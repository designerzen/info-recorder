import { useEffect, useRef, useState } from "react";

type ActivityProgressProps = {
  title: string;
  message: string;
  active: boolean;
  blocking: boolean;
  progress?: number;
  inputLevel?: number;
  recordingStartedAt?: number;
};

export function ActivityProgress({ title, message, active, blocking, progress, inputLevel, recordingStartedAt }: ActivityProgressProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const isRecording = recordingStartedAt !== undefined;
  const value = progress === undefined ? undefined : Math.max(0, Math.min(100, Math.round(progress)));

  useEffect(() => {
    if (recordingStartedAt === undefined) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [recordingStartedAt]);

  const elapsedSeconds = Math.max(0, Math.floor((now - (recordingStartedAt ?? now)) / 1000));
  const elapsed = [Math.floor(elapsedSeconds / 3600), Math.floor(elapsedSeconds / 60) % 60, elapsedSeconds % 60]
    .slice(elapsedSeconds >= 3600 ? 0 : 1).map((part) => String(part).padStart(2, "0")).join(":");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (blocking) dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [blocking]);

  const content = (
    <div className="activity-progress" data-active={active} data-recording={isRecording}>
      <div className="activity-progress-heading">
        <span className="activity-progress-symbol" aria-hidden="true" />
        <strong>{title}</strong>
        {isRecording ? <span className="activity-progress-value" role="timer" aria-live="off" aria-label="Recording duration">{elapsed}</span> : null}
        {value !== undefined ? <span className="activity-progress-value">{value}%</span> : null}
      </div>
      <p>{message}</p>
      {active && !isRecording ? <progress max={100} value={value} aria-label={`${title} progress`} /> : null}
      {inputLevel !== undefined ? (
        <label className="activity-progress-input">
          <span>Microphone activity</span>
          <meter min={0} max={1} value={Math.max(0, Math.min(1, inputLevel))} aria-label="Microphone activity" />
        </label>
      ) : null}
      {blocking ? <small>Please wait. Controls will be available when setup finishes.</small> : null}
    </div>
  );

  return blocking ? (
    <dialog ref={dialogRef} className="activity-progress-dialog" aria-label={title}
      aria-describedby="blocking-activity-status" onCancel={(event) => event.preventDefault()}>
      <div id="blocking-activity-status" role="status" aria-live="polite">{content}</div>
    </dialog>
  ) : (
    <section className="activity-progress-panel" aria-label="Activity and progress" role="status" aria-live="polite">
      {content}
    </section>
  );
}
