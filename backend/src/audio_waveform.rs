use super::*;
use std::hash::{Hash, Hasher};
use std::io::{BufReader, Read};
use std::process::Stdio;

const BINS: usize = 2048;
static GENERATION: Mutex<()> = Mutex::new(());

pub(super) fn get(s: &AppState, v: &Value) -> Result<Value, String> {
    let pid = project_id(v)?;
    let c = db(s, &pid)?;
    let item = media(&c, Some(intv(v, "media_id")?)).ok_or("音频素材不存在或已删除")?;
    if item["kind"] != "audio" { return Err("只能读取音频素材的波形".into()); }
    let source = item["path"].as_str().ok_or("音频路径无效")?;
    if v.get("source_path").is_some_and(|value| value.as_str() != Some(source)) {
        return Err("素材已更新，请重新打开后再操作".into());
    }
    let root = PathBuf::from(strv(&project(s, &pid)?, "path")?);
    let cache = root.join(".cache");
    let dir = cache.join("waveforms");
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    for path in [&cache, &dir] {
        if path.exists() && !path.canonicalize().map_err(|e| e.to_string())?.starts_with(&canonical_root) {
            return Err("缓存目录不能指向项目之外".into());
        }
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let metadata = fs::metadata(source).map_err(|e| e.to_string())?;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    ("waveform-v1", source, metadata.len(), metadata.modified().ok()).hash(&mut hash);
    let output = dir.join(format!("{:x}.json", hash.finish()));
    let _lock = GENERATION.lock().map_err(|_| "波形缓存不可用")?;
    if let Ok(bytes) = fs::read(&output) {
        if let Ok(value) = serde_json::from_slice::<Value>(&bytes) { return Ok(value); }
    }
    let value = generate(source)?;
    // Cache writes are atomic; interrupted analysis never leaves a partial result.
    let temporary = dir.join(format!("{}.tmp", Uuid::new_v4()));
    let result = (|| {
        fs::write(&temporary, value.to_string()).map_err(|e| e.to_string())?;
        fs::rename(&temporary, &output).map_err(|e| e.to_string())?;
        Ok(value)
    })();
    if result.is_err() { let _ = fs::remove_file(temporary); }
    result
}

fn generate(source: &str) -> Result<Value, String> {
    let out = editor::run(crate::background_command(editor::binary("ffprobe")).args([
        "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels:format=duration", "-of", "json", source,
    ]))?;
    let info: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    let rate = info["streams"][0]["sample_rate"].as_str().and_then(|s| s.parse::<u64>().ok()).filter(|n| *n > 0).ok_or("无法读取音频采样率")?;
    let channels = info["streams"][0]["channels"].as_u64().filter(|n| *n > 0).ok_or("素材没有可用音轨")?;
    let duration = info["format"]["duration"].as_str().and_then(|s| s.parse::<f64>().ok()).filter(|n| n.is_finite() && *n > 0.0).ok_or("无法读取音频时长")?;
    // Preserve every channel: a mono downmix would erase out-of-phase stereo sound.
    // Stream PCM into fixed-size envelopes instead of retaining the decoded audio in memory.
    let mut child = crate::background_command(editor::binary("ffmpeg")).args([
        "-v", "error", "-nostdin", "-i", source, "-map", "0:a:0", "-vn", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1",
    ]).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("无法运行 FFmpeg：{e}"))?;
    let stderr = child.stderr.take().ok_or("无法读取波形处理状态")?;
    let errors = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.take(2048).read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes).into_owned()
    });
    let mut reader = BufReader::new(child.stdout.take().ok_or("无法读取波形数据")?);
    let bins = (duration * rate as f64).ceil().clamp(1.0, BINS as f64) as usize;
    let mut peaks = vec![0.0_f64; bins];
    let mut squares = vec![0.0_f64; bins];
    let mut counts = vec![0_u64; bins];
    let mut sample = [0_u8; 4];
    let mut index = 0_u64;
    let samples_per_bin = (duration * rate as f64 * channels as f64 / bins as f64).max(1.0);
    let read_result = loop {
        match reader.read_exact(&mut sample) {
            Ok(()) => {
                let bin = ((index as f64 / samples_per_bin) as usize).min(bins - 1);
                let value = f32::from_le_bytes(sample) as f64;
                if value.is_finite() {
                    peaks[bin] = peaks[bin].max(value.abs());
                    squares[bin] += value * value;
                    counts[bin] += 1;
                }
                index += 1;
            }
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => break Ok(()),
            Err(error) => break Err(format!("读取波形失败：{error}")),
        }
    };
    if read_result.is_err() { let _ = child.kill(); }
    let status = child.wait().map_err(|e| e.to_string())?;
    let error = errors.join().unwrap_or_default();
    read_result?;
    if !status.success() || index == 0 { return Err(format!("无法生成音频波形：{error}")); }
    let round = |value: f64| (value.min(1.0) * 1_000_000.0).round() / 1_000_000.0;
    let rms: Vec<f64> = squares.iter().zip(&counts).map(|(sum, count)| round(if *count > 0 { (sum / *count as f64).sqrt() } else { 0.0 })).collect();
    Ok(json!({"duration":duration,"peaks":peaks.into_iter().map(round).collect::<Vec<_>>(),"rms":rms,"silence_threshold":0.003162278}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(duration: f64, silent: bool) -> Vec<u8> {
        let rate = 8000_u32;
        let frames = (duration * rate as f64) as u32;
        let size = frames * 4;
        let mut bytes = Vec::new();
        bytes.extend(b"RIFF"); bytes.extend((36 + size).to_le_bytes()); bytes.extend(b"WAVEfmt ");
        bytes.extend(16_u32.to_le_bytes()); bytes.extend(1_u16.to_le_bytes()); bytes.extend(2_u16.to_le_bytes());
        bytes.extend(rate.to_le_bytes()); bytes.extend((rate * 4).to_le_bytes()); bytes.extend(4_u16.to_le_bytes()); bytes.extend(16_u16.to_le_bytes());
        bytes.extend(b"data"); bytes.extend(size.to_le_bytes());
        for frame in 0..frames {
            let t = frame as f64 / rate as f64;
            let tone = (0.25 * (t * 440.0 * std::f64::consts::TAU).sin() * i16::MAX as f64) as i16;
            let (left, right) = if silent { (0,0) } else if (0.5..1.5).contains(&t) { (tone, -tone) } else if (2.0..2.6).contains(&t) { (0,tone) } else { (0,0) };
            bytes.extend(left.to_le_bytes()); bytes.extend(right.to_le_bytes());
        }
        bytes
    }

    #[test]
    fn real_envelopes_preserve_silence_and_channels_and_invalidate_cache() {
        let root = std::env::temp_dir().join(format!("waveform-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let s = AppState {root:root.clone(),guard:std::sync::Arc::new(Mutex::new(()))};
        let result = (|| -> Result<(),String> {
            let p = create_project(&s,&json!({"name":"Waveform"}))?;
            let other = create_project(&s,&json!({"name":"Other"}))?;
            let pid = p["id"].as_str().unwrap();
            let source = root.join("silence-and-tone.wav");
            fs::write(&source, wav(3.0,false)).unwrap();
            let item = import_media(&s,&json!({"project_id":pid,"source_path":source}))?;
            let request = json!({"project_id":pid,"media_id":item["id"],"source_path":item["path"]});
            let c = db(&s,pid)?;
            let revisions = catalog::revisions(&c)?;
            let wave = rest::action(&s,"/media/audio-waveform",request.clone()).map_err(|e|e.1)?;
            let peaks = wave["peaks"].as_array().unwrap();
            let rms = wave["rms"].as_array().unwrap();
            let at = |seconds:f64| (seconds/3.0*peaks.len() as f64) as usize;
            assert_eq!(peaks.len(),BINS); assert_eq!(rms.len(),BINS);
            assert_eq!(wave["duration"],3.0);
            for seconds in [0.1,0.3,1.7,2.8] { assert_eq!(peaks[at(seconds)],0.0,"Silence must remain flat"); }
            for seconds in [0.7,1.2,2.2,2.5] {
                assert!(peaks[at(seconds)].as_f64().unwrap()>0.2,"Do not cancel antiphase or right-only sound");
                assert!(rms[at(seconds)].as_f64().unwrap()>0.1);
            }
            assert_eq!(catalog::revisions(&c)?,revisions,"Reading waveforms must not edit the media catalog");
            let cache = PathBuf::from(p["path"].as_str().unwrap()).join(".cache/waveforms");
            let file = fs::read_dir(&cache).unwrap().next().unwrap().unwrap().path();
            let stamp = fs::metadata(&file).unwrap().modified().unwrap();
            assert_eq!(get(&s,&request)?,wave);
            assert_eq!(fs::metadata(file).unwrap().modified().unwrap(),stamp);
            fs::write(item["path"].as_str().unwrap(),wav(3.25,true)).unwrap();
            let updated = get(&s,&request)?;
            assert_eq!(updated["duration"],3.25);
            assert!(updated["peaks"].as_array().unwrap().iter().all(|v|v==0.0));
            let cut = editor::process_audio(&s,&json!({"project_id":pid,"media_id":item["id"],"start":0.2,"end":1.2,"overwrite":true}),false)?;
            assert!(get(&s,&request).unwrap_err().contains("已更新"));
            let current = json!({"project_id":pid,"media_id":cut["id"],"source_path":cut["path"]});
            assert!((get(&s,&current)?["duration"].as_f64().unwrap()-1.0).abs()<0.001);
            let mut wrong = current.clone(); wrong["project_id"] = other["id"].clone();
            assert!(get(&s,&wrong).is_err());
            fs::write(cut["path"].as_str().unwrap(),b"broken file").unwrap();
            let count = fs::read_dir(&cache).unwrap().count();
            assert!(get(&s,&current).is_err());
            assert_eq!(fs::read_dir(&cache).unwrap().count(),count,"Failed analysis must not cache a silent waveform");
            let project_root = PathBuf::from(p["path"].as_str().unwrap());
            assert!(catalog::disk_scan(&c,&project_root)?["cache_bytes"].as_u64().unwrap()>0);
            catalog::cleanup(&c,&project_root,&json!({"clear_cache":true}))?;
            assert_eq!(fs::read_dir(&cache).unwrap().count(),0,"Disk cleanup must include waveform caches");
            catalog::trash(&c,cut["id"].as_i64().unwrap())?;
            assert!(get(&s,&current).is_err());
            Ok(())
        })();
        let _ = fs::remove_dir_all(root);
        result.unwrap();
    }
}
