import { afterEach, describe, expect, it } from "vitest";
import { getTranscriptionRuntimeSupport } from "../../src/recorder/runtimeSupport";

const originalWebAssembly = globalThis.WebAssembly;
const originalGpuDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "gpu");
const originalSecureContextDescriptor = Object.getOwnPropertyDescriptor(window, "isSecureContext");

describe("transcription runtime support", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "WebAssembly", {
      configurable: true,
      value: originalWebAssembly
    });
    if (originalGpuDescriptor) {
      Object.defineProperty(Navigator.prototype, "gpu", originalGpuDescriptor);
    } else {
      delete (Navigator.prototype as Partial<Navigator> & { gpu?: unknown }).gpu;
    }
    if (originalSecureContextDescriptor) {
      Object.defineProperty(window, "isSecureContext", originalSecureContextDescriptor);
    }
  });

  it("requires WebGPU", () => {
    setRuntimeSupport({ hasWebAssembly: true, hasWebGpu: false, isSecureContext: true });

    expect(getTranscriptionRuntimeSupport()).toMatchObject({
      hasWebAssembly: true,
      hasWebGpu: false,
      isSupported: false
    });
  });

  it("requires WebAssembly", () => {
    setRuntimeSupport({ hasWebAssembly: false, hasWebGpu: true, isSecureContext: true });

    expect(getTranscriptionRuntimeSupport()).toMatchObject({
      hasWebAssembly: false,
      hasWebGpu: true,
      isSupported: false
    });
  });

  it("passes when WebGPU, WebAssembly, and a secure context are available", () => {
    setRuntimeSupport({ hasWebAssembly: true, hasWebGpu: true, isSecureContext: true });

    expect(getTranscriptionRuntimeSupport()).toMatchObject({
      hasWebAssembly: true,
      hasWebGpu: true,
      isSecureContext: true,
      isSupported: true
    });
  });
});

function setRuntimeSupport({
  hasWebAssembly,
  hasWebGpu,
  isSecureContext
}: {
  hasWebAssembly: boolean;
  hasWebGpu: boolean;
  isSecureContext: boolean;
}) {
  Object.defineProperty(globalThis, "WebAssembly", {
    configurable: true,
    value: hasWebAssembly ? originalWebAssembly : undefined
  });
  if (hasWebGpu) {
    Object.defineProperty(Navigator.prototype, "gpu", {
      configurable: true,
      value: {}
    });
  } else {
    Object.defineProperty(Navigator.prototype, "gpu", {
      configurable: true,
      value: undefined
    });
  }
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: isSecureContext
  });
}
