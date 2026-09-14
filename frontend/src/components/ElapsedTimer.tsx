import { useEffect, useState } from "react";

function format(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m} 分 ${s.toString().padStart(2, "0")} 秒`;
  const h = Math.floor(m / 60);
  return `${h} 時 ${(m % 60).toString().padStart(2, "0")} 分`;
}

export function ElapsedTimer({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return <span className="elapsed">已經過 {format(seconds)}</span>;
}
