# Word Trail: a quiet, AAA-first interface

Word Trail starts with one Record button. It shows recording status only while
working, the transcript only when text exists, and map controls only when there
are located phrases. Playback, settings and downloads appear when they have
content to act on. Download options stay collapsed until requested. There are no
decorative headings, slogans, idle status panels or empty transcript gadgets.
Plain verbs describe actions. Status includes text or a symbol; colour is never
the only cue. Selected controls have an underline. Disabled controls keep readable
labels and use dashed boundaries.

## Measurable rules

| Property | Contract |
| --- | --- |
| Button text | At least **7:1** in rest, hover, pressed, selected and disabled states |
| Other interface text | Semantic strong/muted tokens selected at **7:1** against all managed surfaces |
| Button target | At least **44 × 44 CSS pixels**, including icon, tab and sentence buttons |
| Button label | At least **16 CSS pixels**, wrapping instead of clipping |
| Supporting text | At least **14 CSS pixels**; body text at least 16 |
| Boundary | Fill or border at least **3:1** against the surrounding surface |
| Keyboard focus | At least **3px solid**, offset **3px**, contrast at least **3:1** against managed surrounding surfaces |
| Motion | 140ms colour/press feedback; no motion when reduced motion is requested |
| Layout | Reflow at 320 CSS pixels, resize text to 200%, respect device safe areas |
| System contrast | Preserve forced-colour adjustment and system button/focus colours |

