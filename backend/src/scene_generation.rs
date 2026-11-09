use super::*;

const REQUEST_FIELDS: &[&str] = &[
    "channel_id",
    "model",
    "aspect_ratio",
    "size",
    "resolution",
    "audio",
];
// Preserve authored numbering before deduplicating the submitted reference list.
fn ordered_ids(v: &Value, key: &str) -> Result<Vec<i64>, String> {
    match v.get(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value
                    .as_i64()
                    .ok_or_else(|| format!("{key} 必须是媒体 ID 数组"))
            })
            .collect(),
        _ => Err(format!("{key} 必须是媒体 ID 数组")),
    }
}

#[derive(Clone, Default)]
struct References {
    images: Vec<i64>,
    videos: Vec<i64>,
    audios: Vec<i64>,
}

impl References {
    fn from_request(v: &Value) -> Result<Self, String> {
        let mut images = ordered_ids(v, "image_media_ids")?;
        if images.is_empty() {
            images.extend(opti(v, "image_media_id"));
        }
        Ok(Self {
            images,
            videos: ordered_ids(v, "reference_video_media_ids")?,
            audios: ordered_ids(v, "reference_audio_media_ids")?,
        })
    }

    fn from_options(v: &Value, fallback_image: Option<i64>) -> Result<Self, String> {
        let mut refs = Self::from_request(v)?;
        refs.images = if v["reference_media_ids"].is_array() {
            ordered_ids(v, "reference_media_ids")?
        } else if refs.images.is_empty() {
            fallback_image.into_iter().collect()
        } else {
            refs.images
        };
        Ok(refs)
    }

    fn is_empty(&self) -> bool {
        self.images.is_empty() && self.videos.is_empty() && self.audios.is_empty()
    }

    fn extend(&mut self, other: &Self) {
        for (ids, extra) in [
            (&mut self.images, &other.images),
            (&mut self.videos, &other.videos),
            (&mut self.audios, &other.audios),
        ] {
            for id in extra {
                if !ids.contains(id) {
                    ids.push(*id);
                }
            }
        }
    }

    fn write_to(&self, v: &mut Value) {
        v["image_media_ids"] = json!(self.images);
        v["reference_video_media_ids"] = json!(self.videos);
        v["reference_audio_media_ids"] = json!(self.audios);
        v["image_media_id"] = Value::Null;
    }

    fn for_frames(first: Option<i64>, last: Option<i64>) -> Self {
        Self {
            images: first.into_iter().chain(last).collect(),
            ..Self::default()
        }
    }
}

fn stored_object(raw: String) -> Result<Value, String> {
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn scene_record(c: &Connection, id: i64) -> Result<Value, String> {
    let (title, description, shared_prompt, images, audios, mode, options) = c.query_row(
        "SELECT title,description,shared_prompt,reference_media_ids,reference_audio_media_ids,generation_mode,generation_options FROM scenes WHERE id=?",
        [id],
        |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?)),
    ).optional().map_err(|e| e.to_string())?.ok_or("场景不存在")?;
    Ok(json!({
        "title": title, "description": description, "shared_prompt": shared_prompt,
        "reference_media_ids": stored_object(images)?, "reference_audio_media_ids": stored_object(audios)?,
        "generation_mode": mode, "generation_options": stored_object(options)?
    }))
}

fn clip_record(c: &Connection, id: i64) -> Result<Value, String> {
    let mut clip = c.query_row(
        "SELECT scene_id,title,description,prompt,first_media_id,last_media_id,reference_media_id FROM clips WHERE id=?",
        [id],
        |r| Ok(json!({
            "id":id,"scene_id":r.get::<_,i64>(0)?,"title":r.get::<_,String>(1)?,
            "description":r.get::<_,String>(2)?,"prompt":r.get::<_,String>(3)?,
            "first_media_id":r.get::<_,Option<i64>>(4)?,"last_media_id":r.get::<_,Option<i64>>(5)?,
            "reference_media_id":r.get::<_,Option<i64>>(6)?
        })),
    ).optional().map_err(|e| e.to_string())?.ok_or("片段不存在")?;
    clip["generation_options"] = clip_options(c, id)?;
    Ok(clip)
}

