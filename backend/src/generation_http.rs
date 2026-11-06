use reqwest::blocking::ClientBuilder;
use std::net::IpAddr;

// LAN and Tailscale generation services must remain reachable when the app
// inherits HTTP_PROXY. Public generation services keep the normal proxy policy.
fn is_local_service(raw: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(raw) else { return false };
    let Some(host) = url.host_str() else { return false };
    let host = host.trim_matches(['[', ']']).trim_end_matches('.').to_ascii_lowercase();
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.is_private() || ip.is_loopback() || ip.is_link_local()
            || (ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1])),
        Ok(IpAddr::V6(ip)) => ip.is_loopback() || (ip.segments()[0] & 0xfe00 == 0xfc00)
            || (ip.segments()[0] & 0xffc0 == 0xfe80)
            || ip.to_ipv4_mapped().is_some_and(|ip| is_local_service(&format!("http://{ip}"))),
        Err(_) => !host.contains('.') || host.ends_with(".localhost")
            || host.ends_with(".local") || host.ends_with(".ts.net"),
    }
}

fn proxy_policy(builder: ClientBuilder, url: &str) -> ClientBuilder {
    if is_local_service(url) { builder.no_proxy() } else { builder }
}

pub(crate) fn client_builder(url: &str) -> ClientBuilder {
    proxy_policy(reqwest::blocking::Client::builder(), url)
}

pub(crate) fn submission_client_builder(url: &str) -> ClientBuilder {
    // Reference media can take minutes to upload over a Tailscale relay. Keep
    // connection establishment bounded without aborting a progressing upload.
    client_builder(url).connect_timeout(std::time::Duration::from_secs(15)).timeout(None)
}

pub(crate) fn request_error(error: &reqwest::Error, url: &str) -> String {
    request_error_for(error, url, "视频生成")
}

fn diagnostic_url(raw: &str) -> Option<reqwest::Url> {
    let mut url = reqwest::Url::parse(raw).ok()?;
    if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() { return None }
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    Some(url)
}

// reqwest's Display includes its URL, and a nested error may include another
// URL after a redirect. Never display credentials or signed query parameters.
fn scrub_diagnostic_urls(text: &str, hide_urls: bool) -> String {
    let mut result = String::new();
    let mut rest = text;
    while let Some(start) = [rest.find("http://"), rest.find("https://")].into_iter().flatten().min() {
        result.push_str(&rest[..start]);
        let tail = &rest[start..];
        let end = tail.find(|c: char| c.is_whitespace() || matches!(c, ')' | '}' | '>' | '\'' | '"')).unwrap_or(tail.len());
        if hide_urls {
            result.push_str("[服务地址]");
        } else {
            result.push_str(&diagnostic_url(&tail[..end]).map(|url| url.to_string()).unwrap_or_else(|| "[无效服务地址]".into()));
        }
        rest = &tail[end..];
    }
    result.push_str(rest);
    result
}

fn tls_protocol_mismatch(is_connect: bool, url: &str, causes: &[String]) -> bool {
    if !is_connect || diagnostic_url(url).is_none_or(|url| url.scheme() != "https") { return false }
    causes.iter().any(|cause| {
        // Exclude URL text itself, so a host or path cannot create a TLS hint.
        let cause = scrub_diagnostic_urls(cause, true).to_ascii_lowercase().replace('_', " ");
        ["record overflow", "wrong version number", "packet length too long", "plaintext http traffic on an https channel"]
            .iter().any(|marker| cause.contains(marker))
    })
}