The 7:1 text target follows [WCAG 2.2 Contrast (Enhanced)](https://www.w3.org/TR/WCAG22/#contrast-enhanced).
We deliberately keep 7:1 for large and disabled labels too, exceeding the
criterion's exceptions. The target size follows
[WCAG Target Size (Enhanced)](https://www.w3.org/TR/WCAG22/#target-size-enhanced).
[Apple's button guidance](https://developer.apple.com/design/human-interface-guidelines/buttons)
informs hierarchy, press feedback and comfortable hit regions. Apple's 44-point
native guidance is expressed here as a 44-CSS-pixel web contract, not a claim
that points and CSS pixels are universally interchangeable.
The focus rule builds on [WCAG Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance).

These are enforced design contracts, not a claim of whole-application WCAG AAA
certification. Content, assistive-technology behaviour, speech/media alternatives,
and every other applicable criterion require their own evaluation.

## Colour source and regimented levels

`src/design/tokens.ts` owns palette recipes. `src/design/color.ts` owns conversions
and the WCAG contrast calculation. `src/design/system.css` owns component rules.

Appearance exposes **canvas seed** and **brand seed**. Existing presets and URL
settings remain readable. Native colour inputs serialize hex, which is converted
to canonical OKLCH immediately; components never consume those raw input colours.
Legacy independent text/surface/button colour fields are retained in the settings
schema for import compatibility, but semantic output is generated from the seeds.

Two source families generate **13 levels** each. Source lightness is normalized to
0.55. Neutral chroma is capped at 0.012; brand chroma at 0.14. Each source retains
its seed hue. Chroma is reduced further when necessary until *every* level is in
the sRGB gamut. This prevents differing browser gamut-mapping choices from breaking
the measured colour pairs.

| Level | Mix with source |
| --- | --- |
| 0 | 100% white |
| 50 | 96% white |
| 100 | 90% white |
| 200 | 78% white |
| 300 | 60% white |
| 400 | 36% white |
| 500 | Source |
| 600 | 16% black |
| 700 | 32% black |
| 800 | 48% black |
| 900 | 64% black |
| 950 | 78% black |
| 1000 | 100% black |

Every level is emitted as `color-mix(in oklch, var(--ds-brand-source), white 78%)`
or its black-endpoint equivalent. No interpolated label uses transparency.
Mix percentages are shared by the CSS generator and measurement code. Palette
levels are perceptually ordered; **OKLCH lightness is not a contrast ratio**.
Contrast is calculated from linear sRGB relative luminance.

## Semantic roles

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | Neutral 50 | Neutral 950 |
| Surface | Neutral 0 | Neutral 900 |
| Raised surface | Neutral 0 | Neutral 800 |
| Tinted panel | Brand 50 | Brand 900 |
| Secondary rest / hover / press | Neutral 0 / 50 / 100 | Neutral 900 / 800 / 700 |
| Primary rest / hover / press | Brand 700 / 800 / 900 | Brand 200 / 100 / 50 |
| Selection | Brand 100 | Brand 800 |
| Strong, muted, focus, border | Selected from measured candidates | Selected from measured candidates |

The canvas seed's luminance selects a coherent light or dark family. Arbitrary
mid-grey seeds cannot force unreadable text/background combinations. The
`colorContrast()` resolver chooses a candidate only when it passes on **all**
the surfaces supplied; it throws if none pass. There is no "best effort" fallback
that quietly accepts a failing ratio.

### CSS contrast functions

The current [CSS Color 5 draft](https://drafts.csswg.org/css-color-5/#contrast-color)
defines `contrast-color()`, returning black or white. The earlier
`color-contrast(... to 7)` syntax is included only behind `@supports` and is not a
browser support requirement. JavaScript supplies the measured fallback.

Native `contrast-color()` progressively enhances primary buttons whose full
rest/hover/pressed ramp has already been validated with the same endpoint ink.
It cannot, by itself, guarantee 7:1 on arbitrary mid-tone colours. Do not apply it
to unconstrained surfaces or replace the palette measurement with a feature check.

## Component and language conventions

- Use semantic tokens (`--ds-text`, `--ds-muted`, `--ds-surface`, `--ds-selected`),
  not palette numbers, in components. Palette numbers belong in the theme mapping.
- Use the shared button rules. Add `.primary` or `data-intent="primary"` to the
  one most likely action. Secondary buttons use the default style.
- Keep an explicit accessible name on icon buttons. Labels describe actions:
  “Start recording”, “Stop playback”, “Download audio”, “Close settings”.
- Give state controls `aria-pressed`, tabs `aria-selected`, and unavailable
  actions native `disabled`. Never communicate state through colour alone.
- Keep focus rings outside clipped containers. Scroll padding and margins leave
  room around focus targets; fixed status panels must not cover focused controls.
- Use a 4px spacing unit, 8px control gaps, 16–24px internal panel padding,
  10px control corners and 16px panel corners. Button corner preferences have an
  8px floor. Focus-width preferences have a 3px floor.
- Keep display typography for headings; use a readable sans face for controls.
  Respect larger font, spacing and typeface preferences. Wrap long control text.

### Typeface choices

Appearance offers 15 locally bundled typefaces, grouped by reading support,
sans-serif, serif, and monospace. These include OpenDyslexic, Readex Pro, Lexend,
Andika, Atkinson Hyperlegible and Next, plus four monospace choices. The
[font inventory and licences](src/assets/fonts/README.md) document their sources.
Descriptions and a live reading preview support personal choice. Font selection
applies to the interface and subtitle family and survives URL reloads. Readex Pro
and Lexend have upright styles; other newly bundled families include true italics.

## Verification and extending the system

Run `pnpm test`, `pnpm test:e2e`, and `pnpm build`.
For the dedicated matrix, run `pnpm test:design`.

The Playwright contract enumerates visible native buttons, tabs and ARIA buttons
in home, both settings panels, transcript, playback, map and phrase detail views.
It covers every preset plus hostile custom colours at desktop and phone widths.
It tests real hover, pointer-down and keyboard-focus states, disabled controls,
rendered text descendants, target rectangles, button boundaries, focus clipping
and obstruction, reduced motion, forced colours and enlarged text.

Measurements use browser-resolved CSS colours painted into an sRGB canvas and
an independent WCAG calculation; they do not trust token names or import the
production contrast function. Fixtures expose recording/media states without
microphone permissions, external model downloads or real user recordings.

When adding a new view or conditional action, expose it in the matrix. Never add
a selector exemption to make an undersized or low-contrast control pass. New
buttons inherit the contract automatically; new surfaces must join the measured
surface set before they are used for text or focus backgrounds.
