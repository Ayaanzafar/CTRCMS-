import { useEffect, useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { sunrackReceiptApi } from "@/lib/api";

interface AuthPhotoProps {
  photoId: string;
  token: string;
  alt: string;
  className?: string;
  url?: string;
}

export function AuthPhoto({ photoId, token, alt, className, url }: AuthPhotoProps) {
  const photoUrl = url ?? sunrackReceiptApi.photoUrl(photoId);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(photoUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to load");
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(objectUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId, token, photoUrl]);

  if (error) {
    return (
      <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <ImageIcon className="h-6 w-6" />
      </div>
    );
  }

  if (!src) {
    return (
      <div className={cn("flex items-center justify-center bg-muted", className)}>
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
      </div>
    );
  }

  return <img src={src} alt={alt} className={cn("object-cover", className)} />;
}

interface MultiPhotoUploadProps {
  label: string;
  disabled?: boolean;
  onUpload: (files: File[]) => Promise<void>;
}

export function MultiPhotoUpload({ label, disabled, onUpload }: MultiPhotoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    setUploading(true);
    try {
      await onUpload(files);
    } finally {
      setUploading(false);
    }
  }

  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all duration-200",
        dragOver ? "border-accent bg-accent/5 scale-[1.01]" : "border-border hover:border-accent/50 hover:bg-muted/30",
        (disabled || uploading) && "pointer-events-none opacity-50"
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        disabled={disabled || uploading}
        onChange={(e) => handleFiles(e.target.files)}
      />
      {uploading ? (
        <Loader2 className="h-10 w-10 animate-spin text-accent" />
      ) : (
        <div className="rounded-full bg-accent/10 p-3">
          <ImageIcon className="h-8 w-8 text-accent" />
        </div>
      )}
      <p className="mt-4 text-sm font-medium">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Drag & drop or click — JPEG, PNG, WebP (multiple allowed)
      </p>
    </label>
  );
}
