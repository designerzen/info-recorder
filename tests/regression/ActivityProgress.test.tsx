import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ActivityProgress } from "../../src/components/ActivityProgress";

it("tracks recording duration and microphone activity in the same gadget, then switches to transcription progress", () => {
  vi.useFakeTimers();
  try {
    const startedAt = Date.now();
    const { rerender } = render(<ActivityProgress title="Recording" message="Microphone is live" active blocking={false} recordingStartedAt={startedAt} inputLevel={0.6} />);
    expect(screen.getByRole("timer")).toHaveTextContent("00:00");
    act(() => vi.advanceTimersByTime(65000));
    expect(screen.getByRole("timer")).toHaveTextContent("01:05");
    expect(screen.getByRole("meter")).toHaveAttribute("value", "0.6");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    rerender(<ActivityProgress title="Transcribing media" message="Processing audio" active blocking={false} progress={42} />);
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "42");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("shows ongoing activity without inventing a percentage, then shows measured progress", () => {
  const { rerender } = render(<ActivityProgress title="Transcribing media" message="Preparing audio" active blocking={false} />);
  expect(screen.getByRole("progressbar")).not.toHaveAttribute("value");
  rerender(<ActivityProgress title="Transcribing media" message="Processing audio" active blocking={false} progress={42} />);
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "42");
  expect(screen.getByText("42%")).toBeVisible();
});

it("opens a native blocking modal and releases it when work can continue in the background", () => {
  const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute("open"); });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: showModal });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: close });
  const { rerender } = render(<ActivityProgress title="Preparing model" message="Loading files" active blocking />);
  expect(showModal).toHaveBeenCalledOnce();
  expect(screen.getByRole("dialog", { name: "Preparing model" })).toBeVisible();
  expect(screen.getByText(/Controls will be available/)).toBeVisible();
  rerender(<ActivityProgress title="Transcribing media" message="Review text as it arrives" active blocking={false} />);
  expect(close).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Review text as it arrives");
});
