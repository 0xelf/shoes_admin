import {
  ChevronDown,
  Code2,
  ListPlus,
  Plus,
  Save,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ConfigEntry, type Protocol, type ProtocolType, type VisualEntry, type YamlEntry } from "../api/client";
import { Badge, Spinner, Switch, toast } from "../components/ui";
import { newUuid } from "../lib/format";

const PROTOCOL_TYPES: ProtocolType[] = [
  "http",
  "socks",
  "mixed",
  "shadowsocks",
  "vmess",
  "vless",
  "trojan",
  "hysteria2",
  "tuic",
  "anytls",
  "naiveproxy",
];

const PROTOCOL_LABEL: Record<ProtocolType, string> = {
  http: "HTTP",
  socks: "SOCKS5",
  mixed: "Mixed (HTTP+SOCKS)",
  shadowsocks: "Shadowsocks",
  vmess: "VMess",
  vless: "VLESS",
  trojan: "Trojan",
  hysteria2: "Hysteria2",
  tuic: "TUIC v5",
  anytls: "AnyTLS",
  naiveproxy: "NaiveProxy",
};

const CIPHERS_SS = ["chacha20-ietf-poly1305", "aes-128-gcm", "aes-256-gcm", "2022-blake3-aes-128-gcm", "2022-blake3-aes-256-gcm", "2022-blake3-chacha20-ietf-poly1305"];
const CIPHERS_VMESS = ["aes-128-gcm", "chacha20-poly1305", "none"];

function defaultProtocol(type: ProtocolType): Protocol {
  switch (type) {
    case "http":
      return { type, username: "", password: "" };
    case "socks":
    case "mixed":
      return { type, username: "", password: "", udp_enabled: true };
    case "shadowsocks":
      return { type, cipher: "chacha20-ietf-poly1305", password: "" };
    case "vmess":
      return { type, cipher: "aes-128-gcm", user_id: newUuid(), udp_enabled: true };
    case "vless":
      return { type, user_id: newUuid(), udp_enabled: true };
    case "trojan":
      return { type, password: "" };
    case "hysteria2":
      return { type, password: "", udp_enabled: true };
    case "tuic":
      return { type, uuid: newUuid(), password: "" };
    case "anytls":
      return { type, users: [{ name: "", password: "" }], udp_enabled: true };
    case "naiveproxy":
      return { type, users: [{ name: "", username: "", password: "" }], padding: true };
  }
}

function newVisualEntry(type: ProtocolType = "socks"): VisualEntry {
  return {
    mode: "visual",
    id: newUuid(),
    name: `${PROTOCOL_LABEL[type]} 代理`,
    enabled: true,
    address: DEFAULT_ADDRESS[type] ?? "0.0.0.0:8080",
    transport: "tcp",
    protocol: defaultProtocol(type),
    quic_settings: null,
    rules_yaml: "",
  };
}

/** 各协议新建条目时的默认监听地址 */
const DEFAULT_ADDRESS: Partial<Record<ProtocolType, string>> = {
  http: "0.0.0.0:8080",
  socks: "0.0.0.0:1080",
  mixed: "0.0.0.0:7890",
  shadowsocks: "0.0.0.0:8388",
  vmess: "0.0.0.0:16823",
  vless: "0.0.0.0:443",
  trojan: "0.0.0.0:8443",
  hysteria2: "0.0.0.0:443",
  tuic: "0.0.0.0:443",
  anytls: "0.0.0.0:443",
  naiveproxy: "0.0.0.0:443",
};

function newYamlEntry(): YamlEntry {
  return {
    mode: "yaml",
    id: newUuid(),
    name: "高级配置",
    enabled: true,
    yaml: "- address: \"0.0.0.0:443\"\n  protocol:\n    type: tls\n    # 在此编写高级 YAML 配置",
  };
}

/** 将 "host:port" 拆分为 host 与 port（支持 IPv6 方括号） */
function splitAddress(addr: string): { host: string; port: string } {
  const s = addr.trim();
  if (!s) return { host: "", port: "" };
  if (s.startsWith("[")) {
    const m = s.match(/^(\[[^\]]*\]):?(\d*)$/);
    if (m) return { host: m[1], port: m[2] };
    return { host: s, port: "" };
  }
  const idx = s.lastIndexOf(":");
  if (idx > 0) return { host: s.slice(0, idx), port: s.slice(idx + 1) };
  return { host: s, port: "" };
}

