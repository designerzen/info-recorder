import { h, Fragment, defineElement, patch } from "../ui/dom";
import { createLifecycle, sameInputs } from "../ui/lifecycle";
import { createStateMachine } from "../state/machine";
import { ExternalLink, LocateFixed, MapPin, Play, Square, X, ZoomIn, ZoomOut } from "../ui/icons";
import type { LocatedTranscriptSentence, LocationFix } from "../transcript/locatedTranscript";
export type PhraseLocationMapMessage = LocatedTranscriptSentence;
type Props = {
    messages: PhraseLocationMapMessage[];
    track?: LocationFix[];
    onPlay: (message: PhraseLocationMapMessage) => void;
    onStop: () => void;
    activeMessageId: string | null;
    isPlaying: boolean;
    playbackLabel: string;
    playbackUnavailable: boolean;
};
type Point = {
    x: number;
    y: number;
};
type Size = {
    width: number;
    height: number;
};
const TILE_SIZE = 256;
const MIN_ZOOM = 2;
const MAX_ZOOM = 18;
const DEFAULT_ZOOM = 14;
const CLUSTER_CELL_PX = 48;
// Beyond this, sentence text spread over several places would cover the map, so markers open it on demand.
const MAX_SENTENCES_WITH_TEXT = 3;
export const PhraseLocationMap = defineElement<Props>("wt-phrase-location-map", (initialProps, host) => {
    let { messages, track = [], onPlay, onStop, activeMessageId, isPlaying, playbackLabel, playbackUnavailable } = initialProps;
    // New sentences must not snatch the view from someone exploring the map.
    let hasMovedView = false;
    let followedMessageId: string | null = null;
    const zoomBy = (delta: number) => {
        hasMovedView = true;
        setView((current) => ({ ...current, zoom: clampZoom(current.zoom + delta) }));
    };
    const centerOn = (message: PhraseLocationMapMessage) => {
        setView((current) => ({ ...current, latitude: message.LAT, longitude: message.LONG }));
    };
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;
    const getPinchDistance = () => {
        const [first, second] = [...pointers.values()];
        return Math.hypot(first.x - second.x, first.y - second.y);
    };
    const tileIsVisibleOffline = () => navigator.onLine !== false;
    const scope = createLifecycle();
    const machine = createStateMachine({ selectedId: (null) as string | null,
        tilesFailed: false,
        size: ({ width: 0, height: 0 }) as Size,
        view: (() => getFittedView(messages, { width: 640, height: 320 }))() }, () => "ready");
    let state = machine.context;
    scope.own(machine.subscribe(() => { state = machine.context; scope.invalidate(); }));
    scope.own(machine.dispose);
    const setSelectedId = (value: typeof state.selectedId | ((previous: typeof state.selectedId) => typeof state.selectedId)) => machine.send({ type: "selectedId", value });
    const setTilesFailed = (value: typeof state.tilesFailed | ((previous: typeof state.tilesFailed) => typeof state.tilesFailed)) => machine.send({ type: "tilesFailed", value });
    const setSize = (value: typeof state.size | ((previous: typeof state.size) => typeof state.size)) => machine.send({ type: "size", value });
    const setView = (value: typeof state.view | ((previous: typeof state.view) => typeof state.view)) => machine.send({ type: "view", value });
    const mapRef: {
        current: HTMLDivElement | null;
    } = { current: null };
    const dragRef: {
        current: {
            x: number;
            y: number;
            center: Point;
        } | null;
    } = { current: null };
    const calculatelocatedMessages = () => messages.filter((message) => isValidCoordinate(message.LAT, message.LONG));
    let locatedMessages = calculatelocatedMessages();
    let calculatelocatedMessagesInputs: readonly unknown[] | undefined;
    let selected = locatedMessages.find((message) => message.id === state.selectedId);
    let selectedIndex = Math.max(0, locatedMessages.findIndex((message) => message.id === (activeMessageId ?? state.selectedId)));
    let route: LocationFix[] = track.filter((fix) => isValidCoordinate(fix.LAT, fix.LONG));
    // Sentences close enough to overlap at this zoom share a marker, so a moving recording stays readable.
    const calculategroups = () => {
        const byCell = new Map<string, PhraseLocationMapMessage[]>();
        for (const message of locatedMessages) {
            const point = project(message.LAT, message.LONG, state.view.zoom);
            const key = `${Math.round(point.x / CLUSTER_CELL_PX)},${Math.round(point.y / CLUSTER_CELL_PX)}`;
            const group = byCell.get(key) ?? [];
            group.push(message);
            byCell.set(key, group);
        }
        return [...byCell.entries()];
    };
    let groups = calculategroups();
    let calculategroupsInputs: readonly unknown[] | undefined;
    let centerPixel = project(state.view.latitude, state.view.longitude, state.view.zoom);
    let topLeft: Point = {
        x: centerPixel.x - state.size.width / 2,
        y: centerPixel.y - state.size.height / 2
    };
    let tiles = getVisibleTiles(state.view.zoom, topLeft, state.size);
    let osmUrl = `https://www.openstreetmap.org/#map=${state.view.zoom}/${state.view.latitude.toFixed(5)}/${state.view.longitude.toFixed(5)}`;
    function render() {
        if (locatedMessages.length === 0)
            return null;
        return (<section className="phrase-map" aria-label="OpenStreetMap phrase locations">
      <div ref={mapRef} className="phrase-map-viewport" onPointerDown={(event) => {
                if (event.button !== 0 || (event.target as HTMLElement).closest("button, a"))
                    return;
                dragRef.current = { x: event.clientX, y: event.clientY, center: centerPixel };
                event.currentTarget.setPointerCapture(event.pointerId);
                pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
                if (pointers.size === 2)
                    pinchDistance = getPinchDistance();
            }} onWheel={(event: WheelEvent) => {
                event.preventDefault();
                zoomBy(event.deltaY < 0 ? 1 : -1);
            }} onPointerMove={(event) => {
                if (pointers.has(event.pointerId))
                    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
                if (pointers.size === 2) {
                    const distance = getPinchDistance();
                    if (Math.abs(distance - pinchDistance) > 48) {
                        zoomBy(distance > pinchDistance ? 1 : -1);
                        pinchDistance = distance;
                    }
                    return;
                }
                const drag = dragRef.current;
                if (!drag)
                    return;
                hasMovedView = true;
                const scale = TILE_SIZE * 2 ** state.view.zoom;
                const x = drag.center.x - (event.clientX - drag.x);
                const y = Math.max(0, Math.min(scale, drag.center.y - (event.clientY - drag.y)));
                setView({
                    zoom: state.view.zoom,
                    longitude: ((x / scale * 360) % 360 + 360) % 360 - 180,
                    latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI
                });
            }} onPointerUp={(event) => { pointers.delete(event.pointerId); dragRef.current = null; }} onPointerCancel={(event: PointerEvent) => { pointers.delete(event.pointerId); dragRef.current = null; }}>
        <div className="phrase-map-tiles" aria-hidden="true">
          {tiles.map((tile) => (<img key={`${tile.zoom}-${tile.column}-${tile.y}`} alt="" draggable={false} crossOrigin="anonymous" className="phrase-map-tile" onError={(event: Event) => { (event.target as HTMLElement).hidden = true; setTilesFailed(true); }} src={`https://tile.openstreetmap.org/${tile.zoom}/${tile.x}/${tile.y}.png`} style={{
                    left: `${tile.left}px`,
                    top: `${tile.top}px`
                }}/>))}
        </div>

        {route.length > 1 ? <svg className="phrase-map-route" aria-hidden="true" width={state.size.width} height={state.size.height}>
          <polyline fill="none" points={route.map((fix) => {
                const point = project(fix.LAT, fix.LONG, state.view.zoom);
                return `${point.x - topLeft.x},${point.y - topLeft.y}`;
            }).join(" ")}/>
        </svg> : null}
        <div className="phrase-map-markers">
          {groups.map(([key, group]) => {
                const point = project(group[0].LAT, group[0].LONG, state.view.zoom);
                if (groups.length > 1 && locatedMessages.length > MAX_SENTENCES_WITH_TEXT) {
                    const first = group.find((message) => message.id === activeMessageId) ?? group.find((message) => message.id === state.selectedId) ?? group[0];
                    return (<div key={key} className="phrase-map-location phrase-map-cluster" style={{
                            left: `${point.x - topLeft.x}px`,
                            top: `${point.y - topLeft.y}px`
                        }}>
                  <button type="button" className="phrase-map-cluster-button" data-active={group.some((message) => message.id === activeMessageId || message.id === state.selectedId)}
                    aria-label={`Phrase ${first.sequence + 1}${group.length > 1 ? ` and ${group.length - 1} nearby` : ""}: ${first.text}`} aria-expanded={state.selectedId === first.id} aria-controls="map-phrase-detail" title={first.text}
                    onClick={() => {
                            setSelectedId(first.id);
                            if (!playbackUnavailable)
                                onPlay(first);
                        }}>{group.length > 1 ? `${first.sequence + 1}+${group.length - 1}` : first.sequence + 1}</button>
                </div>);
                }
                return (<div key={key} className="phrase-map-location" style={{
                        left: `${point.x - topLeft.x}px`,
                        top: `${point.y - topLeft.y}px`
                    }}>
                <span className="phrase-map-pin" aria-hidden="true" data-active={group.some((message) => message.id === activeMessageId)}>
                  <MapPin size={18}/>
                </span>
                <div className="phrase-map-message-list">
                  {group.map((message) => (<button key={message.id} type="button" className="phrase-map-message" aria-expanded={state.selectedId === message.id} aria-controls="map-phrase-detail" aria-label={`Phrase ${message.sequence + 1}: ${message.text}`} data-playing={isPlaying && activeMessageId === message.id} onClick={() => {
                            setSelectedId(message.id);
                            if (!playbackUnavailable)
                                onPlay(message);
                        }} title={`Read phrase ${message.sequence + 1}`}>
                      <span className="phrase-map-bubble">
                        <span className="phrase-map-bubble-kicker">Phrase {message.sequence + 1}</span>
                        <span>{message.text}</span>
                      </span>
                    </button>))}
                </div>
              </div>);
            })}
        </div>

        <div className="phrase-map-controls" aria-label="Map controls">
          <button type="button" onClick={() => zoomBy(1)} title="Zoom in" aria-label="Zoom in">
            <ZoomIn size={17}/>
          </button>
          <button type="button" onClick={() => zoomBy(-1)} title="Zoom out" aria-label="Zoom out">
            <ZoomOut size={17}/>
          </button>
          <button type="button" onClick={() => { hasMovedView = false; setView(getFittedView(locatedMessages, state.size)); }} title="Fit phrase locations" aria-label="Fit phrase locations">
            <LocateFixed size={17}/>
          </button>
          <a href={osmUrl} rel="noreferrer" target="_blank" title="Open this map in OpenStreetMap" aria-label="Open this map in OpenStreetMap">
            <ExternalLink size={17}/>
          </a>
        </div>

        <a className="phrase-map-attribution" href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">
          &copy; OpenStreetMap contributors
        </a>
      </div>
      {state.tilesFailed ? <p className="map-tile-error" role="status">Map tiles are unavailable{tileIsVisibleOffline() ? "" : " offline"}. Areas you have already viewed stay available, and the route, sentences and playback still work.</p> : <p className="map-privacy-note">Map images come from OpenStreetMap, which sees the area being viewed. Your audio and text stay on this device.</p>}
      {locatedMessages.length > 1 ? <label className="phrase-map-timeline">
        <span>{selectedIndex + 1} / {locatedMessages.length}</span>
        <input type="range" aria-label="Sentence timeline" min={0} max={locatedMessages.length - 1} value={selectedIndex} onChange={(event: Event) => {
                const message = locatedMessages[Number((event.target as HTMLInputElement).value)];
                hasMovedView = true;
                setSelectedId(message.id);
                centerOn(message);
            }}/>
      </label> : null}
      {selected ? (<section className="map-phrase-detail" id="map-phrase-detail" aria-label="Selected phrase">
          <div className="map-phrase-heading">
            <strong>Phrase {selected.sequence + 1}</strong>
            <span>{playbackLabel}</span>
            <button type="button" onClick={() => setSelectedId(null)} title="Close phrase" aria-label="Close phrase"><X size={18}/></button>
          </div>
          <p dir="auto">{selected.text}</p>
          <div className="map-phrase-actions">
            <button type="button" disabled={playbackUnavailable} onClick={() => isPlaying && activeMessageId === selected!.id ? onStop() : onPlay(selected!)}>
              {isPlaying && activeMessageId === selected.id ? <Square size={16}/> : <Play size={16}/>}
              {isPlaying && activeMessageId === selected.id ? "Stop playback" : "Play phrase"}
            </button>
            <a href={`https://www.openstreetmap.org/?mlat=${selected.LAT}&mlon=${selected.LONG}#map=17/${selected.LAT}/${selected.LONG}`} target="_blank" rel="noreferrer">OpenStreetMap <ExternalLink size={14}/></a>
          </div>
        </section>) : null}
    </section>);
    }
    function refresh() {
        {
            const inputs = [messages];
            if (!sameInputs(calculatelocatedMessagesInputs, inputs)) {
                locatedMessages = calculatelocatedMessages();
                calculatelocatedMessagesInputs = inputs;
            }
        }
        selected = locatedMessages.find((message) => message.id === state.selectedId);
        selectedIndex = Math.max(0, locatedMessages.findIndex((message) => message.id === (activeMessageId ?? state.selectedId)));
        route = track.filter((fix) => isValidCoordinate(fix.LAT, fix.LONG));
        {
            const inputs = [locatedMessages, state.view.zoom];
            if (!sameInputs(calculategroupsInputs, inputs)) {
                groups = calculategroups();
                calculategroupsInputs = inputs;
            }
        }
        centerPixel = project(state.view.latitude, state.view.longitude, state.view.zoom);
        topLeft = {
            x: centerPixel.x - state.size.width / 2,
            y: centerPixel.y - state.size.height / 2
        };
        tiles = getVisibleTiles(state.view.zoom, topLeft, state.size);
        osmUrl = `https://www.openstreetmap.org/#map=${state.view.zoom}/${state.view.latitude.toFixed(5)}/${state.view.longitude.toFixed(5)}`;
        patch(host, render());
        scope.watch("map-size", [locatedMessages.length > 0], () => {
            const map = mapRef.current;
            if (!map)
                return;
            const observer = new ResizeObserver(([entry]) => {
                setSize({
                    width: Math.max(1, Math.round(entry.contentRect.width)),
                    height: Math.max(1, Math.round(entry.contentRect.height))
                });
            });
            observer.observe(map);
            return () => observer.disconnect();
        });
        scope.watch("fit-locations", [locatedMessages, state.size], () => {
            if (locatedMessages.length === 0 || hasMovedView)
                return;
            setView(getFittedView(locatedMessages, state.size.width > 0 ? state.size : { width: 640, height: 320 }));
        });
        scope.watch("follow-playback", [activeMessageId], () => {
            const active = activeMessageId ? locatedMessages.find((message) => message.id === activeMessageId) : undefined;
            if (active && followedMessageId !== active.id) {
                followedMessageId = active.id;
                hasMovedView = true;
                centerOn(active);
            }
        });
        scope.flush();
    }
    scope.setRefresh(refresh);
    refresh();
    return { update(props) { ({ messages, track = [], onPlay, onStop, activeMessageId, isPlaying, playbackLabel, playbackUnavailable } = props); refresh(); }, dispose: scope.dispose };
});
function getFittedView(messages: PhraseLocationMapMessage[], size: Size) {
    if (messages.length === 0) {
        return { latitude: 0, longitude: 0, zoom: DEFAULT_ZOOM };
    }
    const bounds = messages.reduce((current, message) => ({
        minLat: Math.min(current.minLat, message.LAT),
        maxLat: Math.max(current.maxLat, message.LAT),
        minLon: Math.min(current.minLon, message.LONG),
        maxLon: Math.max(current.maxLon, message.LONG)
    }), {
        minLat: messages[0].LAT,
        maxLat: messages[0].LAT,
        minLon: messages[0].LONG,
        maxLon: messages[0].LONG
    });
    const latitude = (bounds.minLat + bounds.maxLat) / 2;
    const longitude = (bounds.minLon + bounds.maxLon) / 2;
    if (messages.length === 1 || (bounds.minLat === bounds.maxLat && bounds.minLon === bounds.maxLon)) {
        return { latitude, longitude, zoom: DEFAULT_ZOOM };
    }
    for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom -= 1) {
        const topLeft = project(bounds.maxLat, bounds.minLon, zoom);
        const bottomRight = project(bounds.minLat, bounds.maxLon, zoom);
        const width = Math.abs(bottomRight.x - topLeft.x);
        const height = Math.abs(bottomRight.y - topLeft.y);
        if (width <= Math.max(1, size.width - 160) && height <= Math.max(1, size.height - 120)) {
            return { latitude, longitude, zoom };
        }
    }
    return { latitude, longitude, zoom: MIN_ZOOM };
}
function getVisibleTiles(zoom: number, topLeft: Point, size: Size) {
    const tileCount = 2 ** zoom;
    const minX = Math.floor(topLeft.x / TILE_SIZE);
    const maxX = Math.floor((topLeft.x + size.width) / TILE_SIZE);
    const minY = Math.max(0, Math.floor(topLeft.y / TILE_SIZE));
    const maxY = Math.min(tileCount - 1, Math.floor((topLeft.y + size.height) / TILE_SIZE));
    const tiles: Array<{
        x: number;
        column: number;
        y: number;
        zoom: number;
        left: number;
        top: number;
    }> = [];
    for (let x = minX; x <= maxX; x += 1) {
        const wrappedX = ((x % tileCount) + tileCount) % tileCount;
        for (let y = minY; y <= maxY; y += 1) {
            tiles.push({
                x: wrappedX,
                column: x,
                y,
                zoom,
                left: x * TILE_SIZE - topLeft.x,
                top: y * TILE_SIZE - topLeft.y
            });
        }
    }
    return tiles;
}
function project(latitude: number, longitude: number, zoom: number): Point {
    const sinLatitude = Math.sin((clampLatitude(latitude) * Math.PI) / 180);
    const scale = TILE_SIZE * 2 ** zoom;
    return {
        x: ((longitude + 180) / 360) * scale,
        y: (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * scale
    };
}
function isValidCoordinate(latitude: number, longitude: number) {
    return (Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180);
}
function clampLatitude(latitude: number) {
    return Math.max(-85.05112878, Math.min(85.05112878, latitude));
}
function clampZoom(zoom: number) {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}
