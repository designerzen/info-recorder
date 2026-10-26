import { expect, it, vi } from "vitest";
import { createNavigationMachine, createPlaybackMachine, createRecorderMachine, createStateMachine, createTranslationMachine } from "../../src/state/machine";

it("guards recorder transitions and allows recovery after failure", () => {
  const machine = createRecorderMachine();
  expect(machine.send("RECORD")).toBe(false);
  expect(machine.send("PREPARE")).toBe(true);
  expect(machine.send("PREPARE")).toBe(false);
  machine.send("RECORD");
  expect(machine.value).toBe("recording");
  expect(machine.send("READY")).toBe(false);
  machine.send("STOP");
  expect(machine.value).toBe("stopping");
  expect(machine.send("PREPARE")).toBe(false);
  machine.send("COMPLETE");
  expect(machine.value).toBe("idle");
  machine.send("PREPARE");
  machine.send("TRANSCRIBE");
  expect(machine.value).toBe("transcribing");
  machine.send("ERROR");
  expect(machine.value).toBe("error");
  machine.send("RESET");
  expect(machine.value).toBe("idle");
});

it("ignores late translation completion after disable and supports retry", () => {
  const machine = createTranslationMachine();
  machine.send("LOAD");
  machine.send("DISABLE");
  expect(machine.send("READY")).toBe(false);
  expect(machine.value).toBe("disabled");
  machine.send("LOAD");
  machine.send("FAIL");
  expect(machine.value).toBe("error");
  machine.send("LOAD");
  machine.send("READY");
  expect(machine.value).toBe("enabled");
});

it("remembers the destination while navigating with settings open", () => {
  const machine = createNavigationMachine("#help");
  machine.send("OPEN_SETTINGS");
  machine.send("DOWNLOADS");
  expect(machine.value).toBe("downloads-settings");
  machine.send("CLOSE_SETTINGS");
  expect(machine.value).toBe("downloads");
});

it("notifies only on transitions and releases subscriptions on disposal", () => {
  const machine = createPlaybackMachine();
  const listener = vi.fn();
  const unsubscribe = machine.subscribe(listener);
  machine.send("STOP");
  machine.send("PLAY");
  machine.send("PLAY");
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
  machine.send("STOP");
  expect(listener).toHaveBeenCalledOnce();
  machine.dispose();
  expect(machine.send("PLAY")).toBe(false);
  expect(machine.value).toBe("idle");
});

it("keeps context events synchronous and ignores events after disposal", () => {
  const machine = createStateMachine({ count: 0 }, () => "ready");
  const listener = vi.fn();
  machine.subscribe(listener);
  machine.send({ type: "count", value: (previous) => previous + 1 });
  expect(machine.context.count).toBe(1);
  machine.send({ type: "count", value: 1 });
  expect(listener).toHaveBeenCalledOnce();
  machine.dispose();
  machine.send({ type: "count", value: 2 });
  expect(machine.context.count).toBe(1);
});
