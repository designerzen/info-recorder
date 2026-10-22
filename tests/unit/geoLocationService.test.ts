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