/** 合并 host 与 port 为 "host:port"（IPv6 自动加方括号） */
function joinAddress(host: string, port: string): string {
  const h = host.trim();
  const p = port.trim();
  const hh = h.includes(":") && !h.startsWith("[") ? `[${h}]` : h;
  return p ? `${hh}:${p}` : hh;
}

function entryTypeLabel(e: ConfigEntry): string {
  if (e.mode === "yaml") return "YAML";
  return PROTOCOL_LABEL[e.protocol.type];
}

export default function ConfigPage() {
  const [entries, setEntries] = useState<ConfigEntry[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generatedYaml, setGeneratedYaml] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [showProtoMenu, setShowProtoMenu] = useState(false);

  const selected = useMemo(
    () => entries?.find((e) => e.id === selectedId) ?? null,
    [entries, selectedId]
  );

  useEffect(() => {
    api
      .config()
      .then((r) => {
        setEntries(r.data!.doc.entries);
        setGeneratedYaml(r.data!.generated_yaml);
        if (r.data!.doc.entries.length > 0) {
          setSelectedId(r.data!.doc.entries[0].id);
        }
      })
      .catch((e) => toast(e instanceof Error ? e.message : "加载配置失败", "error"))
      .finally(() => setLoading(false));
  }, []);

  const updateEntry = useCallback((id: string, updater: (e: ConfigEntry) => ConfigEntry) => {
    setEntries((prev) => (prev ? prev.map((e) => (e.id === id ? updater(e) : e)) : prev));
  }, []);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => {
      if (!prev) return prev;
      const next = prev.filter((e) => e.id !== id);
      if (selectedId === id) setSelectedId(next[0]?.id ?? null);
      return next;
    });
  }, [selectedId]);

  const handleSave = async () => {
    if (!entries) return;
    setSaving(true);
    try {
      const r = await api.saveConfig(entries);
      setGeneratedYaml(r.data!.generated_yaml);
      toast(`已保存 ${r.data!.saved_entries} 个配置条目，若代理在运行将自动热重载`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !entries) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={26} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <div>
          <h1 className="text-lg font-semibold">配置管理</h1>
          <p className="text-xs text-slate-400">
            服务器条目列表，保存后生成 shoes 的 YAML 配置
            {selected && <Badge color="slate">共 {entries.length} 条</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 添加服务器：展开选择协议类型 */}
          <div className="relative">
            <button
              className="btn-secondary px-3 py-1.5 text-xs"
              onClick={() => setShowProtoMenu(!showProtoMenu)}
            >
              <Plus size={13} /> 添加配置 <ChevronDown size={12} />
            </button>
            {showProtoMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowProtoMenu(false)} />
                <div className="absolute right-0 z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                  <div className="px-2 py-1 text-[11px] font-medium text-slate-400">选择代理协议</div>
                  {PROTOCOL_TYPES.map((t) => (
                    <button
                      key={t}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 transition hover:bg-indigo-500/10 hover:text-indigo-600 dark:text-slate-200 dark:hover:text-indigo-300"
                      onClick={() => {
                        const e = newVisualEntry(t);
                        setEntries((p) => [...(p ?? []), e]);
                        setSelectedId(e.id);
                        setShowProtoMenu(false);
                      }}
                    >
                      {PROTOCOL_LABEL[t]}
                      <span className="font-mono text-[10px] text-slate-400">{t}</span>
                    </button>
                  ))}
                  <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                  <button
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 transition hover:bg-cyan-500/10 hover:text-cyan-600 dark:text-slate-200 dark:hover:text-cyan-300"
                    onClick={() => {
                      const e = newYamlEntry();
                      setEntries((p) => [...(p ?? []), e]);
                      setSelectedId(e.id);
                      setShowProtoMenu(false);
                    }}
                  >
                    高级 YAML 配置
                    <span className="font-mono text-[10px] text-slate-400">yaml</span>
                  </button>
                </div>
              </>
            )}
          </div>
          <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setShowPreview(!showPreview)}>
            <Code2 size={13} /> 预览 YAML
          </button>
          <button className="btn-primary px-4 py-1.5 text-xs" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner size={13} /> : <Save size={13} />} 保存配置
          </button>
        </div>
      </div>

      {/* 主体：条目列表 + 编辑区 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_1fr]">
        {/* 左侧列表 */}
        <div className="min-h-0 overflow-y-auto border-r border-slate-200 p-3 dark:border-slate-800">
          {entries.length === 0 && (
            <div className="mt-10 flex flex-col items-center gap-2 text-sm text-slate-400">
              <ListPlus size={26} className="opacity-40" />
              <span>暂无配置条目</span>
            </div>
          )}
          <div className="space-y-2">
            {entries.map((e) => (
              <div
                key={e.id}
                onClick={() => setSelectedId(e.id)}
                className={`group cursor-pointer rounded-xl border p-3 transition ${
                  selectedId === e.id
                    ? "border-indigo-500/60 bg-indigo-500/5 dark:bg-indigo-500/10"
                    : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{e.name}</span>
                  <div className="flex shrink-0 items-center gap-1.5" onClick={(ev) => ev.stopPropagation()}>
                    <Switch
                      checked={e.enabled}
                      onChange={(v) => updateEntry(e.id, (x) => ({ ...x, enabled: v }))}
                    />
                    <button
                      className="text-slate-300 opacity-0 transition group-hover:opacity-100 hover:text-rose-500"
                      onClick={() => removeEntry(e.id)}
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
                  <Badge color={e.mode === "yaml" ? "cyan" : "indigo"}>{entryTypeLabel(e)}</Badge>
                  <span className="truncate font-mono">
                    {e.mode === "yaml" ? "raw yaml" : e.address}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧编辑区 */}
        <div className="min-h-0 overflow-y-auto">
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-400">
              <ListPlus size={30} className="opacity-40" />
              <span>选择或创建一个配置条目开始编辑</span>
            </div>
          ) : selected.mode === "visual" ? (
            <VisualEditor
              entry={selected}
              onChange={(updater) => updateEntry(selected.id, (e) => (e.mode === "visual" ? updater(e as VisualEntry) : e))}
            />
          ) : (
            <YamlEditor entry={selected} onChange={(updater) => updateEntry(selected.id, updater)} />
          )}
        </div>
      </div>

      {/* YAML 预览 */}
      {showPreview && (
        <div className="border-t border-slate-200 bg-slate-950/95 p-4 dark:border-slate-800">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">生成的 config.yaml 预览</span>
            <button className="text-xs text-slate-500 hover:text-slate-300" onClick={() => setShowPreview(false)}>
              收起
            </button>
          </div>
          <pre className="max-h-72 overflow-auto rounded-lg bg-black/40 p-4 font-mono text-[12px] leading-relaxed text-emerald-300/90">
            {generatedYaml}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------- 可视化编辑器 ----------

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="label-base">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function VisualEditor({
  entry,
  onChange,
}: {
  entry: VisualEntry;
  onChange: (updater: (e: VisualEntry) => VisualEntry) => void;
}) {
  const p = entry.protocol;
  const setProtocol = (proto: Protocol) => onChange((e) => ({ ...e, protocol: proto }));
  const setField = (key: keyof Protocol, value: unknown) =>
    setProtocol({ ...p, [key]: value } as Protocol);

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[180px] flex-1">
          <Field label="名称">
            <input
              className="input-base"
              value={entry.name}
              onChange={(ev) => onChange((e) => ({ ...e, name: ev.target.value }))}
            />
          </Field>
        </div>
        <div className="flex items-center gap-2 pb-1">
          <Switch
            checked={entry.enabled}
            onChange={(v) => onChange((e) => ({ ...e, enabled: v }))}
          />
          <span className="text-xs text-slate-400">{entry.enabled ? "已启用" : "已停用"}</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="监听 Host" hint="默认 0.0.0.0（所有网卡），仅本机可填 127.0.0.1，IPv6 填 [::]">
          <input
            className="input-base font-mono text-xs"
            value={splitAddress(entry.address).host}
            onChange={(ev) => {
              const { port } = splitAddress(entry.address);
              onChange((e) => ({ ...e, address: joinAddress(ev.target.value, port) }));
            }}
            placeholder="0.0.0.0"
          />
        </Field>
        <Field label="监听 Port">
          <input
            className="input-base font-mono text-xs"
            value={splitAddress(entry.address).port}
            onChange={(ev) => {
              const { host } = splitAddress(entry.address);
              onChange((e) => ({ ...e, address: joinAddress(host, ev.target.value) }));
            }}
            placeholder="8080"
          />
        </Field>
      </div>
      <div>
        <Field label="传输层">
          <select
            className="input-base"
            value={entry.transport}
            onChange={(ev) => onChange((e) => ({ ...e, transport: ev.target.value }))}
          >
            <option value="tcp">TCP</option>
            <option value="quic">QUIC</option>
          </select>
        </Field>
      </div>

      <Field label="协议类型">
        <select
          className="input-base"
          value={p.type}
          onChange={(ev) => setProtocol(defaultProtocol(ev.target.value as ProtocolType))}
        >
          {PROTOCOL_TYPES.map((t) => (
            <option key={t} value={t}>
              {PROTOCOL_LABEL[t]}
            </option>
          ))}
        </select>
      </Field>

      {/* 协议动态字段 */}
      <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">协议参数 · {PROTOCOL_LABEL[p.type]}</span>
        </div>

        {p.type === "http" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="用户名（可选）">
              <input className="input-base" value={p.username ?? ""} onChange={(e) => setField("username", e.target.value)} />
            </Field>
            <Field label="密码（可选）">
              <input className="input-base" type="password" value={p.password ?? ""} onChange={(e) => setField("password", e.target.value)} />
            </Field>
          </div>
        )}

        {(p.type === "socks" || p.type === "mixed") && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="用户名（可选）">
                <input className="input-base" value={p.username ?? ""} onChange={(e) => setField("username", e.target.value)} />
              </Field>
              <Field label="密码（可选）">
                <input className="input-base" type="password" value={p.password ?? ""} onChange={(e) => setField("password", e.target.value)} />
              </Field>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Switch checked={p.udp_enabled ?? true} onChange={(v) => setField("udp_enabled", v)} />
              <span className="text-xs text-slate-400">启用 UDP ASSOCIATE</span>
            </div>
          </>
        )}

        {p.type === "shadowsocks" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="加密方式">
              <select className="input-base" value={p.cipher ?? ""} onChange={(e) => setField("cipher", e.target.value)}>
                {CIPHERS_SS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="密码">
              <input className="input-base" type="password" value={p.password ?? ""} onChange={(e) => setField("password", e.target.value)} />
            </Field>
          </div>
        )}

        {p.type === "vmess" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="加密方式">
                <select className="input-base" value={p.cipher ?? "aes-128-gcm"} onChange={(e) => setField("cipher", e.target.value)}>
                  {CIPHERS_VMESS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="用户 UUID">
                <input className="input-base font-mono text-xs" value={p.user_id ?? ""} onChange={(e) => setField("user_id", e.target.value)} />
              </Field>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Switch checked={p.udp_enabled ?? true} onChange={(v) => setField("udp_enabled", v)} />
              <span className="text-xs text-slate-400">启用 UDP（XUDP）</span>
            </div>
          </>
        )}

        {p.type === "vless" && (
          <>
            <Field label="用户 UUID">
              <input className="input-base font-mono text-xs" value={p.user_id ?? ""} onChange={(e) => setField("user_id", e.target.value)} />
            </Field>
            <div className="mt-4 flex items-center gap-2">
              <Switch checked={p.udp_enabled ?? true} onChange={(v) => setField("udp_enabled", v)} />
              <span className="text-xs text-slate-400">启用 UDP（XUDP）</span>
            </div>
          </>
        )}

        {p.type === "trojan" && (
          <Field label="密码">
            <input className="input-base" type="password" value={p.password ?? ""} onChange={(e) => setField("password", e.target.value)} />
          </Field>
        )}

        {p.type === "hysteria2" && (
          <>
            <Field label="密码">
              <input className="input-base" type="password" value={p.password ?? ""} onChange={(e) => setField("password", e.target.value)} />
            </Field>
            <div className="mt-4 flex items-center gap-2">
              <Switch checked={p.udp_enabled ?? true} onChange={(v) => setField("udp_enabled", v)} />
              <span className="text-xs text-slate-400">启用 UDP</span>
            </div>
          </>
        )}

        {p.type === "tuic" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="UUID">
              <input className="input-base font-mono text-xs" value={p.uuid ?? ""} onChange={(e) => setField("uuid", e.target.value)} />
            </Field>
            <Field label="密码">
              <input className="input-base" type="password" value={p.password ?? ""} onChange={(e) => setField("password", e.target.value)} />
            </Field>
          </div>
        )}

        {p.type === "anytls" && (
          <UserListEditor
            users={p.users ?? []}
            columns={[{ key: "name", label: "名称（可选）" }, { key: "password", label: "密码", type: "password" }]}
            onChange={(users) => setField("users", users)}
          />
        )}

        {p.type === "naiveproxy" && (
          <>
            <UserListEditor
              users={p.users ?? []}
              columns={[{ key: "name", label: "名称（可选）" }, { key: "username", label: "用户名" }, { key: "password", label: "密码", type: "password" }]}
              onChange={(users) => setField("users", users)}
            />
            <div className="mt-4 flex items-center gap-2">
              <Switch checked={p.padding ?? true} onChange={(v) => setField("padding", v)} />
              <span className="text-xs text-slate-400">启用 padding 协议</span>
            </div>
          </>
        )}
      </div>

      {/* 高级项 */}
      <details className="rounded-xl border border-slate-200 dark:border-slate-800">
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">
          <ChevronDown size={14} /> 高级选项（路由规则 / QUIC 设置）
        </summary>
        <div className="space-y-4 border-t border-slate-200 p-4 dark:border-slate-800">
          {entry.transport === "quic" && (
            <Field label="QUIC 设置 (JSON)" hint='如 {"cert": "cert.pem", "key": "key.pem", "alpn_protocols": ["h3"]}'>
              <textarea
                className="input-base min-h-[90px] font-mono text-xs"
                value={entry.quic_settings ? JSON.stringify(entry.quic_settings, null, 2) : ""}
                onChange={(ev) => {
                  const raw = ev.target.value.trim();
                  if (!raw) {
                    onChange((e) => ({ ...e, quic_settings: null }));
                    return;
                  }
                  try {
                    onChange((e) => ({ ...e, quic_settings: JSON.parse(raw) }));
                  } catch {
                    /* 未完成输入时忽略 */
                  }
                }}
                placeholder='{"cert": "cert.pem", "key": "key.pem"}'
              />
            </Field>
          )}
          <Field label="路由规则 rules (YAML)" hint='如 - masks: "0.0.0.0/0"\n  action: allow\n  client_chain: ...'>
            <textarea
              className="input-base min-h-[110px] font-mono text-xs"
              value={entry.rules_yaml ?? ""}
              onChange={(ev) => onChange((e) => ({ ...e, rules_yaml: ev.target.value }))}
              placeholder={'- masks: "0.0.0.0/0"\n  action: allow'}
            />
          </Field>
        </div>
      </details>
    </div>
  );
}

function UserListEditor({
  users,
  columns,
  onChange,
}: {
  users: { name?: string | null; username?: string; password: string }[];
  columns: { key: string; label: string; type?: "password" }[];
  onChange: (users: { name?: string | null; username?: string; password: string }[]) => void;
}) {
  const update = (i: number, key: string, value: string) => {
    const next = users.map((u, idx) => (idx === i ? { ...u, [key]: value } : u));
    onChange(next);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">用户列表</span>
        <button
          className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-400"
          onClick={() => {
            const base: { name?: string; username?: string; password: string } = { name: "", password: "" };
            columns.forEach((c) => {
              if (c.key === "username") base.username = "";
            });
            onChange([...users, base]);
          }}
        >
          <UserPlus size={13} /> 添加用户
        </button>
      </div>
      {users.map((u, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-2">
          {columns.map((c) => (
            <input
              key={c.key}
              className="input-base"
              type={c.type ?? "text"}
              placeholder={c.label}
              value={(u as Record<string, unknown>)[c.key] as string}
              onChange={(ev) => update(i, c.key, ev.target.value)}
            />
          ))}
          {columns.length === 1 ? (
            <button
              className="justify-self-start text-xs text-slate-400 hover:text-rose-500"
              onClick={() => onChange(users.filter((_, idx) => idx !== i))}
            >
              删除
            </button>
          ) : (
            <button
              className="col-span-full justify-self-start text-xs text-slate-400 hover:text-rose-500"
              onClick={() => onChange(users.filter((_, idx) => idx !== i))}
            >
              删除该用户
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- YAML 编辑器 ----------

function YamlEditor({
  entry,
  onChange,
}: {
  entry: YamlEntry;
  onChange: (updater: (e: ConfigEntry) => ConfigEntry) => void;
}) {
  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-[180px] flex-1">
          <Field label="名称">
            <input
              className="input-base"
              value={entry.name}
              onChange={(ev) => onChange((e) => ({ ...e, name: ev.target.value }))}
            />
          </Field>
        </div>
        <div className="flex items-center gap-2 pb-1">
          <Switch
            checked={entry.enabled}
            onChange={(v) => onChange((e) => ({ ...e, enabled: v }))}
          />
          <span className="text-xs text-slate-400">{entry.enabled ? "已启用" : "已停用"}</span>
        </div>
      </div>
      <Field label="原始 YAML（支持一个或多个配置条目）">
        <textarea
          className="input-base min-h-[320px] font-mono text-xs leading-relaxed"
          value={entry.yaml}
          onChange={(ev) => onChange((e) => ({ ...e, yaml: ev.target.value }))}
          spellCheck={false}
        />
      </Field>
      <p className="text-[11px] text-slate-400">
        支持 TLS / Reality / ShadowTLS / WebSocket 等可视化表单未覆盖的协议，语法参考原项目 CONFIG.md。
      </p>
    </div>
  );
}
