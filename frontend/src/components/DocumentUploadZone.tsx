import { useRef, useState } from "react";
import { Upload, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DocumentUploadZoneProps {
  label: string;
  accept?: string;
  disabled?: boolean;
  onUpload: (file: File) => Promise<void>;
}

export function DocumentUploadZone({
  label,
  accept = ".pdf,image/*",
  disabled,
  onUpload,
}: DocumentUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      await onUpload(file);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border-2 border-dashed p-6 text-center transition-colors",
        dragOver ? "border-accent bg-accent/5" : "border-border",
        disabled && "pointer-events-none opacity-50"
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      {uploading ? (
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />
      ) : (
        <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
      )}
      <p className="mt-3 text-sm font-medium">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">PDF or image, max 25 MB</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-4 cursor-pointer"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
      >
        <FileText className="mr-2 h-4 w-4" />
        Choose file
      </Button>
    </div>
  );
}
