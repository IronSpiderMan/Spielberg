//! Model-facing production tools. The same field definitions describe and check
//! arguments before the existing project-scoped CRUD or action handlers run.
use serde_json::{json, Map, Value};
use std::collections::HashSet;

#[derive(Clone, Copy)]
enum Shape {
    Integer(i64, Option<i64>),
    OptionalId,
    Text,
    NonemptyText,
    Choices(&'static [&'static str]),
    Ids(usize),
    Boolean,
    PositiveNumber,
    Storyboard,
    GenerationOptions,
}

const ID: Shape = Shape::Integer(1, None);
const POSITION: Shape = Shape::Choices(&["before", "after"]);

impl Shape {
    fn schema(self) -> Value {
        match self {
            Self::Integer(minimum, maximum) => {
                let mut schema = json!({"type":"integer","minimum":minimum});
                if let Some(maximum) = maximum {
                    schema["maximum"] = json!(maximum);
                }
                schema
            }
            Self::OptionalId => json!({"type":["integer","null"],"minimum":1}),
            Self::Text => json!({"type":"string"}),
            Self::NonemptyText => json!({"type":"string","minLength":1}),
            Self::Choices(choices) => json!({"type":"string","enum":choices}),
            Self::Ids(minimum) => json!({
                "type":"array","items":ID.schema(),"minItems":minimum,"uniqueItems":true
            }),
            Self::Boolean => json!({"type":"boolean"}),
            Self::PositiveNumber => json!({"type":"number","exclusiveMinimum":0}),
            Self::Storyboard => json!({"type":["object","null"]}),
            Self::GenerationOptions => {
                json!({"type":"object","properties":properties(GENERATION_OPTIONS)})
            }
        }
    }

    fn validate(self, path: &str, value: &Value) -> Result<(), String> {
        let expected = match self {
            Self::Integer(minimum, maximum) => {
                if value
                    .as_i64()
                    .is_some_and(|n| n >= minimum && maximum.is_none_or(|max| n <= max))
                {
                    return Ok(());
                }
                match maximum {
                    Some(maximum) => format!("{minimum}–{maximum} 的整数"),
                    None => format!("大于等于 {minimum} 的整数"),
                }
            }
            Self::OptionalId => {
                if value.is_null() || value.as_i64().is_some_and(|id| id > 0) {
                    return Ok(());
                }
                "正整数 ID 或 null".into()
            }
            Self::Text => {
                if value.is_string() {
                    return Ok(());
                }
                "字符串".into()
            }
            Self::NonemptyText => {
                if value.as_str().is_some_and(|text| !text.trim().is_empty()) {
                    return Ok(());
                }
                "非空字符串".into()
            }
            Self::Choices(choices) => {
                if value
                    .as_str()
                    .is_some_and(|choice| choices.contains(&choice))
                {
                    return Ok(());
                }
                format!("以下值之一：{}", choices.join("、"))
            }
            Self::Ids(minimum) => {
                let mut seen = HashSet::new();
                if value.as_array().is_some_and(|items| {
                    items.len() >= minimum
                        && items
                            .iter()
                            .all(|item| item.as_i64().is_some_and(|id| id > 0 && seen.insert(id)))
                }) {
                    return Ok(());
                }
                format!("至少 {minimum} 项且无重复的正整数 ID 数组")
            }
            Self::Boolean => {
                if value.is_boolean() {
                    return Ok(());
                }
                "布尔值".into()
            }
            Self::PositiveNumber => {
                if value.as_f64().is_some_and(|number| number > 0.0) {
                    return Ok(());
                }
                "大于 0 的数字".into()
            }
            Self::Storyboard => {
                if value.is_object() || value.is_null() {
                    return Ok(());
                }
                "分镜对象或 null".into()
            }
            Self::GenerationOptions => {
                if let Some(options) = value.as_object() {
                    for field in GENERATION_OPTIONS {
                        if let Some(item) = options.get(field.name) {
                            field
                                .shape
                                .validate(&format!("{path}.{}", field.name), item)?;
                        }
                    }
                    return Ok(());
                }
                "生成选项对象".into()
            }
        };
        Err(format!("{path} 必须为{expected}"))
    }
}

