import { useEffect, useState } from "react";
import { fetchPhotoBlobUrl } from "../api/client";

export function AuthedImage({ photoId, alt, className }: { photoId: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchPhotoBlobUrl(photoId).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setSrc(url);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);

  if (!src) {
    return <div className={className} style={{ background: "var(--color-border)" }} />;
  }
  return <img src={src} alt={alt} className={className} />;
}
