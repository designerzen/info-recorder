// Derived from Underdog Woof by Conway: Underdog Non-Commercial License 1.0. See LICENSE and README.md in this folder.
/** Respellings for hard names and foreign words (Siobhan -> Shivawn), from Woof's respell.tsv lexicon: whole words,
 * case- and accent-insensitive, longest entry first. Entries flagged "c" match only when every word is capitalised. */
import { isLower, isUpper } from "./pyre";

const WORD = /[\p{L}\p{Nl}\p{No}]+(?:'[\p{L}\p{Nl}\p{No}]+)*/gu;

/** Lookup key: no accents, lower case, straight apostrophes, hyphens read as spaces. */
function fold(text: string) {
  let s = text.replaceAll("’", "'").replaceAll("‘", "'").normalize("NFKD").replace(/\p{Mn}/gu, "").toLowerCase();
  s = s.replaceAll("ł", "l").replaceAll("ø", "o").replaceAll("æ", "ae").replaceAll("œ", "oe").replaceAll("ß", "ss").replaceAll("đ", "d");
  return s.replace(/[-‐–]/g, " ").split(/\s+/u).filter(Boolean).join(" ");
}

export class Respeller {
  private lexicon = new Map<string, [string, boolean]>();
  private longest = 1;

  constructor(tsv: string) {
    for (const line of tsv.split("\n")) {
      if (!line.trim() || line.startsWith("#")) continue;
      const parts = line.replace(/\r$/, "").split("\t");
      const key = fold(parts[0]);
      this.lexicon.set(key, [parts[1], (parts[2] ?? "").includes("c")]);
      this.longest = Math.max(this.longest, key.split(" ").length);
    }
  }

  private lookup(source: string): [[string, boolean] | undefined, string] {
    const key = fold(source);
    const hit = this.lexicon.get(key);
    if (hit) return [hit, ""];
    if (key.endsWith("'s") && this.lexicon.has(key.slice(0, -2))) return [this.lexicon.get(key.slice(0, -2)), source.slice(-2)];
    return [undefined, ""];
  }

  /** A hyphenated word matches alone only as a capitalised name next to a lower-case part (Siobhan-led). */
  private static hyphenOk(t: string, a: number, b: number, source: string) {
    const sides: Array<[boolean, () => string[]]> = [
      [t.slice(Math.max(0, a - 1), a) === "-" && /\p{L}/u.test(t.slice(Math.max(0, a - 2), Math.max(0, a - 1))), () => t.slice(0, Math.max(0, a - 1)).split(/\s+/u).filter(Boolean).slice(-1)],
      [t.slice(b, b + 1) === "-" && /\p{L}/u.test(t.slice(b + 1, b + 2)), () => t.slice(b + 1).split(/\s+/u).filter(Boolean).slice(0, 1)]
    ];
    for (const [joined, other] of sides) {
      if (!joined) continue;
      const word = other()[0] ?? "";
      if (!(isUpper(source.slice(0, 1)) && isLower(word.slice(0, 1)))) return false;
    }
    return true;
  }

  respell(input: string) {
    if (this.lexicon.size === 0) return input;
    const t = input.replaceAll("’", "'");
    const found = [...t.matchAll(WORD)].map((word) => ({ text: word[0], start: word.index ?? 0, end: (word.index ?? 0) + word[0].length }));
    let out = "";
    let position = 0;
    let i = 0;
    while (i < found.length) {
      let matched = false;
      for (let n = Math.min(this.longest, found.length - i); n > 0; n--) {
        const span = found.slice(i, i + n);
        if (span.slice(1).some((word, k) => ![" ", "-"].includes(t.slice(span[k].end, word.start)))) continue;
        const a = span[0].start;
        const b = span[span.length - 1].end;
        const source = t.slice(a, b);
        if (!Respeller.hyphenOk(t, a, b, source)) continue;
        const [hit, tail] = this.lookup(source);
        if (!hit) continue;
        let [replacement] = hit;
        const [, capitalised] = hit;
        if (capitalised && !span.every((word) => isUpper(word.text.slice(0, 1)))) continue;
        if (isUpper(source.slice(0, 1)) && isLower(replacement.slice(0, 1))) replacement = replacement[0].toUpperCase() + replacement.slice(1);
        out += t.slice(position, a) + replacement + tail;
        position = b;
        i += n;
        matched = true;
        break;
      }
      if (!matched) i++;
    }
    return out + t.slice(position);
  }
}
