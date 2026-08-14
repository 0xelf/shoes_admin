import { useAuth } from "../store/useAuth";

export interface ApiResp<T> {
  ok: boolean;
  message: string;
  data?: T;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<ApiResp<T>> {
  const { token } = useAuth.getState();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const resp = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let json: ApiResp<T> | null = null;
  try {
    json = (await resp.json()) as ApiResp<T>;
  } catch {
    /* ignore */
  }

  if (resp.status === 401) {
    useAuth.getState().logout();
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    throw new ApiError(401, json?.message ?? "未登录或登录已过期");
  }

  if (!resp.ok || !json?.ok) {
    throw new ApiError(resp.status, json?.message ?? `请求失败 (${resp.status})`);
  }
  return json;
}

// ---------- 类型定义 ----------

export type ProxyState = "stopped" | "starting" | "running" | "exited";
export type DownloadState =
  | "idle"
  | "checking"
  | "downloading"
  | "extracting"
  | "done"
  | "unsupported"
  | "error";

export interface ProxyStatus {
  state: ProxyState;
  pid: number | null;
  started_at: number | null;
  last_error: string | null;
  log_count: number;
}

export interface DownloadStatus {
  state: DownloadState;
  version: string | null;
  asset: string | null;
  progress: number;
  received: number;
  total: number;
  message: string;
  binary_ready: boolean;
}

export interface StatusData {
  panel_version: string;
  platform: { os: string; arch: string; proxy_supported: boolean };
  proxy: ProxyStatus;
  download: DownloadStatus;
  config_entry_count: number;
  username: string;
  server_time: number;
}

export type ProtocolType =
  | "http"
  | "socks"
  | "mixed"
  | "shadowsocks"
  | "vmess"
  | "vless"
  | "trojan"
  | "hysteria2"
  | "tuic"
  | "anytls"
  | "naiveproxy";

export interface Protocol {
  type: ProtocolType;
  username?: string | null;
  password?: string | null;
  udp_enabled?: boolean;
  cipher?: string;
  user_id?: string;
  uuid?: string;
  users?: { name?: string | null; username?: string; password: string }[];
  padding?: boolean;
}

export interface VisualEntry {
  mode: "visual";
  id: string;
  name: string;
  enabled: boolean;
  address: string;
  transport: string;
  protocol: Protocol;
  quic_settings?: Record<string, unknown> | null;
  rules_yaml?: string | null;
}

export interface YamlEntry {
  mode: "yaml";
  id: string;
  name: string;
  enabled: boolean;
  yaml: string;
}

export type ConfigEntry = VisualEntry | YamlEntry;

export interface ConfigData {
  doc: { version: number; entries: ConfigEntry[] };
  generated_yaml: string;
}

export interface SettingsData {
  listen: string;
  username: string;
  platform: { os: string; arch: string };
  panel_version: string;
  default_username: string;
}

export const api = {
  login: (username: string, password: string) =>
    apiFetch<{ token: string; username: string; expires_in: number }>("/api/auth/login", {
      method: "POST",
      body: { username, password },
    }),
  changePassword: (old_password: string, new_password: string) =>
    apiFetch<Record<string, never>>("/api/auth/password", {
      method: "PUT",
      body: { old_password, new_password },
    }),
  status: () => apiFetch<StatusData>("/api/status"),
  config: () => apiFetch<ConfigData>("/api/config"),
  saveConfig: (entries: ConfigEntry[]) =>
    apiFetch<{ generated_yaml: string; saved_entries: number }>("/api/config", {
      method: "PUT",
      body: { entries },
    }),
  resetConfig: () =>
    apiFetch<{ generated_yaml: string }>("/api/config/default", { method: "POST" }),
  proxyStart: () => apiFetch<Record<string, never>>("/api/proxy/start", { method: "POST" }),
  proxyStop: () => apiFetch<Record<string, never>>("/api/proxy/stop", { method: "POST" }),
  logs: (lines = 500) => apiFetch<{ logs: string[]; state: ProxyState }>(`/api/proxy/logs?lines=${lines}`),
  clearLogs: () => apiFetch<Record<string, never>>("/api/proxy/logs/clear", { method: "POST" }),
  downloadStatus: () => apiFetch<DownloadStatus>("/api/download/status"),
  retryDownload: () => apiFetch<Record<string, never>>("/api/download/retry", { method: "POST" }),
  settings: () => apiFetch<SettingsData>("/api/settings"),
  saveSettings: (body: { listen?: string; username?: string }) =>
    apiFetch<Record<string, never>>("/api/settings", { method: "PUT", body }),
};
