import { jsonRequest, request, download } from "./transport";
import { downloadName, releaseFile, selectedFile } from "./platform";
const resourceFields: Record<string, string[]> = {
  roles: ["name", "description", "design_media_id"],
  episodes: ["title", "description", "cover_media_id"],
  scenes: ["title", "description", "episode_id", "first_media_id", "last_media_id", "reference_media_id", "generation_options"],
  prompts: ["name", "content", "category"],
  projects: ["name"], assets: ["name"],
};
type Payload = Record<string, any>;
function fields(resource: string, data: Payload) {
  return Object.fromEntries(resourceFields[resource].filter(key => data[key] !== undefined).map(key => [key, data[key]]));
}
const projectPath = (projectId: string, resource: string) => `/api/v1/projects/${encodeURIComponent(projectId)}/${resource}`;
function query(data: Payload) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(data)) if (value !== undefined && value !== null) q.set(key, String(value));
  return q.toString();
}
/** UI service adapter. All data travels over HTTP; CRUD uses resource URLs and HTTP verbs. */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const data: Payload = options.body ? JSON.parse(String(options.body)) : {};
  const method = options.method || "GET";
  if (path === "/projects" && method === "GET") return jsonRequest<T>("/api/v1/projects", "GET");
  if (path === "/media/list") {
    const { project_id, ...filters } = data;
    return jsonRequest<T>(`${projectPath(project_id, "assets")}?${query(filters)}`, "GET");
  }
  if (path === "/media/import") {
    const file = selectedFile(data.source_path);
    if (file) {
      const result = await request<T>(`${projectPath(data.project_id, "assets/upload")}?${query({ name: file.name, role_id: data.role_id })}`, { method: "POST", body: file });
      releaseFile(data.source_path); return result;
    }
  }
  if (path === "/media/export") {
    const name = downloadName(data.destination_path);
    if (name !== null) {
      // Resolve the resource first so missing/deleted media errors reach the UI.
      await jsonRequest(projectPath(data.project_id, `assets/${data.media_id}`), "GET");
      download(`${projectPath(data.project_id, `assets/${data.media_id}/content`)}?download=1`, name);
      return { path: name } as T;
    }
  }
  if (path === "/projects/backup") {
    const name = downloadName(data.path);
    if (name !== null) {
      const result = await jsonRequest<{ url: string }>(projectPath(data.project_id, "backup"), "POST", { include_api_keys: data.include_api_keys });
      download(result.url, name); return { path: name } as T;
    }
  }
  if (path === "/projects/restore") {
    const file = selectedFile(data.path);
    if (file) {
      const result = await request<T>("/api/v1/projects/restore-upload", { method: "POST", body: file });
      releaseFile(data.path); return result;
    }
  }
  const parts = path.split("/").filter(Boolean);
  const resource = parts[0] === "media" ? "assets" : parts[0];
  const operation = parts[1];
  if (resourceFields[resource] && (parts.length === 1 && method === "POST" || parts.length === 2 && ["update", "rename", "delete"].includes(operation))) {
    if (resource === "scenes" && method === "POST") {
      const { episode_id, ...scene } = fields(resource, data);
      if (!episode_id) throw new Error("创建场景需要 episode_id");
      return jsonRequest<T>(`${projectPath(data.project_id, `episodes/${encodeURIComponent(episode_id)}/scenes`)}`, "POST", scene);
    }
    const root = resource === "projects" ? "/api/v1/projects" : projectPath(data.project_id, resource);
    if (!operation) return jsonRequest<T>(root, "POST", fields(resource, data));
    return jsonRequest<T>(`${root}/${encodeURIComponent(data.id)}`, operation === "delete" ? "DELETE" : "PATCH", operation === "delete" ? undefined : fields(resource, data));
  }
  if (path === "/tasks" && method === "GET") {
    const result = await jsonRequest<{ items: unknown[] }>("/api/v1/actions/tasks", "POST", {});
    return result.items as T;
  }
  return jsonRequest<T>(`/api/v1/actions${path}`, "POST", data);
}
export const post = <T,>(path: string, data?: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(data || {}) });
