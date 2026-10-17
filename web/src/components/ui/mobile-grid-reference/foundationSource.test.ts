import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs from web/. Resolve actual disk paths rather than Vite-rewritten module URLs.
const sourceDirectory = resolve(process.cwd(), 'src', 'components', 'ui', 'mobile-grid-reference');

describe('isolated source-level foundation checks (not layout evidence)', () => {
  it('scopes mobile geometry to a strict named container and adapts only its own Modal', () => {
    const css = readFileSync(resolve(sourceDirectory, 'mobile-grid-reference.css'), 'utf8');
    expect(css).toContain('container: mobile-grid-reference / inline-size');
    expect(css).toContain('@container mobile-grid-reference (width < 640px)');
    expect(css).toContain('.mgr-mobile { display: none; }');
    expect(css).toContain('.mgr-desktop { display: none; }');
    expect(css).toContain('.mgr-kv { height: 48px');
    expect(css).toContain('.mgr-progress { height: 5px; }');
    expect(css).toContain('--mgr-control-h: 40px');
    expect(css).toContain('--mgr-tap-min: 44px');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).not.toContain('.data-grid');
    expect(css).not.toContain('@media (max-width');
  });
  it('keeps all public renderer modules independent of fetch and serialization', () => {
    for (const file of ['MobileGridReference.tsx', 'MobileReferenceFooter.tsx', 'MobileReferenceDialogs.tsx', 'MobileReferenceToolbar.tsx']) {
      const source = readFileSync(resolve(sourceDirectory, file), 'utf8');
      expect(source).not.toMatch(/\bfetch\s*\(|downloadCSV|downloadJSON|request\s*</);
      expect(source).not.toMatch(/\buseState\s*\(/);
      expect(source).not.toMatch(/from ['"](?:recharts|react-leaflet|framer-motion)['"]/);
    }
  });
});
