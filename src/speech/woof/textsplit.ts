// Derived from Underdog Woof by Conway: Underdog Non-Commercial License 1.0. See LICENSE and README.md in this folder.
/** Splits text into utterances as Woof expects: each sentence on its own, and a sentence over CLAUSE_MAX characters at
 * clause punctuation, then once before a conjunction near its middle if it is still too long. */
import { finditer, split } from "./pyre";

const CLAUSE_MAX = 120;
const MIN_PIECE = 30;
const CONJ = "\\b(?:and|but|or|nor|that|which|who|whom|whose|when|where|while|because|although|though|so|if|as|than|until)\\b";

function splitConjunction(s: string, clauseMax: number): string[] {
  if (s.length <= clauseMax) return [s];
  const candidates = finditer("\\s(?=" + CONJ + ")", s).map((m) => m.start())
    .filter((c) => c >= MIN_PIECE && s.length - c >= MIN_PIECE);
  if (candidates.length === 0) return [s];
  const cut = candidates.reduce((best, c) => (Math.abs(c - s.length / 2) < Math.abs(best - s.length / 2) ? c : best));
  return [...splitConjunction(s.slice(0, cut).trim(), clauseMax), ...splitConjunction(s.slice(cut).trim(), clauseMax)];
}

export function splitText(text: string, clauseMax = CLAUSE_MAX) {
  const out: string[] = [];
  for (const s of split("(?<=[.!?…])\\s+", text.trim())) {
    if (!s) continue;
    if (s.length <= clauseMax) {
      out.push(s);
      continue;
    }
    const clauses = split("(?<=[,;:])\\s+|(?<=—)\\s*|(?<=--)\\s*", s).filter(Boolean);
    const merged: string[] = [];
    let current = "";
    for (const clause of clauses) {
      if (current && current.length + 1 + clause.length > clauseMax) {
        merged.push(current);
        current = clause;
      } else {
        current = !current ? clause : current.endsWith("—") || current.endsWith("--") ? current + clause : current + " " + clause;
      }
    }
    if (current) merged.push(current);
    for (const piece of merged) out.push(...splitConjunction(piece, clauseMax));
  }
  return out;
}
