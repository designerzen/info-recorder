import { h, Fragment, defineElement, patch } from "../ui/dom";
import { createLifecycle } from "../ui/lifecycle";
import { Download } from "../ui/icons";
import { estimateSecondsRemaining, formatBytes, formatDuration } from "../recorder/modelInventory";
type ModelLoadDialogProps = {
    isOpen: boolean;
    message: string;
    progress: number;
    transferredBytes?: number;
    totalBytes?: number;
    downloadSpeedBps?: number;
};
export const ModelLoadDialog = defineElement<ModelLoadDialogProps>("wt-model-load-dialog", (initialProps, host) => {
    let { isOpen, message, progress, transferredBytes = 0, totalBytes = 0, downloadSpeedBps = 0 } = initialProps;
    const scope = createLifecycle();
    const dialogRef: {
        current: HTMLDialogElement | null;
    } = { current: null };
    let progressValue = Math.min(100, Math.max(0, Math.round(progress)));
    let remainingBytes = Math.max(0, totalBytes - transferredBytes);
    let etaSeconds = estimateSecondsRemaining(remainingBytes, downloadSpeedBps);
    function render() {
        return (<dialog ref={dialogRef} className="model-dialog" aria-labelledby="model-dialog-title" aria-describedby="model-dialog-message" onCancel={(event) => event.preventDefault()}>
      <div className="model-dialog-icon">
        <Download size={28} aria-hidden="true"/>
      </div>
      <div className="model-dialog-copy">
        <h2 id="model-dialog-title">Downloading transcription model</h2>
        <p id="model-dialog-message">
          Keep this tab open. The app is fetching transcription model files and storing them in your
          offline model storage.
        </p>
      </div>
      <progress value={progressValue} max={100} aria-label="Model download progress"/>
      <div className="model-dialog-status" aria-live="polite">
        <span>{message || "Preparing model download..."}</span>
        <strong>{progressValue}%</strong>
      </div>
      <div className="model-dialog-status model-dialog-metrics" aria-live="polite">
        <span>
          {totalBytes > 0 ? `${formatBytes(transferredBytes)} of ${formatBytes(totalBytes)}` : "Measuring model size..."}
        </span>
        <span>
          {downloadSpeedBps > 0 ? `${formatBytes(downloadSpeedBps)}/s` : "Estimating speed..."}
          {etaSeconds ? ` · ${formatDuration(etaSeconds)} left` : ""}
        </span>
      </div>
    </dialog>);
    }
    function refresh() {
        progressValue = Math.min(100, Math.max(0, Math.round(progress)));
        remainingBytes = Math.max(0, totalBytes - transferredBytes);
        etaSeconds = estimateSecondsRemaining(remainingBytes, downloadSpeedBps);
        patch(host, render());
        scope.watch("download-dialog", [isOpen], () => {
            const dialog = dialogRef.current;
            if (!dialog)
                return;
            if (isOpen && !dialog.open) {
                dialog.showModal();
            }
            else if (!isOpen && dialog.open) {
                dialog.close();
            }
        });
        scope.flush();
    }
    scope.setRefresh(refresh);
    refresh();
    return { update(props) {
            ({
                isOpen,
                message,
                progress,
                transferredBytes = 0,
                totalBytes = 0,
                downloadSpeedBps = 0
            } = props);
            refresh();
        }, dispose: scope.dispose };
});
