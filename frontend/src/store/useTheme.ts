import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

function applyTheme(theme: Theme) {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function initTheme() {
  // 从 store 取主题值：persist 未完成 hydration 时返回默认 "dark"
  // 不能直接读 localStorage 原始值——persist 存储的是 JSON（{"state":{"theme":...}}），会造成误判
  applyTheme(useTheme.getState().theme);
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: "dark",
      setTheme: (t) => {
        applyTheme(t);
        set({ theme: t });
      },
    }),
    {
      name: "shoes-admin-theme",
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
    }
  )
);

// 跟随系统主题变化
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  const t = useTheme.getState().theme;
  if (t === "system") {
    document.documentElement.classList.toggle("dark", e.matches);
  }
});
