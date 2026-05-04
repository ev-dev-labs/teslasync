import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isSilenced,
  silence,
  unsilence,
  listSilenced,
  clearAllSilenced,
  _STORAGE_KEY_INTERNAL as STORAGE_KEY,
} from '../confirmSilence';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('confirmSilence', () => {
  it('returns false for an unrecorded key', () => {
    expect(isSilenced('never.recorded')).toBe(false);
  });

  it('silence + isSilenced round-trip persists across re-reads', () => {
    silence('discard-draft');
    expect(isSilenced('discard-draft')).toBe(true);
    expect(isSilenced('other-key')).toBe(false);
  });

  it('persists to localStorage under the v1 key as a JSON array', () => {
    silence('discard-draft');
    silence('remove-widget');
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    expect(new Set(parsed as string[])).toEqual(new Set(['discard-draft', 'remove-widget']));
  });

  it('silence is idempotent — re-adding the same key does not duplicate', () => {
    silence('discard-draft');
    silence('discard-draft');
    silence('discard-draft');
    expect(listSilenced()).toEqual(['discard-draft']);
  });

  it('listSilenced returns a sorted array', () => {
    silence('zeta');
    silence('alpha');
    silence('mu');
    expect(listSilenced()).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('unsilence removes only the named key', () => {
    silence('a');
    silence('b');
    unsilence('a');
    expect(listSilenced()).toEqual(['b']);
    expect(isSilenced('a')).toBe(false);
    expect(isSilenced('b')).toBe(true);
  });

  it('unsilence on a missing key is a no-op', () => {
    silence('a');
    unsilence('never-recorded');
    expect(listSilenced()).toEqual(['a']);
  });

  it('clearAllSilenced empties the store', () => {
    silence('a');
    silence('b');
    silence('c');
    clearAllSilenced();
    expect(listSilenced()).toEqual([]);
    expect(isSilenced('a')).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('treats malformed JSON in storage as an empty set', () => {
    localStorage.setItem(STORAGE_KEY, 'not valid json');
    expect(listSilenced()).toEqual([]);
    expect(isSilenced('anything')).toBe(false);
  });

  it('treats a non-array JSON value in storage as an empty set', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: 'an array' }));
    expect(listSilenced()).toEqual([]);
  });

  it('drops non-string entries when loading', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['valid', 42, null, 'also-valid']));
    expect(listSilenced()).toEqual(['also-valid', 'valid']);
  });

  it('isSilenced and silence treat an empty key as a no-op', () => {
    silence('');
    expect(isSilenced('')).toBe(false);
    expect(listSilenced()).toEqual([]);
  });

  it('localStorage write failures do not throw', () => {
    const setSpy = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem');
    Storage.prototype.setItem = () => {
      throw new Error('quota exceeded');
    };
    try {
      expect(() => silence('discard-draft')).not.toThrow();
      expect(() => clearAllSilenced()).not.toThrow();
    } finally {
      if (setSpy) Object.defineProperty(Storage.prototype, 'setItem', setSpy);
    }
  });

  it('localStorage read failures do not throw', () => {
    const getSpy = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem');
    Storage.prototype.getItem = () => {
      throw new Error('access denied');
    };
    try {
      expect(isSilenced('anything')).toBe(false);
      expect(listSilenced()).toEqual([]);
    } finally {
      if (getSpy) Object.defineProperty(Storage.prototype, 'getItem', getSpy);
    }
  });
});
