# Spielberg 项目工具与交付格式

通过 `read_skill` 读取本技能及参考文件；有 `next_offset` 时继续分页。以下为内置适配约定，实际操作前用 `app_describe` 查询所需资源或动作，以当前返回的 schema 为准。工具始终限定当前项目，不自行传 `project_id`。

## 读取创作依据

- `app_action` 的 `project/config/read`：项目大纲和文档目录；分别沿 `outline.next_offset`、`documents_next_offset` 读完相关分页。`project/document/read` 读取相关文档正文，沿 `next_offset` 继续。时间线用 `project/timelines/read`，拼接分页内容后理解完整时间线。
- `app_request` 的 `episodes` 查询目标剧集。`screenplays` 的 GET 用 `episode_id` 筛选，每集最多一份 `format=markdown` 剧本和一份 `format=csv` 分镜头剧本。`scenes` 是叙事场景，`clips` 是可以单独制作的片段，片段列表可按 `scene_id` 筛选。`assets` 是人物、地点、物件等创作资产，`asset-relations` 是资产关系，`media` 是图片、视频和音频文件。
- `get_project` 和普通 GET 的长文本可能截断。剧本与分镜的 `content`、资产与剧集的 `description`、场景的 `description` 和 `shared_prompt`、片段的 `description` 和 `prompt`，均可用 `app_action` 的 `resource/text/read` 分页读取。传入 `resource`、真实 `id` 和 `field`，沿 `next_offset` 读到 null。
- 资产引用仅使用启用的资产，读取其真实名称及关联图片。资产 ID 与素材 ID 不可混用；使用 `inspect_image` 传真实 `media_id` 视觉检查图片。缺图仍可写分镜，留空实际图片绑定并列出需补的画面。

列表或结构化 `storyboard` 若出现截断标记，不把节选当成完整数据提交替换；先缩小读取范围。仍无法完整读取时报告这一限制并保留已有内容，不猜测缺失镜头。

## 默认保存到分镜头剧本

用户要求制作本集分镜时，优先写入其 `screenplays` 的 `format=csv` 记录，让分镜表可直接编辑。仅讨论时不写入。已有 csv 先读取完整 `content` 再 PATCH；没有 csv 时按当前 schema POST，填写目标 `episode_id`、标题、`format:"csv"` 和 `content`。不要新建第二份同格式记录，也不要把分镜写进 `format=markdown` 的原剧本。

新 CSV 固定六列，表头逐字为：

```csv
编号,景别,运镜,时长,素材,描述
```

- **编号**：按表格行序从 1 开始连续编号，编辑器自动生成。通过 CSV 写入时使用同样的编号。
- **景别**：`大远景`、`远景`、`全景`、`中景`、`近景`、`特写`、`大特写`。
- **运镜**：`固定`、`推近`、`拉远`、`横摇`、`俯仰`、`平移`、`跟随`、`升高`、`降低`、`环绕`、`手持`、`变焦`。更细的机位、速度和原因写入描述。
- **时长**：可为空；有明确指定时填 1–30 的整数，单位为秒。修改已有分镜时保留原值，不从描述或时间码自动填入。
- **素材**：可为空，只引用项目中已有的图片。CSV 使用 `@资产名.图片名#素材ID`，未关联资产的图片使用 `@素材库.图片名#素材ID`。同一单元格内每行一个引用。末尾使用真实图片素材 ID，编辑器显示时省略 ID。
- **描述**：非空；承载来源、叙事目的、时长、机位、起点→动作→终点、声音/对白、连续性、首帧提示词、按需尾帧和参考图用途。

包含逗号、双引号或换行的单元格用双引号包围，内部双引号写为两个双引号。旧版五列表头 `编号,景别,运镜,画面,描述` 仍可读取；转换时将原画面值保留在素材列，时长留空。不要把 Markdown 表格传给 csv 记录。

例如以下只是格式示例，角色和剧情必须换成当前项目的真实内容：

