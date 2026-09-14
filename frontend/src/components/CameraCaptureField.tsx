import { useRef, useState, type ChangeEvent } from "react";

interface Props {
  label: string;
  onCapture: (file: File, capturedAt: Date) => void;
}

/**
 * `capture="environment"` 讓手機瀏覽器直接開後鏡頭拍照；桌機瀏覽器則會退回成
 * 一般的檔案選取。capturedAt 用「使用者選好照片的當下時間」當作拍攝時間的近似值
 * (瀏覽器沙盒無法取得作業系統相機的精確拍攝時間戳記)。
 */
export function CameraCaptureField({ label, onCapture }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const capturedAt = new Date();
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    onCapture(file, capturedAt);
  }

  return (
    <div>
      <div className="camera-preview" onClick={() => inputRef.current?.click()} role="button">
        {previewUrl ? (
          <img src={previewUrl} alt={label} />
        ) : (
          <div className="center-col">
            <span style={{ fontSize: 32 }}>📷</span>
            <span>{label}</span>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handleChange}
      />
      <button type="button" className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => inputRef.current?.click()}>
        {previewUrl ? "重新拍攝" : `拍攝${label}`}
      </button>
    </div>
  );
}
