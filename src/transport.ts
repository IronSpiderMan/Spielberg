declare global { interface Window { __SPIELBERG_API_URL__?: string } }
const configured = (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL;
export const API_BASE_URL = (window.__SPIELBERG_API_URL__ || configured || "").replace(/\/$/, "");
export const isLocalDesktop = "__TAURI_INTERNALS__" in window && (!API_BASE_URL || ["localhost", "127.0.0.1", "[::1]"].includes(new URL(API_BASE_URL, location.origin).hostname));
export function backendUrl(path: string) { return `${API_BASE_URL}${path}`; }
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(backendUrl(path), options); }
  catch { throw new Error("无法连接后端，请检查服务是否启动及 API 地址配置"); }
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || `请求失败（HTTP ${response.status}）`);
  if (!result || !("data" in result)) throw new Error("后端返回了无效的 API 响应");
  return result.data as T;
}
export const jsonRequest = <T,>(path: string, method: string, data?: unknown) => request<T>(path, {
  method,
  ...(data === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
});
export function download(path: string, name: string) {
  const link = document.createElement("a");
  link.href = backendUrl(path); link.download = name; link.style.display = "none";
  document.body.append(link); link.click(); link.remove();
}
