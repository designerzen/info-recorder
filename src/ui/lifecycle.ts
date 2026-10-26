type Cleanup = void | (() => void);
const updates = new Set<() => void>();
export function flushUpdates() {
    let passes = 0;
    while (updates.size) {
        if (++passes > 100)
            throw new Error("State updates did not settle");
        const batch = [...updates];
        updates.clear();
        for (const update of batch)
            update();
    }
}
/** Named browser subscriptions, owned and disposed by a service or custom element. */
export function createLifecycle() {
    let disposed = false;
    let queued = false;
    let refresh = () => { };
    const subscriptions = new Map<string, {
        inputs: readonly unknown[];
        cleanup: Cleanup;
    }>();
    const pending = new Map<string, () => void>();
    const disposers: Array<() => void> = [];
    const run = () => { queued = false; if (!disposed)
        refresh(); };
    return {
        invalidate() {
            if (disposed || queued)
                return;
            queued = true;
            updates.add(run);
            queueMicrotask(flushUpdates);
        },
        setRefresh(callback: () => void) { refresh = callback; },
        watch(name: string, inputs: readonly unknown[], callback: () => Cleanup) {
            const previous = subscriptions.get(name);
            if (previous && sameInputs(previous.inputs, inputs))
                return;
            pending.set(name, () => {
                previous?.cleanup?.();
                subscriptions.set(name, { inputs, cleanup: callback() });
            });
        },
        flush() { for (const callback of pending.values())
            callback(); pending.clear(); },
        own(dispose: () => void) { disposers.push(dispose); },
        dispose() {
            disposed = true;
            updates.delete(run);
            pending.clear();
            for (const subscription of subscriptions.values())
                subscription.cleanup?.();
            for (const dispose of disposers.reverse())
                dispose();
            subscriptions.clear();
        }
    };
}
export function sameInputs(previous: readonly unknown[] | undefined, next: readonly unknown[]) {
    return previous !== undefined && previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]));
}
let nextId = 0;
export function uniqueId() { return `wt-${++nextId}`; }
