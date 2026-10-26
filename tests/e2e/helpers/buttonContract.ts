import { expect, type Locator, type Page } from "@playwright/test";

/** Browser-resolved paint, independently measured in sRGB via a canvas.
 * Does not import the production contrast algorithm or inspect token names. */
export async function readButton(button: Locator) {
  return button.evaluate((element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (colour: string): number[] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).map((value, i) => i === 3 ? value / 255 : value);
    };
    const blend = (front: number[], back: number[]) => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      return [0, 1, 2].map((i) => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / (alpha || 1)).concat(alpha);
    };
    const background = (node: Element | null): number[] => {
      if (!node) return [255, 255, 255, 1];
      const paint = rgba(getComputedStyle(node).backgroundColor);
      return paint[3] >= 1 ? paint : blend(paint, background(node.parentElement));
    };
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: number[], b: number[]) => {
      const x = luminance(a), y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    const bg = background(element);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const labels: { text: string; ratio: number; size: number }[] = [];
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim();
      const parent = walker.currentNode.parentElement!;
      if (!text || !parent.checkVisibility()) continue;
      const parentStyle = getComputedStyle(parent), parentBg = background(parent);
      labels.push({ text, ratio: ratio(blend(rgba(parentStyle.color), parentBg), parentBg), size: parseFloat(parentStyle.fontSize) });
    }
    const surrounding = background(element.parentElement);
    const centre = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    let clipped = false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const parentStyle = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(parentStyle.overflowY) &&
        (rect.top - 6 < bounds.top - 1 || rect.bottom + 6 > bounds.bottom + 1)) clipped = true;
    }
    return {
      name: element.getAttribute("aria-label") || element.textContent?.trim() || element.getAttribute("title"),
      width: rect.width, height: rect.height, labels,
      iconContrast: ratio(blend(rgba(style.color), bg), bg),
      background: style.backgroundColor, backgroundImage: style.backgroundImage,
      foreground: style.color, opacity: style.opacity, filter: style.filter,
      outlineWidth: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle,
      outlineOffset: parseFloat(style.outlineOffset), focusContrast: ratio(rgba(style.outlineColor), surrounding),
      borderContrast: ratio(rgba(style.borderTopColor), surrounding),
      boundaryContrast: Math.max(ratio(bg, surrounding), ratio(rgba(style.borderTopColor), surrounding)),
      fontSize: parseFloat(style.fontSize), transition: style.transitionDuration,
      focused: element.matches(":focus-visible"), obscured: !centre || !element.contains(centre), clipped,
      disabled: (element as HTMLButtonElement).disabled || element.getAttribute("aria-disabled") === "true"
    };
  });
}

export async function assertButton(button: Locator, state: string) {
  const paint = await readButton(button);
  const context = `${paint.name} (${state}): ${JSON.stringify(paint)}`;
  expect(paint.name, context).toBeTruthy();
  expect(paint.width, context).toBeGreaterThanOrEqual(43.99);
  expect(paint.height, context).toBeGreaterThanOrEqual(43.99);
  expect(paint.opacity, context).toBe("1");
  expect(paint.filter, context).toBe("none");
  expect(paint.backgroundImage, context).toBe("none");
  expect(paint.fontSize, context).toBeGreaterThanOrEqual(16);
  expect(paint.boundaryContrast, context).toBeGreaterThanOrEqual(3);
  expect(paint.iconContrast, context).toBeGreaterThanOrEqual(7);
  for (const label of paint.labels) {
    expect(label.ratio, context).toBeGreaterThanOrEqual(7);
    expect(label.size, context).toBeGreaterThanOrEqual(14);
  }
  if (state === "focus") {
    expect(paint.focused, context).toBe(true);
    expect(paint.outlineStyle, context).toBe("solid");
    expect(paint.outlineWidth, context).toBeGreaterThanOrEqual(3);
    expect(paint.outlineOffset, context).toBeGreaterThanOrEqual(3);
    expect(paint.focusContrast, context).toBeGreaterThanOrEqual(3);
    expect(paint.obscured, context).toBe(false);
    expect(paint.clipped, context).toBe(false);
  }
  return paint;
}

export async function auditButtons(page: Page, scope: Locator, interactive = true) {
  // Include tabs and explicitly button-like ARIA controls, not only role=button.
  const buttons = scope.locator('button:visible, [role="button"]:visible');
  expect(await buttons.count()).toBeGreaterThan(0);
  for (let i = 0; i < await buttons.count(); i++) {
    const button = buttons.nth(i);
    // Opening a modal can place a new control underneath the old pointer.
    // Move away before measuring rest, rather than accidentally auditing hover twice.
    await page.mouse.move(0, 0);
    await button.scrollIntoViewIfNeeded();
    const rest = await assertButton(button, "rest");
    if (!interactive || rest.disabled) continue;
    await button.hover();
    if (rest.transition !== "0s") await page.waitForTimeout(160);
    const hover = await assertButton(button, "hover");
    expect(hover.background, `${rest.name} needs a hover state`).not.toBe(rest.background);
    await page.mouse.down();
    await assertButton(button, "pressed");
    // Read after the state transition, then release outside to avoid activation.
    if (rest.transition !== "0s") await page.waitForTimeout(160);
    expect((await readButton(button)).background, `${rest.name} needs a press state`).not.toBe(hover.background);
    await page.mouse.move(0, 0);
    await page.mouse.up();
    await page.keyboard.press("Tab");
    await button.focus();
    await assertButton(button, "focus");
  }
}
