import { localId } from "./id";
import { Input, Modal } from "@arco-design/web-react";
import { createElement } from "react";
import { isLocalDesktop } from "./transport";
type DialogOptions = { title?: string; directory?: boolean; multiple?: boolean; defaultPath?: string; filters?: { name: string; extensions: string[] }[] };
const files = new Map<string, File>();
export function selectedFile(token: string): File | undefined { return files.get(token); }
export function releaseFile(token: string) { files.delete(token); }
export function downloadName(token: string) { return token.startsWith("download:") ? decodeURIComponent(token.slice(9)) : null; }
export async function open(options: DialogOptions = {}): Promise<string | string[] | null> {
  if (isLocalDesktop) return (await import("@tauri-apps/plugin-dialog")).open(options);
  if (options.directory) {
    return new Promise(resolve => {
      let path = "";
      Modal.confirm({ title: options.title || "打开服务器目录", content: createElement("div", null,
        createElement("p", null, "填写后端服务器上已有项目或备份文件夹的完整路径。导入此电脑的项目请使用备份压缩包恢复。"),
        createElement(Input, { placeholder: "服务器上的完整目录路径", onChange: (value: string) => { path = value; } })),
        onOk: () => { if (!path.trim()) throw new Error("请输入目录路径"); resolve(path.trim()); }, onCancel: () => resolve(null) });
    });
  }
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file"; input.multiple = options.multiple || false;
    input.accept = options.filters?.flatMap(f => f.extensions.map(ext => `.${ext}`)).join(",") || "";
    input.style.display = "none"; document.body.append(input);
    const finish = (value: string | string[] | null) => { input.remove(); resolve(value); };
    input.addEventListener("cancel", () => finish(null), { once: true });
    input.addEventListener("change", () => {
      const tokens = Array.from(input.files || []).map(file => { const token = `upload:${localId()}`; files.set(token, file); return token; });
      finish(options.multiple ? tokens : tokens[0] || null);
    }, { once: true });
    input.click();
  });
}
export async function save(options: DialogOptions = {}): Promise<string | null> {
  if (isLocalDesktop) return (await import("@tauri-apps/plugin-dialog")).save(options);
  return `download:${encodeURIComponent(options.defaultPath || "download")}`;
}
