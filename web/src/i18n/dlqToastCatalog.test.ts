import { readFileSync } from 'node:fs';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import canonical from './en.json';
import admin from './en/locale-admin.json';

// Catalog-only fixture: inspect the producer without importing the replay hook
// or issuing a request. These are the existing helper's fallback/vars contract.
const producer = readFileSync('src/api/hooks/useDLQ.ts', 'utf8');
const successFallback = 'Replay published to {{topic}}';
const errorFallback = 'Replay failed';
const catalogs = [
  { name: 'canonical English', resource: canonical },
  { name: 'generated admin bundle', resource: admin },
];

it('preserves the existing DLQ toast producer fallback and topic contract', () => {
  expect(producer).toMatch(
    /success\('admin\.dlq\.toast\.replaySuccess', 'Replay published to \{\{topic\}\}', \{\s*topic: res\?\.dst_topic \?\? '—',\s*\}\)/,
  );
  expect(producer).toContain("error(err, 'admin.dlq.toast.replayError', 'Replay failed')");
});

describe.each(catalogs)('DLQ toast catalog in $name', ({ resource }) => {
  it('matches both canonical English leaves to the existing producer fallbacks', () => {
    expect(resource.admin.dlq.toast).toEqual({
      replaySuccess: successFallback,
      replayError: errorFallback,
    });
  });

  it('looks up success and interpolates only the destination topic including the missing-topic dash', async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'en',
      fallbackLng: false,
      resources: { en: { translation: resource } },
      interpolation: { escapeValue: false },
    });

    const key = 'admin.dlq.toast.replaySuccess';
    expect(i18n.exists(key)).toBe(true);
    expect(i18n.t(key, {
      defaultValue: 'Missing success catalog entry',
      topic: 'fixture.telemetry.replay',
    })).toBe('Replay published to fixture.telemetry.replay');
    expect(i18n.t(key, {
      defaultValue: successFallback,
      topic: 'fixture.telemetry.replay',
    })).toBe('Replay published to fixture.telemetry.replay');
    expect(i18n.t(key, {
      defaultValue: successFallback,
      topic: '—',
    })).toBe('Replay published to —');
  });

  it('looks up an independent error title without topic or error-detail interpolation', async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'en',
      fallbackLng: false,
      resources: { en: { translation: resource } },
      interpolation: { escapeValue: false },
    });

    const key = 'admin.dlq.toast.replayError';
    expect(i18n.exists(key)).toBe(true);
    expect(i18n.t(key, { defaultValue: 'Missing error catalog entry' })).toBe(errorFallback);
    expect(i18n.t(key, {
      defaultValue: errorFallback,
      topic: 'fixture.telemetry.replay',
      message: 'Synthetic transport detail',
    })).toBe('Replay failed');
    expect(resource.admin.dlq.toast.replayError).not.toBe(resource.admin.dlq.toast.replaySuccess);
  });
});
