import { useEffect, useRef, useState, type ChangeEvent } from "react";

interface Props {
  label: string;
  onCapture: (file: File, capturedAt: Date) => void;
}

/**
 * 拍照流程：
 *   1. 優先用 getUserMedia 開一個「即時相機預覽」全螢幕畫面，點擊快門立刻擷取當前畫面
 *      —— 這是為了避免手機瀏覽器把 `capture="environment"` 只當成提示，跳出「相機/相簿/
 *      檔案」選擇清單而不是直接開相機，導致拍餐前/餐後照片時不夠即時。
 *   2. 如果裝置不支援 getUserMedia、使用者拒絕權限、或找不到相機（例如桌機瀏覽器、
 *      非 HTTPS/localhost 的連線），才退回原本的 `<input type="file" capture="environment">`
 *      做法，讓功能在任何環境下都至少能用。
 * capturedAt 一律用「使用者按下快門/選好照片的當下時間」當作拍攝時間的近似值
 * (瀏覽器沙盒無法取得作業系統相機的精確拍攝時間戳記)。
 */
export function CameraCaptureField({ label, onCapture }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // ImageCapture 目前不在標準 TS DOM 型別定義裡（實驗性 API），用 any 存取
  const imageCaptureRef = useRef<{ takePhoto: () => Promise<Blob> } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (liveOpen && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [liveOpen]);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    imageCaptureRef.current = null;
  }

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      inputRef.current?.click();
      return;
    }
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          // 沒指定的話瀏覽器會挑視訊通話等級的低解析度（常見 640x480），拍食物照片會糊。
          // ideal 只是偏好，裝置支援不到也不會出錯，會自動退到裝置能給的最高值。
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
        },
        audio: false,
      });
      streamRef.current = stream;
      // ImageCapture 可以直接向相機要一張真正的高解析度靜態照片，畫質遠高於
      // 從 <video> 畫面截圖；目前只有 Chromium 系列瀏覽器支援，iOS Safari 沒有，
      // 沒有的話下面 capturePhoto() 會自動退回截圖方式。
      const ImageCaptureCtor = (window as unknown as { ImageCapture?: new (track: MediaStreamTrack) => { takePhoto: () => Promise<Blob> } }).ImageCapture;
      if (ImageCaptureCtor) {
        try {
          imageCaptureRef.current = new ImageCaptureCtor(stream.getVideoTracks()[0]);
        } catch {
          imageCaptureRef.current = null;
        }
      }
      setLiveOpen(true);
    } catch {
      // 拒絕權限 / 沒有相機 / 不支援：退回系統相機或檔案選取
      inputRef.current?.click();
    } finally {
      setStarting(false);
    }
  }

  function closeCamera() {
    stopStream();
    setLiveOpen(false);
  }

  function finishCapture(file: File, capturedAt: Date) {
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
    onCapture(file, capturedAt);
    closeCamera();
  }

  async function capturePhoto() {
    const capturedAt = new Date();
    if (imageCaptureRef.current) {
      try {
        const blob = await imageCaptureRef.current.takePhoto();
        finishCapture(new File([blob], `capture-${capturedAt.getTime()}.jpg`, { type: blob.type || "image/jpeg" }), capturedAt);
        return;
      } catch {
        // takePhoto 失敗（部分裝置的相機不支援拍照模式）：退回下面的畫面截圖
      }
    }
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        finishCapture(new File([blob], `capture-${capturedAt.getTime()}.jpg`, { type: "image/jpeg" }), capturedAt);
      },
      "image/jpeg",
      0.92
    );
  }

  // 相簿選擇的照片，實際拍攝時間可能早於選取當下（例如挑一張舊照片），
  // 這裡的 capturedAt 只能近似成「選取的當下時間」，跟拍照當下擷取的精確度不同。
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
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
      <div className="camera-preview">
        {previewUrl ? (
          <img src={previewUrl} alt={label} />
        ) : (
          <div className="center-col">
            <span style={{ fontSize: 32 }}>📷</span>
            <span>{starting ? "正在啟動相機..." : label}</span>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" className="btn btn-secondary" onClick={openCamera} disabled={starting}>
          {previewUrl ? "重新拍攝" : "拍照"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => galleryInputRef.current?.click()} disabled={starting}>
          從相簿選擇
        </button>
      </div>

      {liveOpen && (
        <div className="camera-overlay">
          <video ref={videoRef} autoPlay playsInline muted className="camera-overlay-video" />
          <button type="button" className="camera-overlay-close" onClick={closeCamera} aria-label="取消拍照">
            ✕
          </button>
          <div className="camera-overlay-shutter-wrap">
            <button type="button" className="camera-overlay-shutter" onClick={capturePhoto} aria-label="拍照" />
          </div>
        </div>
      )}
    </div>
  );
}