pub(crate) fn request_error_for(error: &reqwest::Error, url: &str, operation: &str) -> String {
    use std::error::Error;
    let mut causes = Vec::new();
    let mut source = error.source();
    while let Some(cause) = source.filter(|_| causes.len() < 16) {
        causes.push(cause.to_string());
        source = cause.source();
    }
    let mismatch = tls_protocol_mismatch(error.is_connect(), url, &causes);
    let endpoint = diagnostic_url(url).map(|url| url.to_string()).unwrap_or_else(|| "[无效服务地址]".into());
    let mut details = vec![scrub_diagnostic_urls(&error.to_string(), false)];
    for cause in causes {
        let cause = scrub_diagnostic_urls(&cause, false);
        if !details.contains(&cause) { details.push(cause); }
    }
    let details: String = details.join("；").chars().take(1200).collect();
    if mismatch {
        let mut candidate = diagnostic_url(url).expect("HTTPS URL checked above");
        let _ = candidate.set_scheme("http");
        return format!("{operation}连接失败：可能将 HTTP 服务误填为 HTTPS。请检查渠道 Base URL，可尝试 {candidate}。诊断：{details}");
    }
    format!("{operation}请求失败（{endpoint}）：{details}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn local_services_include_lan_and_tailscale_but_not_public_hosts() {
        for url in ["http://zack-4090:8001", "http://192.168.66.185:8001", "http://100.114.83.111:8001",
            "http://host.tail123.ts.net:8001", "http://localhost:8001", "http://host.local:8001",
            "http://127.0.0.1", "http://[::1]", "http://[fd7a:115c:a1e0::1]", "http://[::ffff:192.168.1.2]"] {
            assert!(is_local_service(url), "{url}");
        }
        for url in ["https://api.example.com", "https://example.ts.net.evil.com", "http://100.128.0.1",
            "http://100.63.255.255", "http://8.8.8.8", "http://[2606:4700:4700::1111]", "invalid"] {
            assert!(!is_local_service(url), "{url}");
        }
    }

    #[test]
    fn local_requests_bypass_an_unreachable_proxy() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/health", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            loop {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream.set_nonblocking(false).unwrap();
                        stream.set_read_timeout(Some(std::time::Duration::from_secs(2))).unwrap();
                        let mut bytes = [0; 4096];
                        let n = stream.read(&mut bytes).unwrap();
                        assert!(String::from_utf8_lossy(&bytes[..n]).starts_with("GET /health "));
                        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").unwrap();
                        break;
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock && std::time::Instant::now() < deadline =>
                        std::thread::sleep(std::time::Duration::from_millis(10)),
                    Err(e) => panic!("direct request did not arrive: {e}"),
                }
            }
        });
        let builder = reqwest::blocking::Client::builder()
            .proxy(reqwest::Proxy::all("http://127.0.0.1:9").unwrap());
        let result = proxy_policy(builder, &url).timeout(std::time::Duration::from_secs(2))
            .build().unwrap().get(url).send().unwrap().text().unwrap();
        assert_eq!(result, "ok");
        server.join().unwrap();
    }

    #[test]
    fn protocol_hints_require_https_connection_errors_and_known_tls_markers() {
        for marker in ["record overflow", "error:wrong version number", "SSL routines:packet length too long", "WRONG_VERSION_NUMBER"] {
            assert!(tls_protocol_mismatch(true, "https://zack-4090:8880/v1/audio/speech", &[marker.into()]));
            assert!(!tls_protocol_mismatch(false, "https://zack-4090:8880/v1/audio/speech", &[marker.into()]));
            assert!(!tls_protocol_mismatch(true, "http://zack-4090:8880/v1/audio/speech", &[marker.into()]));
        }
        for cause in ["certificate verify failed", "connection refused", "operation timed out", "error for url (https://host/wrong_version_number)"] {
            assert!(!tls_protocol_mismatch(true, "https://host/", &[cause.into()]), "{cause}");
        }
    }

    #[test]
    fn diagnostics_redact_url_credentials_queries_and_fragments() {
        let text = "error for url (https://user:secret@host:8880/v1/audio/speech?api_key=private-key#private-fragment); redirect https://other-user:other-secret@other-host/path?signature=private-signature";
        let result = scrub_diagnostic_urls(text, false);
        assert_eq!(result, "error for url (https://host:8880/v1/audio/speech); redirect https://other-host/path");
        assert_eq!(diagnostic_url("http://[::1]:8880/v1?token=secret").unwrap().as_str(), "http://[::1]:8880/v1");
    }

    #[test]
    fn https_to_plain_http_reports_protocol_hint_without_retrying_insecurely() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock && std::time::Instant::now() < deadline =>
                        std::thread::sleep(std::time::Duration::from_millis(10)),
                    Err(e) => panic!("TLS fixture connection did not arrive: {e}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream.set_read_timeout(Some(std::time::Duration::from_secs(2))).unwrap();
            let mut hello = [0; 4096];
            let count = stream.read(&mut hello).unwrap();
            assert!(count > 5);
            assert_eq!(hello[0], 0x16, "client must send TLS, never an insecure HTTP retry");
            // A real HTTP server's plaintext header is misread as a TLS record.
            // This yields record overflow on macOS native-tls and wrong version
            // number / packet length too long on other TLS implementations.
            stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            drop(stream);
        });
        let url = format!("https://user:private-password@{address}/v1/audio/speech?token=private-token#private-fragment");
        let error = client_builder(&url).timeout(std::time::Duration::from_secs(3)).build().unwrap().post(&url).send().unwrap_err();
        server.join().unwrap();
        assert!(error.is_connect());
        let message = request_error_for(&error, &url, "语音合成");
        assert!(message.contains("可能将 HTTP 服务误填为 HTTPS"), "{message}");
        assert!(message.contains(&format!("http://{address}/v1/audio/speech")), "{message}");
        assert!(!message.contains("private-"), "{message}");
    }
}
