import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RTL_LANGS,
  applyDocumentDirection,
  getLangDir,
  mapControlPositionForDir,
  textAnchorForDir,
} from './i18nDir';

describe('i18nDir.getLangDir', () => {
  it('returns "ltr" for English', () => {
    expect(getLangDir('en')).toBe('ltr');
  });

  it('returns "rtl" for Arabic', () => {
    expect(getLangDir('ar')).toBe('rtl');
  });

  it('returns "rtl" for Hebrew', () => {
    expect(getLangDir('he')).toBe('rtl');
  });

  it('returns "rtl" for Persian / Farsi', () => {
    expect(getLangDir('fa')).toBe('rtl');
  });

  it('returns "rtl" for Urdu', () => {
    expect(getLangDir('ur')).toBe('rtl');
  });

  it('strips the region subtag before lookup', () => {
    expect(getLangDir('ar-SA')).toBe('rtl');
    expect(getLangDir('he-IL')).toBe('rtl');
    expect(getLangDir('en-US')).toBe('ltr');
    expect(getLangDir('pt-BR')).toBe('ltr');
  });

  it('is case-insensitive on the primary subtag', () => {
    expect(getLangDir('AR')).toBe('rtl');
    expect(getLangDir('Ar-sa')).toBe('rtl');
    expect(getLangDir('EN')).toBe('ltr');
  });

  it('falls back to "ltr" for empty / nullish input', () => {
    expect(getLangDir('')).toBe('ltr');
    expect(getLangDir(null)).toBe('ltr');
    expect(getLangDir(undefined)).toBe('ltr');
  });

  it('falls back to "ltr" for unknown languages', () => {
    expect(getLangDir('xx')).toBe('ltr');
    expect(getLangDir('zz-ZZ')).toBe('ltr');
  });
});

describe('i18nDir.RTL_LANGS', () => {
  it('contains exactly the four primary RTL ISO-639-1 codes', () => {
    expect([...RTL_LANGS].sort()).toEqual(['ar', 'fa', 'he', 'ur']);
  });

  it('is frozen so callers cannot mutate it', () => {
    expect(Object.isFrozen(RTL_LANGS)).toBe(true);
  });
});

describe('i18nDir.applyDocumentDirection', () => {
  let originalDir: string | null;
  let originalLang: string | null;

  beforeEach(() => {
    originalDir = document.documentElement.getAttribute('dir');
    originalLang = document.documentElement.getAttribute('lang');
  });

  afterEach(() => {
    if (originalDir == null) {
      document.documentElement.removeAttribute('dir');
    } else {
      document.documentElement.setAttribute('dir', originalDir);
    }
    if (originalLang == null) {
      document.documentElement.removeAttribute('lang');
    } else {
      document.documentElement.setAttribute('lang', originalLang);
    }
  });

  it('sets <html dir="rtl"> when switching to Arabic', () => {
    const dir = applyDocumentDirection('ar');
    expect(dir).toBe('rtl');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
  });

  it('sets <html dir="ltr"> when switching back to English', () => {
    applyDocumentDirection('ar');
    const dir = applyDocumentDirection('en');
    expect(dir).toBe('ltr');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('returns "ltr" without setting lang when called with empty input', () => {
    document.documentElement.setAttribute('lang', 'en');
    const dir = applyDocumentDirection('');
    expect(dir).toBe('ltr');
    // lang is preserved when no replacement is provided.
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('handles region-tagged Hebrew', () => {
    const dir = applyDocumentDirection('he-IL');
    expect(dir).toBe('rtl');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('he-IL');
  });
});

describe('i18nDir.textAnchorForDir', () => {
  it('flips Y-axis label anchor between ltr and rtl', () => {
    expect(textAnchorForDir('y', 'ltr')).toBe('end');
    expect(textAnchorForDir('y', 'rtl')).toBe('start');
  });

  it('keeps X-axis label anchor centred regardless of direction', () => {
    expect(textAnchorForDir('x', 'ltr')).toBe('middle');
    expect(textAnchorForDir('x', 'rtl')).toBe('middle');
  });
});

describe('i18nDir.mapControlPositionForDir', () => {
  it('returns top-corner positions by default', () => {
    expect(mapControlPositionForDir('ltr')).toBe('topright');
    expect(mapControlPositionForDir('rtl')).toBe('topleft');
  });

  it('returns bottom-corner positions when requested', () => {
    expect(mapControlPositionForDir('ltr', 'bottom')).toBe('bottomright');
    expect(mapControlPositionForDir('rtl', 'bottom')).toBe('bottomleft');
  });
});
