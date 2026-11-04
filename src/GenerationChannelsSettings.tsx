import { ConfirmPopover } from "./components/ConfirmAction";
import { useEffect, useRef, useState } from "react";
import { Button, Dropdown, Form, Input, Menu, Select, Space, Switch } from "@arco-design/web-react";
import { ChevronDown, Cpu, Plus, Search, Server, Star, Trash2 } from "lucide-react";
import type { ModelSettings } from "./core";
import { localId } from "./id";
import { channelBaseUrl, channelsFor, MODEL_PROFILES, presetsFor, profilesFor, type ChannelProvider, type GenerationChannel, type GenerationKind, type GenerationModel } from "./generation-channels";
import { EmptyState } from "./ui";
import "./generation-channels.css";

const labels = { llm: "LLM", image: "图片", video: "视频", tts: "TTS" };
const providerLabels = { openai: "OpenAI", deepseek: "DeepSeek", "qianwen-token-plan": "Qwen Token Plan", cast: "RunningHub / ComfyUI" };
const descriptions = {
  llm: "默认模型用于分镜、Prompt 优化与 Agent。",
  image: "创作时可按需选择图片模型。",
  video: "按模型能力选择视频生成方式。",
  tts: "用于台词、配音与旁白的语音模型。",
};

function ProviderMark({ provider }: { provider: ChannelProvider }) {
  return <span className="settings-provider-mark" data-provider={provider} aria-hidden="true">{({ openai: "O", deepseek: "D", "qianwen-token-plan": "Q", cast: "R" })[provider]}</span>;
}

