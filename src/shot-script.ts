export const shotSizes = ["大远景", "远景", "全景", "中景", "近景", "特写", "大特写"] as const;
export const cameraMoves = ["固定", "推近", "拉远", "横摇", "俯仰", "平移", "跟随", "升高", "降低", "环绕", "手持", "变焦"] as const;
export type CameraMove = typeof cameraMoves[number];
export type ShotSize = typeof shotSizes[number];
export type ScriptShot = { number: string; size: ShotSize; camera: CameraMove; picture: string; description: string };
export const shotHeaders = ["编号", "景别", "运镜", "画面", "描述"];
export const newShot = (number: string): ScriptShot => ({ number, size: "中景", camera: "固定", picture: "", description: "" });
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
  if (rows[0]?.length !== 5 || rows[0].some((value, index) => value !== shotHeaders[index])) throw new Error("CSV 表头必须为：编号,景别,运镜,画面,描述");
  const seen = new Set<string>();
  return rows.slice(1).map((values, index) => {
    if (values.length !== 5) throw new Error(`第 ${index + 2} 行必须有 5 列（画面可留空）`);
    const [number, size, camera, picture, description] = values;
    if (validate && (!number.trim() || seen.has(number.trim()))) throw new Error(`第 ${index + 2} 行编号为空或重复`);
    seen.add(number.trim());
    if (!shotSizes.includes(size as ShotSize)) throw new Error(`第 ${index + 2} 行景别无效，可选：${shotSizes.join("、")}`);
    if (!cameraMoves.includes(camera as CameraMove)) throw new Error(`第 ${index + 2} 行运镜无效，可选：${cameraMoves.join("、")}`);
    if (validate && !description.trim()) throw new Error(`第 ${index + 2} 行描述不能为空`);
    return { number, size: size as ShotSize, camera: camera as CameraMove, picture, description };
  });
}
export function serializeShotCsv(shots: ScriptShot[]): string {
  const escape = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [shotHeaders, ...shots.map(s => [s.number, s.size, s.camera, s.picture, s.description])].map(row => row.map(escape).join(',')).join('\r\n');
}
