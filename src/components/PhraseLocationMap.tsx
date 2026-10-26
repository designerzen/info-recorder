import { h, Fragment, defineElement, patch } from "../ui/dom";
import { createLifecycle, sameInputs } from "../ui/lifecycle";
import { createStateMachine } from "../state/machine";
import { ExternalLink, LocateFixed, MapPin, Play, Square, X, ZoomIn, ZoomOut } from "../ui/icons";
import type { LocatedTranscriptSentence } from "../transcript/locatedTranscript";
export type PhraseLocationMapMessage = LocatedTranscriptSentence;
type Props = {
    messages: PhraseLocationMapMessage[];
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
export const PhraseLocationMap = defineElement<Props>("wt-phrase-location-map", (initialProps, host) => {
    let { messages, onPlay, onStop, activeMessageId, isPlaying, playbackLabel, playbackUnavailable } = initialProps;
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
    const calculategroups = () => {
        const byCoordinate = new Map<string, PhraseLocationMapMessage[]>();
        for (const message of locatedMessages) {
            const key = `${message.LAT.toFixed(5)},${message.LONG.toFixed(5)}`;
            const group = byCoordinate.get(key) ?? [];
            group.push(message);
            byCoordinate.set(key, group);
        }
        return [...byCoordinate.entries()];
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
            }} onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag)
                    return;
                const scale = TILE_SIZE * 2 ** state.view.zoom;
                const x = drag.center.x - (event.clientX - drag.x);
                const y = Math.max(0, Math.min(scale, drag.center.y - (event.clientY - drag.y)));
                setView({
                    zoom: state.view.zoom,
                    longitude: ((x / scale * 360) % 360 + 360) % 360 - 180,
                    latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI
                });
            }} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
        <div className="phrase-map-tiles" aria-hidden="true">
          {tiles.map((tile) => (<img key={`${tile.zoom}-${tile.column}-${tile.y}`} alt="" draggable={false} crossOrigin="anonymous" onError={() => setTilesFailed(true)} src={`https://tile.openstreetmap.org/${tile.zoom}/${tile.x}/${tile.y}.png`} style={{
                    left: `${tile.left}px`,
                    top: `${tile.top}px`
                }}/>))}
        </div>

        <div className="phrase-map-markers">
          {groups.map(([key, group]) => {
                const point = project(group[0].LAT, group[0].LONG, state.view.zoom);
                return (<div key={key} className="phrase-map-location" style={{
                        left: `${point.x - topLeft.x}px`,
                        top: `${point.y - topLeft.y}px`
                    }}>
                <span className="phrase-map-pin" aria-hidden="true">
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
          <button type="button" onClick={() => setView((current) => ({ ...current, zoom: clampZoom(current.zoom + 1) }))} title="Zoom in" aria-label="Zoom in">
            <ZoomIn size={17}/>
          </button>
          <button type="button" onClick={() => setView((current) => ({ ...current, zoom: clampZoom(current.zoom - 1) }))} title="Zoom out" aria-label="Zoom out">
            <ZoomOut size={17}/>
          </button>
          <button type="button" onClick={() => setView(getFittedView(locatedMessages, state.size))} title="Fit phrase locations" aria-label="Fit phrase locations">
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
      {state.tilesFailed ? <p className="map-tile-error" role="status">Map tiles are unavailable. Phrase locations and playback remain available.</p> : null}
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
        {
            const inputs = [locatedMessages];
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
            if (locatedMessages.length === 0)
                return;
            setView(getFittedView(locatedMessages, state.size.width > 0 ? state.size : { width: 640, height: 320 }));
        });
        scope.flush();
    }
    scope.setRefresh(refresh);
    refresh();
    return { update(props) { ({ messages, onPlay, onStop, activeMessageId, isPlaying, playbackLabel, playbackUnavailable } = props); refresh(); }, dispose: scope.dispose };
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