fn clip_inputs(c: &Connection, id: i64) -> Result<(Value, Value), String> {
    let clip = clip_record(c, id)?;
    let scene = scene_record(c, intv(&clip, "scene_id")?)?;
    Ok((clip, scene))
}

fn scene_inputs(c: &Connection, id: i64) -> Result<Value, String> {
    let scene = scene_record(c, id)?;
    let mut query = c
        .prepare("SELECT id FROM clips WHERE scene_id=? ORDER BY sort_order,id")
        .map_err(|e| e.to_string())?;
    let ids = query
        .query_map([id], |r| r.get::<_, i64>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let clips = ids
        .into_iter()
        .map(|id| clip_record(c, id))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({"scene":scene,"clips":clips}))
}

fn trim_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("").trim()
}

fn configured_mode(
    explicit: Option<&str>,
    refs: &References,
    first: Option<i64>,
) -> Result<&'static str, String> {
    match explicit {
        Some("t2v") => Ok("t2v"),
        Some("fl2v") => Ok("fl2v"),
        Some("i2v" | "ref2v") => Ok("ref2v"),
        Some(_) => Err("未知视频生成模式".into()),
        None if !refs.is_empty() => Ok("ref2v"),
        None if first.is_some() => Ok("fl2v"),
        None => Ok("t2v"),
    }
}

fn shared_refs(scene: &Value) -> Result<References, String> {
    let mut refs = References::from_options(scene, None)?;
    refs.videos = ordered_ids(&scene["generation_options"], "reference_video_media_ids")?;
    Ok(refs)
}

fn clipped_shared_refs(shared: &References, options: &Value) -> Result<References, String> {
    let mut refs = shared.clone();
    let excluded_images = reference_media_ids(options, "exclude_shared_reference_media_ids")?;
    let excluded_audios = reference_media_ids(options, "exclude_shared_reference_audio_media_ids")?;
    refs.images.retain(|id| !excluded_images.contains(id));
    refs.audios.retain(|id| !excluded_audios.contains(id));
    Ok(refs)
}

fn has_mention_boundary(rest: &str) -> bool {
    let rest = rest.strip_prefix('.').unwrap_or(rest);
    rest.chars()
        .next()
        .is_none_or(|c| c.is_whitespace() || "，。！？、；：,!?;:\"'<>@()（）".contains(c))
}

fn mentions(
    s: &AppState,
    c: &Connection,
    pid: &str,
    prompt: &str,
    images: &[i64],
) -> Result<String, String> {
    if !prompt.contains('@') {
        return Ok(prompt.to_string());
    }
    let mut query = c
        .prepare("SELECT id,name,content FROM prompts ORDER BY id")
        .map_err(|e| e.to_string())?;
    let prompts = query
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let names = prompts
        .iter()
        .map(|(id, name, content)| {
            let alias = if prompts.iter().filter(|(_, other, _)| other == name).count() > 1 {
                format!("prompt.{name}#{id}")
            } else {
                format!("prompt.{name}")
            };
            (alias, content.clone())
        })
        .collect::<Vec<_>>();
    let expanded = replace_mentions(prompt, &names);
    if !expanded.contains('@') {
        return Ok(expanded);
    }
    let catalog = storyboard::assets(s, pid)?;
    let names = catalog
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let name = item["name"].as_str()?;
            let description = trim_field(item, "description");
            let reference =
                opti(item, "media_id").and_then(|id| images.iter().position(|media| *media == id));
            let replacement = match (description.is_empty(), reference) {
                (false, Some(i)) => format!("{name}（{description}，参考 [Image {}]）", i + 1),
                (true, Some(i)) => format!("{name}（参考 [Image {}]）", i + 1),
                (false, None) => format!("{name}（{description}）"),
                (true, None) => name.to_string(),
            };
            Some((name.to_string(), replacement))
        })
        .collect::<Vec<_>>();
    Ok(replace_mentions(&expanded, &names))
}

