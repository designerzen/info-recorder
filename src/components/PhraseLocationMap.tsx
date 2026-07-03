import { ExternalLink, LocateFixed, MapPin, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type PhraseLocationMapMessage = {
  id: string;
  sequence: number;
  text: string;
  LAT: number;
  LONG: number;
  startIso?: string;
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

export function PhraseLocationMap({ messages }: { messages: PhraseLocationMapMessage[] }) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState(() => getFittedView(messages, { width: 640, height: 320 }));
  const locatedMessages = useMemo(
    () => messages.filter((message) => isValidCoordinate(message.LAT, message.LONG)),
    [messages]
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.max(1, Math.round(entry.contentRect.width)),
        height: Math.max(1, Math.round(entry.contentRect.height))
      });
    });
    observer.observe(map);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (locatedMessages.length === 0) return;
    setView(getFittedView(locatedMessages, size.width > 0 ? size : { width: 640, height: 320 }));
  }, [locatedMessages, size]);

  const centerPixel = project(view.latitude, view.longitude, view.zoom);
  const topLeft: Point = {
    x: centerPixel.x - size.width / 2,
    y: centerPixel.y - size.height / 2
  };
  const tiles = getVisibleTiles(view.zoom, topLeft, size);
  const markerOffsets = getMarkerOffsets(locatedMessages);
  const osmUrl = `https://www.openstreetmap.org/#map=${view.zoom}/${view.latitude.toFixed(5)}/${view.longitude.toFixed(5)}`;

  if (locatedMessages.length === 0) return null;

  return (
    <section className="phrase-map" aria-label="OpenStreetMap phrase locations">
      <div ref={mapRef} className="phrase-map-viewport">
        <div className="phrase-map-tiles" aria-hidden="true">
          {tiles.map((tile) => (
            <img
              key={`${tile.zoom}-${tile.x}-${tile.y}`}
              alt=""
              draggable={false}
              src={`https://tile.openstreetmap.org/${tile.zoom}/${tile.x}/${tile.y}.png`}
              style={{
                left: `${tile.left}px`,
                top: `${tile.top}px`
              }}
            />
          ))}
        </div>

        <div className="phrase-map-markers">
          {locatedMessages.map((message) => {
            const point = project(message.LAT, message.LONG, view.zoom);
            const offset = markerOffsets.get(message.id) ?? { x: 0, y: 0 };
            return (
              <a
                key={message.id}
                className="phrase-map-message"
                href={`https://www.openstreetmap.org/?mlat=${message.LAT}&mlon=${message.LONG}#map=17/${message.LAT}/${message.LONG}`}
                rel="noreferrer"
                target="_blank"
                style={{
                  left: `${point.x - topLeft.x + offset.x}px`,
                  top: `${point.y - topLeft.y + offset.y}px`
                }}
                title={`Open phrase ${message.sequence + 1} in OpenStreetMap`}
              >
                <span className="phrase-map-pin" aria-hidden="true">
                  <MapPin size={18} />
                </span>
                <span className="phrase-map-bubble">
                  <span className="phrase-map-bubble-kicker">Phrase {message.sequence + 1}</span>
                  <span>{message.text}</span>
                </span>
              </a>
            );
          })}
        </div>

        <div className="phrase-map-controls" aria-label="Map controls">
          <button
            type="button"
            onClick={() => setView((current) => ({ ...current, zoom: clampZoom(current.zoom + 1) }))}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomIn size={17} />
          </button>
          <button
            type="button"
            onClick={() => setView((current) => ({ ...current, zoom: clampZoom(current.zoom - 1) }))}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOut size={17} />
          </button>
          <button
            type="button"
            onClick={() => setView(getFittedView(locatedMessages, size))}
            title="Fit phrase locations"
            aria-label="Fit phrase locations"
          >
            <LocateFixed size={17} />
          </button>
          <a href={osmUrl} rel="noreferrer" target="_blank" title="Open this map in OpenStreetMap" aria-label="Open this map in OpenStreetMap">
            <ExternalLink size={17} />
          </a>
        </div>

        <a className="phrase-map-attribution" href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">
          OpenStreetMap contributors
        </a>
      </div>
    </section>
  );
}

function getFittedView(messages: PhraseLocationMapMessage[], size: Size) {
  if (messages.length === 0) {
    return { latitude: 0, longitude: 0, zoom: DEFAULT_ZOOM };
  }

  const bounds = messages.reduce(
    (current, message) => ({
      minLat: Math.min(current.minLat, message.LAT),
      maxLat: Math.max(current.maxLat, message.LAT),
      minLon: Math.min(current.minLon, message.LONG),
      maxLon: Math.max(current.maxLon, message.LONG)
    }),
    {
      minLat: messages[0].LAT,
      maxLat: messages[0].LAT,
      minLon: messages[0].LONG,
      maxLon: messages[0].LONG
    }
  );
  const latitude = (bounds.minLat + bounds.maxLat) / 2;
  const longitude = (bounds.minLon + bounds.maxLon) / 2;

  if (messages.length === 1) {
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
  const tiles: Array<{ x: number; y: number; zoom: number; left: number; top: number }> = [];

  for (let x = minX; x <= maxX; x += 1) {
    const wrappedX = ((x % tileCount) + tileCount) % tileCount;
    for (let y = minY; y <= maxY; y += 1) {
      tiles.push({
        x: wrappedX,
        y,
        zoom,
        left: x * TILE_SIZE - topLeft.x,
        top: y * TILE_SIZE - topLeft.y
      });
    }
  }

  return tiles;
}

function getMarkerOffsets(messages: PhraseLocationMapMessage[]) {
  const coordinateCounts = new Map<string, number>();
  const offsets = new Map<string, Point>();

  for (const message of messages) {
    const key = `${message.LAT.toFixed(5)},${message.LONG.toFixed(5)}`;
    const count = coordinateCounts.get(key) ?? 0;
    coordinateCounts.set(key, count + 1);
    offsets.set(message.id, {
      x: Math.min(count, 5) * 18,
      y: Math.min(count, 5) * 14
    });
  }

  return offsets;
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
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function clampLatitude(latitude: number) {
  return Math.max(-85.05112878, Math.min(85.05112878, latitude));
}

function clampZoom(zoom: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}
