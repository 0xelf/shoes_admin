import { KeyRound, RefreshCw, Save, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type SettingsData } from "../api/client";
import { Badge, Spinner, toast, useDebounced } from "../components/ui";
import { useTheme, type Theme } from "../store/useTheme";

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [listen, setListen] = useState("");
  const [username, setUsername] = useState("");
  const debouncedListen = useDebounced(listen, 400);

  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const { theme, setTheme } = useTheme();

  useEffect(() => {
    api
      .settings()
      .then((r) => {
        setSettings(r.data ?? null);
        setListen(r.data?.listen ?? "");
        setUsername(r.data?.username ?? "");
      })
      .catch((e) => toast(e instanceof Error ? e.message : "加载设置失败", "error"));
  }, []);

  // 保存设置（防抖自动保存，简单可靠）
  useEffect(() => {
    if (settings && debouncedListen && debouncedListen !== settings.listen) {
      const timer = setTimeout(() => {
        api
          .saveSettings({ listen: debouncedListen })
          .then((r) => toast(r.message))
          .catch((e) => toast(e instanceof Error ? e.message : "保存失败", "error"));
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [debouncedListen, settings]);

  const saveUsername = async () => {
    try {
      const r = await api.saveSettings({ username });
      setSettings((s) => (s ? { ...s, username } : s));
      toast(r.message);
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存失败", "error");
    }
  };

  const savePassword = async () => {
    if (newPw.length < 6) {
      toast("新密码长度至少 6 位", "error");
      return;
    }
    if (newPw !== confirmPw) {
      toast("两次输入的新密码不一致", "error");
      return;
    }
    setSavingPw(true);
    try {
      const r = await api.changePassword(oldPw, newPw);
      toast(r.message);
      setOldPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "修改失败", "error");
    } finally {
      setSavingPw(false);
    }
  };

  const handleResetConfig = async () => {
    if (!window.confirm("确定恢复默认配置？当前所有配置条目将被覆盖。")) return;
    try {
      await api.resetConfig();
      toast("已恢复默认配置");
    } catch (e) {
      toast(e instanceof Error ? e.message : "操作失败", "error");
    }
  };

  const handleRetry = async () => {
    try {
      await api.retryDownload();
      toast("已开始检查最新版本");
    } catch (e) {
      toast(e instanceof Error ? e.message : "操作失败", "error");
    }
  };

  const themeOptions: { value: Theme; label: string }[] = [
    { value: "light", label: "浅色" },
    { value: "dark", label: "深色" },
    { value: "system", label: "跟随系统" },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 lg:p-8">
      <header>
        <h1 className="text-lg font-semibold">面板设置</h1>
        <p className="text-xs text-slate-400">账号、服务与外观配置</p>
      </header>

      {!settings ? (
        <div className="flex justify-center py-16">
          <Spinner size={24} />
        </div>
      ) : (
        <>
          {/* 服务 */}
          <section className="glass-card space-y-4 p-6">
            <div className="flex items-center gap-2">
              <Settings2 size={17} className="text-indigo-500" />
              <h2 className="text-sm font-medium">服务配置</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label-base">监听地址</label>
                <input
                  className="input-base font-mono text-xs"
                  value={listen}
                  onChange={(e) => setListen(e.target.value)}
                  placeholder="0.0.0.0:6240"
                />
                <p className="mt-1 text-[11px] text-slate-400">修改后需重启面板生效</p>
              </div>
              <div>
                <label className="label-base">管理员用户名</label>
                <div className="flex gap-2">
                  <input
                    className="input-base flex-1"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                  <button className="btn-secondary shrink-0 px-3" onClick={saveUsername}>
                    <Save size={14} /> 保存
                  </button>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
              <span>
                面板版本 <Badge color="indigo">v{settings.panel_version}</Badge>
              </span>
              <span>
                运行平台{" "}
                <Badge color="slate">
                  {settings.platform.os} / {settings.platform.arch}
                </Badge>
              </span>
            </div>
          </section>

          {/* 修改密码 */}
          <section className="glass-card space-y-4 p-6">
            <div className="flex items-center gap-2">
              <KeyRound size={17} className="text-cyan-500" />
              <h2 className="text-sm font-medium">修改密码</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="label-base">原密码</label>
                <input
                  className="input-base"
                  type="password"
                  value={oldPw}
                  onChange={(e) => setOldPw(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div>
                <label className="label-base">新密码（至少 6 位）</label>
                <input
                  className="input-base"
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="label-base">确认新密码</label>
                <input
                  className="input-base"
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
            <button
              className="btn-primary"
              onClick={savePassword}
              disabled={savingPw || !oldPw || !newPw || !confirmPw}
            >
              {savingPw ? <Spinner size={15} /> : <KeyRound size={15} />} 更新密码
            </button>
          </section>

          {/* 外观 */}
          <section className="glass-card space-y-4 p-6">
            <div className="flex items-center gap-2">
              <Settings2 size={17} className="text-amber-500" />
              <h2 className="text-sm font-medium">外观主题</h2>
            </div>
            <div className="flex gap-2">
              {themeOptions.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setTheme(o.value)}
                  className={`rounded-lg border px-4 py-2 text-sm transition ${
                    theme === o.value
                      ? "border-indigo-500 bg-indigo-500/10 text-indigo-500"
                      : "border-slate-300 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </section>

          {/* shoes 二进制 */}
          <section className="glass-card space-y-4 p-6">
            <div className="flex items-center gap-2">
              <RefreshCw size={17} className="text-emerald-500" />
              <h2 className="text-sm font-medium">shoes 二进制</h2>
            </div>
            <p className="text-xs text-slate-400">
              二进制存放于可执行文件同级的 bin/ 目录。点击下方按钮可重新检查最新 release 并更新。
            </p>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" onClick={handleRetry}>
                <RefreshCw size={14} /> 重新检查 / 更新
              </button>
              <button className="btn-secondary text-rose-500" onClick={handleResetConfig}>
                <Trash2 size={14} /> 恢复默认配置
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