fn replace_mentions(prompt: &str, names: &[(String, String)]) -> String {
    let mut result = String::new();
    let mut rest = prompt;
    while let Some((before, after)) = rest.split_once('@') {
        result.push_str(before);
        let matched = names
            .iter()
            .filter_map(|(name, text)| {
                let remainder = after.strip_prefix(name)?;
                has_mention_boundary(remainder).then_some((name.len(), text, remainder))
            })
            .max_by_key(|(len, _, _)| *len);
        if let Some((_, text, remainder)) = matched {
            result.push_str(text);
            rest = remainder;
        } else {
            result.push('@');
            rest = after;
        }
    }
    result.push_str(rest);
    result
}

fn remap_token(
    prompt: &str,
    prefix: &str,
    suffix: char,
    source: &[i64],
    destination: &[i64],
) -> Result<String, String> {
    let mut parts = prompt.split(prefix);
    let mut result = parts.next().unwrap_or("").to_string();
    for part in parts {
        result.push_str(prefix);
        if let Some((number, rest)) = part.split_once(suffix) {
            if let Ok(index) = number.parse::<usize>() {
                let id = index
                    .checked_sub(1)
                    .and_then(|i| source.get(i))
                    .ok_or_else(|| format!("Prompt 中的 {prefix}{index}{suffix} 未绑定参考素材"))?;
                let new_index = destination
                    .iter()
                    .position(|target| target == id)
                    .ok_or_else(|| {
                        format!("Prompt 中的 {prefix}{index}{suffix} 引用的素材未随当前请求提交")
                    })?;
                result.push_str(&(new_index + 1).to_string());
                result.push(suffix);
                result.push_str(rest);
                continue;
            }
        }
        result.push_str(part);
    }
    Ok(result)
}

fn remap_references(
    prompt: &str,
    source: &References,
    destination: &References,
) -> Result<String, String> {
    let mut text = prompt.to_string();
    for (prefix, suffix, from, to) in [
        ("[Image ", ']', &source.images, &destination.images),
        ("<Picture ", '>', &source.images, &destination.images),
        ("<Video ", '>', &source.videos, &destination.videos),
        ("<Audio ", '>', &source.audios, &destination.audios),
    ] {
        text = remap_token(&text, prefix, suffix, from, to)?;
    }
    Ok(text)
}

