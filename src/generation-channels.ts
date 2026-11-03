import { useState } from "react";
import catalog from "./generation-models.json";
import { GENERATION_SIZES } from "./generation-sizes";
import type { ModelSettings } from "./core";

export type GenerationKind = "image" | "video" | "tts";
export type ChannelProvider = "openai" | "cast" | "qianwen-token-plan";
export type GenerationModel = { id: string; name: string; profile: string; base_url?: string; send_model?: boolean };
export type GenerationChannel = { id: string; name: string; provider: ChannelProvider; base_url: string; api_key: string; models: GenerationModel[]; default_model_id?: string; resolution?: string; operation_urls?: Record<string,string>; operation_api_keys?: Record<string,string> };
export type GenerationSelection = { channel_id?: string; model?: string };
export type ModelCapabilities = { label: string; kind: GenerationKind; providers: string[]; modes: string[]; mask?: boolean; last_frame?: boolean; max_images?: number; max_videos?: number; max_audios?: number; size_mode: string; min_pixels?: number; max_pixels?: number; ratios?: string[]; resolutions?: string[]; min_duration?: number; max_duration?: number; smart_duration?: boolean; audio?: boolean; default_voice?: string; formats?: string[]; max_text?: number; speed?: boolean; instructions?: boolean };
export const MODEL_PROFILES = catalog.profiles as Record<string, ModelCapabilities>;
export const MODEL_PRESETS = catalog.models as GenerationModel[];
export type GenerationChoice = { channel: GenerationChannel; model: GenerationModel; capabilities: ModelCapabilities };
export const profilesFor = (kind: GenerationKind, provider: ChannelProvider) => Object.entries(MODEL_PROFILES).filter(([,p]) => p.kind === kind && p.providers.includes(provider));
export const presetsFor = (kind: GenerationKind, provider: ChannelProvider) => MODEL_PRESETS.filter(m => profilesFor(kind,provider).some(([id]) => id === m.profile));

// Older projects are presented as one channel until settings are next saved.
export function channelsFor(settings: ModelSettings, kind: GenerationKind): GenerationChannel[] {
  if (settings[kind]?.channels) return settings[kind].channels!;
  if (kind === "tts") return [];
  const operations = kind === "image" ? ["t2i","i2i"] : ["t2v","i2v","ref2v","fl2v"];
  const legacy = operations.map(op => settings[op]).find(c => c?.url);
  const shared = settings[kind];
  const config = shared || legacy;
  if (!config) return [];
  const base_url = config.base_url || config.url || legacy?.url || "";
  if (!base_url && config.provider !== "qianwen-token-plan") return [];
  const provider = config.provider || "cast";
  const defaults = presetsFor(kind,provider);
  const id = config.model || (kind === "video" && provider === "qianwen-token-plan" ? "happyhorse-1.1-t2v" : defaults[0]?.id);
  const found = defaults.find(m => m.id === id);
  const models = kind === "video" && provider === "qianwen-token-plan" && id?.startsWith("happyhorse-") ? defaults.filter(m => m.id.startsWith("happyhorse-")) : [{...(found || defaults[0]), id:id || "default",name:found?.name || id || "默认模型"}];
  const channel: GenerationChannel = {id:`legacy-${kind}`,name:kind === "image" ? "原图片渠道" : "原视频渠道",provider,base_url,api_key:config.api_key || legacy?.api_key || "",models,default_model_id:id,resolution:config.resolution};
  if (!shared && provider === "cast") {
    channel.operation_urls = Object.fromEntries(operations.filter(op => settings[op]?.url).map(op => [op, settings[op].url]));
    channel.operation_api_keys = Object.fromEntries(operations.filter(op => settings[op]?.url).map(op => [op, settings[op].api_key]));
  }
  return [channel];
}

// Task-specific API models share one user-facing model family.
export const modelFamily = (model: GenerationModel) => model.id.replace(/^(happyhorse-[\d.]+)-(?:t2v|i2v|r2v)$/, "$1");
export function selectableModels(models: GenerationModel[]) {
  return models.filter((model,index)=>models.findIndex(other=>modelFamily(other)===modelFamily(model))===index)
    .map(model=>({...model,id:modelFamily(model),name:modelFamily(model)!==model.id?`HappyHorse ${modelFamily(model).replace("happyhorse-","")}`:model.name}));
}

