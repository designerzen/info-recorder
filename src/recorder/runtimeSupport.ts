export type TranscriptionRuntimeSupport = {
  hasWebAssembly: boolean;
  hasWebGpu: boolean;
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

  return {
    hasWebAssembly,
    hasWebGpu,
    isSecureContext,
    isSupported: hasWebAssembly && hasWebGpu && isSecureContext
  };
}

function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}