fn merge_clip_prompt(shared: &str, local: &str) -> String {
    if shared.is_empty() {
        return local.to_string();
    }
    for section in [
        "detailed_description:",
        "integrated_multimodal_description:",
    ] {
        if let Some((before, after)) = local.split_once(section) {
            return format!("{before}{section}\n{shared}\n{}", after.trim_start());
        }
    }
    [shared, local]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn copy_options(to: &mut Value, from: &Value) {
    for key in REQUEST_FIELDS {
        if to.get(*key).is_none() && !from[*key].is_null() {
            to[*key] = from[*key].clone();
        }
    }
}

pub(super) fn prepare_clip(
    s: &AppState,
    c: &Connection,
    pid: &str,
    v: &Value,
) -> Result<Value, String> {
    let clip_id = intv(v, "clip_id")?;
    let (clip, scene) = clip_inputs(c, clip_id)?;
    let options = &clip["generation_options"];
    let shared = shared_refs(&scene)?;
    let mut effective_options = options.clone();
    for key in [
        "inherit_shared_prompt",
        "exclude_shared_reference_media_ids",
        "exclude_shared_reference_audio_media_ids",
    ] {
        if let Some(value) = v.get(key) {
            effective_options[key] = value.clone();
        }
    }
    let inherited = clipped_shared_refs(&shared, &effective_options)?;
    let saved_inputs = [
        "operation",
        "video_mode",
        "image_media_ids",
        "image_media_id",
        "first_media_id",
        "last_media_id",
        "reference_video_media_ids",
        "reference_audio_media_ids",
    ]
    .iter()
    .all(|k| v.get(*k).is_none());
    let local_refs = if saved_inputs {
        References::from_options(options, opti(&clip, "reference_media_id"))?
    } else {
        References::from_request(v)?
    };
    let first = opti(if saved_inputs { &clip } else { v }, "first_media_id");
    let last = opti(if saved_inputs { &clip } else { v }, "last_media_id");
    let explicit = if saved_inputs {
        options["video_mode"].as_str()
    } else {
        v["video_mode"].as_str().or(v["operation"].as_str())
    };
    let mut available = local_refs.clone();
    if saved_inputs && first.is_none() {
        available.extend(&inherited);
    }
    let mode = configured_mode(explicit, &available, first)?;
    if !saved_inputs && mode != "fl2v" && (first.is_some() || last.is_some()) {
        return Err("只有首尾帧模式可以指定首帧或尾帧".into());
    }
    let mut request = v.clone();
    if saved_inputs {
        copy_options(&mut request, options);
    }
    if request.get("duration").is_none() {
        request["duration"] = options.get("duration").cloned().unwrap_or(json!(5));
    }
    request["operation"] = json!(mode);
    request["video_mode"] = json!(mode);
    request["first_media_id"] = json!(first.filter(|_| mode == "fl2v"));
    request["last_media_id"] = json!(last.filter(|_| mode == "fl2v"));
    let mut warnings = Vec::new();
    let (local_source, effective) = match mode {
        "ref2v" => {
            let mut refs = References::default();
            refs.extend(&local_refs);
            refs.extend(&inherited);
            refs.write_to(&mut request);
            (local_refs, refs)
        }
        "fl2v" | "t2v" => {
            if !saved_inputs && !local_refs.is_empty() {
                return Err("文生视频与首尾帧模式不能混用参考素材".into());
            }
            if !inherited.is_empty() {
                warnings.push("当前生成方式仅继承文字设定，共享参考素材未提交");
            }
            References::default().write_to(&mut request);
            let frames = if mode == "fl2v" {
                References::for_frames(first, last)
            } else {
                References::default()
            };
            (frames.clone(), frames)
        }
        _ => unreachable!(),
    };
    let local = v["prompt"].as_str().map(str::trim).unwrap_or_else(|| {
        let prompt = trim_field(&clip, "prompt");
        if prompt.is_empty() {
            trim_field(&clip, "description")
        } else {
            prompt
        }
    });
    let local = remap_references(local, &local_source, &effective)?;
    let shared_prompt = if effective_options["inherit_shared_prompt"] == false {
        String::new()
    } else {
        remap_references(trim_field(&scene, "shared_prompt"), &shared, &effective)?
    };
    let prompt = merge_clip_prompt(&shared_prompt, &local);
    request["prompt"] = json!(mentions(s, c, pid, &prompt, &effective.images)?);
    request["warnings"] = json!(warnings);
    request["_clip_inputs"] = json!([clip, scene]);
    Ok(request)
}

fn timecode(seconds: f64) -> String {
    let millis = (seconds * 1000.0).round() as u64;
    format!(
        "{:02}:{:02}.{:03}",
        millis / 60_000,
        (millis / 1000) % 60,
        millis % 1000
    )
}

fn h3_image_labels(text: &str) -> String {
    let mut parts = text.split("[Image ");
    let mut output = parts.next().unwrap_or("").to_string();
    for part in parts {
        if let Some((number, rest)) = part.split_once(']') {
            if number.parse::<usize>().is_ok() {
                output.push_str(&format!("<Picture {number}>{rest}"));
                continue;
            }
        }
        output.push_str("[Image ");
        output.push_str(part);
    }
    output
}

fn one_take_prompt(
    config: &Value,
    mode: &str,
    request: &Value,
    context: &str,
    beats: &str,
    refs: &References,
) -> String {
    let model = config["model"].as_str().unwrap_or("");
    if !["minimax-h3", "standard", "turbo8", "pika"].contains(&model) {
        return format!("一个连续镜头，从开场到结束保持连续运镜和空间关系。下列时间点仅标记动作变化，镜头始终连续。\n{context}\n{beats}");
    }
    let context = h3_image_labels(context);
    let beats = h3_image_labels(beats);
    let continuous = format!("{context}\n[Shot 1] A single uninterrupted continuous camera take from beginning to end. Time markers below describe changes in action within this same shot. Maintain spatial, wardrobe and sound continuity.\n{beats}");
    let sound = "\noverall_soundscape: Follow the ambient, action and dialogue cues above.\nnon_diegetic_music: Follow the scene's sound design.";
    match mode {
        "ref2v" => {
            let mut subjects = Vec::new();
            for (ids, label) in [(&refs.images,"Picture"),(&refs.videos,"Video"),(&refs.audios,"Audio")] {
                for index in 1..=ids.len() {
                    subjects.push(format!("<{label} {index}>: Reference for the scene or action described below."));
                }
            }
            format!("subject_definitions:\n{}\nsummary: [reference generation] A single continuous take.\nretention_analysis: Maintain the referenced appearance and sound according to the scene instructions.\ndetailed_description: {continuous}{sound}", subjects.join("\n"))
        }
        "fl2v" if !request["last_media_id"].is_null() => format!(
            "How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the {:.2}-second mark of the target video.\n\nintegrated_multimodal_description: {continuous}{sound}",
            request["duration"].as_f64().unwrap_or(0.0),
        ),
        "fl2v" => format!("For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\nintegrated_multimodal_description: {continuous}{sound}"),
        _ => format!("integrated_multimodal_description: {continuous}{sound}"),
    }
}

pub(super) fn prepare_scene(
    s: &AppState,
    c: &Connection,
    pid: &str,
    v: &Value,
) -> Result<Value, String> {
    let id = intv(v, "scene_id")?;
    let inputs = scene_inputs(c, id)?;
    let scene = &inputs["scene"];
    if scene["generation_mode"] != "one_take" {
        return Err("请将场景生成方式设置为一镜到底".into());
    }
    let clips = inputs["clips"]
        .as_array()
        .filter(|items| !items.is_empty())
        .ok_or("场景至少需要一个片段")?;
    let mut options = scene["generation_options"].clone();
    if let Some(overrides) = v.get("generation_options") {
        for (key, value) in overrides
            .as_object()
            .ok_or("generation_options 必须为对象")?
        {
            options[key] = value.clone();
        }
    }
    let shared = shared_refs(scene)?;
    let mut refs = References::default();
    refs.extend(&shared);
    let mut sources = Vec::new();
    for clip in clips {
        let refs_for_clip = References::from_options(
            &clip["generation_options"],
            opti(clip, "reference_media_id"),
        )?;
        refs.extend(&refs_for_clip);
        sources.push(refs_for_clip);
    }
    let first = opti(&options, "first_media_id").or_else(|| {
        options
            .get("first_media_id")
            .is_none()
            .then(|| opti(&clips[0], "first_media_id"))
            .flatten()
    });
    let last = opti(&options, "last_media_id").or_else(|| {
        options
            .get("last_media_id")
            .is_none()
            .then(|| opti(clips.last().unwrap(), "last_media_id"))
            .flatten()
    });
    let mode = configured_mode(options["video_mode"].as_str(), &refs, first)?;
    let mut request = json!({
        "project_id":pid,"scene_id":id,"operation":mode,"video_mode":mode,
        "first_media_id":first.filter(|_|mode=="fl2v"),"last_media_id":last.filter(|_|mode=="fl2v")
    });
    copy_options(&mut request, &options);
    let mut warnings = Vec::new();
    let effective = if mode == "ref2v" {
        refs.write_to(&mut request);
        refs
    } else {
        if !refs.is_empty() {
            warnings.push("当前生成方式不会提交共享或片段参考素材".to_string());
        }
        References::default().write_to(&mut request);
        if mode == "fl2v" {
            References::for_frames(first, last)
        } else {
            References::default()
        }
    };
    let mut timeline = Vec::new();
    let mut total = 0.0;
    let mut beats = Vec::new();
    for (clip, local_refs) in clips.iter().zip(sources.iter()) {
        let duration = clip["generation_options"]
            .get("duration")
            .map(Value::as_f64)
            .unwrap_or(Some(5.0))
            .filter(|time| time.is_finite() && *time > 0.0)
            .ok_or_else(|| format!("片段「{}」需要设置具体时长", trim_field(clip, "title")))?;
        let end = ((total + duration) * 1000.0).round() / 1000.0;
        if end <= total {
            return Err("片段时长至少需要 0.001 秒".into());
        }
        let title = trim_field(clip, "title");
        let description = trim_field(clip, "description");
        let prompt = trim_field(clip, "prompt");
        let action = if prompt.is_empty() || prompt.contains("[Shot ") {
            if prompt.contains("[Shot ") && !description.is_empty() {
                warnings.push(format!(
                    "片段「{title}」采用动作描述，原分镜 Prompt 含独立镜头标记。"
                ));
            }
            if description.is_empty() {
                prompt
            } else {
                description
            }
        } else {
            prompt
        };
        if action.is_empty() {
            return Err(format!("请填写片段「{title}」的动作描述"));
        }
        if action.contains("[Shot ") {
            return Err(format!(
                "请将片段「{title}」的动作写成连续描述，去掉 [Shot N] 分镜标记"
            ));
        }
        let clip_first = opti(clip, "first_media_id");
        let clip_mode = configured_mode(
            clip["generation_options"]["video_mode"].as_str(),
            local_refs,
            clip_first,
        )?;
        let source = if clip_mode == "fl2v" {
            References::for_frames(clip_first, opti(clip, "last_media_id"))
        } else {
            local_refs.clone()
        };
        let action = remap_references(action, &source, &effective)?;
        timeline.push(format!(
            "{}–{} · {title}\n{action}",
            timecode(total),
            timecode(end)
        ));
        beats.push(json!({"clip_id":clip["id"],"title":title,"start":total,"end":end}));
        total = end;
    }
    if total.ceil() != total {
        warnings.push(format!(
            "片段总时长为 {total} 秒，模型按 {} 秒生成，结尾保持最终状态。",
            total.ceil()
        ));
        timeline.push(format!(
            "{}–{} · 保持最终状态，镜头继续至结束。",
            timecode(total),
            timecode(total.ceil())
        ));
    }
    request["duration"] = json!(total.ceil() as i64);
    request["beats"] = json!(beats);
    request["warnings"] = json!(warnings);
    request["_scene_inputs"] = inputs.clone();
    let context = remap_references(trim_field(scene, "shared_prompt"), &shared, &effective)?;
    let description = remap_references(trim_field(scene, "description"), &shared, &effective)?;
    let context = [description, context]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let context = mentions(s, c, pid, &context, &effective.images)?;
    let beats = mentions(s, c, pid, &timeline.join("\n\n"), &effective.images)?;
    if context.contains("[Shot ") || beats.contains("[Shot ") {
        return Err(
            "一镜到底只使用一个镜头，请移除共享描述和片段动作中的 [Shot N] 分镜标记".into(),
        );
    }
    request["prompt"] = json!(format!("{context}\n{beats}"));
    let (_, config) = validate_video_request(c, &request)?;
    if let Some(channel) = config.get("_channel_id") {
        request["channel_id"] = channel.clone();
        request["model"] = config["model"].clone();
    }
    request["prompt"] = json!(one_take_prompt(
        &config, mode, &request, &context, &beats, &effective
    ));
    if config["model"] == "wan3.0-video" {
        request["prompt_extend"] = json!(false);
        if request.get("audio").is_none() {
            request["audio"] = json!(true);
        }
    }
    Ok(request)
}

pub(super) fn clip_preview(s: &AppState, v: &Value) -> Result<Value, String> {
    let pid = project_id(v)?;
    let c = db(s, &pid)?;
    let mut request = prepare_clip(s, &c, &pid, v)?;
    validate_video_request(&c, &request)?;
    request.as_object_mut().unwrap().remove("_clip_inputs");
    Ok(request)
}

pub(super) fn scene_preview(s: &AppState, v: &Value) -> Result<Value, String> {
    let pid = project_id(v)?;
    let c = db(s, &pid)?;
    let mut request = prepare_scene(s, &c, &pid, v)?;
    request.as_object_mut().unwrap().remove("_scene_inputs");
    Ok(request)
}

pub(super) fn attach_result(c: &Connection, v: &Value, mid: i64) -> Result<bool, String> {
    if let Some(scene_id) = opti(v, "scene_id") {
        let exists: bool = c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM scenes WHERE id=?)",
                [scene_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !exists {
            return Ok(true);
        }
        let current = scene_inputs(c, scene_id)? == v["_scene_inputs"];
        scenes::attach_scene_video(c, scene_id, mid, current)?;
        return Ok(!current);
    }
    if let Some(clip_id) = opti(v, "clip_id") {
        let exists: bool = c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM clips WHERE id=?)",
                [clip_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !exists {
            return Ok(true);
        }
        if !v["_clip_inputs"].is_null() {
            let (clip, scene) = clip_inputs(c, clip_id)?;
            if json!([clip, scene]) != v["_clip_inputs"] {
                c.execute(
                    "INSERT INTO clip_videos(clip_id,media_id) VALUES(?,?)",
                    params![clip_id, mid],
                )
                .map_err(|e| e.to_string())?;
                return Ok(true);
            }
        }
        attach_clip_video(c, clip_id, mid)?;
        return Ok(false);
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        state: AppState,
        pid: String,
        episode: i64,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("spielberg-take-{}", Uuid::new_v4()));
            storage::initialize_root(&root).unwrap();
            let state = AppState {
                root,
                guard: std::sync::Arc::new(Mutex::new(())),
            };
            let project =
                create_project(&state, &json!({"name":"Scene generation fixture"})).unwrap();
            let pid = strv(&project, "id").unwrap();
            let episode =
                insert_episode(&state, &json!({"project_id":pid,"title":"雨夜"})).unwrap();
            Self {
                state,
                pid,
                episode: intv(&episode, "id").unwrap(),
            }
        }

        fn config(&self, url: &str) {
            save_settings(
                &self.state,
                &json!({"project_id":self.pid,"settings":{"video":{
                    "default_channel_id":"fixture","channels":[{"id":"fixture","name":"Fixture",
                        "provider":"qianwen-token-plan","base_url":url,"api_key":"sk-sp-fixture",
                        "models":[{"id":"wan3.0-video","profile":"wan3-video"}]}]
                }}}),
            )
            .unwrap();
        }

        fn clip(&self, scene: i64, title: &str, prompt: &str, options: Value) -> i64 {
            let clip = insert_clip(
                &self.state,
                &json!({"project_id":self.pid,"episode_id":self.episode,
                "scene_id":scene,"title":title,"prompt":prompt,"generation_options":options}),
            )
            .unwrap();
            intv(&clip, "id").unwrap()
        }

        fn media(&self, c: &Connection, name: &str, kind: &str) -> i64 {
            let path = self.state.root.join(name);
            fs::write(&path, b"\x89PNG\r\n\x1a\nfixture").unwrap();
            c.execute(
                "INSERT INTO media(name,path,kind,created_at) VALUES(?,?,?,?)",
                params![name, path.to_string_lossy(), kind, now()],
            )
            .unwrap();
            c.last_insert_rowid()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.state.root);
        }
    }

    #[test]
    fn clip_preview_keeps_local_reference_indices_and_remaps_shared_tokens() {
        let fixture = Fixture::new();
        fixture.config("http://127.0.0.1:9");
        let c = db(&fixture.state, &fixture.pid).unwrap();
        let local = fixture.media(&c, "coat.png", "image");
        let shared = fixture.media(&c, "room.png", "image");
        let voice = fixture.media(&c, "voice.wav", "audio");
        let scene = scenes::create(&fixture.state, &json!({"project_id":fixture.pid,"episode_id":fixture.episode,
            "title":"审讯","shared_prompt":"房间参照 [Image 1] 和 <Audio 1>","reference_media_ids":[shared,local],
            "reference_audio_media_ids":[voice]})).unwrap();
        let clip = fixture.clip(
            intv(&scene, "id").unwrap(),
            "进门",
            "警官穿 <Picture 1> 的衣服，进入 @room。",
            json!({
                "video_mode":"i2v","duration":5,"reference_media_ids":[local]
            }),
        );
        let mut payload = json!({"project_id":fixture.pid,"clip_id":clip});
        let plan = clip_preview(&fixture.state, &payload).unwrap();
        assert_eq!(plan["image_media_ids"], json!([local, shared]));
        assert_eq!(plan["reference_audio_media_ids"], json!([voice]));
        let prompt = plan["prompt"].as_str().unwrap();
        assert!(
            prompt.contains("房间参照 [Image 2] 和 <Audio 1>"),
            "{prompt}"
        );
        assert!(prompt.contains("穿 <Picture 1>"), "{prompt}");
        assert!(prompt.contains("room（参考 [Image 2]）"), "{prompt}");

        payload["inherit_shared_prompt"] = json!(false);
        payload["exclude_shared_reference_media_ids"] = json!([shared]);
        payload["exclude_shared_reference_audio_media_ids"] = json!([voice]);
        let excluded = clip_preview(&fixture.state, &payload).unwrap();
        assert_eq!(excluded["image_media_ids"], json!([local]));
        assert_eq!(excluded["reference_audio_media_ids"], json!([]));
        assert!(!excluded["prompt"].as_str().unwrap().contains("房间参照"));
    }

    #[test]
    fn generates_ordered_beats_once_and_selects_only_current_scene_result() {
        let fixture = Fixture::new();
        let c = db(&fixture.state, &fixture.pid).unwrap();
        let (url, mock) = qianwen_video::tests::server(vec![
            (
                "POST /api/v1/services/aigc/video-generation/video-synthesis ",
                200,
                json!({"output":{"task_id":"take"}}).to_string(),
            ),
            (
                "GET /api/v1/tasks/take ",
                200,
                json!({"output":{"task_status":"SUCCEEDED","video_url":"$BASE/clip.mp4"}})
                    .to_string(),
            ),
            ("GET /clip.mp4 ", 200, "take-video".to_string()),
        ]);
        fixture.config(&url);
        let scene = scenes::create(
            &fixture.state,
            &json!({"project_id":fixture.pid,"episode_id":fixture.episode,
            "title":"雨夜审讯","generation_mode":"one_take","shared_prompt":"冷绿顶灯，雨声持续"}),
        )
        .unwrap();
        let id = intv(&scene, "id").unwrap();
        let first = intv(&scene["clips"][0], "id").unwrap();
        c.execute(
            "UPDATE clips SET title='警官进门',description='缓慢跟拍警官走进房间' WHERE id=?",
            [first],
        )
        .unwrap();
        c.execute(
            "INSERT INTO clip_options VALUES(?,?)",
            params![first, json!({"duration":3.5}).to_string()],
        )
        .unwrap();
        let second = fixture.clip(
            id,
            "放下照片",
            "顺着手部动作移动，警官低声说“看这里”。",
            json!({"duration":4.25}),
        );
        let payload = json!({"project_id":fixture.pid,"scene_id":id});
        let preview = scene_preview(&fixture.state, &payload).unwrap();
        assert_eq!(
            preview["beats"],
            json!([{"clip_id":first,"title":"警官进门","start":0.0,"end":3.5},
            {"clip_id":second,"title":"放下照片","start":3.5,"end":7.75}])
        );
        assert_eq!(preview["duration"], 8);
        assert!(preview.get("_scene_inputs").is_none());
        let saved =
            tracked_generation(&fixture.state, "/generations/scene-video", &payload).unwrap();
        let provider = mock.join().unwrap();
        assert_eq!(provider[0]["input"]["prompt"], preview["prompt"]);
        assert_eq!(provider[0]["parameters"]["duration"], 8);
        assert_eq!(provider[0]["parameters"]["prompt_extend"], false);
        assert_eq!(
            fs::read(saved["path"].as_str().unwrap()).unwrap(),
            b"take-video"
        );
        assert!(clip_videos(&c, first).unwrap().is_empty());
        assert!(clip_videos(&c, second).unwrap().is_empty());
        let units = scenes::episode_playback_units(&c, fixture.episode).unwrap();
        assert_eq!(units.len(), 1);
        assert_eq!(units[0]["kind"], "scene");
        assert_eq!(units[0]["video_media_id"], saved["id"]);

        let in_flight = prepare_scene(&fixture.state, &c, &fixture.pid, &payload).unwrap();
        c.execute(
            "UPDATE scenes SET shared_prompt='白色窗光',video_media_id=NULL WHERE id=?",
            [id],
        )
        .unwrap();
        let old_video = fixture.media(&c, "old.mp4", "video");
        assert!(attach_result(&c, &in_flight, old_video).unwrap());
        let selected: Option<i64> = c
            .query_row("SELECT video_media_id FROM scenes WHERE id=?", [id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(selected, None);
        assert_eq!(scenes::videos(&c, id).unwrap().len(), 2);
    }
}
