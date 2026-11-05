import type { LocationFix } from "../transcript/locatedTranscript";

export type RecordedPhraseLocation = {
  LAT: number | null;
  LONG: number | null;
};

export const emptyPhraseLocation: RecordedPhraseLocation = {
  LAT: null,
  LONG: null
};

export type LocationStatus = "off" | "waiting" | "active" | "denied" | "unavailable";

// Slow or stationary fixes add noise and storage without improving the route.
const MIN_FIX_DISTANCE_METRES = 2;

export class GeoLocationService {
  private readonly geolocation: Geolocation | null;
  private clock: () => number = () => 0;
  private onChange: () => void = () => {};
  private lastFix: LocationFix | null = null;

  status: LocationStatus = "off";
  track: LocationFix[] = [];

  private watchId: number | null = null;
  private latestLocation: RecordedPhraseLocation = emptyPhraseLocation;
  private currentPhraseLocation: RecordedPhraseLocation = emptyPhraseLocation;
  private hasActivePhrase = false;

  lastError: GeolocationPositionError | Error | null = null;

  constructor(geolocation: Geolocation | null = getNativeGeolocation()) {
    this.geolocation = geolocation;
  }

  /** Report fixes against the caller's recording clock, so they share the audio timeline. */
  observe(clock: () => number, onChange: () => void) {
    this.clock = clock;
    this.onChange = onChange;
  }

  start() {
    this.track = [];
    this.lastFix = null;
    this.latestLocation = emptyPhraseLocation;
    this.resume();
  }

  /** Continue the same track after a pause. */
  resume() {
    this.stop();
    this.currentPhraseLocation = emptyPhraseLocation;
    this.lastError = null;

    if (!this.geolocation) {
      this.setStatus("unavailable");
      return;
    }
    this.setStatus(this.track.length ? "active" : "waiting");

    const options: PositionOptions = {
      enableHighAccuracy: true,
      maximumAge: 5_000,
      timeout: 15_000
    };

    try {
      this.geolocation.getCurrentPosition(this.capturePosition, this.captureFailure, options);
      this.watchId = this.geolocation.watchPosition(
        this.capturePosition,
        this.captureFailure,
        options
      );
    } catch (cause) {
      this.captureThrownFailure(cause);
    }
  }

  stop() {
    if (this.watchId !== null && this.geolocation) {
      try {
        this.geolocation.clearWatch(this.watchId);
      } catch (cause) {
        this.captureThrownFailure(cause);
      }
    }

    this.watchId = null;
    this.hasActivePhrase = false;
    this.currentPhraseLocation = emptyPhraseLocation;
    if (this.status === "active" || this.status === "waiting") this.setStatus("off");
  }

  startPhrase() {
    this.hasActivePhrase = true;
    this.currentPhraseLocation = this.latestLocation;
  }

  finishPhrase() {
    const location = this.currentPhraseLocation;
    this.hasActivePhrase = false;
    this.currentPhraseLocation = emptyPhraseLocation;
    return location;
  }

  private capturePosition = (position: GeolocationPosition) => {
    this.latestLocation = {
      LAT: position.coords.latitude,
      LONG: position.coords.longitude
    };
    this.lastError = null;
    this.recordFix(position);

    if (this.hasActivePhrase && this.currentPhraseLocation.LAT === null) {
      this.currentPhraseLocation = this.latestLocation;
    }
  };

  private recordFix({ coords }: GeolocationPosition) {
    const fix: LocationFix = {
      atMs: Math.max(0, this.clock()),
      LAT: coords.latitude,
      LONG: coords.longitude,
      accuracy: coords.accuracy
    };
    const isNewPlace = !this.lastFix || distanceMetres(this.lastFix, fix) >= MIN_FIX_DISTANCE_METRES;
    if (isNewPlace) {
      this.lastFix = fix;
      this.track = [...this.track, fix];
    }
    if (this.status !== "active" || isNewPlace) this.setStatus("active", true);
  }

  private setStatus(status: LocationStatus, force = false) {
    if (this.status === status && !force) return;
    this.status = status;
    this.onChange();
  }

  private captureFailure = (error: GeolocationPositionError) => {
    this.lastError = error;
    // Timeouts are transient and the watch keeps running; only denial ends location.
    if (error.code === 1) this.setStatus("denied");
  };

  private captureThrownFailure(cause: unknown) {
    this.lastError = cause instanceof Error ? cause : new Error("Unable to access geolocation.");
  }
}

function distanceMetres(from: LocationFix, to: LocationFix) {
  const metresPerDegree = 111_320;
  const dx = (to.LONG - from.LONG) * metresPerDegree * Math.cos(from.LAT * Math.PI / 180);
  const dy = (to.LAT - from.LAT) * metresPerDegree;
  return Math.hypot(dx, dy);
}

function getNativeGeolocation() {
  return typeof navigator === "undefined" ? null : navigator.geolocation;
}
