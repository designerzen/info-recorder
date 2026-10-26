import { fireEvent as domFireEvent, screen, within, waitFor } from "@testing-library/dom";
import { patch, type DomContent } from "../src/ui/dom";
import { flushUpdates } from "../src/ui/lifecycle";
export { screen, within, waitFor };
const containers = new Set<HTMLElement>();
const services = new Set<() => void>();
export function mountService<T extends { dispose(): void }>(service: T) {
  services.add(service.dispose);
  return { result: { current: service }, unmount: () => { service.dispose(); services.delete(service.dispose); } };
}
export function render(content: DomContent) {
  const container = document.createElement("div");
  containers.add(container);
  document.body.append(container);
  patch(container, content);
  flushUpdates();
  return {
    container,
    rerender(next: DomContent) { patch(container, next); flushUpdates(); },
    unmount() { container.remove(); containers.delete(container); }
  };
}
export function cleanup() { for (const container of containers) container.remove(); containers.clear(); for (const dispose of services) dispose(); services.clear(); flushUpdates(); }
export function act<T>(callback: () => T): T {
  const result = callback();
  flushUpdates();
  if (result instanceof Promise) return result.finally(flushUpdates) as T;
  return result;
}
export const fireEvent = new Proxy(domFireEvent, {
  get(target, key) {
    const fn = Reflect.get(target, key);
    return typeof fn === "function" ? (...args: unknown[]) => { const result = fn(...args); flushUpdates(); return result; } : fn;
  }
});
