import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {
  buildAppIconSvg,
  buildDynamicAppIconManifest,
  computeDynamicAppIconSnapshot,
  dynamicAppIconNativeCapabilities,
  renderSvgToPngDataUrl,
  svgToDataUrl,
  useDynamicAppIcon,
} from '../src/web-parity/hooks/useDynamicAppIcon';

function HookProbe() {
  useDynamicAppIcon();
  return <Text>icon-host</Text>;
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('useDynamicAppIcon mounts as a safe void no-op and unmounts cleanly', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  let result: unknown = 'sentinel';
  function CaptureProbe() {
    result = useDynamicAppIcon();
    return <Text>captured</Text>;
  }
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<CaptureProbe />);
  });
  expect(JSON.stringify(tree?.toJSON())).toContain('captured');
  // The hook preserves the web `: void` contract.
  expect(result).toBeUndefined();
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });

  // A second mount must not throw either (signature dedupe path).
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<HookProbe />);
  });
  expect(JSON.stringify(tree?.toJSON())).toContain('icon-host');
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('computeDynamicAppIconSnapshot mirrors the web signature + artwork', () => {
  const snap = computeDynamicAppIconSnapshot('#00f0ff', '#10b981');
  expect(snap.signature).toBe('#00f0ff|#10b981');
  expect(snap.primary).toBe('#00f0ff');
  expect(snap.accent).toBe('#10b981');
  expect(snap.dynamicMark).toBe('data-dynamic-app-icon');

  // Favicon/standard variant carries the rounded square and both gradient stops.
  expect(snap.faviconSvg).toContain('rx="44"');
  expect(snap.faviconSvg).toContain('stop-color="#00f0ff"');
  expect(snap.faviconSvg).toContain('stop-color="#10b981"');
  expect(snap.standardSvg).toBe(snap.faviconSvg);

  // Apple variant is full-bleed (no rounded corners).
  expect(snap.appleSvg).not.toContain('rx=');
  expect(snap.appleSvg).toContain('fill="url(#g)"');

  // Maskable variant scales the bolt into the Android safe-zone.
  expect(snap.maskableSvg).toContain('translate(20 20) scale(0.8)');

  // btoa is available in the Jest/node env, so the href is a real base64 URL.
  expect(snap.faviconHref.startsWith('data:image/svg+xml;base64,')).toBe(true);
  expect(snap.faviconHref.length).toBeGreaterThan('data:image/svg+xml;base64,'.length);
});

test('buildAppIconSvg falls back to brand colours for malformed hex', () => {
  const svg = buildAppIconSvg({ primary: 'not-a-color', accent: 'bad', mode: 'standard' });
  expect(svg).toContain('stop-color="#00f0ff"');
  expect(svg).toContain('stop-color="#10b981"');
});

test('svgToDataUrl encodes deterministically when btoa is reachable', () => {
  const a = svgToDataUrl('<svg/>');
  const b = svgToDataUrl('<svg/>');
  expect(a).toBe(b);
  expect(a.startsWith('data:image/svg+xml;base64,')).toBe(true);
});

test('svgToDataUrl returns the empty data URL when no btoa exists', () => {
  const original = (globalThis as { btoa?: unknown }).btoa;
  // eslint-disable-next-line no-extra-semi
  (globalThis as { btoa?: unknown }).btoa = undefined;
  try {
    expect(svgToDataUrl('<svg/>')).toBe('data:image/svg+xml;base64,');
  } finally {
    (globalThis as { btoa?: unknown }).btoa = original;
  }
});

test('renderSvgToPngDataUrl resolves null on native (no canvas)', async () => {
  await expect(renderSvgToPngDataUrl('<svg/>', 180)).resolves.toBeNull();
  await expect(renderSvgToPngDataUrl('<svg/>', 512)).resolves.toBeNull();
});

test('dynamicAppIconNativeCapabilities marks every DOM layer unavailable', () => {
  expect(dynamicAppIconNativeCapabilities.favicon.available).toBe(false);
  expect(dynamicAppIconNativeCapabilities.themeColorMeta.available).toBe(false);
  expect(dynamicAppIconNativeCapabilities.appleTouchIcon.available).toBe(false);
  expect(dynamicAppIconNativeCapabilities.manifest.available).toBe(false);
  // The pure icon computation is the one thing that survives natively.
  expect(dynamicAppIconNativeCapabilities.iconComputation.available).toBe(true);
  expect(dynamicAppIconNativeCapabilities.favicon.reason).toContain('data-dynamic-app-icon');
});

test('buildDynamicAppIconManifest mirrors the web manifest shape', () => {
  const manifest = buildDynamicAppIconManifest('#e31937', {
    std192: 'data:image/png;base64,std192',
    std512: 'data:image/png;base64,std512',
    msk192: 'data:image/png;base64,msk192',
    msk512: 'data:image/png;base64,msk512',
  });
  expect(manifest.name).toBe('TeslaSync');
  expect(manifest.short_name).toBe('TeslaSync');
  expect(manifest.start_url).toBe('/');
  expect(manifest.display).toBe('standalone');
  expect(manifest.background_color).toBe('#0a0a0f');
  expect(manifest.theme_color).toBe('#e31937');
  expect(manifest.orientation).toBe('any');
  expect(manifest.categories).toEqual(['auto', 'utilities']);
  expect(manifest.icons).toHaveLength(4);
  expect(manifest.icons[0]).toEqual({
    src: 'data:image/png;base64,std192',
    sizes: '192x192',
    type: 'image/png',
    purpose: 'any',
  });
  expect(manifest.icons[3].purpose).toBe('maskable');
});
