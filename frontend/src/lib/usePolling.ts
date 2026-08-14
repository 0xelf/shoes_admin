import { useEffect, useRef, useState } from "react";

/** 轮询 hook：每 interval ms 调用一次 fn，组件卸载时停止 */
export function usePolling<T>(fn: () => Promise<T>, interval = 2000, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const result = await fnRef.current();
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const schedule = () => {
      if (!paused && !cancelled) {
        timer = setTimeout(async () => {
          await tick();
          schedule();
        }, interval);
      }
    };

    void tick();
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, interval, ...deps]);

  return { data, error, loading, paused, setPaused };
}
