/**
 * Rules are stored as regexes and matched server-side with
 * `new RegExp(pattern, 'i').test(value)` — case-insensitive, unanchored. Most
 * people don't want to write one: they want "contains github.com", and the
 * literal dot in it should mean a dot.
 *
 * So the form offers modes, and this module is the translation both ways:
 * `toPattern` compiles a mode + text into the regex that gets stored, and
 * `parsePattern` reads a stored regex back into a mode so editing an existing
 * rule doesn't dump the user into raw-regex mode. The round-trip is only
 * claimed when it is lossless — anything with live metacharacters in it stays
 * `regex`, which is honest and keeps hand-written rules untouched.
 */

const META = /[.*+?^${}()|[\]\\]/g;

/** Escapes a literal so it matches itself and nothing else. */
export const escapeRegex = (value: string): string => value.replace(META, '\\$&');

const unescape = (value: string): string => value.replace(/\\(.)/g, '$1');

/** True when `body` is exactly the escaping of some plain literal. */
const isLiteral = (body: string): boolean => escapeRegex(unescape(body)) === body;

/** Same compilation the server does, so a preview can't disagree with it. */
export function compile(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

// --- predicates: does this activity match? -------------------------------

export type MatchMode = 'contains' | 'startsWith' | 'endsWith' | 'exactly' | 'oneOf' | 'regex';

export const MATCH_MODES: { value: MatchMode; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'exactly', label: 'is exactly' },
  { value: 'oneOf', label: 'is one of' },
  { value: 'regex', label: 'matches regex' },
];

export interface Match {
  mode: MatchMode;
  /** The user's own text; for `oneOf`, comma-separated alternatives. */
  value: string;
}

/** Splits an `oneOf` value into its alternatives, dropping empties. */
export const alternatives = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

export function toPattern(match: Match): string {
  const value = match.mode === 'regex' ? match.value : match.value.trim();
  const escaped = escapeRegex(value);
  switch (match.mode) {
    case 'contains':
      return escaped;
    case 'startsWith':
      return `^${escaped}`;
    case 'endsWith':
      return `${escaped}$`;
    case 'exactly':
      return `^${escaped}$`;
    case 'oneOf':
      return `^(${alternatives(value).map(escapeRegex).join('|')})$`;
    case 'regex':
      return value;
  }
}

export function parsePattern(pattern: string): Match {
  const asRegex: Match = { mode: 'regex', value: pattern };

  // ^(a|b|c)$ — a list, as long as every alternative is a plain literal.
  const list = /^\^\((.+)\)\$$/.exec(pattern);
  if (list?.[1] !== undefined) {
    const parts = list[1].split('|');
    if (parts.length > 1 && parts.every((part) => part.length > 0 && isLiteral(part))) {
      return { mode: 'oneOf', value: parts.map(unescape).join(', ') };
    }
  }

  const anchoredStart = pattern.startsWith('^');
  const anchoredEnd = /(?<!\\)\$$/.test(pattern);
  const body = pattern.slice(anchoredStart ? 1 : 0, anchoredEnd ? -1 : undefined);
  if (body.length === 0 || !isLiteral(body)) return asRegex;

  const value = unescape(body);
  if (anchoredStart && anchoredEnd) return { mode: 'exactly', value };
  if (anchoredStart) return { mode: 'startsWith', value };
  if (anchoredEnd) return { mode: 'endsWith', value };
  return { mode: 'contains', value };
}

/** One-line English for a stored pattern, for the rules tables. */
export function describePattern(pattern: string): string {
  const match = parsePattern(pattern);
  switch (match.mode) {
    case 'contains':
      return `contains “${match.value}”`;
    case 'startsWith':
      return `starts with “${match.value}”`;
    case 'endsWith':
      return `ends with “${match.value}”`;
    case 'exactly':
      return `is “${match.value}”`;
    case 'oneOf':
      return `is one of ${match.value}`;
    case 'regex':
      return match.value;
  }
}

// --- extractors: which part of the title is the context? -----------------

export type ExtractMode = 'before' | 'after' | 'between' | 'regex';

export const EXTRACT_MODES: { value: ExtractMode; label: string }[] = [
  { value: 'before', label: 'text before' },
  { value: 'after', label: 'text after' },
  { value: 'between', label: 'text between' },
  { value: 'regex', label: 'custom regex' },
];

export interface Extract {
  mode: ExtractMode;
  /** The marker text; the regex itself in `regex` mode. */
  first: string;
  /** The closing marker, `between` only. */
  second: string;
}

/**
 * Context rules are extractors, not predicates: the first capture group of the
 * title regex becomes the context. `\s*` around the markers means the user
 * doesn't have to think about the spaces flanking a separator.
 */
export function toExtractPattern(extract: Extract): string {
  const first = escapeRegex(extract.first.trim());
  const second = escapeRegex(extract.second.trim());
  switch (extract.mode) {
    case 'before':
      return `^(.+?)\\s*${first}`;
    case 'after':
      return `${first}\\s*(.+)$`;
    case 'between':
      return `${first}\\s*(.+?)\\s*${second}`;
    case 'regex':
      return extract.first;
  }
}

export function parseExtractPattern(pattern: string): Extract {
  const asRegex: Extract = { mode: 'regex', first: pattern, second: '' };

  const before = /^\^\(\.\+\?\)\\s\*(.+)$/.exec(pattern);
  if (before?.[1] !== undefined && isLiteral(before[1])) {
    return { mode: 'before', first: unescape(before[1]), second: '' };
  }

  const between = /^(.+?)\\s\*\(\.\+\?\)\\s\*(.+)$/.exec(pattern);
  if (between?.[1] !== undefined && between[2] !== undefined) {
    if (isLiteral(between[1]) && isLiteral(between[2])) {
      return { mode: 'between', first: unescape(between[1]), second: unescape(between[2]) };
    }
  }

  const after = /^(.+?)\\s\*\(\.\+\)\$$/.exec(pattern);
  if (after?.[1] !== undefined && isLiteral(after[1])) {
    return { mode: 'after', first: unescape(after[1]), second: '' };
  }

  return asRegex;
}

export function describeExtractPattern(pattern: string): string {
  const extract = parseExtractPattern(pattern);
  switch (extract.mode) {
    case 'before':
      return `text before “${extract.first}”`;
    case 'after':
      return `text after “${extract.first}”`;
    case 'between':
      return `text between “${extract.first}” and “${extract.second}”`;
    case 'regex':
      return extract.first;
  }
}

/** The context a rule would pull out of `title`, or null if it doesn't apply. */
export function extractFrom(pattern: string, title: string): string | null {
  const compiled = compile(pattern);
  const found = compiled?.exec(title);
  const captured = found?.[1]?.trim();
  return captured ? captured : null;
}

/**
 * Mirrors the server's context-rule validation: a valid regex with at least
 * one capture group, since group 1 is what becomes the context. The alternation
 * with '' always matches, so the exec result counts groups without input.
 */
export function hasCaptureGroup(pattern: string): boolean {
  try {
    return (new RegExp(`${pattern}|`, 'i').exec('')?.length ?? 1) >= 2;
  } catch {
    return false;
  }
}
