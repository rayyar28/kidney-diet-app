import { useEffect, useRef, useState, type ChangeEvent } from "react";

interface Props {
  /** 用在提示文字上，例如「餐前照片」 */
  label: string;
  onCapture: (file: File, capturedAt: Date) => void;
}

/**
 * 拍照 / 選相簿。介面刻意只有兩個大圖示磚（相機、圖冊），
 * 年長使用者不必讀文字就知道要按哪裡；拍好之後換成固定高度的預覽，
 * 不會把整個畫面吃掉（避免需要滑動）。
 *
 * 拍照流程：
 *   1. 優先用 getUserMedia 開全螢幕即時相機預覽，按快門立刻擷取畫面
 *      —— 手機瀏覽器常把 `capture="environment"` 只當成提示，會先跳出
 *      「相機/相簿/檔案」選單，拍餐前/餐後照時不夠即時。
 *   2. 不支援 getUserMedia、使用者拒絕權限、或找不到相機（桌機、非 HTTPS）
 *      才退回 `<input type="file" capture="environment">`，功能在任何環境都能用。
 * capturedAt 一律用「按下快門 / 選好照片的當下時間」當作拍攝時間的近似值
 * (瀏覽器沙盒無法取得作業系統相機的精確拍攝時間戳記)。
 */
export function CameraCaptureField({ label, onCapture }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // ImageCapture 目前不在標準 TS DOM 型別定義裡（實驗性 API）
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
      const ImageCaptureCtor = (
        window as unknown as {
          ImageCapture?: new (track: MediaStreamTrack) => { takePhoto: () => Promise<Blob> };
        }
      ).ImageCapture;
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
        finishCapture(
          new File([blob], `capture-${capturedAt.getTime()}.jpg`, { type: blob.type || "image/jpeg" }),
          capturedAt
        );
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

  // 相簿選的照片，實際拍攝時間可能早於選取當下（例如挑一張舊照片），
  // 這裡的 capturedAt 只能近似成「選取的當下時間」。
  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    finishCapture(file, new Date());
    e.target.value = ""; // 讓同一張照片可以再選一次
  }

  function retake() {
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  }

  return (
    <>
      {previewUrl ? (
        <div className="shot-preview">
          <img src={previewUrl} alt={label} />
          <span className="shot-done">✓ 已拍好</span>
          <button type="button" className="shot-retake" onClick={retake}>
            重拍
          </button>
        </div>
      ) : (
        <div className="capture-tiles">
          <button type="button" className="capture-tile" onClick={openCamera} disabled={starting}>
            <span className="tile-icon">📷</span>
            <span className="tile-label">{starting ? "開啟中" : "拍照"}</span>
          </button>
          <button
            type="button"
            className="capture-tile"
            onClick={() => galleryInputRef.current?.click()}
            disabled={starting}
          >
            <span className="tile-icon">🖼️</span>
            <span className="tile-label">相簿</span>
          </button>
        </div>
      )}

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
    </>
  );
}
