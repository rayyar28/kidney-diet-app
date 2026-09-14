import { NavLink } from "react-router-dom";

const items = [
  { to: "/", label: "首頁", icon: "🏠", end: true },
  { to: "/history", label: "紀錄", icon: "📖", end: false },
  { to: "/profile", label: "我的", icon: "👤", end: false },
];

export function BottomNav() {
  return (
    <nav className="bottom-nav">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
          <span className="icon">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
