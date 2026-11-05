import { describe, expect, it, vi } from "vitest";
import { GeoLocationService } from "../../src/recorder/geoLocationService";

function makePosition(latitude: number, longitude: number): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy: 0,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null
    },
    timestamp: 0
  };
}

describe("GeoLocationService", () => {
  it("records the latest native geolocation for a phrase", () => {
    let watchSuccess: PositionCallback | null = null;
    const geolocation = {
      getCurrentPosition: vi.fn((success: PositionCallback) => success(makePosition(51.5, -0.12))),
      watchPosition: vi.fn((success: PositionCallback) => {
        watchSuccess = success;
        return 7;
      }),
      clearWatch: vi.fn()
    } as unknown as Geolocation;
    const service = new GeoLocationService(geolocation);

    service.start();
    service.startPhrase();
    watchSuccess?.(makePosition(52, -1));

    expect(service.finishPhrase()).toEqual({ LAT: 51.5, LONG: -0.12 });

    service.stop();
    expect(geolocation.clearWatch).toHaveBeenCalledWith(7);
  });

  it("fills an active phrase if location arrives after the phrase starts", () => {
    let watchSuccess: PositionCallback | null = null;
    const geolocation = {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn((success: PositionCallback) => {
        watchSuccess = success;
        return 3;
      }),
      clearWatch: vi.fn()
    } as unknown as Geolocation;
    const service = new GeoLocationService(geolocation);

    service.start();
    service.startPhrase();
    watchSuccess?.(makePosition(40.7, -74));

    expect(service.finishPhrase()).toEqual({ LAT: 40.7, LONG: -74 });
  });

  it("returns null coordinates when geolocation is unavailable or fails", () => {
    const service = new GeoLocationService(null);

    service.start();
    service.startPhrase();

    expect(service.finishPhrase()).toEqual({ LAT: null, LONG: null });
  });

  it("catches thrown geolocation failures", () => {
    const geolocation = {
      getCurrentPosition: vi.fn(() => {
        throw new Error("permission plumbing failed");
      }),
      watchPosition: vi.fn(),
      clearWatch: vi.fn()
    } as unknown as Geolocation;
    const service = new GeoLocationService(geolocation);

    expect(() => service.start()).not.toThrow();
    expect(service.lastError?.message).toBe("permission plumbing failed");
  });
});

describe("location track", () => {
  const position = (latitude: number, longitude: number, accuracy = 5) => ({ coords: { latitude, longitude, accuracy } }) as GeolocationPosition;
  function setup() {
    let emit: PositionCallback = () => {};
    let fail: PositionErrorCallback = () => {};
    const geolocation = {
      getCurrentPosition: vi.fn(),
      watchPosition: vi.fn((success: PositionCallback, failure: PositionErrorCallback) => { emit = success; fail = failure as PositionErrorCallback; return 1; }),
      clearWatch: vi.fn()
    } as unknown as Geolocation;
    const service = new GeoLocationService(geolocation);
    let now = 0;
    const onChange = vi.fn();
    service.observe(() => now, onChange);
    return { service, onChange, emit: (value: GeolocationPosition, at: number) => { now = at; emit(value); }, fail: (code: number) => fail({ code } as GeolocationPositionError) };
  }

  it("records fixes on the caller's clock and ignores movement within GPS noise", () => {
    const { service, emit } = setup();
    service.start();
    expect(service.status).toBe("waiting");
    emit(position(51.5, -0.12), 1000);
    emit(position(51.500001, -0.12), 2000);
    emit(position(51.501, -0.12), 3000);
    expect(service.track.map((fix) => fix.atMs)).toEqual([1000, 3000]);
    expect(service.track[0].accuracy).toBe(5);
    expect(service.status).toBe("active");
  });

  it("continues the same track after a pause and starts a new one on start", () => {
    const { service, emit } = setup();
    service.start();
    emit(position(51.5, -0.12), 1000);
    service.stop();
    service.resume();
    expect(service.track).toHaveLength(1);
    service.start();
    expect(service.track).toHaveLength(0);
  });

  it("reports denial but treats timeouts as temporary", () => {
    const { service, fail } = setup();
    service.start();
    fail(3);
    expect(service.status).toBe("waiting");
    fail(1);
    expect(service.status).toBe("denied");
  });
});
