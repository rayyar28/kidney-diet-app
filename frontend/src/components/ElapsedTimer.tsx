import { useEffect, useState } from "react";

/**
 * 顯示「餐前照拍了多久」。刻意只顯示到分鐘：跳動的秒數對年長使用者是干擾，
 * 而且用餐時長本來就不需要秒級精度（真正的精確時間是照片的時間戳記）。
 */
export function ElapsedTimer({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000));
  if (minutes < 1) return <span className="elapsed">剛剛拍的</span>;
  if (minutes < 60) return <span className="elapsed">已經過 {minutes} 分鐘</span>;
  const h = Math.floor(minutes / 60);
  return (
    <span className="elapsed">
      已經過 {h} 小時 {minutes % 60} 分
    </span>
  );
}
