import { useToastStore } from "../store/toast";

export function Toast() {
  const message = useToastStore((s) => s.message);
  if (!message) return null;
  return <div className="toast">{message}</div>;
}