export function GenerationChannelsSettings({ kind, settings, onChange, disabled }: { kind: GenerationKind; settings: ModelSettings; onChange: (settings: ModelSettings) => void; disabled?: boolean }) {
  const channels = channelsFor(settings, kind);
  const defaultId = channels.find(channel => channel.id === settings[kind]?.default_channel_id)?.id || channels[0]?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(defaultId);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const selected = channels.find(channel => channel.id === selectedId) || channels.find(channel => channel.id === defaultId) || channels[0];
  const label = labels[kind];
  const filtered = channels.filter(channel => `${channel.name} ${providerLabels[channel.provider]} ${channel.base_url} ${channel.models.map(model => `${model.id} ${model.name}`).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  const focusableId = filtered.some(channel => channel.id === selected?.id) ? selected?.id : filtered[0]?.id;
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const revealSelected = () => {
      const option = list.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
      if (!option || !list.clientWidth || !list.clientHeight) return;
      const bounds = list.getBoundingClientRect();
      const item = option.getBoundingClientRect();
      if (item.left < bounds.left) list.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right) list.scrollLeft += item.right - bounds.right;
      if (item.top < bounds.top) list.scrollTop += item.top - bounds.top;
      else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
    };
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    observer.observe(list);
    return () => observer.disconnect();
  }, [selected?.id, query]);
  const save = (next: GenerationChannel[], nextDefault = defaultId) => onChange({ ...settings, [kind]: {
    ...(settings[kind] || { url: "", api_key: "", description: "" }), channels: next,
    default_channel_id: next.some(channel => channel.id === nextDefault) ? nextDefault : next[0]?.id || "",
  } });
  const add = () => {
    const provider = kind === "video" ? "cast" : "openai";
    const models = presetsFor(kind, provider).map(model => ({ ...model }));
    let number = channels.length + 1;
    while (channels.some(channel => channel.name === `${label}渠道 ${number}`)) number++;
    const channel: GenerationChannel = { id: localId(), name: `${label}渠道 ${number}`, provider, base_url: channelBaseUrl(kind, provider), api_key: "", models, default_model_id: models[0]?.id };
    save([...channels, channel]); setQuery(""); setSelectedId(channel.id);
  };
  return <div className="generation-channels-settings settings-channel-workspace">
    <div className="settings-channel-layout">
      <aside className="settings-channel-sidebar" aria-label={`${label}渠道列表`}>
        <div className="settings-service-heading"><div className="settings-channel-list-heading"><h3>{kind === "llm" ? "统一渠道配置" : `${label}生成渠道`}</h3><span>{query.trim() ? `${filtered.length} / ${channels.length}` : channels.length}</span><Button className="settings-add-channel" aria-label={`添加${label}渠道`} title={`添加${label}渠道`} size="small" icon={<Plus size={14} />} disabled={disabled} onClick={add} /></div><p>服务渠道 · 当前项目</p></div>
        <Input aria-label={`搜索${label}渠道`} value={query} onChange={setQuery} allowClear prefix={<Search size={14} />} placeholder="搜索渠道或模型" />
        <div className="settings-channel-list" ref={listRef}>
          {filtered.map((channel, index) => <button key={channel.id} type="button" className="settings-channel-option" title={channel.name || "未命名渠道"} aria-pressed={selected?.id === channel.id} tabIndex={0} onClick={() => setSelectedId(channel.id)} >
            <ProviderMark provider={channel.provider} /><span className="settings-channel-option-copy"><strong>{channel.name || "未命名渠道"}</strong><small>{providerLabels[channel.provider]} · {channel.models.length} 个模型</small></span>{channel.id === defaultId && <Star size={12} className="settings-default-star" aria-label="默认渠道" />}
          </button>)}
          {!filtered.length && <div className="settings-channel-list-empty">{query.trim() ? <>没有匹配的渠道<Button type="text" size="small" onClick={() => setQuery("")}>清空搜索</Button></> : "添加第一个服务渠道"}</div>}
        </div>
      </aside>
      <div className="settings-channel-editor-scroll" key={selected?.id}>
        {selected ? <ChannelEditor kind={kind} channel={selected} disabled={disabled} isDefault={selected.id === defaultId} onChange={channel => save(channels.map(item => item.id === channel.id ? channel : item))} onDefault={() => save(channels, selected.id)} onRemove={() => {
          const index = channels.findIndex(channel => channel.id === selected.id);
          const next = channels.filter(channel => channel.id !== selected.id);
          save(next); setSelectedId(next[Math.min(index, next.length - 1)]?.id);
        }} /> : <EmptyState icon={<Server size={22} />} title={`还没有${label}渠道`} description="添加渠道后，配置服务地址、API Key 和可用模型。" action={<Button type="primary" icon={<Plus size={15} />} disabled={disabled} onClick={add}>创建第一个渠道</Button>} />}
      </div>
    </div>
  </div>;
}

function ChannelEditor({ kind, channel, isDefault, disabled, onChange, onDefault, onRemove }: { kind: GenerationKind; channel: GenerationChannel; isDefault: boolean; disabled?: boolean; onChange: (channel: GenerationChannel) => void; onDefault: () => void; onRemove: () => void }) {
  const [expandedModel, setExpandedModel] = useState<number | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const editorRef = useRef<HTMLElement>(null);
  const newModelIndex = useRef<number | null>(null);
  useEffect(() => {
    if (newModelIndex.current === null) return;
    const editor = editorRef.current?.querySelector<HTMLElement>(".settings-model-editor");
    if (!editor) return;
    editor.scrollIntoView({ block: "nearest" });
    editor.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    newModelIndex.current = null;
  }, [channel.models.length]);
  const label = labels[kind];
  const change = (patch: Partial<GenerationChannel>) => onChange({ ...channel, ...patch });
  const setModels = (models: GenerationModel[], defaultId = channel.default_model_id) => change({ models, default_model_id: models.some(model => model.id === defaultId) ? defaultId : models[0]?.id });
  const addModel = (model: GenerationModel) => { newModelIndex.current = channel.models.length; setModels([...channel.models, model]); setModelQuery(""); setExpandedModel(channel.models.length); };
  const availablePresets = presetsFor(kind, channel.provider).filter(model => !channel.models.some(item => item.id === model.id));
  const allowCustom = channel.provider !== "qianwen-token-plan" || kind === "llm";
  const addCustomModel = () => {
    let number = channel.models.length + 1;
    while (channel.models.some(model => model.id === `model-${number}`)) number++;
    addModel({ id: `model-${number}`, name: "新模型", profile: profilesFor(kind, channel.provider)[0][0] });
  };
  const matches = channel.models.map((model, index) => ({ model, index })).filter(({ model }) => `${model.name} ${model.id}`.toLowerCase().includes(modelQuery.trim().toLowerCase()));

  return <article className="generation-channel-card settings-channel-editor" ref={editorRef}>
    <div className="generation-channel-heading"><div className="settings-channel-identity"><ProviderMark provider={channel.provider} /><div><div className="settings-channel-title"><h3>{channel.name || "未命名渠道"}</h3>{isDefault && <span className="settings-default-badge"><Star size={11} />默认渠道</span>}</div><p>{providerLabels[channel.provider]}<span>·</span>{channel.models.length} 个可用模型</p></div></div><Space>
      {!isDefault && <Button size="small" disabled={disabled} onClick={onDefault}>设为默认</Button>}
      <ConfirmPopover title="删除这个渠道？" content={`「${channel.name}」将在保存配置后删除。${kind === "llm" ? "删除默认渠道后将使用剩余的第一个渠道。" : "已有素材会保留，使用此渠道的场景需重新选择。"}`} okText="删除渠道" disabled={disabled} onOk={onRemove}><Button aria-label={`删除渠道 ${channel.name}`} title="删除渠道" type="text" status="danger" size="small" icon={<Trash2 size={15} />} disabled={disabled} /></ConfirmPopover>
    </Space></div>
    <Form layout="vertical" disabled={disabled}>
      <div className="settings-connection-card">
      <div className="settings-card-heading"><h4>连接设置</h4><span className="settings-scope">当前项目</span></div>
      <div className="generation-channel-config">
        <Form.Item label="渠道名称"><Input aria-label={`${label}渠道名称`} value={channel.name} onChange={name => change({ name })} /></Form.Item>
        <Form.Item label="接口类型"><Select aria-label={`${label}渠道接口类型`} value={channel.provider} options={[
          { label: kind === "llm" ? "OpenAI" : kind === "image" ? "OpenAI 兼容图片接口" : kind === "tts" ? "OpenAI 兼容语音接口" : "RunningHub / ComfyUI 兼容接口", value: kind === "video" ? "cast" : "openai" },
          ...(kind === "llm" ? [{ label: "DeepSeek", value: "deepseek" }] : []),
          { label: kind === "llm" ? "Qwen Token Plan" : "千问 Token Plan", value: "qianwen-token-plan" },
          ...(kind === "image" && channel.provider === "cast" ? [{ label: "CAST 图片接口（旧配置）", value: "cast" }] : []),
        ]} onChange={(provider: ChannelProvider) => {
          const models = presetsFor(kind, provider).map(model => ({ ...model }));
          change({ provider, models, default_model_id: models[0]?.id, base_url: channelBaseUrl(kind, provider), api_key: "", operation_urls: undefined, operation_api_keys: undefined });
          setExpandedModel(null); setModelQuery("");
        }} /></Form.Item>
        <Form.Item label="接口地址（Base URL）"><Input aria-label={`${label}渠道地址`} value={channel.base_url} placeholder={channelBaseUrl(kind, channel.provider) || "http://127.0.0.1:8190"} onChange={base_url => change({ base_url, operation_urls: undefined })} /></Form.Item>
        <Form.Item label={channel.provider === "qianwen-token-plan" ? "Token Plan API Key" : "API Key"}><Input.Password aria-label={`${label}渠道 API Key`} value={channel.api_key} placeholder={channel.provider === "qianwen-token-plan" ? "sk-sp- 开头的专属 Key" : "输入 API Key"} onChange={api_key => change({ api_key, operation_api_keys: undefined })} /></Form.Item>
      </div>
      </div>
      <div className="generation-channel-models">
        <div className="settings-models-heading"><div><strong>渠道模型 <span>{channel.models.length}</span></strong><p>{descriptions[kind]}</p></div><div className="settings-models-tools">{(channel.models.length > 5 || modelQuery) && <Input aria-label={`搜索${label}模型`} value={modelQuery} onChange={setModelQuery} allowClear prefix={<Search size={13} />} placeholder="搜索模型" />}<Dropdown trigger="click" position="br" disabled={disabled || (!availablePresets.length && !allowCustom)} droplist={<Menu className="settings-add-model-menu" onClickMenuItem={key => {
          if (key === "custom") addCustomModel();
          else { const model = availablePresets[Number(key)]; if (model) addModel({ ...model }); }
        }}>{availablePresets.length > 0 && <Menu.ItemGroup title="预设模型">{availablePresets.map((model, index) => <Menu.Item key={String(index)}>{model.name}</Menu.Item>)}</Menu.ItemGroup>}{allowCustom && <Menu.Item key="custom"><Plus size={14} />添加自定义模型</Menu.Item>}</Menu>}><Button size="small" icon={<Plus size={14} />} disabled={disabled || (!availablePresets.length && !allowCustom)}>添加模型</Button></Dropdown></div></div>
        <div className="settings-model-list">{matches.map(({ model, index }) => {
          const set = (patch: Partial<GenerationModel>) => setModels(channel.models.map((item, i) => i === index ? { ...item, ...patch } : item), channel.default_model_id === model.id && patch.id !== undefined ? patch.id : channel.default_model_id);
          const cap = MODEL_PROFILES[model.profile];
          const expanded = expandedModel === index;
          const defaultModel = (channel.default_model_id || channel.models[0]?.id) === model.id;
          return <div className="generation-channel-model" key={index}>
            <div className="settings-model-row"><button type="button" className="settings-model-toggle" aria-label={`编辑模型 ${model.name || model.id}`} aria-expanded={expanded} aria-controls={`model-editor-${channel.id}-${index}`} onClick={() => setExpandedModel(expanded ? null : index)}><Cpu size={15} /><span><strong title={model.name}>{model.name || "未命名模型"}</strong><small title={model.id}>{model.id || "未填写模型 ID"}</small></span>{defaultModel && <em>默认模型</em>}<ChevronDown size={15} data-expanded={expanded} /></button><div className="settings-model-actions">{!defaultModel && <Button type="text" size="mini" disabled={disabled} onClick={() => change({ default_model_id: model.id })}>设为默认</Button>}<Button type="text" aria-label={`删除模型 ${model.name}`} title="删除模型" size="mini" disabled={disabled} icon={<Trash2 size={13} />} onClick={() => { setModels(channel.models.filter((_, i) => i !== index)); setExpandedModel(null); }} /></div></div>
            {expanded && <div className="settings-model-editor" id={`model-editor-${channel.id}-${index}`}>
              <div className={`generation-channel-model-fields${kind === "llm" ? " generation-channel-chat-model-fields" : ""}`}>
                <Form.Item label="模型 ID">{channel.provider === "qianwen-token-plan" && kind !== "llm" ? <Select aria-label={`${label}模型 ID`} value={model.id} options={presetsFor(kind, channel.provider).map(item => ({ label: item.id, value: item.id }))} onChange={id => { const preset = presetsFor(kind, channel.provider).find(item => item.id === id); if (preset) set(preset); }} /> : <Input aria-label={`${label}模型 ID`} value={model.id} onChange={id => set({ id })} />}</Form.Item>
                <Form.Item label="显示名称"><Input aria-label={`${label}模型名称`} value={model.name} onChange={name => set({ name })} /></Form.Item>
                {kind !== "llm" && <Form.Item label="参数能力"><Select aria-label={`${label}模型参数能力`} value={model.profile} disabled={channel.provider === "qianwen-token-plan"} options={profilesFor(kind, channel.provider).map(([value, profile]) => ({ label: profile.label, value }))} onChange={profile => set({ profile })} /></Form.Item>}
              </div>
              <div className="generation-model-summary">{cap?.label}{cap?.min_duration ? ` · ${cap.min_duration}–${cap.max_duration} 秒` : ""}{cap?.smart_duration ? " · 智能时长" : ""}{cap?.max_images ? ` · 最多 ${cap.max_images} 张参考图` : ""}{cap?.last_frame ? " · 支持尾帧" : ""}</div>
              {channel.provider === "cast" && <div className="generation-model-route"><Form.Item label="模型服务地址（可选）" extra="模型由不同服务提供时，填写该模型的完整服务地址。"><Input aria-label={`${label}模型服务地址`} value={model.base_url || ""} onChange={base_url => set({ base_url })} placeholder="留空使用渠道地址" /></Form.Item><label><Switch size="small" checked={!!model.send_model} disabled={disabled} onChange={send_model => set({ send_model })} />接口接收 model 参数</label><p className="helper">固定模型的 RunningHub 适配服务保持关闭；支持按 model 分发的服务可开启。</p></div>}
            </div>}
          </div>;
        })}</div>
        {!matches.length && <div className="settings-model-empty"><p>{modelQuery.trim() ? "没有匹配的模型，试试其他关键词。" : "还没有模型，从预设添加或创建自定义模型。"}</p>{modelQuery.trim() && <Button type="text" size="small" onClick={() => setModelQuery("")}>清空搜索</Button>}</div>}
      </div>
    </Form>
    <details className="settings-connection-help"><summary>接口说明与调用约定</summary><p>{kind === "llm" ? <>默认渠道与模型用于分镜、Prompt 优化及 Agent，通过 OpenAI 兼容的 <code>/chat/completions</code> 调用。</> : kind === "image" ? <>OpenAI 模式根据 Base URL 调用 <code>/images/generations</code>（文生图）或 <code>/images/edits</code>（图生图），并将画面比例映射为模型支持的尺寸。旧 CAST 接口会按生成方式补全路径。</> : kind === "video" ? <>千问 Token Plan 使用专属视频接口，自动查询进度并下载入库。RunningHub / ComfyUI 兼容接口会按生成方式补全 <code>/v1/generations/t2v</code>、<code>ref2v</code> 或 <code>fl2v</code> 路径。</> : <>OpenAI 兼容服务使用 <code>/audio/speech</code>；可用音色、格式及语速参数由所选模型决定。</>}</p></details>
  </article>;
}
