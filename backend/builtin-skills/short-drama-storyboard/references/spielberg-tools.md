# Spielberg 项目工具与交付格式

通过 `read_skill` 读取本技能及参考文件；有 `next_offset` 时继续分页。以下为内置适配约定，实际操作前用 `app_describe` 查询所需资源或动作，以当前返回的 schema 为准。工具始终限定当前项目，不自行传 `project_id`。

## 读取创作依据

- `app_action` 的 `project/config/read`：项目大纲和文档目录；分别沿 `outline.next_offset`、`documents_next_offset` 读完相关分页。`project/document/read` 读取相关文档正文，沿 `next_offset` 继续。时间线用 `project/timelines/read`，拼接分页内容后理解完整时间线。
- `app_request`：`episodes` 查询目标剧集；`screenplays` 的 GET 用 `episode_id` 筛选，每集最多一份 `format=markdown` 剧本和一份 `format=csv` 分镜头剧本。`scenes` 是制作场景，`assets` 是人物、地点、物件等创作资产，`asset-relations` 是资产关系，`media` 是图片、视频和音频文件。
- `get_project` 和普通 GET 的长文本可能截断。剧本/分镜的 `content`、资产/剧集的 `description`、场景的 `description`/`prompt`，用 `app_action` 的 `resource/text/read` 传 `resource`、真实 `id`、`field`，沿 `next_offset` 读到 null。不要拿摘要或单页覆盖原文。
- 资产引用仅使用启用的资产，读取其真实名称及关联图片。资产 ID 与素材 ID 不可混用；使用 `inspect_image` 传真实 `media_id` 视觉检查图片。缺图仍可写分镜，留空实际图片绑定并列出需补的画面。

列表或结构化 `storyboard` 若出现截断标记，不把节选当成完整数据提交替换；先缩小读取范围。仍无法完整读取时报告这一限制并保留已有内容，不猜测缺失镜头。

## 默认保存到分镜头剧本

用户要求制作本集分镜时，优先写入其 `screenplays` 的 `format=csv` 记录，让分镜表可直接编辑。仅讨论时不写入。已有 csv 先读取完整 `content` 再 PATCH；没有 csv 时按当前 schema POST，填写目标 `episode_id`、标题、`format:"csv"` 和 `content`。不要新建第二份同格式记录，也不要把分镜写进 `format=markdown` 的原剧本。

CSV 固定五列，表头逐字为：

```csv
编号,景别,运镜,画面,描述
```

- **编号**：非空且唯一；局部修改沿用已有编号。
- **景别**：`大远景`、`远景`、`全景`、`中景`、`近景`、`特写`、`大特写`。
- **运镜**：`固定`、`推近`、`拉远`、`横摇`、`俯仰`、`平移`、`跟随`、`升高`、`降低`、`环绕`、`手持`、`变焦`。更细的机位、速度和原因写入描述。
- **画面**：可为空；有真实图片时填写工具返回的该图片 `path`，不填资产 ID、素材 ID、提示词或虚构路径。
- **描述**：非空；承载来源、叙事目的、时长、机位、起点→动作→终点、声音/对白、连续性、首帧提示词、按需尾帧和参考图用途。

包含逗号、双引号或换行的单元格用双引号包围，内部双引号写为两个双引号。不能给表格增添第六列；不要把 Markdown 表格传给 csv 记录。

例如以下只是格式示例，角色和剧情必须换成当前项目的真实内容：

```csv
编号,景别,运镜,画面,描述
001,中景,固定,,"来源：本集柜台场；目的：让观众看见交证之前的犹豫；时长：4 秒（文本估计）；机位：柜台外侧，甲前景、乙后景；起点：甲右手垂在衣袋旁，证件仍在袋内；动作：甲停顿后将右手伸向衣袋；终点：右手触及袋口，未取出证件；声音：保留原剧本这一拍的环境声；首帧：沿用本集画风与灯光，甲站在柜台外，右手垂在衣袋旁，乙在台内注视甲；参考图：甲造型图、柜台地点图待补。"
```

保存后按返回 ID 再读取 `content` 核对镜数、编号和目标修改；原剧本与未指定镜头保持不变。多集任务逐集读写并记录完成的真实 ID，重试先查结果，避免重复创建。

## AI 分镜与场景制作

用户要求可供“AI 分镜与场景制作”使用的规划时，通过 `app_request` PATCH `episodes` 的 `storyboard` 字段，沿用真实剧集 ID。根对象为 `{"scenes":[...]}`；每组结构为：

```json
{
  "title": "组名",
  "duration": 8,
  "shots": [
    {"duration": 4, "description": "来源、目的、起点、动作、终点、连续性和关键帧说明", "camera": "景别、机位和运镜", "sound": "原文对白与声音"},
    {"duration": 4, "description": "下一镜的完整说明", "camera": "景别、机位和运镜", "sound": "原文对白与声音"}
  ]
}
```

每个 shot 时长大于 0，组时长是 shots 之和且不超过 15 秒；超过时按动作闭合点拆组。这个分组约束不等于所有模型的视频时长上限。沿用已有根字段、未修改的组、`scene_id` 和素材绑定；被修改镜头对应的旧生成 `plan` 已失效时移除该旧计划，不能把旧 Prompt 当成新分镜的结果。

可直接完成导演设计后保存，无须为加载技能再额外调用一次生成服务。需要现有渠道帮助规划时，`storyboard/generate` 返回分镜，结果仍需检查并保存；`storyboard/plan` 接收 `scene`，返回参考图、补图任务和 H3 Prompt。`storyboard/validate` 需要同时提供 `scene` 和真实 `plan`，不能用它校验任意 CSV 或无 plan 的分镜。

`storyboard/plan` 是 H3 规划流程，不能当作其他视频模型的通用提示词模板。使用其他模型时读取 `settings/read` 和对应生成动作的 `app_describe`，按实际能力安排参考图、画幅与时长。

## 后续制作与范围

仅规划分镜时，不自动生图、生视频、改渠道或改世界观。用户已要求实际制作时，使用真实 `generations/image`、`generations/video`、`generations/tts` 等动作及已有授权；图片编辑用 `i2i` 和真实 `image_media_ids`，需要核验的生成图片再用 `inspect_image` 检查。未完成的任务、补图需求和成片区分报告。

用户要求写入制作场景时，先 GET 目标 `scenes`，按实际字段 POST/PATCH `description`、`prompt`、参考素材和生成选项；不为方便而重新创建全部场景。`scripts/publish` 会删除草稿中没有的已有场景，不能用于一次普通分镜更新。

不要调用 Shell、Python、FFmpeg 命令或任意文件系统操作；此环境提供的是项目工具。用户要求只是分镜时无需初始化另一套工程或安装其他技能。
