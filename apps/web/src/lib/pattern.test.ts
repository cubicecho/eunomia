import { describe, expect, it } from 'vitest';
import {
  compile,
  describeExtractPattern,
  describePattern,
  type Extract,
  extractFrom,
  type Match,
  parseExtractPattern,
  parsePattern,
  toExtractPattern,
  toPattern,
} from './pattern.ts';

const roundTrip = (match: Match) => parsePattern(toPattern(match));

describe('toPattern', () => {
  it('escapes metacharacters so a literal means itself', () => {
    expect(toPattern({ mode: 'contains', value: 'docs.rs' })).toBe('docs\\.rs');
    // A dot that means "any character" is the bug this whole module exists for.
    expect(compile(toPattern({ mode: 'contains', value: 'docs.rs' }))?.test('docsXrs')).toBe(false);
    expect(compile(toPattern({ mode: 'contains', value: 'docs.rs' }))?.test('docs.rs')).toBe(true);
  });

  it('makes a valid pattern out of text that is not valid regex', () => {
    expect(compile(toPattern({ mode: 'contains', value: 'C++ (unsaved)' }))).not.toBeNull();
    expect(compile('C++ (unsaved)')).toBeNull();
  });

  it('anchors each mode the way the server matches', () => {
    expect(toPattern({ mode: 'startsWith', value: 'Code' })).toBe('^Code');
    expect(toPattern({ mode: 'endsWith', value: 'Code' })).toBe('Code$');
    expect(toPattern({ mode: 'exactly', value: 'Code' })).toBe('^Code$');
    expect(toPattern({ mode: 'oneOf', value: 'Code, Alacritty' })).toBe('^(Code|Alacritty)$');
  });

  it('passes a custom regex through untouched', () => {
    expect(toPattern({ mode: 'regex', value: '^(Code|Alacritty)$' })).toBe('^(Code|Alacritty)$');
  });
});

describe('parsePattern', () => {
  it('round-trips every mode', () => {
    expect(roundTrip({ mode: 'contains', value: 'docs.rs' })).toEqual({
      mode: 'contains',
      value: 'docs.rs',
    });
    expect(roundTrip({ mode: 'startsWith', value: 'Code' })).toEqual({
      mode: 'startsWith',
      value: 'Code',
    });
    expect(roundTrip({ mode: 'endsWith', value: '- Vim' })).toEqual({
      mode: 'endsWith',
      value: '- Vim',
    });
    expect(roundTrip({ mode: 'exactly', value: 'Slack' })).toEqual({
      mode: 'exactly',
      value: 'Slack',
    });
    expect(roundTrip({ mode: 'oneOf', value: 'Code, Alacritty' })).toEqual({
      mode: 'oneOf',
      value: 'Code, Alacritty',
    });
  });

  it('leaves a hand-written regex as a regex', () => {
    // Anything with live metacharacters must not be claimed as a literal, or
    // opening the rule to edit it would silently rewrite the match.
    for (const pattern of ['docs.rs', '.*', 'a+b', '^v?[0-9]+', '(Code|Alacritty)']) {
      expect(parsePattern(pattern).mode).toBe('regex');
      expect(parsePattern(pattern).value).toBe(pattern);
    }
  });

  it('does not turn a one-alternative group into a list', () => {
    expect(parsePattern('^(Code)$').mode).toBe('regex');
  });

  it('reads an anchored alternation as a list, since that is what it is', () => {
    // Hand-written or form-built, `^(a|b)$` compiles back byte-identical, so
    // showing it as a list costs the author nothing.
    expect(parsePattern('^(Code|Alacritty)$')).toEqual({
      mode: 'oneOf',
      value: 'Code, Alacritty',
    });
    expect(toPattern(parsePattern('^(Code|Alacritty)$'))).toBe('^(Code|Alacritty)$');
  });

  it('treats an escaped dollar as part of the literal, not an anchor', () => {
    expect(parsePattern('cost\\$')).toEqual({ mode: 'contains', value: 'cost$' });
  });

  it('describes patterns for the rules table', () => {
    expect(describePattern('^Code$')).toBe('is “Code”');
    expect(describePattern('docs\\.rs')).toBe('contains “docs.rs”');
    expect(describePattern('^(Code|Alacritty)$')).toBe('is one of Code, Alacritty');
    expect(describePattern('^v?[0-9]+')).toBe('^v?[0-9]+');
  });
});

const extractRoundTrip = (extract: Extract) => parseExtractPattern(toExtractPattern(extract));

describe('extract patterns', () => {
  it('captures the part of the title the user pointed at', () => {
    const before = toExtractPattern({ mode: 'before', first: '- Visual Studio Code', second: '' });
    expect(extractFrom(before, 'schema.ts - eunomia - Visual Studio Code')).toBe(
      'schema.ts - eunomia',
    );

    const after = toExtractPattern({ mode: 'after', first: 'Mozilla Firefox —', second: '' });
    expect(extractFrom(after, 'Mozilla Firefox — github.com')).toBe('github.com');

    const between = toExtractPattern({ mode: 'between', first: '[', second: ']' });
    expect(extractFrom(between, 'notes [eunomia] — Obsidian')).toBe('eunomia');
  });

  it('round-trips every extract mode', () => {
    expect(extractRoundTrip({ mode: 'before', first: ' - Vim', second: '' })).toEqual({
      mode: 'before',
      first: '- Vim',
      second: '',
    });
    expect(extractRoundTrip({ mode: 'after', first: '—', second: '' })).toEqual({
      mode: 'after',
      first: '—',
      second: '',
    });
    expect(extractRoundTrip({ mode: 'between', first: '[', second: ']' })).toEqual({
      mode: 'between',
      first: '[',
      second: ']',
    });
  });

  it('leaves a hand-written extractor alone', () => {
    const written = '^(.+?) · ';
    expect(parseExtractPattern(written)).toEqual({ mode: 'regex', first: written, second: '' });
    expect(describeExtractPattern(written)).toBe(written);
  });

  it('returns null when the rule does not apply to a title', () => {
    const after = toExtractPattern({ mode: 'after', first: '—', second: '' });
    expect(extractFrom(after, 'Slack')).toBeNull();
  });
});