#[derive(Clone, Copy)]
struct Field {
    name: &'static str,
    shape: Shape,
    required: bool,
    description: &'static str,
}

const fn optional(name: &'static str, shape: Shape) -> Field {
    Field {
        name,
        shape,
        required: false,
        description: "",
    }
}

impl Field {
    const fn required(mut self) -> Self {
        self.required = true;
        self
    }

    const fn described(mut self, description: &'static str) -> Self {
        self.description = description;
        self
    }
}

fn properties(fields: &[Field]) -> Map<String, Value> {
    fields
        .iter()
        .map(|field| {
            let mut schema = field.shape.schema();
            if !field.description.is_empty() {
                schema["description"] = json!(field.description);
            }
            (field.name.into(), schema)
        })
        .collect()
}

const EPISODE_ID: Field =
    optional("episode_id", ID).described("Episode ID in the current project.");
const SCENE_ID: Field =
    optional("scene_id", ID).described("Narrative scene ID, distinct from a clip ID.");
const CLIP_ID: Field =
    optional("clip_id", ID).described("Production clip ID, distinct from a scene ID.");
const MEDIA_ID: Field =
    optional("media_id", ID).described("Media library file ID, distinct from a creative asset ID.");
const RECORD_ID: Field = optional("id", ID).required();
const TITLE: Field = optional("title", Shape::NonemptyText);
const DESCRIPTION: Field = optional("description", Shape::Text);
const PROMPT: Field = optional("prompt", Shape::Text);
const OFFSET: Field = optional("offset", Shape::Integer(0, None))
    .described("Omit for the first page. Pass next_offset to continue until it is null.");
const LIMIT: Field =
    optional("limit", Shape::Integer(1, Some(50))).described("Page size; default 25.");
const COVER: Field = optional("cover_media_id", Shape::OptionalId)
    .described("Image media ID. Pass null to remove the cover.");
const STORYBOARD: Field = optional("storyboard", Shape::Storyboard)
    .described("Complete storyboard object with an ordered clips array; null clears it.");
const SHARED_PROMPT: Field = optional("shared_prompt", Shape::Text)
    .described("Complete visual style and continuity prompt shared by member clips.");
const SCENE_IMAGES: Field = optional("reference_media_ids", Shape::Ids(0))
    .described("Complete ordered list of shared image media IDs; [] clears.");
const SCENE_AUDIO: Field = optional("reference_audio_media_ids", Shape::Ids(0))
    .described("Complete ordered list of shared audio media IDs; [] clears.");
const GENERATION_MODE: Field = optional("generation_mode", Shape::Choices(&["clips", "one_take"]));
const OPTIONS: Field = optional("generation_options", Shape::GenerationOptions)
    .described("Replaces the saved options object when provided. Read the target and preserve existing options outside the requested change.");
const FIRST_IMAGE: Field =
    optional("first_media_id", Shape::OptionalId).described("Opening image media ID; null clears.");
const LAST_IMAGE: Field =
    optional("last_media_id", Shape::OptionalId).described("Closing image media ID; null clears.");
const CLIP_IMAGE: Field = optional("reference_media_id", Shape::OptionalId)
    .described("Single reference image media ID; null clears. Use generation_options.reference_media_ids for multiple images.");
const MEMBERS: Field = optional("clip_ids", Shape::Ids(1))
    .described("Complete nonempty selection of consecutive clip IDs in current episode order.");
const PLACEMENT: Field = optional("position", POSITION);
const GENERATION_OPTIONS: &[Field] = &[
    optional(
        "video_mode",
        Shape::Choices(&["t2v", "fl2v", "i2v", "ref2v"]),
    ),
    optional("custom", Shape::Boolean),
    optional("first", Shape::Boolean),
    optional("last", Shape::Boolean),
    optional("reference", Shape::Boolean),
    optional("duration", Shape::PositiveNumber)
        .described("Seconds; supported values depend on the selected model."),
    optional("aspect_ratio", Shape::Text),
    optional("size", Shape::Text),
    optional("channel_id", Shape::Text),
    optional("model", Shape::Text),
    optional("resolution", Shape::Text),
    optional("audio", Shape::Boolean),
    optional("reference_media_ids", Shape::Ids(0))
        .described("Ordered image media IDs; for scene images use the top-level scene field."),
    optional("reference_video_media_ids", Shape::Ids(0)).described("Ordered video media IDs."),
    optional("reference_audio_media_ids", Shape::Ids(0))
        .described("Ordered audio media IDs; for scene audio use the top-level scene field."),
    optional("exclude_shared_reference_media_ids", Shape::Ids(0)),
    optional("exclude_shared_reference_audio_media_ids", Shape::Ids(0)),
    optional("exclude_shared_reference_video_media_ids", Shape::Ids(0)),
    optional("inherit_shared_prompt", Shape::Boolean),
    FIRST_IMAGE,
    LAST_IMAGE,
];

