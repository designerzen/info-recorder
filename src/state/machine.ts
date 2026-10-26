/** Synchronous, typed events keep state changes independent of the DOM. */
export type StateEvent<C> = {
    [K in keyof C]: {
        type: K;
        value: C[K] | ((previous: C[K]) => C[K]);
    };
}[keyof C];
export function createTransitionMachine<S extends string, E extends string>(initial: S, transitions: Record<S, Partial<Record<E, S>>>) {
    let value = initial;
    let disposed = false;
    const listeners = new Set<() => void>();
    return {
        get value() { return value; },
        can(event: E) { return !disposed && transitions[value][event] !== undefined; },
        send(event: E) {
            if (disposed)
                return false;
            const next = transitions[value][event];
            if (next === undefined)
                return false;
            if (next !== value) {
                value = next;
                for (const listener of listeners)
                    listener();
            }
            return true;
        },
        subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
        dispose() { disposed = true; listeners.clear(); }
    };
}
type RecorderState = "idle" | "preparing" | "recording" | "transcribing" | "stopping" | "error";
type RecorderEvent = "PREPARE" | "READY" | "RECORD" | "TRANSCRIBE" | "STOP" | "COMPLETE" | "ERROR" | "RESET";
export function createRecorderMachine() {
    return createTransitionMachine<RecorderState, RecorderEvent>("idle", {
        idle: { PREPARE: "preparing", ERROR: "error" },
        preparing: { READY: "idle", RECORD: "recording", TRANSCRIBE: "transcribing", STOP: "stopping", ERROR: "error" },
        recording: { TRANSCRIBE: "transcribing", STOP: "stopping", ERROR: "error" },
        transcribing: { STOP: "stopping", COMPLETE: "idle", ERROR: "error" },
        stopping: { COMPLETE: "idle", ERROR: "error" },
        error: { RESET: "idle", PREPARE: "preparing" }
    });
}
export function createPlaybackMachine() {
    return createTransitionMachine<"idle" | "playing", "PLAY" | "STOP">("idle", {
        idle: { PLAY: "playing", STOP: "idle" },
        playing: { PLAY: "playing", STOP: "idle" }
    });
}
export function createTranslationMachine() {
    return createTransitionMachine<"disabled" | "loading" | "enabled" | "error", "LOAD" | "READY" | "FAIL" | "DISABLE">("disabled", {
        disabled: { LOAD: "loading", DISABLE: "disabled" },
        loading: { READY: "enabled", FAIL: "error", DISABLE: "disabled" },
        enabled: { DISABLE: "disabled" },
        error: { LOAD: "loading", DISABLE: "disabled" }
    });
}
type NavigationState = "workspace" | "help" | "downloads" | "workspace-settings" | "help-settings" | "downloads-settings";
type NavigationEvent = "WORKSPACE" | "HELP" | "DOWNLOADS" | "OPEN_SETTINGS" | "CLOSE_SETTINGS";
export function createNavigationMachine(hash: string) {
    return createTransitionMachine<NavigationState, NavigationEvent>(hash === "#help" ? "help" : hash === "#downloads" ? "downloads" : "workspace", {
        workspace: { WORKSPACE: "workspace", HELP: "help", DOWNLOADS: "downloads", OPEN_SETTINGS: "workspace-settings" },
        help: { WORKSPACE: "workspace", HELP: "help", DOWNLOADS: "downloads", OPEN_SETTINGS: "help-settings" },
        downloads: { WORKSPACE: "workspace", HELP: "help", DOWNLOADS: "downloads", OPEN_SETTINGS: "downloads-settings" },
        "workspace-settings": { WORKSPACE: "workspace-settings", HELP: "help-settings", DOWNLOADS: "downloads-settings", CLOSE_SETTINGS: "workspace" },
        "help-settings": { WORKSPACE: "workspace-settings", HELP: "help-settings", DOWNLOADS: "downloads-settings", CLOSE_SETTINGS: "help" },
        "downloads-settings": { WORKSPACE: "workspace-settings", HELP: "help-settings", DOWNLOADS: "downloads-settings", CLOSE_SETTINGS: "downloads" }
    });
}
export function createStateMachine<C extends object, S extends string>(initial: C, transition: (context: Readonly<C>, event?: StateEvent<C>) => S) {
    let context = initial;
    let value = transition(context);
    let disposed = false;
    const listeners = new Set<() => void>();
    return {
        get context(): Readonly<C> { return context; },
        get value() { return value; },
        send(event: StateEvent<C>) {
            if (disposed)
                return;
            const previous = context[event.type];
            const next = typeof event.value === "function"
                ? (event.value as (input: C[keyof C]) => C[keyof C])(previous)
                : event.value;
            if (Object.is(previous, next))
                return;
            context = { ...context, [event.type]: next };
            value = transition(context, event);
            for (const listener of listeners)
                listener();
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        dispose() { disposed = true; listeners.clear(); }
    };
}
