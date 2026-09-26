import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CameraCaptureField } from "../components/CameraCaptureField";
import { createLocalMeal, deleteLocalMeal } from "../offline/mealStore";
import { syncAndWait } from "../offline/syncEngine";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import type { MealType } from "../api/types";

const MEAL_TYPES: Array<{ value: MealType; label: string; icon: string }> = [
  { value: "BREAKFAST", label: "早餐", icon: "🍳" },
  { value: "LUNCH", label: "午餐", icon: "🍱" },
  { value: "DINNER", label: "晚餐", icon: "🍲" },
  { value: "SNACK", label: "點心", icon: "🍎" },
];

/** 餐前紀錄：選餐別 → 拍照 → 送出。三步都在同一個畫面內，不需要滑動。 */
export function NewMealPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const trial = useAuthStore((s) => s.mode === "trial");
  const showToast = useToastStore((s) => s.show);
  const [mealType, setMealType] = useState<MealType>("BREAKFAST");
  const [file, setFile] = useState<File | null>(null);
  const [capturedAt, setCapturedAt] = useState<Date | null>(null);
  const [notes, setNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!file || !capturedAt) {
      setError("請先拍一張餐前照片");
      return;
    }
    if (!user) {
      setError("請先登入");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // 先存進手機本機 (不需要網路，這一步成功就代表資料不會丟)，再試著上傳
      const meal = await createLocalMeal({
        userId: user.id,
        mealType,
        notes: notes.trim() || null,
        file,
        capturedAt,
      });

      // 試用模式沒有伺服器，存進本機就已經是最終狀態，不必也不能去等上傳結果
      if (trial) {
        showToast("餐前紀錄完成！吃完記得回來拍 📸");
        navigate("/");
        return;
      }

      const outcome = await syncAndWait(meal.id);
      if (typeof outcome === "object") {
        // 伺服器明確拒絕這張照片 (格式不對等)。留在這一頁讓使用者重拍，
        // 不留下一筆永遠傳不上去的本機紀錄。
        await deleteLocalMeal(meal.id);
        setFile(null);
        setCapturedAt(null);
        setError(outcome.failed);
        return;
      }

      showToast(outcome === "synced" ? "餐前紀錄完成！吃完記得回來拍 📸" : "已存在手機裡，有網路就會自動上傳 📸");
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div>
          <h1 className="page-title">記錄餐前</h1>
          <p className="page-hint">吃之前先拍一張</p>
        </div>
      </div>

      <div className="page">
        <div className="section-title">1. 這是哪一餐？</div>
        <div className="meal-type-row">
          {MEAL_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`meal-type-btn ${mealType === t.value ? "selected" : ""}`}
              onClick={() => setMealType(t.value)}
            >
              <span className="type-icon">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        <div className="section-title">2. 拍下餐點</div>
        <CameraCaptureField
          label="餐前照片"
          onCapture={(f, d) => {
            setFile(f);
            setCapturedAt(d);
            setError(null);
          }}
        />

        {notesOpen ? (
          <textarea
            className="input"
            rows={2}
            placeholder="例如：外食、和家人一起吃…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setNotesOpen(true)}>
            ✏️ 加註記（可不填）
          </button>
        )}

        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="page-footer">
        <button className="btn btn-primary" onClick={submit} disabled={submitting || !file}>
          {submitting ? "儲存中…" : "✓ 送出"}
        </button>
        <button className="btn btn-ghost" onClick={() => navigate("/")}>
          取消
        </button>
      </div>
    </div>
  );
}
