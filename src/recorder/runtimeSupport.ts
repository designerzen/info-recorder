export type TranscriptionRuntimeSupport = {
  hasWebAssembly: boolean;
  hasWebGpu: boolean;
  hasCrossOriginIsolation: boolean;
  isSecureContext: boolean;
  isSupported: boolean;
};

export function getTranscriptionRuntimeSupport(): TranscriptionRuntimeSupport {
  const hasWebAssembly =
    typeof WebAssembly === "object" &&
    typeof WebAssembly.compile === "function" &&
    typeof WebAssembly.instantiate === "function";
  const hasWebGpu = typeof navigator !== "undefined" && navigator.gpu != null;
  const isSecureContext =
    typeof window === "undefined" ? true : window.isSecureContext || isLocalhost(window.location.hostname);

  const hasCrossOriginIsolation =
    typeof window === "undefined" ? true : window.crossOriginIsolated === true;

  return {
    hasWebAssembly,
    hasWebGpu,
    hasCrossOriginIsolation,
    isSecureContext,
    isSupported: hasWebAssembly && hasWebGpu && isSecureContext
  };
}

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
