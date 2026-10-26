import { h, Fragment, defineElement, patch } from "../ui/dom";
import { createLifecycle } from "../ui/lifecycle";
import { createStateMachine } from "../state/machine";
type ActivityProgressProps = {
    title: string;
    message: string;
    active: boolean;
    blocking: boolean;
    progress?: number;
    inputLevel?: number;
    recordingStartedAt?: number;
};
export const ActivityProgress = defineElement<ActivityProgressProps>("wt-activity-progress", (initialProps, host) => {
    let { title, message, active, blocking, progress, inputLevel, recordingStartedAt } = initialProps;
    const scope = createLifecycle();
    const machine = createStateMachine({ now: (() => Date.now())() }, () => "ready");
    let state = machine.context;
    scope.own(machine.subscribe(() => { state = machine.context; scope.invalidate(); }));
    scope.own(machine.dispose);
    const setNow = (value: typeof state.now | ((previous: typeof state.now) => typeof state.now)) => machine.send({ type: "now", value });
    const dialogRef: {
        current: HTMLDialogElement | null;
    } = { current: null };
    let isRecording = recordingStartedAt !== undefined;
    let value = progress === undefined ? undefined : Math.max(0, Math.min(100, Math.round(progress)));
    let elapsedSeconds = Math.max(0, Math.floor((state.now - (recordingStartedAt ?? state.now)) / 1000));
    let elapsed = [Math.floor(elapsedSeconds / 3600), Math.floor(elapsedSeconds / 60) % 60, elapsedSeconds % 60]
        .slice(elapsedSeconds >= 3600 ? 0 : 1).map((part) => String(part).padStart(2, "0")).join(":");
    let content = (<div className="activity-progress" data-active={active} data-recording={isRecording}>
      <div className="activity-progress-heading">
        <span className="activity-progress-symbol" aria-hidden="true"/>
        <strong>{title}</strong>
        {isRecording ? <span className="activity-progress-value" role="timer" aria-live="off" aria-label="Recording duration">{elapsed}</span> : null}
        {value !== undefined ? <span className="activity-progress-value">{value}%</span> : null}
      </div>
      <p>{message}</p>
      {active && !isRecording ? <progress max={100} value={value} aria-label={`${title} progress`}/> : null}
      {inputLevel !== undefined ? (<label className="activity-progress-input">
          <span>Microphone activity</span>
          <meter min={0} max={1} value={Math.max(0, Math.min(1, inputLevel))} aria-label="Microphone activity"/>
        </label>) : null}
      {blocking ? <small>Please wait. Controls will be available when setup finishes.</small> : null}
    </div>);
    function render() {
        return blocking ? (<dialog ref={dialogRef} className="activity-progress-dialog" aria-label={title} aria-describedby="blocking-activity-status" onCancel={(event) => event.preventDefault()}>
      <div id="blocking-activity-status" role="status" aria-live="polite">{content}</div>
    </dialog>) : (<section className="activity-progress-panel" aria-label="Activity and progress" role="status" aria-live="polite">
      {content}
    </section>);
    }
    function refresh() {
        isRecording = recordingStartedAt !== undefined;
        value = progress === undefined ? undefined : Math.max(0, Math.min(100, Math.round(progress)));
        elapsedSeconds = Math.max(0, Math.floor((state.now - (recordingStartedAt ?? state.now)) / 1000));
        elapsed = [Math.floor(elapsedSeconds / 3600), Math.floor(elapsedSeconds / 60) % 60, elapsedSeconds % 60]
            .slice(elapsedSeconds >= 3600 ? 0 : 1).map((part) => String(part).padStart(2, "0")).join(":");
        content = (<div className="activity-progress" data-active={active} data-recording={isRecording}>
      <div className="activity-progress-heading">
        <span className="activity-progress-symbol" aria-hidden="true"/>
        <strong>{title}</strong>
        {isRecording ? <span className="activity-progress-value" role="timer" aria-live="off" aria-label="Recording duration">{elapsed}</span> : null}
        {value !== undefined ? <span className="activity-progress-value">{value}%</span> : null}
      </div>
      <p>{message}</p>
      {active && !isRecording ? <progress max={100} value={value} aria-label={`${title} progress`}/> : null}
      {inputLevel !== undefined ? (<label className="activity-progress-input">
          <span>Microphone activity</span>
          <meter min={0} max={1} value={Math.max(0, Math.min(1, inputLevel))} aria-label="Microphone activity"/>
        </label>) : null}
      {blocking ? <small>Please wait. Controls will be available when setup finishes.</small> : null}
    </div>);
        patch(host, render());
        scope.watch("recording-clock", [recordingStartedAt], () => {
            if (recordingStartedAt === undefined)
                return;
            setNow(Date.now());
            const interval = window.setInterval(() => setNow(Date.now()), 1000);
            return () => window.clearInterval(interval);
        });
        scope.watch("blocking-dialog", [blocking], () => {
            const dialog = dialogRef.current;
            if (blocking)
                dialog?.showModal();
            return () => { if (dialog?.open)
                dialog.close(); };
        });
        scope.flush();
    }
    scope.setRefresh(refresh);
    refresh();
    return { update(props) { ({ title, message, active, blocking, progress, inputLevel, recordingStartedAt } = props); refresh(); }, dispose: scope.dispose };
});
