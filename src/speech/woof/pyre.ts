/** Python `re` semantics on JavaScript regular expressions, so the Woof text rules can be ported as written: \w, \d, \s
 * and \b are Unicode-aware, replacement templates use \1, and callbacks get a match object with group(), start(), end()
 * and string. */

const WORD = "\\p{L}\\p{N}_";
const SPACE = "\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const SYNTAX = new Set("^$\\.*+?()[]{}|/");

function translate(pattern: string) {
  let out = "";
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "\\") {
      const next = pattern[++i];
      if (next === "w") out += inClass ? WORD : `[${WORD}]`;
      else if (next === "W") {
        if (inClass) throw new Error(`\\W inside a class is not supported: ${pattern}`);
        out += `[^${WORD}]`;
      } else if (next === "d") out += "\\p{Nd}";
      else if (next === "D") out += "\\P{Nd}";
      else if (next === "s") out += inClass ? SPACE : `[${SPACE}]`;
      else if (next === "S") {
        if (inClass) throw new Error(`\\S inside a class is not supported: ${pattern}`);
        out += `[^${SPACE}]`;
      } else if (next === "b") out += inClass ? "\\x08" : `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`;
      else if (/[A-Za-z0-9]/.test(next)) out += `\\${next}`;
      else if (SYNTAX.has(next) || (inClass && next === "-")) out += `\\${next}`;
      // Python allows any punctuation to be escaped; the unicode flag does not.
      else out += next;
    } else if (char === "[" && !inClass) {
      inClass = true;
      out += char;
      // A ']' straight after '[' or '[^' is a literal in Python.
      if (pattern[i + 1] === "^") out += pattern[++i];
      if (pattern[i + 1] === "]") {
        out += "\\]";
        i++;
      }
    } else if (char === "]" && inClass) {
      inClass = false;
      out += char;
    } else if (char === "[" && inClass) {
      out += "\\[";
    } else if (char === "{" && !inClass && !/^\{\d*(?:,\d*)?\}/.test(pattern.slice(i))) {
      out += "\\{";
    } else if (char === "}" && !inClass && !/\{\d*(?:,\d*)?$/.test(pattern.slice(0, i))) {
      out += "\\}";
    } else out += char;
  }
  return out;
}

const cache = new Map<string, RegExp>();

/** A compiled pattern; `flags` takes "i", and "g" is added where every match is wanted. */
export function re(pattern: string, flags = "") {
  const key = `${flags}\u0000${pattern}`;
  let compiled = cache.get(key);
  if (!compiled) {
    compiled = new RegExp(translate(pattern), `u${flags}`);
    cache.set(key, compiled);
  }
  return compiled;
}

export type Match = {
  group(index?: number): string | undefined;
  groups(): Array<string | undefined>;
  start(): number;
  end(): number;
  string: string;
};

function makeMatch(text: string, values: Array<string | undefined>, index: number): Match {
  return {
    group: (n = 0) => values[n],
    groups: () => values.slice(1),
    start: () => index,
    end: () => index + (values[0]?.length ?? 0),
    string: text
  };
}

/** re.sub: a template with \1 / \g<1>, or a function of the match. */
export function sub(pattern: string, replacement: string | ((match: Match) => string), text: string, flags = "") {
  const compiled = re(pattern, `${flags}g`);
  return text.replace(compiled, (...args: unknown[]) => {
    const hasNamed = typeof args[args.length - 1] === "object";
    const end = hasNamed ? args.length - 3 : args.length - 2;
    const values = args.slice(0, end) as Array<string | undefined>;
    const match = makeMatch(text, values, args[end] as number);
    if (typeof replacement === "function") return replacement(match);
    return replacement.replace(/\\g<(\d+)>|\\(\d+)/g, (_, named, plain) => match.group(Number(named ?? plain)) ?? "");
  });
}

export function search(pattern: string, text: string, flags = "") {
  const found = re(pattern, flags).exec(text);
  return found ? makeMatch(text, [...found], found.index) : null;
}

/** re.match: anchored at the start. */
export function match(pattern: string, text: string, flags = "") {
  return search(`^(?:${pattern})`, text, flags);
}

export function fullmatch(pattern: string, text: string, flags = "") {
  const compiled = re(`(?:${pattern})`, `${flags}y`);
  compiled.lastIndex = 0;
  const found = compiled.exec(text);
  return found && found[0].length === text.length ? makeMatch(text, [...found], 0) : null;
}

export function finditer(pattern: string, text: string, flags = "") {
  return [...text.matchAll(re(pattern, `${flags}g`))].map((found) => makeMatch(text, [...found], found.index ?? 0));
}

export function findall(pattern: string, text: string) {
  return finditer(pattern, text).map((found) => {
    const groups = found.groups();
    if (groups.length === 0) return found.group(0) ?? "";
    return groups.length === 1 ? groups[0] ?? "" : groups.map((group) => group ?? "");
  });
}

export function split(pattern: string, text: string) {
  return text.split(re(pattern, "g"));
}

/** str.split() with no separator. */
export const words = (text: string) => text.split(/\s+/u).filter(Boolean);

export const escape = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");

const cased = (char: string) => char.toLowerCase() !== char.toUpperCase();
export const isUpper = (text: string) => [...text].some(cased) && text === text.toUpperCase();
export const isLower = (text: string) => [...text].some(cased) && text === text.toLowerCase();
export const isAlpha = (text: string) => /^\p{L}+$/u.test(text);
export const isDigit = (text: string) => /^\p{Nd}+$/u.test(text);
export const capitalize = (text: string) => text.slice(0, 1).toUpperCase() + text.slice(1).toLowerCase();
