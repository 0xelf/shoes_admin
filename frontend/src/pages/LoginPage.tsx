import { KeyRound, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Spinner, toast } from "../components/ui";
import { BrandIcon } from "../components/BrandIcon";
import { useAuth } from "../store/useAuth";

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuth();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const resp = await api.login(username.trim(), password);
      setAuth(resp.data!.token, resp.data!.username);
      toast("登录成功，欢迎回来");
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tech-grid-light dark:tech-grid relative flex h-full items-center justify-center bg-slate-50 p-4 dark:bg-base">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-72 w-[560px] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl dark:bg-indigo-600/20" />
        <div className="absolute -bottom-24 right-0 h-64 w-96 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-500/10" />
      </div>

      <div className="relative w-full max-w-sm animate-fade-in">
        <div className="mb-8 flex flex-col items-center gap-3">
          <BrandIcon size={56} className="shadow-glow-indigo rounded-xl" />
          <div>
            <h1 className="text-center text-xl font-semibold text-slate-900 dark:text-white">shoes-admin</h1>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="glass-card space-y-4 p-6 shadow-xl">
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <User size={13} className="shrink-0 text-slate-400" /> 用户名
            </label>
            <input
              className="input-base"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              <KeyRound size={13} className="shrink-0 text-slate-400" /> 密码
            </label>
            <input
              className="input-base"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-300">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading || !username || !password} className="btn-primary w-full py-2.5">
            {loading ? <Spinner size={16} /> : <ShieldCheck size={16} />}
            登录
          </button>

          <p className="pt-1 text-center text-[11px] text-slate-400">
            默认账号 admin / admin，首次登录后请及时修改密码
          </p>
        </form>
      </div>
    </div>
  );
}
