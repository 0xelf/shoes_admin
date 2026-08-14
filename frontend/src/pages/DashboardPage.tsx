import {
  Activity,
  ArrowDownToLine,
  Box,
  Cpu,
  DownloadCloud,
  ExternalLink,
  ListOrdered,
  Play,
  RefreshCw,
  Server,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type StatusData } from "../api/client";
import { Badge, Spinner, toast } from "../components/ui";
import { formatBytes, formatDuration, formatPercent, formatTime } from "../lib/format";
import { usePolling } from "../lib/usePolling";

const stateMeta: Record<string, { label: string; color: "green" | "red" | "amber" | "slate" | "indigo"; dot: string }> = {
  running: { label: "运行中", color: "green", dot: "bg-emerald-500" },
  starting: { label: "启动中", color: "amber", dot: "bg-amber-500" },
  stopped: { label: "已停止", color: "slate", dot: "bg-slate-400" },
  exited: { label: "已退出", color: "red", dot: "bg-rose-500" },
};

const dlMeta: Record<string, { label: string; color: "green" | "red" | "amber" | "slate" | "indigo" | "cyan" }> = {
  done: { label: "就绪", color: "green" },
  checking: { label: "查询版本", color: "indigo" },
  downloading: { label: "下载中", color: "cyan" },
  extracting: { label: "解压中", color: "cyan" },
  unsupported: { label: "平台不支持", color: "amber" },
  error: { label: "下载失败", color: "red" },
  idle: { label: "未检测", color: "slate" },
};