```csv
编号,景别,运镜,时长,素材,描述
1,中景,固定,,,"来源：本集柜台场；目的：让观众看见交证之前的犹豫；机位：柜台外侧，甲前景、乙后景；起点：甲右手垂在衣袋旁，证件仍在袋内；动作：甲停顿后将右手伸向衣袋；终点：右手触及袋口，未取出证件；声音：保留原剧本这一拍的环境声；首帧：沿用本集画风与灯光，甲站在柜台外，右手垂在衣袋旁，乙在台内注视甲；参考图：甲造型图、柜台地点图待补。"
```

保存后按返回 ID 再读取 `content` 核对镜数、编号和目标修改；原剧本与未指定镜头保持不变。多集任务逐集读写并记录完成的真实 ID，重试先查结果，避免重复创建。

## AI 分镜与片段制作

用户要求可供“AI 分镜与片段制作”使用的规划时，通过 `app_request` PATCH `episodes` 的 `storyboard` 字段，沿用真实剧集 ID。根对象为 `{"clips":[...]}`，成员结构如下。

```json
{
  "title": "片段标题",
  "duration": 8,
  "shots": [
    {"duration": 4, "description": "来源、目的、起点、动作、终点、连续性和关键帧说明", "camera": "景别、机位和运镜", "sound": "原文对白与声音"},
    {"duration": 4, "description": "下一镜的完整说明", "camera": "景别、机位和运镜", "sound": "原文对白与声音"}
  ]
}
```

每个 shot 时长大于 0，片段时长是 shots 之和且不超过 15 秒。超过时按动作闭合点拆分片段。局部修改沿用已有根字段、未修改的片段、`clip_id` 和素材绑定。被修改的镜头需要重新规划时，移除该片段的旧 `plan`。

可以直接完成导演设计并保存。需要现有渠道帮助规划时，`storyboard/generate` 返回待检查与保存的分镜。`storyboard/plan` 接收 `clip`，返回参考图、补图任务和 H3 Prompt。`storyboard/validate` 接收 `clip` 和对应的 `plan`。

`storyboard/plan` 是 H3 规划流程，不能当作其他视频模型的通用提示词模板。使用其他模型时读取 `settings/read` 和对应生成动作的 `app_describe`，按实际能力安排参考图、画幅与时长。

## 后续制作与范围

仅规划分镜时，不自动生图、生视频、改渠道或改世界观。用户已要求实际制作时，使用真实 `generations/image`、`generations/video`、`generations/tts` 等动作及已有授权；图片编辑用 `i2i` 和真实 `image_media_ids`，需要核验的生成图片再用 `inspect_image` 检查。未完成的任务、补图需求和成片区分报告。

用户要求写入制作片段时，先查询目标 `clips`，再 POST/PATCH `description`、`prompt`、参考素材和生成选项。新增片段传入其父场景 `scene_id`。`scripts/publish` 会删除草稿中没有的已有片段，局部更新用片段 PATCH。

用户要求编排场景时，先读 `scenes` 和本集片段顺序。通过场景的 `clip_ids` 归入连续片段，将时间地点、开场站位、造型、音色与环境写入 `shared_prompt`，把实际引用写入共享图片和音频 ID 列表。局部运镜、对白与动作放在各片段。逐片段生成前用 `generations/clip-preview` 核对继承后的请求，实际生成使用 `generations/video` 加 `clip_id`。

一镜到底使用 `generation_mode=one_take`，按连续运镜设计各片段的动作段落并给出具体时长。通过 `generations/scene-preview` 检查完整的连续动作和实际引用，用户要求生成时调用 `generations/scene-video`。用场景的 `videos` 查询结果，并通过 `scenes/select-video` 设置播放版本。剧集 `playback_units` 显示实际预览与合并的播放顺序。

不要调用 Shell、Python、FFmpeg 命令或任意文件系统操作；此环境提供的是项目工具。用户要求只是分镜时无需初始化另一套工程或安装其他技能。
