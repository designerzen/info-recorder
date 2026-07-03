export type RecordedPhraseLocation = {
  LAT: number | null;
  LONG: number | null;
};

export const emptyPhraseLocation: RecordedPhraseLocation = {
  LAT: null,
  LONG: null
};

export class GeoLocationService {
  private readonly geolocation: Geolocation | null;
  private watchId: number | null = null;
  private latestLocation: RecordedPhraseLocation = emptyPhraseLocation;
  private currentPhraseLocation: RecordedPhraseLocation = emptyPhraseLocation;
  private hasActivePhrase = false;

  lastError: GeolocationPositionError | Error | null = null;

  constructor(geolocation: Geolocation | null = getNativeGeolocation()) {
    this.geolocation = geolocation;
  }

  start() {
    this.stop();
    this.latestLocation = emptyPhraseLocation;
    this.currentPhraseLocation = emptyPhraseLocation;
    this.lastError = null;

    if (!this.geolocation) return;

    const options: PositionOptions = {
      enableHighAccuracy: false,
      maximumAge: 60_000,
      timeout: 10_000
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

    if (this.hasActivePhrase && this.currentPhraseLocation.LAT === null) {
      this.currentPhraseLocation = this.latestLocation;
    }
  };

  private captureFailure = (error: GeolocationPositionError) => {
    this.lastError = error;
  };

  private captureThrownFailure(cause: unknown) {
    this.lastError = cause instanceof Error ? cause : new Error("Unable to access geolocation.");
  }
}

function getNativeGeolocation() {
  return typeof navigator === "undefined" ? null : navigator.geolocation;
}
