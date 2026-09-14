import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { CameraCaptureField } from "../components/CameraCaptureField";
import { useToastStore } from "../store/toast";
import type { MealType } from "../api/types";

const MEAL_TYPES: Array<{ value: MealType; label: string; icon: string }> = [
  { value: "BREAKFAST", label: "早餐", icon: "🍳" },
  { value: "LUNCH", label: "午餐", icon: "🍱" },
  { value: "DINNER", label: "晚餐", icon: "🍲" },
  { value: "SNACK", label: "點心", icon: "🍎" },
];

export function NewMealPage() {
  const navigate = useNavigate();
  const showToast = useToastStore((s) => s.show);
  const [mealType, setMealType] = useState<MealType>("BREAKFAST");
  const [file, setFile] = useState<File | null>(null);
  const [capturedAt, setCapturedAt] = useState<Date | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file || !capturedAt) {
      setError("請先拍攝餐前照片");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("photo", file);
      form.append("mealType", mealType);
      form.append("capturedAt", capturedAt.toISOString());
      form.append("tzOffsetMinutes", String(new Date().getTimezoneOffset()));
      if (notes.trim()) form.append("notes", notes.trim());

      await api.post("/meals/pre-meal", form);
      showToast("餐前紀錄完成！記得吃完後回來拍餐後照 📸");
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "上傳失敗，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="page">
        <h2 style={{ marginBottom: 4 }}>記錄餐前</h2>
        <p style={{ color: "var(--color-text-muted)", marginTop: 0, fontSize: 14 }}>
          先選擇餐別，拍下這一餐開動前的樣子。
        </p>

        <div className="section-title">這是哪一餐？</div>
        <div className="meal-type-grid">
          {MEAL_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`meal-type-btn ${mealType === t.value ? "selected" : ""}`}
              onClick={() => setMealType(t.value)}
            >
              <span style={{ fontSize: 22 }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        <div className="section-title">餐前照片</div>
        <CameraCaptureField label="餐前照片" onCapture={(f, d) => { setFile(f); setCapturedAt(d); }} />

        <div className="section-title">備註（選填）</div>
        <textarea
          className="input"
          rows={3}
          placeholder="例如：今天特別餓、外食、和家人一起吃…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={submit} disabled={submitting}>
          {submitting ? "上傳中..." : "送出餐前紀錄"}
        </button>
        <button className="btn btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => navigate(-1)}>
          取消
        </button>
      </div>
    </div>
  );
}