export function generationChoice(settings: ModelSettings, kind: GenerationKind, value: GenerationSelection = {}, operation?: string): GenerationChoice | undefined {
  const channels = channelsFor(settings,kind);
  const channel = value.channel_id ? channels.find(c => c.id === value.channel_id) : channels.find(c => c.id === settings[kind]?.default_channel_id) || channels[0];
  if (!channel) return;
  const candidates = channel.models.filter(m => !operation || MODEL_PROFILES[m.profile]?.modes.includes(operation));
  const selected = value.model || channel.default_model_id;
  const family = selected && modelFamily({id:selected} as GenerationModel);
  const siblings = channel.models.filter(m=>modelFamily(m)===family);
  const model = (operation ? candidates : channel.models).find(m=>modelFamily(m)===family) || (value.model ? undefined : candidates[0]);
  const capabilities = model && MODEL_PROFILES[model.profile];
  if (!model || !capabilities) return;
  // Without a task, expose the family's combined modes for the configuration UI.
  const combined = !operation && siblings.length>1 ? {...capabilities,modes:[...new Set(siblings.flatMap(m=>MODEL_PROFILES[m.profile]?.modes || []))],max_images:Math.max(...siblings.map(m=>MODEL_PROFILES[m.profile]?.max_images || 0))} : capabilities;
  return {channel,model,capabilities:combined};
}

export function useGenerationSelection(settings: ModelSettings, kind: GenerationKind, operation?: string) {
  const [value,setValue] = useState<GenerationSelection>({});
  return {value,setValue,choice:generationChoice(settings,kind,value,operation)};
}
export const selectionPayload = (choice?: GenerationChoice): GenerationSelection => choice ? {channel_id:choice.channel.id,model:choice.model.id} : {};
export function modelRatio(choice: GenerationChoice | undefined, ratio: string) {
  const ratios=choice?.capabilities.ratios;
  if (!ratios || ratios.includes(ratio)) return ratio;
  if (choice?.capabilities.size_mode === "openai") return ratio === "9:16" ? "2:3" : ratio === "16:9" ? "3:2" : ratios[0];
  return ratios[0];
}
export function imageSizes(choice: GenerationChoice | undefined, ratio: string, operation = "t2i") {
  if (choice?.capabilities.size_mode === "openai") return ratio === "1:1" ? ["1024x1024"] : ratio === "2:3" ? ["1024x1536"] : ["1536x1024"];
  const cap = choice?.capabilities;
  const sizes = [...(GENERATION_SIZES.find(g => g.ratio === ratio)?.sizes || ["1024x1024"])];
  if (cap?.size_mode === "qianwen" && ratio === "1:1") sizes.push("2048x2048",...(choice?.model.profile === "wan-image-pro" && operation === "t2i" ? ["4096x4096"] : []));
  return [...new Set(sizes)].filter(size => {const [w,h] = size.split("x").map(Number);return w*h >= (cap?.min_pixels || 1) && w*h <= (cap?.max_pixels || Infinity) && !(choice?.model.profile === "wan-image-pro" && operation === "i2i" && w*h > 4194304);});
}
export function modelImageSize(choice: GenerationChoice | undefined, ratio: string, size?: string, operation?: string) {
  const sizes = imageSizes(choice,modelRatio(choice,ratio),operation);
  return size && sizes.includes(size) ? size : sizes.includes("1344x768") ? "1344x768" : sizes[sizes.length > 2 ? 2 : 0] || "1024x1024";
}
export function validateGeneration(choice: GenerationChoice | undefined, operation: string, fields: {images?: number;videos?: number;audios?: number;last?: boolean;mask?: boolean;duration?: number}) {
  if (!choice) throw new Error("请先在设置中配置渠道和模型，再选择生成渠道与模型");
  const cap = choice.capabilities;
  if (!cap.modes.includes(operation)) throw new Error("所选模型不支持当前生成方式");
  if (fields.last && !cap.last_frame) throw new Error("所选模型不支持尾帧");
  if (fields.mask && !cap.mask) throw new Error("所选模型不支持蒙版，请清除蒙版或切换模型");
  if ((fields.images || 0) > (cap.max_images || 0) || (fields.videos || 0) > (cap.max_videos || 0) || (fields.audios || 0) > (cap.max_audios || 0)) throw new Error("参考素材超过所选模型支持的数量");
  if (fields.duration !== undefined && !(fields.duration === -1 && cap.smart_duration) && (fields.duration < (cap.min_duration || 3) || fields.duration > (cap.max_duration || 15))) throw new Error("时长超出所选模型支持的范围");
}
