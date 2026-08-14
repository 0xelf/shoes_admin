import React, { useCallback, useEffect, useRef, useState } from "react";

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function Badge({
  color = "slate",
  children,
}: {
  color?: "slate" | "indigo" | "green" | "red" | "amber" | "cyan";
  children: React.ReactNode;
}) {
  const map: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    indigo: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    red: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
    cyan: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${map[color]}`}
    >
      {children}
    </span>
  );
}

interface ToastItem {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}

const toastListeners: ((t: ToastItem) => void)[] = [];

export function toast(message: string, type: ToastItem["type"] = "success") {
  toastListeners.forEach((fn) => fn({ id: Date.now() + Math.random(), type, message }));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener = (t: ToastItem) => {
      setItems((prev) => [...prev.slice(-3), t]);
      setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== t.id)), 3200);
    };
    toastListeners.push(listener);
    return () => {
      const idx = toastListeners.indexOf(listener);
      if (idx >= 0) toastListeners.splice(idx, 1);
    };
  }, []);

  const styleMap: Record<string, string> = {
    success: "border-emerald-500/40 text-emerald-600 dark:text-emerald-300",
    error: "border-rose-500/40 text-rose-600 dark:text-rose-300",
    info: "border-indigo-500/40 text-indigo-600 dark:text-indigo-300",
  };

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-sm rounded-xl border bg-white/95 px-4 py-2.5 text-sm shadow-lg backdrop-blur animate-fade-in dark:bg-slate-900/95 ${styleMap[t.type]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

/** 防抖 hook */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useIsMobile() {
  const [mobile, setMobile] = useState(window.innerWidth < 900);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return mobile;
}

/** 侧边栏折叠控制（全局单例，避免 props 层层传递） */
const sidebarListeners: ((v: boolean) => void)[] = [];
export function setSidebarCollapsed(v: boolean) {
  sidebarListeners.forEach((fn) => fn(v));
}
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const fn = (v: boolean) => setCollapsed(v);
    sidebarListeners.push(fn);
    return () => {
      const idx = sidebarListeners.indexOf(fn);
      if (idx >= 0) sidebarListeners.splice(idx, 1);
    };
  }, []);
  return collapsed;
}