#[derive(Clone, Copy)]
enum Route {
    List(&'static str),
    Create(&'static str),
    Record(&'static str, &'static str, &'static str),
    Action(&'static str, bool),
}

struct Spec {
    name: &'static str,
    description: &'static str,
    route: Route,
    fields: &'static [Field],
}

const fn tool(
    name: &'static str,
    description: &'static str,
    route: Route,
    fields: &'static [Field],
) -> Spec {
    Spec {
        name,
        description,
        route,
        fields,
    }
}

use Route::{Action, Create, List, Record};

const TOOLS: &[Spec] = &[
    tool("list_media", "Search media files by name, kind and usage. Returns items and total; increment page while more matches remain. Media IDs refer to files, not creative assets.", List("media"), &[
        optional("kind", Shape::Choices(&["all", "image", "video", "audio"])),
        optional("usage", Shape::Choices(&["all", "used", "unused", "trash"])),
        optional("query", Shape::Text).described("Case-insensitive substring of the media filename."),
        optional("page", Shape::Integer(1, None)).described("One-based page number; default 1."),
        optional("limit", Shape::Integer(1, Some(60))).described("Page size; default 24."),
    ]),
    tool("get_media", "Read a media file record by its media library ID.", Record("media", "GET", "id"), &[RECORD_ID]),
    tool("get_media_usage", "Read where a media file is referenced before changing its associations or moving it to the recycle bin.", Action("media/usage", false), &[RECORD_ID]),
    tool("rename_media", "Change a media library file's display name. Per-asset reference names are managed separately.", Record("media", "PATCH", "id"), &[
        RECORD_ID, optional("name", Shape::NonemptyText).required(),
    ]),
    tool("trash_media", "Move an unused media file to the recycle bin. Referenced files are rejected. Read get_media_usage to find references.", Record("media", "DELETE", "id"), &[RECORD_ID]),
    tool("restore_media", "Restore a media file from the recycle bin using its media ID.", Action("media/restore", true), &[RECORD_ID]),

    tool("list_episodes", "List episode IDs and titles in project order. Follow next_offset until null for the complete order. Use get_episode for details.", List("episodes"), &[OFFSET, LIMIT]),
    tool("get_episode", "Read episode details including scenes, clips and playback units. Use the dedicated list tools for complete child IDs, and read_resource_text for the complete description.", Record("episodes", "GET", "id"), &[RECORD_ID]),
    tool("create_episode", "Create an episode in the current project.", Create("episodes"), &[TITLE.required(), DESCRIPTION, COVER, STORYBOARD]),
    tool("update_episode", "Update only the supplied episode fields. For a description edit, read the complete existing text with read_resource_text first.", Record("episodes", "PATCH", "id"), &[
        RECORD_ID, TITLE, DESCRIPTION, COVER, STORYBOARD,
    ]),
    tool("delete_episode", "Delete an episode and its scenes, clips and screenplays. Source media files remain in the media library. Use only if requested.", Record("episodes", "DELETE", "id"), &[RECORD_ID]),
    tool("reorder_episodes", "Reorder all episodes. Read every list_episodes page first and send all episode IDs once in the desired order.", Action("episodes/reorder", true), &[
        optional("episode_ids", Shape::Ids(0)).required(),
    ]),
    tool("merge_episode_video", "Render the episode's playback units into a single video media file. Select a video for every required scene or clip first. Use only when asked to render a merged video.", Action("episodes/merge", true), &[EPISODE_ID.required()]),

    tool("list_scenes", "List narrative scene IDs and titles in project order, optionally for one episode. Follow next_offset for the complete order. Use get_scene for details.", List("scenes"), &[
        EPISODE_ID, OFFSET, LIMIT,
    ]),
    tool("get_scene", "Read a narrative scene by scene ID. Use list_clips with scene_id for all member IDs, and read_resource_text for the full description or shared prompt.", Record("scenes", "GET", "id"), &[RECORD_ID]),
    tool("create_scene", "Create a narrative scene in an episode. Omitting clip_ids creates an initial clip; supplying clip_ids regroups existing consecutive clips. For insertion beside a scene, supply both anchor_scene_id and position and omit clip_ids.", Create("scenes"), &[
        EPISODE_ID.required(), TITLE.required(), DESCRIPTION, SHARED_PROMPT, SCENE_IMAGES, SCENE_AUDIO, GENERATION_MODE, OPTIONS,
        MEMBERS, optional("anchor_scene_id", ID), PLACEMENT,
    ]),
    tool("update_scene", "Update the supplied narrative scene fields. Use set_scene_clips to change membership. Read full text with read_resource_text before editing the description or shared prompt.", Record("scenes", "PATCH", "id"), &[
        RECORD_ID, TITLE, DESCRIPTION, SHARED_PROMPT, SCENE_IMAGES, SCENE_AUDIO, GENERATION_MODE, OPTIONS,
    ]),
    tool("delete_scene", "Delete a narrative scene and all of its member clips. Source media files remain in the media library. To keep the clips and split their group, use ungroup_scene.", Record("scenes", "DELETE", "id"), &[RECORD_ID]),
    tool("set_scene_clips", "Set the complete clip membership of a narrative scene. Selected clips must be consecutive and in the same episode. Old members omitted from the selection become separate scenes, and emptied source scenes are removed. Read list_clips before regrouping.", Record("scenes", "PATCH", "scene_id"), &[
        SCENE_ID.required(), MEMBERS.required(),
    ]),
    tool("merge_scenes", "Merge adjacent narrative scenes from one episode into one scene, preserving all their clips and source media. Retain the target scene's settings and video candidates and clear its selected video.", Action("scenes/merge", true), &[
        EPISODE_ID.required(),
        optional("scene_ids", Shape::Ids(2)).required().described("At least two adjacent scene IDs from the episode."),
        optional("target_scene_id", ID).described("One of scene_ids. Defaults to the first selected scene in episode order."),
        TITLE,
    ]),
    tool("ungroup_scene", "Split a narrative scene with at least two clips into separate single-clip scenes. Keeps member clips and their order.", Action("scenes/ungroup", true), &[SCENE_ID.required()]),
    tool("reorder_scenes", "Reorder scenes and their member clips within one episode. Read every list_scenes page for that episode and submit its complete scene order.", Action("scenes/reorder", true), &[
        EPISODE_ID.required(), optional("scene_ids", Shape::Ids(0)).required(),
    ]),
    tool("select_scene_video", "Link a video media file to a scene and select it as that scene's one-take playback video.", Action("scenes/select-video", true), &[
        SCENE_ID.required(), MEDIA_ID.required(),
    ]),
    tool("remove_scene_video", "Unlink a video version from a scene and clear its selection if necessary. Retains the media library file.", Action("scenes/delete-video", true), &[
        SCENE_ID.required(), MEDIA_ID.required(),
    ]),

    tool("list_clips", "List production clip IDs and titles, optionally by episode or narrative scene. Follow next_offset for the complete order. Use get_clip for details.", List("clips"), &[
        EPISODE_ID, SCENE_ID, OFFSET, LIMIT,
    ]),
    tool("get_clip", "Read a production clip by clip ID. Use read_resource_text for the complete description or prompt.", Record("clips", "GET", "id"), &[RECORD_ID]),
    tool("create_clip", "Create a clip in an episode. Supply scene_id to add it to an existing scene. Supply both anchor_clip_id and position to insert beside a clip; if scene_id is omitted, inherit the anchor's scene. With neither ID, creates a single-clip scene.", Create("clips"), &[
        EPISODE_ID.required(), SCENE_ID, TITLE.required(), DESCRIPTION, PROMPT,
        optional("creation_mode", Shape::Choices(&["default", "canvas"])), FIRST_IMAGE, LAST_IMAGE, CLIP_IMAGE, OPTIONS,
        optional("anchor_clip_id", ID), PLACEMENT,
    ]),
    tool("update_clip", "Update only the supplied production clip fields. Use set_scene_clips to regroup clips and read_resource_text before editing existing description or prompt text.", Record("clips", "PATCH", "id"), &[
        RECORD_ID, TITLE, DESCRIPTION, PROMPT, FIRST_IMAGE, LAST_IMAGE, CLIP_IMAGE, OPTIONS,
    ]),
    tool("delete_clip", "Delete a production clip and its local edits. If it was the only member, its parent scene is also removed. Source media files remain in the library.", Record("clips", "DELETE", "id"), &[RECORD_ID]),
    tool("duplicate_clip", "Copy a production clip and its canvas within its scene. The new clip starts without video versions.", Action("clips/duplicate", true), &[RECORD_ID, PLACEMENT]),
    tool("reorder_clips", "Reorder all production clips within one episode. Read every list_clips page for that episode first and keep each scene's clips contiguous in the new complete order.", Action("clips/reorder", true), &[
        EPISODE_ID.required(), optional("clip_ids", Shape::Ids(0)).required(),
    ]),
    tool("select_clip_video", "Link a video media file to a clip and select it as the clip's playback video.", Action("clips/select-video", true), &[
        CLIP_ID.required(), MEDIA_ID.required(),
    ]),
    tool("remove_clip_video", "Unlink a video version from a clip and clear its selection if necessary. Retains the media library file.", Action("clips/delete-video", true), &[
        CLIP_ID.required(), MEDIA_ID.required(),
    ]),
];

pub(super) fn definitions() -> Vec<Value> {
    TOOLS.iter().map(|spec| json!({
        "type":"function",
        "function":{
            "name":spec.name,
            "description":spec.description,
            "parameters":{
                "type":"object",
                "properties":properties(spec.fields),
                "required":spec.fields.iter().filter(|field| field.required).map(|field| field.name).collect::<Vec<_>>(),
                "additionalProperties":false
            }
        }
    })).collect()
}

pub(super) fn action_tool(operation: &str) -> Option<&'static str> {
    TOOLS.iter().find_map(|spec| match spec.route {
        Action(action, _) if action == operation => Some(spec.name),
        _ => None,
    })
}

pub(super) fn is_write(name: &str) -> bool {
    TOOLS.iter().any(|spec| {
        spec.name == name
            && matches!(
                spec.route,
                Create(_) | Record(_, "PATCH" | "DELETE", _) | Action(_, true)
            )
    })
}

fn normalize(spec: &Spec, args: &Value) -> Result<(&'static str, Value), String> {
    let args = args.as_object().ok_or("工具参数必须为 JSON 对象")?;
    if let Some(key) = args
        .keys()
        .find(|key| !spec.fields.iter().any(|field| field.name == key.as_str()))
    {
        let accepted = spec
            .fields
            .iter()
            .map(|field| field.name)
            .collect::<Vec<_>>()
            .join("、");
        return Err(format!(
            "{} 不支持参数 {key}；可用参数：{accepted}。",
            spec.name
        ));
    }
    for field in spec.fields {
        match args.get(field.name) {
            Some(value) => field.shape.validate(field.name, value)?,
            None if field.required => {
                return Err(format!("{} 缺少必填参数 {}。", spec.name, field.name))
            }
            None => {}
        }
    }
    let anchor_field = match spec.route {
        Create("scenes") => Some("anchor_scene_id"),
        Create("clips") => Some("anchor_clip_id"),
        _ => None,
    };
    if let Some(anchor) = anchor_field {
        if args.contains_key(anchor) != args.contains_key("position") {
            return Err(format!(
                "插入时须同时传入 {anchor} 和 position（before 或 after）；追加时省略两者。"
            ));
        }
        if anchor == "anchor_scene_id" && args.contains_key(anchor) && args.contains_key("clip_ids")
        {
            return Err("在已有场景旁插入新场景时，请省略 clip_ids；若要把已有连续片段归为新场景，请省略 anchor_scene_id 和 position。".into());
        }
    }
    if matches!(spec.route, Action("scenes/merge", _)) {
        if let Some(target) = args.get("target_scene_id") {
            if !args["scene_ids"]
                .as_array()
                .is_some_and(|ids| ids.contains(target))
            {
                return Err("target_scene_id 必须是 scene_ids 中的一个 ID；也可省略以保留剧集顺序中的第一个场景。".into());
            }
        }
    }
    let mut data = args.clone();
    match spec.route {
        List(resource) => {
            if resource != "media" {
                data.remove("offset");
                data.remove("limit");
            }
            Ok((
                "app_request",
                json!({"resource":resource,"method":"GET","data":data}),
            ))
        }
        Create(resource) => Ok((
            "app_request",
            json!({"resource":resource,"method":"POST","data":data}),
        )),
        Record(resource, method, id_field) => {
            let id = data
                .remove(id_field)
                .expect("required record ID is validated");
            if method == "PATCH" && data.is_empty() {
                let editable = spec
                    .fields
                    .iter()
                    .filter(|field| field.name != id_field)
                    .map(|field| field.name)
                    .collect::<Vec<_>>()
                    .join("、");
                return Err(format!(
                    "{} 至少需要一个待修改字段；可编辑字段：{}。",
                    spec.name, editable
                ));
            }
            Ok((
                "app_request",
                json!({"resource":resource,"method":method,"id":id,"data":data}),
            ))
        }
        Action(operation, _) => Ok(("app_action", json!({"operation":operation,"data":data}))),
    }
}

pub(super) fn route(name: &str, args: &Value) -> Option<Result<(&'static str, Value), String>> {
    TOOLS
        .iter()
        .find(|spec| spec.name == name)
        .map(|spec| normalize(spec, args))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_arguments_with_correctable_field_names() {
        for (name, args, expected) in [
            ("list_media", json!({"limit":20000}), "1–60"),
            ("list_clips", json!({"scene_id":"3"}), "scene_id"),
            (
                "create_scene",
                json!({"episode_id":1,"title":"New scene","position":"after"}),
                "anchor_scene_id",
            ),
            (
                "create_clip",
                json!({"episode_id":1,"title":"New clip","anchor_clip_id":2}),
                "position",
            ),
            (
                "merge_scenes",
                json!({"episode_id":1,"scene_ids":[2,3],"target_scene_id":4}),
                "target_scene_id",
            ),
            (
                "reorder_clips",
                json!({"episode_id":1,"clip_ids":[2,2]}),
                "无重复",
            ),
            ("update_scene", json!({"id":1}), "可编辑字段"),
            (
                "update_clip",
                json!({"id":1,"generation_options":{"reference_audio_media_ids":"2"}}),
                "generation_options.reference_audio_media_ids",
            ),
        ] {
            let error = route(name, &args).unwrap().unwrap_err();
            assert!(error.contains(expected), "{name}: {error}");
        }
    }

    #[test]
    fn normalizes_identifiers_filters_and_intentional_nulls() {
        let list = route("list_clips", &json!({"scene_id":7,"offset":50,"limit":25}))
            .unwrap()
            .unwrap();
        assert_eq!(
            list,
            (
                "app_request",
                json!({"resource":"clips","method":"GET","data":{"scene_id":7}})
            )
        );
        let set = route("set_scene_clips", &json!({"scene_id":7,"clip_ids":[21,22]}))
            .unwrap()
            .unwrap();
        assert_eq!(
            set,
            (
                "app_request",
                json!({"resource":"scenes","method":"PATCH","id":7,"data":{"clip_ids":[21,22]}})
            )
        );
        let update = route("update_clip", &json!({"id":21,"reference_media_id":null,"generation_options":{"provider_extension":"value"}})).unwrap().unwrap();
        assert!(update.1["data"]["reference_media_id"].is_null());
        assert_eq!(
            update.1["data"]["generation_options"]["provider_extension"],
            "value"
        );
        assert!(is_write("set_scene_clips"));
        assert!(!is_write("get_media_usage"));
        assert_eq!(action_tool("media/restore"), Some("restore_media"));
    }
}
