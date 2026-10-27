// Static hosts such as GitHub Pages cannot set COOP/COEP response headers.
// Establish isolation before mounting the app or creating any inference workers.
async function prepareIsolation() {
  if (window.crossOriginIsolated || !window.isSecureContext ||
      !["https:", "http:"].includes(location.protocol) || !("serviceWorker" in navigator)) return;

  const workerUrl = new URL(`${import.meta.env.BASE_URL}isolation-worker.js`, location.origin);
  const workers = navigator.serviceWorker;
  const isControlling = () => workers.controller?.scriptURL === workerUrl.href;
  // A controlled page that is still not isolated must show the normal support
  // error, rather than entering a reload loop (for example in an embedded page).
  if (isControlling()) return;

  let onChange = () => {};
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const controlled = new Promise<boolean>((resolve) => {
      onChange = () => { if (isControlling()) resolve(true); };
      workers.addEventListener("controllerchange", onChange);
    });
    const expired = new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), 10_000);
    });
    const registered = workers.register(workerUrl, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: "none"
    }).then(() => isControlling() || controlled);
    if (await Promise.race([registered, expired])) {
      // The first document was fetched without the policy headers. Keep its URL
      // (including settings and navigation) and fetch it again through the worker.
      location.reload();
      await new Promise<never>(() => {});
    }
  } catch (error) {
    console.warn("Could not enable cross-origin isolation for transcription.", error);
  } finally {
    clearTimeout(timeout);
    workers.removeEventListener("controllerchange", onChange);
  }
}

await prepareIsolation();
await import("./main");
