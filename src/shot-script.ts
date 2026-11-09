export const shotSizes = ["大远景", "远景", "全景", "中景", "近景", "特写", "大特写"] as const;
export const cameraMoves = ["固定", "推近", "拉远", "横摇", "俯仰", "平移", "跟随", "升高", "降低", "环绕", "手持", "变焦"] as const;
export type CameraMove = typeof cameraMoves[number];
export type ShotSize = typeof shotSizes[number];
export const shotDurations = Array.from({ length: 30 }, (_, index) => index + 1);
export type ScriptShot = { size: ShotSize; camera: CameraMove; duration: number | null; media: string[]; description: string };
const legacyHeaders = ["编号", "景别", "运镜", "画面", "描述"];
export const shotHeaders = ["编号", "景别", "运镜", "时长", "素材", "描述"];
export const newShot = (): ScriptShot => ({ size: "中景", camera: "固定", duration: null, media: [], description: "" });
export function parseShotCsv(content: string, validate = true): ScriptShot[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, closed = false;
  const source = content.replace(/^\uFEFF/, "");
  const finishCell = () => { row.push(cell); cell = ""; closed = false; };
  const finishRow = () => { finishCell(); rows.push(row); row = []; };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') { if (source[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += ch;
    } else if (ch === ',') finishCell();
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && source[i + 1] === '\n') i++; finishRow(); }
    else if (ch === '"' && !cell && !closed) quoted = true;
    else { if (closed || ch === '"') throw new Error("CSV 引号格式错误"); cell += ch; }
  }
  if (quoted) throw new Error("CSV 存在未闭合的引号");
  if (cell || row.length || closed) finishRow();
  const matches = (headers: string[]) => rows[0]?.length === headers.length && headers.every((value, index) => value === rows[0][index]);
  const legacy = matches(legacyHeaders);
  if (!legacy && !matches(shotHeaders)) throw new Error(`CSV 表头必须为：${shotHeaders.join(",")}`);
  const columns = legacy ? legacyHeaders.length : shotHeaders.length;
  return rows.slice(1).map((values, index) => {
    if (values.length !== columns) throw new Error(`第 ${index + 2} 行必须有 ${columns} 列`);
    const [, size, camera] = values;
    const description = values[columns - 1];
    const duration = legacy || values[3] === "" ? null : Number(values[3]);
    const media = legacy ? (values[3] ? [values[3]] : []) : values[4].split(/\r?\n/).filter(Boolean);
    if (!shotSizes.includes(size as ShotSize)) throw new Error(`第 ${index + 2} 行景别无效，可选：${shotSizes.join("、")}`);
    if (!cameraMoves.includes(camera as CameraMove)) throw new Error(`第 ${index + 2} 行运镜无效，可选：${cameraMoves.join("、")}`);
    if (duration !== null && (!shotDurations.includes(duration) || String(duration) !== values[3])) throw new Error(`第 ${index + 2} 行时长必须为 1–30 秒的整数`);
    if (validate && !description.trim()) throw new Error(`第 ${index + 2} 行描述不能为空`);
    return { size: size as ShotSize, camera: camera as CameraMove, duration, media, description };
  });
}
export function serializeShotCsv(shots: ScriptShot[]): string {
  const escape = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [shotHeaders, ...shots.map((s, index) => [String(index + 1), s.size, s.camera, s.duration?.toString() ?? "", s.media.join("\n"), s.description])].map(row => row.map(escape).join(',')).join('\r\n');
}
