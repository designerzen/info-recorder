import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { expect, test } from "@playwright/test";

let server: Server;
let origin: string;
const base = "/info-recorder/";
const dist = resolve("dist");
const mime: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png",
  ".woff2": "font/woff2", ".ttf": "font/ttf", ".json": "application/json"
};

test.beforeAll(async () => {
  // Deliberately no COOP/COEP: Vite preview would hide this Pages regression.
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url!, "http://localhost").pathname;
    if (pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>Another project</title>");
      return;
    }
    if (pathname === `${base}probe-worker.js`) {
      response.setHeader("Content-Type", "text/javascript");
      response.end("onmessage = ({data}) => { const view = new Int32Array(data); Atomics.add(view, 0, 1); postMessage({isolated: crossOriginIsolated, value: view[0]}); };");
      return;
    }
    const file = resolve(dist, decodeURIComponent(pathname.slice(base.length)) || "index.html");
    if (!pathname.startsWith(base) || !file.startsWith(dist + sep)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const bytes = await readFile(file);
      response.setHeader("Content-Type", mime[extname(file)] || "application/octet-stream");
      response.setHeader("Cache-Control", "no-store");
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server address");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
});

test("Pages first visit enables shared memory before starting the app and stays isolated on revisit", async ({ page, request }) => {
  const url = `${origin}${base}?source=pages-test#downloads`;
  const raw = await request.get(url);
  expect(raw.headers()["cross-origin-opener-policy"]).toBeUndefined();
  expect(raw.headers()["cross-origin-embedder-policy"]).toBeUndefined();

  let navigations = 0;
  page.on("request", request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++;
  });
  await page.goto(url);
  await expect(page.locator("wt-app")).toBeVisible();
  const currentUrl = new URL(page.url());
  expect(currentUrl.pathname).toBe(base);
  expect(currentUrl.searchParams.get("source")).toBe("pages-test");
  expect(currentUrl.hash).toBe("#downloads");
  expect(navigations).toBe(2);
  await expect(page.getByRole("alertdialog", { name: "Browser upgrade required" })).toHaveCount(0);
  expect(await page.evaluate(() => ({
    isolated: crossOriginIsolated,
    sharedMemory: typeof SharedArrayBuffer,
    controller: navigator.serviceWorker.controller?.scriptURL
  }))).toEqual({ isolated: true, sharedMemory: "function", controller: `${origin}${base}isolation-worker.js` });

  // Exercise a real worker sharing memory, rather than just checking headers.
  expect(await page.evaluate(async () => {
    const worker = new Worker("./probe-worker.js");
    try {
      const result = new Promise(resolve => worker.onmessage = event => resolve(event.data));
      worker.postMessage(new SharedArrayBuffer(4));
      return await result;
    } finally { worker.terminate(); }
  })).toEqual({ isolated: true, value: 1 });

  await page.reload();
  await expect(page.locator("wt-app")).toBeVisible();
  expect(navigations).toBe(3);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  const sibling = await page.context().newPage();
  await sibling.goto(origin);
  expect(await sibling.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  expect(await sibling.evaluate(() => crossOriginIsolated)).toBe(false);
});

test("blocked service workers show the support error without a reload loop", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    let navigations = 0;
    page.on("request", request => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations++;
    });
    await page.goto(`${origin}${base}`);
    await expect(page.getByRole("alertdialog", { name: "Browser upgrade required" })).toBeVisible({ timeout: 15_000 });
    expect(navigations).toBe(1);
  } finally { await context.close(); }
});
