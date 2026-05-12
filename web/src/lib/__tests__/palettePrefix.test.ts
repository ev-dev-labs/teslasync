import { describe, it, expect } from 'vitest';
import {
  parsePrefix,
  getScopeMeta,
  isPaletteScope,
  itemMatchesScope,
  PALETTE_PREFIX_CHARS,
  PALETTE_SCOPE_HINTS,
} from '../palettePrefix';

describe('parsePrefix', () => {
  it('returns null scope for an empty input', () => {
    expect(parsePrefix('')).toEqual({ scope: null, term: '' });
  });

  it('returns null scope for plain text', () => {
    expect(parsePrefix('drives')).toEqual({ scope: null, term: 'drives' });
  });

  it('recognizes ">" as the commands scope', () => {
    expect(parsePrefix('>')).toEqual({ scope: 'command', term: '' });
    expect(parsePrefix('> wake')).toEqual({ scope: 'command', term: 'wake' });
    expect(parsePrefix('>wake')).toEqual({ scope: 'command', term: 'wake' });
  });

  it('recognizes "/" as the pages scope', () => {
    expect(parsePrefix('/')).toEqual({ scope: 'navigate', term: '' });
    expect(parsePrefix('/ drives')).toEqual({ scope: 'navigate', term: 'drives' });
    expect(parsePrefix('/drives')).toEqual({ scope: 'navigate', term: 'drives' });
  });

  it('recognizes "@" as the vehicles scope', () => {
    expect(parsePrefix('@')).toEqual({ scope: 'vehicle-switch', term: '' });
    expect(parsePrefix('@ model y')).toEqual({ scope: 'vehicle-switch', term: 'model y' });
  });

  it('recognizes ":" as the settings scope', () => {
    expect(parsePrefix(':')).toEqual({ scope: 'registry', term: '' });
    expect(parsePrefix(': theme')).toEqual({ scope: 'registry', term: 'theme' });
    expect(parsePrefix(':theme dark')).toEqual({ scope: 'registry', term: 'theme dark' });
  });

  it('only consumes a single space after the prefix', () => {
    // Two spaces → the second space stays in the term.
    expect(parsePrefix('>  wake')).toEqual({ scope: 'command', term: ' wake' });
  });

  it('does NOT treat a prefix character mid-string as a scope', () => {
    expect(parsePrefix('a > b')).toEqual({ scope: null, term: 'a > b' });
    expect(parsePrefix('hello/world')).toEqual({ scope: null, term: 'hello/world' });
  });

  it('does NOT treat an unknown leading char as a scope', () => {
    expect(parsePrefix('!boom')).toEqual({ scope: null, term: '!boom' });
    expect(parsePrefix('#tag')).toEqual({ scope: null, term: '#tag' });
  });

  it('preserves trailing whitespace inside the term', () => {
    expect(parsePrefix('> wake ')).toEqual({ scope: 'command', term: 'wake ' });
  });
});

describe('getScopeMeta', () => {
  it('returns the prefix character for each scope', () => {
    expect(getScopeMeta('command').prefix).toBe('>');
    expect(getScopeMeta('navigate').prefix).toBe('/');
    expect(getScopeMeta('vehicle-switch').prefix).toBe('@');
    expect(getScopeMeta('registry').prefix).toBe(':');
  });

  it('returns a non-empty placeholder and label per scope', () => {
    for (const scope of ['command', 'navigate', 'vehicle-switch', 'registry'] as const) {
      const meta = getScopeMeta(scope);
      expect(meta.placeholder.length).toBeGreaterThan(0);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.types.length).toBeGreaterThan(0);
    }
  });
});

describe('isPaletteScope', () => {
  it('returns true for known scopes', () => {
    expect(isPaletteScope('command')).toBe(true);
    expect(isPaletteScope('navigate')).toBe(true);
  });

  it('returns false for unknown values, null, undefined, empty string', () => {
    expect(isPaletteScope('search-hit')).toBe(false);
    expect(isPaletteScope('')).toBe(false);
    expect(isPaletteScope(null)).toBe(false);
    expect(isPaletteScope(undefined)).toBe(false);
  });
});

describe('itemMatchesScope', () => {
  it('passes every item when scope is null', () => {
    expect(itemMatchesScope('command', null)).toBe(true);
    expect(itemMatchesScope('navigate', null)).toBe(true);
    expect(itemMatchesScope(undefined, null)).toBe(true);
  });

  it('matches command items only under the command scope', () => {
    expect(itemMatchesScope('command', 'command')).toBe(true);
    expect(itemMatchesScope('navigate', 'command')).toBe(false);
    expect(itemMatchesScope('vehicle-switch', 'command')).toBe(false);
  });

  it('matches navigate items only under the navigate scope', () => {
    expect(itemMatchesScope('navigate', 'navigate')).toBe(true);
    expect(itemMatchesScope('command', 'navigate')).toBe(false);
  });

  it('matches vehicle-switch items only under the vehicle-switch scope', () => {
    expect(itemMatchesScope('vehicle-switch', 'vehicle-switch')).toBe(true);
    expect(itemMatchesScope('navigate', 'vehicle-switch')).toBe(false);
  });

  it('matches registry items only under the registry scope', () => {
    expect(itemMatchesScope('registry', 'registry')).toBe(true);
    expect(itemMatchesScope('command', 'registry')).toBe(false);
  });

  it('rejects items without a type when a scope is active', () => {
    expect(itemMatchesScope(undefined, 'command')).toBe(false);
  });
});

describe('PALETTE_PREFIX_CHARS / PALETTE_SCOPE_HINTS', () => {
  it('exposes the four canonical prefix chars in display order', () => {
    expect(PALETTE_PREFIX_CHARS).toEqual(['>', '/', '@', ':']);
  });

  it('PALETTE_SCOPE_HINTS pairs each prefix with its scope and label', () => {
    expect(PALETTE_SCOPE_HINTS.map(h => h.prefix)).toEqual(['>', '/', '@', ':']);
    expect(PALETTE_SCOPE_HINTS.map(h => h.scope)).toEqual([
      'command', 'navigate', 'vehicle-switch', 'registry',
    ]);
    expect(PALETTE_SCOPE_HINTS.every(h => typeof h.label === 'string' && h.label.length > 0)).toBe(true);
  });
});
