import { h, Fragment, defineElement, patch } from "../ui/dom";
import { Trash2 } from "../ui/icons";
import type { SavedSessionSummary } from "../recorder/sessionStore";
import { formatClock } from "../transcript/sentenceMeta";

type Props = {
    isOpen: boolean;
    disabled: boolean;
    list: () => Promise<SavedSessionSummary[]>;
    onOpen: (name: string) => void;
    onDelete: (name: string) => Promise<void>;
};

/** Recordings kept on this device, listed afresh whenever Settings opens. */
export const SavedSessions = defineElement<Props>("wt-saved-sessions", (initialProps, host) => {
    let props = initialProps;
    let sessions: SavedSessionSummary[] = [];
    let usage = "";
    let wasOpen = false;
    let disposed = false;
    const render = () => (<div className="saved-sessions">
      {sessions.length === 0 ? <p className="settings-hint">Recordings and uploads are saved here automatically.</p> : <ul className="saved-session-list">
        {sessions.map((session) => <li key={session.name} className="saved-session">
          <button type="button" className="saved-session-open" disabled={props.disabled} onClick={() => props.onOpen(session.name)}
            aria-label={`Open ${session.title}`}>
            <strong>{session.title}</strong>
            <small>{formatClock(session.durationMs)} {session.excerpt}</small>
          </button>
          <button type="button" disabled={props.disabled} aria-label={`Delete ${session.title}`} title="Delete" onClick={() => void remove(session.name)}><Trash2 size={17} aria-hidden="true" /></button>
        </li>)}
      </ul>}
      {usage ? <p className="settings-hint">{usage}</p> : null}
    </div>);
    const load = async () => {
        const [next, estimate] = await Promise.all([
            props.list().catch(() => []),
            navigator.storage?.estimate?.().catch(() => null)
        ]);
        if (disposed)
            return;
        sessions = next;
        usage = estimate?.usage && estimate.quota
            ? `${Math.round(estimate.usage / 1048576)} MB used of ${Math.round(estimate.quota / 1048576)} MB available in this browser.`
            : "";
        patch(host, render());
    };
    const remove = async (name: string) => {
        await props.onDelete(name);
        await load();
    };
    const refresh = () => {
        if (props.isOpen && !wasOpen)
            void load();
        wasOpen = props.isOpen;
        patch(host, render());
    };
    refresh();
    return { update(next) { props = next; refresh(); }, dispose() { disposed = true; } };
});
