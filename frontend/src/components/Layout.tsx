import { LayoutDashboard, ListTodo, ScrollText, Settings, LogOut, Sun, Moon, Monitor, ChevronLeft, ChevronRight } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../store/useAuth";
import { useTheme, type Theme } from "../store/useTheme";
import { useIsMobile, useSidebarCollapsed, setSidebarCollapsed } from "./ui";
import { BrandIcon } from "./BrandIcon";

const NAV = [
  { to: "/", label: "仪表盘", icon: LayoutDashboard, end: true },
  { to: "/config", label: "配置管理", icon: ListTodo, end: false },
  { to: "/logs", label: "运行日志", icon: ScrollText, end: false },
  { to: "/settings", label: "面板设置", icon: Settings, end: false },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { username, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const mobile = useIsMobile();
  const collapsed = useSidebarCollapsed();

  const themeIcons: Record<Theme, React.ReactNode> = {
    light: <Sun size={15} />,
    dark: <Moon size={15} />,
    system: <Monitor size={15} />,
  };
  const themeCycle: Theme[] = ["light", "dark", "system"];

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const sidebar = (
    <div
      className={`flex h-full flex-col border-r border-slate-200 bg-white/90 backdrop-blur transition-all dark:border-slate-800 dark:bg-slate-950/80 ${
        collapsed ? "w-[68px]" : "w-[216px]"
      }`}
    >
      <div className="flex items-center gap-3 px-5 py-5">
        <BrandIcon size={36} className="shrink-0" />
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">shoes-admin</div>
            <div className="truncate text-[11px] text-slate-400">Proxy setting</div>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={item.label}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                collapsed ? "justify-center" : ""
              } ${
                isActive
                  ? "bg-indigo-600/10 font-medium text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70"
              }`
            }
          >
            <item.icon size={18} className="shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-1 border-t border-slate-200 p-3 dark:border-slate-800">
        <button
          title={`切换主题（当前：${theme}）`}
          onClick={() => {
            const next = themeCycle[(themeCycle.indexOf(theme) + 1) % 3];
            setTheme(next);
          }}
          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70 ${
            collapsed ? "justify-center" : ""
          }`}
        >
          {themeIcons[theme]}
          {!collapsed && <span>{theme === "light" ? "浅色" : theme === "dark" ? "深色" : "跟随系统"}</span>}
        </button>
        <div className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-500 dark:text-slate-400 ${collapsed ? "justify-center" : ""}`}>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-indigo-500 text-[11px] font-bold text-white">
            {(username || "A").slice(0, 1).toUpperCase()}
          </div>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate">{username ?? "admin"}</span>
              <button
                title="退出登录"
                onClick={handleLogout}
                className="text-slate-400 transition hover:text-rose-500"
              >
                <LogOut size={16} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-base dark:text-slate-100">
      {mobile ? (
        <MobileNav />
      ) : (
        <div className="relative shrink-0">{sidebar}</div>
      )}

      <div className="relative flex min-w-0 flex-1 flex-col">
        {!mobile && (
          <button
            onClick={() => setSidebarCollapsed(!collapsed)}
            className="absolute left-0 top-1/2 z-20 -translate-x-1/2 rounded-full border border-slate-200 bg-white p-1 text-slate-400 shadow-md transition hover:text-indigo-500 dark:border-slate-700 dark:bg-slate-800"
            title={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function MobileNav() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  return (
    <div className="flex shrink-0 flex-col border-r border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
      <div className="px-4 py-4">
        <BrandIcon size={36} />
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-2">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={item.label}
            className={({ isActive }) =>
              `flex items-center justify-center rounded-lg p-2.5 transition ${
                isActive
                  ? "bg-indigo-600/10 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
                  : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/70"
              }`
            }
          >
            <item.icon size={19} />
          </NavLink>
        ))}
      </nav>
      <button
        onClick={() => {
          logout();
          navigate("/login");
        }}
        className="m-2 rounded-lg p-2.5 text-slate-400 transition hover:text-rose-500"
        title="退出登录"
      >
        <LogOut size={18} />
      </button>
    </div>
  );
}
