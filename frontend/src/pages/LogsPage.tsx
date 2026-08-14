import { ArrowDown, ArrowDownToLine, Download, Eraser, Pause, Play, RefreshCw, ScrollText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type ProxyState } from "../api/client";
import { Badge, Spinner, toast } from "../components/ui";
import { usePolling } from "../lib/usePolling";

const stateBadge: Record<ProxyState, { label: string; color: "green" | "red" | "amber" | "slate" }> = {
  running: { label: "运行中", color: "green" },
  starting: { label: "启动中", color: "amber" },
  stopped: { label: "已停止", color: "slate" },
  exited: { label: "已退出", color: "red" },
};

/** 日志页操作按钮统一尺寸基线 */
const BTN =
  "inline-flex h-[30px] items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition";

export default function LogsPage() {
  const { data, error, paused, setPaused } = usePolling(() => api.logs(1000), 2000);
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const logs = data?.data?.logs ?? [];
  const state = data?.data?.state ?? "stopped";
  const meta = stateBadge[state];

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filtered = filter.trim()
    ? logs.filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  const handleClear = async () => {
    try {
      await api.clearLogs();
      toast("日志已清空");
    } catch (e) {
      toast(e instanceof Error ? e.message : "清空失败", "error");
    }
  };

  const handleExport = () => {
    const blob = new Blob([logs.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shoes-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(url);
    toast("日志已导出");
  };

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col space-y-4 p-6 lg:p-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-500">
            <ScrollText size={18} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">运行日志</h1>
            <p className="text-xs text-slate-400">代理进程实时输出（最多保留 2000 行）</p>
          </div>
          <Badge color={meta.color}>{meta.label}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input-base w-44 px-3 py-1.5 text-xs"
            placeholder="过滤日志..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {/* 四个操作按钮统一尺寸：h-30px + text-xs + border */}
          <button
            className={`${BTN} border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700`}
            onClick={() => setPaused(!paused)}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? "继续" : "暂停"}
          </button>
          <button
            className={`${BTN} ${
              autoScroll
                ? "border-indigo-600 bg-indigo-600 text-white shadow-glow-indigo"
                : "border-slate-300 bg-white text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? "点击关闭自动滚动" : "点击开启自动滚动"}
          >
            {autoScroll ? <ArrowDownToLine size={13} /> : <ArrowDown size={13} />}
            {autoScroll ? "自动滚动：开" : "自动滚动：关"}
          </button>
          <button
            className={`${BTN} border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700`}
            onClick={handleExport}
          >
            <Download size={13} /> 导出
          </button>
          <button
            className={`${BTN} border-slate-300 bg-white text-rose-500 hover:bg-rose-50 dark:border-slate-700 dark:bg-slate-800 dark:text-rose-400 dark:hover:bg-slate-700`}
            onClick={handleClear}
          >
            <Eraser size={13} /> 清空
          </button>
        </div>
      </header>

      <div className="glass-card relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {error && (
          <div className="absolute inset-x-0 top-0 z-10 border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-500">
            {error}
          </div>
        )}
        <div
          ref={boxRef}
          className="min-h-0 flex-1 overflow-y-auto bg-slate-950/40 p-4 font-mono text-[12px] leading-relaxed dark:bg-black/30"
        >
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
              {logs.length === 0 ? (
                <>
                  <ScrollText size={28} className="opacity-40" />
                  <span>暂无日志，启动代理后将在此显示输出</span>
                </>
              ) : (
                <span>没有匹配「{filter}」的日志</span>
              )}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all text-slate-300">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-800">
          <span className="flex items-center gap-1.5">
            {paused ? <Pause size={11} /> : <RefreshCw size={11} className="animate-spin" />}
            {paused ? "已暂停刷新" : "每 2 秒自动刷新"}
          </span>
          <span>共 {logs.length} 行{filter.trim() ? ` / 匹配 ${filtered.length}` : ""}</span>
        </div>
      </div>
    </div>
  );
}
