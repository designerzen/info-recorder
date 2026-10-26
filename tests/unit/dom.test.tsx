import { expect, it, vi } from "vitest";
import { defineElement, h, patch } from "../../src/ui/dom";
import { fireEvent, render, screen } from "../dom";

it("keeps repeated unkeyed siblings and all parts of a text label", () => {
  const { container, rerender } = render(<div><span>Ready</span></div>);
  rerender(<div><span>Ready</span><span>{42}%</span><fieldset>First</fieldset><fieldset>Second</fieldset></div>);
  expect(screen.getByText("42%")).toBeVisible();
  expect(container.querySelectorAll("fieldset")).toHaveLength(2);
});

it("preserves canvas identity, focused input, selection and current handlers", () => {
  const first = vi.fn();
  const second = vi.fn();
  const { container, rerender } = render(<section><canvas /><input value="words" /><button onClick={first}>Save</button></section>);
  const canvas = container.querySelector("canvas");
  const input = container.querySelector("input")!;
  input.focus();
  input.setSelectionRange(1, 3);
  rerender(<section><canvas /><input value="words" /><button onClick={second}>Save</button></section>);
  expect(container.querySelector("canvas")).toBe(canvas);
  expect(input).toHaveFocus();
  expect(input.selectionStart).toBe(1);
  expect(input.selectionEnd).toBe(3);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
});

it("releases the previous canvas ref before binding a replacement", () => {
  const ref = vi.fn();
  const { rerender } = render(<div><canvas key="first" ref={ref} /></div>);
  ref.mockClear();
  rerender(<div><canvas key="second" ref={ref} /></div>);
  expect(ref.mock.calls.map(([node]) => node?.nodeName ?? null)).toEqual([null, "CANVAS"]);
});

it("updates an existing custom element and disposes it when removed", () => {
  const create = vi.fn();
  const dispose = vi.fn();
  const Widget = defineElement<{ label: string }>("wt-test-widget", (props, host) => {
    create();
    patch(host, <button>{props.label}</button>);
    return { update(next) { patch(host, <button>{next.label}</button>); }, dispose };
  });
  const { rerender, unmount } = render(<Widget label="First" />);
  rerender(<Widget label="Second" />);
  expect(create).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Second" })).toBeVisible();
  unmount();
  expect(dispose).toHaveBeenCalledOnce();
});