export default function DashboardPage() {
  const { data, error, loading, setPaused } = usePolling(() => api.status(), 2000);
  const [busy, setBusy] = useState<"start" | "stop" | null>(null);
  const status = data?.data ?? null;

  // 代理正在下载/运行等状态时暂停轮询无必要，保留轮询即可
  useEffect(() => {
    setPaused(false);
  }, [setPaused]);

  const handleStart = useCallback(async () => {
    setBusy("start");
    try {
      await api.proxyStart();
      toast("代理已启动");
    } catch (e) {
      toast(e instanceof Error ? e.message : "启动失败", "error");
    } finally {
      setBusy(null);
    }
  }, []);

  const handleStop = useCallback(async () => {
    setBusy("stop");
    try {
      await api.proxyStop();
      toast("代理已停止");
    } catch (e) {
      toast(e instanceof Error ? e.message : "停止失败", "error");
    } finally {
      setBusy(null);
    }
  }, []);

  const handleRetryDownload = useCallback(async () => {
    try {
      await api.retryDownload();
      toast("已开始检查最新版本");
    } catch (e) {
      toast(e instanceof Error ? e.message : "操作失败", "error");
    }
  }, []);

  if (loading && !status) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={28} />
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <div className="text-sm text-rose-500">{error}</div>
        <button className="btn-secondary" onClick={() => window.location.reload()}>
          <RefreshCw size={14} /> 重试
        </button>
      </div>
    );
  }

  const proxyState = status?.proxy.state ?? "stopped";
  const pm = stateMeta[proxyState] ?? stateMeta.stopped;
  const dl = status?.download;
  const dlm = dlMeta[dl?.state ?? "idle"];
  const proxySupported = status?.platform.proxy_supported ?? false;
  const running = proxyState === "running";
  const canControl = proxySupported && dl?.binary_ready && !["downloading", "extracting", "checking"].includes(dl?.state ?? "");

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">仪表盘</h1>
          <p className="text-xs text-slate-400">代理运行状态与服务总览</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Badge color="indigo">v{status?.panel_version}</Badge>
          <Badge color="slate">
            {status?.platform.os} / {status?.platform.arch}
          </Badge>
        </div>
      </header>

      {/* 主控制卡片 */}
      <div className="glass-card relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-indigo-500/10 blur-2xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="relative">
              <div className={`flex h-16 w-16 items-center justify-center rounded-2xl border ${running ? "border-emerald-500/40 bg-emerald-500/10" : "border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"}`}>
                <Server size={28} className={running ? "text-emerald-500" : "text-slate-400"} />
              </div>
              <span className={`absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 border-white dark:border-slate-900 ${running ? "bg-emerald-500 animate-pulse-dot" : "bg-slate-400"}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold">shoes 代理</h2>
                <Badge color={pm.color}>{pm.label}</Badge>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Activity size={13} /> PID: {status?.proxy.pid ?? "-"}
                </span>
                <span className="flex items-center gap-1.5">
                  <Cpu size={13} /> 启动于 {formatTime(status?.proxy.started_at ?? null)}
                </span>
                <span className="flex items-center gap-1.5">
                  <ListOrdered size={13} /> 配置 {status?.config_entry_count ?? 0} 条
                </span>
              </div>
              {status?.proxy.last_error && (
                <p className="mt-2 max-w-xl truncate text-xs text-rose-500">{status.proxy.last_error}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!proxySupported && (
              <Badge color="amber">当前平台不支持运行代理（官方未提供预编译产物）</Badge>
            )}
            {running ? (
              <button className="btn-danger px-6" onClick={handleStop} disabled={busy !== null}>
                {busy === "stop" ? <Spinner size={16} /> : <Square size={15} />} 停止代理
              </button>
            ) : (
              <button
                className="btn-primary px-6"
                onClick={handleStart}
                disabled={!canControl || busy !== null}
                title={canControl ? "启动代理" : "代理二进制未就绪或平台不支持"}
              >
                {busy === "start" ? <Spinner size={16} /> : <Play size={15} />} 启动代理
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 下载状态 */}
      <div className="glass-card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <DownloadCloud size={17} className="text-indigo-500" />
            <h3 className="text-sm font-medium">代理二进制</h3>
            {dl && <Badge color={dlm.color}>{dlm.label}</Badge>}
            {dl?.version && <Badge color="slate">{dl.version}</Badge>}
          </div>
          <button className="btn-secondary px-3 py-1.5 text-xs" onClick={handleRetryDownload}>
            <RefreshCw size={13} /> 重新检查 / 更新
          </button>
        </div>

        {dl && dl.state === "downloading" && (
          <div className="mb-3">
            <div className="mb-1 flex justify-between text-xs text-slate-400">
              <span className="truncate">{dl.asset}</span>
              <span>
                {formatBytes(dl.received)} / {formatBytes(dl.total)} · {formatPercent(dl.progress)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all"
                style={{ width: `${Math.max(3, dl.progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <Box size={13} /> 版本：{dl?.version ?? "-"}
          </span>
          <span className="flex items-center gap-1.5">
            <ArrowDownToLine size={13} /> 资产：{dl?.asset ?? "-"}
          </span>
          {dl?.message && <span className="flex-1 truncate">{dl.message}</span>}
        </div>
      </div>

      {/* 快捷入口 */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/config" className="glass-card group flex items-center justify-between p-5 transition hover:border-indigo-500/50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
              <ListOrdered size={19} />
            </div>
            <div>
              <div className="text-sm font-medium">配置管理</div>
              <div className="text-xs text-slate-400">可视化编辑代理服务器配置</div>
            </div>
          </div>
          <ExternalLink size={16} className="text-slate-300 transition group-hover:text-indigo-400" />
        </Link>
        <Link to="/logs" className="glass-card group flex items-center justify-between p-5 transition hover:border-cyan-500/50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-500">
              <Activity size={19} />
            </div>
            <div>
              <div className="text-sm font-medium">运行日志</div>
              <div className="text-xs text-slate-400">查看代理进程实时输出</div>
            </div>
          </div>
          <ExternalLink size={16} className="text-slate-300 transition group-hover:text-cyan-400" />
        </Link>
      </div>
    </div>
  );
}
