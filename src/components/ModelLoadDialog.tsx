import { Download } from "lucide-react";
import { useEffect, useRef } from "react";

type ModelLoadDialogProps = {
  isOpen: boolean;
  message: string;
  progress: number;
};

export function ModelLoadDialog({ isOpen, message, progress }: ModelLoadDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const progressValue = Math.min(100, Math.max(0, Math.round(progress)));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      className="model-dialog"
      aria-labelledby="model-dialog-title"
      aria-describedby="model-dialog-message"
      onCancel={(event) => event.preventDefault()}
    >
      <div className="model-dialog-icon">
        <Download size={28} aria-hidden="true" />
      </div>
      <div className="model-dialog-copy">
        <h2 id="model-dialog-title">Downloading transcription model</h2>
        <p id="model-dialog-message">
          Keep this tab open. The app is fetching Whisper model files and storing them in your
          browser cache.
        </p>
      </div>
      <progress
        value={progressValue}
        max={100}
        aria-label="Model download progress"
      />
      <div className="model-dialog-status" aria-live="polite">
        <span>{message || "Preparing model download..."}</span>
        <strong>{progressValue}%</strong>
      </div>
    </dialog>
  );
}
