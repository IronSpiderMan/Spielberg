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
    use std::error::Error;
    let mut message = format!("视频生成请求失败（{url}）：{error}");
    let mut source = error.source();
    while let Some(cause) = source {
        message.push_str(&format!("；{cause}"));
        source = cause.source();
    }
    message
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
}
