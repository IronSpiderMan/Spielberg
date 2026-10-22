import { Form, Select, Tabs } from "@arco-design/web-react";
import { GENERATION_SIZES, normalizeGenerationSize } from "../../generation-sizes";

export function MediaSizeFields({ ratio, size, onChange, ratioLabel = "画幅", ariaPrefix = "", disabled }: {
  ratio: string;
  size?: string;
  onChange: (value: { ratio: string; size: string }) => void;
  ratioLabel?: string;
  ariaPrefix?: string;
  disabled?: boolean;
}) {
  const sizes = GENERATION_SIZES.find(group => group.ratio === ratio)?.sizes || [];
  return <>
    <Form.Item label={ratioLabel}>
      <Select aria-label={`${ariaPrefix}${ratioLabel}`} disabled={disabled} value={ratio}
        options={GENERATION_SIZES.map(group => ({ label: group.label, value: group.ratio }))}
        onChange={value => onChange({ ratio: value, size: normalizeGenerationSize(value, size) })} />
    </Form.Item>
    <Form.Item label="输出尺寸" extra="宽 × 高（像素）；部分尺寸为接近所选画幅的模型适配值">
      <Select aria-label={`${ariaPrefix}输出尺寸`} disabled={disabled} value={normalizeGenerationSize(ratio, size)}
        options={sizes.map(value => ({ label: value, value }))}
        onChange={value => onChange({ ratio, size: value })} />
    </Form.Item>
  </>;
}

export function VideoDurationField({ value, onChange, disabled }: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return <Form.Item label="时长"><Select aria-label="视频时长" value={value} onChange={onChange} disabled={disabled}
    options={Array.from({ length: 13 }, (_, i) => ({ label: `${i + 3} 秒`, value: i + 3 }))} /></Form.Item>;
}

export function GenerationModeTabs<T extends string>({ value, onChange, modes, disabled = false }: {
  value: T;
  onChange: (value: T) => void;
  modes: { value: T; label: string; disabled?: boolean }[];
  disabled?: boolean;
}) {
  return <Tabs className="image-mode-tabs" activeTab={value} onChange={key => onChange(key as T)}>
    {modes.map(mode => <Tabs.TabPane key={mode.value} title={mode.label} disabled={disabled || mode.disabled} />)}
  </Tabs>;
}
