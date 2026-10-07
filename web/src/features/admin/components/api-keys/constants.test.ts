import { describe, it, expect } from 'vitest';
import { Shield, ShieldAlert, Crown, Key } from 'lucide-react';
import { neonColorMap } from '@/lib/tokens';
import {
  PERMISSION_META,
  FALLBACK_PERMISSION_META,
  PERMISSION_ORDER,
  KEY_ICON,
  permissionMeta,
  type ApiKeyPermission,
  type PermissionMeta,
} from './constants';

// The three canonical permission levels the backend emits for an APIKey.
const KNOWN_PERMISSIONS: ApiKeyPermission[] = ['read', 'read-write', 'admin'];

/**
 * Runtime shape guard proving a value is a real, renderable PermissionMeta —
 * i.e. NOT an inherited Object.prototype member (Function/Object) leaking
 * through the lookup. Mirrors the `isVisual` guard in activityIcons.test.ts.
 */
function assertRenderable(meta: PermissionMeta): void {
  expect(meta).toBeTruthy();
  // A lucide icon is an exotic object (forwardRef) or a function — never undefined.
  expect(meta.icon).toBeDefined();
  expect(['object', 'function']).toContain(typeof meta.icon);
  // The chip colour MUST resolve through neonColorMap or the badge throws.
  expect(Object.prototype.hasOwnProperty.call(neonColorMap, meta.color)).toBe(true);
  expect(meta.barColor).toMatch(/^#[0-9a-f]{6}$/i);
  expect(meta.labelFallback.length).toBeGreaterThan(0);
  expect(meta.descFallback.length).toBeGreaterThan(0);
}

describe('PERMISSION_META', () => {
  it('exposes exactly the three canonical permission levels', () => {
    expect(Object.keys(PERMISSION_META)).toEqual(['read', 'read-write', 'admin']);
  });

  it('maps read → green Shield with read-only copy', () => {
    const m = PERMISSION_META.read;
    expect(m.icon).toBe(Shield);
    expect(m.color).toBe('green');
    expect(m.barColor).toBe('#10b981');
    expect(m.labelKey).toBe('apiKeys.perm.read');
    expect(m.labelFallback).toBe('Read');
    expect(m.descKey).toBe('apiKeys.perm.readDesc');
    expect(m.descFallback).toContain('Read-only');
  });

  it('maps read-write → amber ShieldAlert with command copy', () => {
    const m = PERMISSION_META['read-write'];
    expect(m.icon).toBe(ShieldAlert);
    expect(m.color).toBe('amber');
    expect(m.barColor).toBe('#f59e0b');
    expect(m.labelKey).toBe('apiKeys.perm.readWrite');
    expect(m.labelFallback).toBe('Read-Write');
    expect(m.descKey).toBe('apiKeys.perm.readWriteDesc');
    expect(m.descFallback).toContain('command');
  });

  it('maps admin → purple Crown with full-access copy', () => {
    const m = PERMISSION_META.admin;
    expect(m.icon).toBe(Crown);
    expect(m.color).toBe('purple');
    expect(m.barColor).toBe('#a855f7');
    expect(m.labelKey).toBe('apiKeys.perm.admin');
    expect(m.labelFallback).toBe('Admin');
    expect(m.descKey).toBe('apiKeys.perm.adminDesc');
    expect(m.descFallback).toContain('administrative');
  });

  it('assigns a distinct icon + neon colour to every level (status is never colour-alone)', () => {
    const icons = KNOWN_PERMISSIONS.map((p) => PERMISSION_META[p].icon);
    const colors = KNOWN_PERMISSIONS.map((p) => PERMISSION_META[p].color);
    expect(new Set(icons).size).toBe(KNOWN_PERMISSIONS.length);
    expect(new Set(colors).size).toBe(KNOWN_PERMISSIONS.length);
  });

  it('every entry is a valid, renderable meta (colour resolves through neonColorMap)', () => {
    for (const perm of KNOWN_PERMISSIONS) {
      assertRenderable(PERMISSION_META[perm]);
    }
  });

  it('every entry carries namespaced i18n keys with non-empty fallbacks', () => {
    for (const perm of KNOWN_PERMISSIONS) {
      const m = PERMISSION_META[perm];
      expect(m.labelKey.startsWith('apiKeys.perm.')).toBe(true);
      expect(m.descKey.startsWith('apiKeys.perm.')).toBe(true);
      expect(m.descKey.endsWith('Desc')).toBe(true);
      expect(m.labelFallback.trim()).not.toBe('');
      expect(m.descFallback.trim()).not.toBe('');
    }
  });
});

describe('FALLBACK_PERMISSION_META', () => {
  it('is the read metadata — the least-privileged safe default', () => {
    expect(FALLBACK_PERMISSION_META).toBe(PERMISSION_META.read);
    expect(FALLBACK_PERMISSION_META.color).toBe('green');
  });

  it('is itself a fully renderable meta', () => {
    assertRenderable(FALLBACK_PERMISSION_META);
  });
});

describe('PERMISSION_ORDER', () => {
  it('lists all levels least→most privileged (read → read-write → admin)', () => {
    expect(PERMISSION_ORDER).toEqual(['read', 'read-write', 'admin']);
  });

  it('covers exactly the keys of PERMISSION_META with no duplicates', () => {
    expect([...PERMISSION_ORDER].sort()).toEqual(Object.keys(PERMISSION_META).sort());
    expect(new Set(PERMISSION_ORDER).size).toBe(PERMISSION_ORDER.length);
  });

  it('only references keys that exist in PERMISSION_META', () => {
    for (const perm of PERMISSION_ORDER) {
      expect(Object.prototype.hasOwnProperty.call(PERMISSION_META, perm)).toBe(true);
    }
  });
});

describe('KEY_ICON', () => {
  it('is the lucide Key glyph', () => {
    expect(KEY_ICON).toBe(Key);
  });

  it('is a defined, renderable component reference', () => {
    expect(KEY_ICON).toBeDefined();
    expect(['object', 'function']).toContain(typeof KEY_ICON);
  });
});

describe('permissionMeta — known levels', () => {
  it('returns the exact same meta object for each known permission (no cloning)', () => {
    expect(permissionMeta('read')).toBe(PERMISSION_META.read);
    expect(permissionMeta('read-write')).toBe(PERMISSION_META['read-write']);
    expect(permissionMeta('admin')).toBe(PERMISSION_META.admin);
  });

  it('is a pure read — repeated calls return a stable reference', () => {
    expect(permissionMeta('admin')).toBe(permissionMeta('admin'));
  });
});

describe('permissionMeta — unrecognised strings fall back safely', () => {
  it.each(['superuser', 'READ', 'Read', 'write', 'read_write', 'owner', ' read '])(
    'resolves unknown "%s" to the fallback meta',
    (perm) => {
      expect(permissionMeta(perm)).toBe(FALLBACK_PERMISSION_META);
    },
  );

  it('resolves the empty string to the fallback meta', () => {
    expect(permissionMeta('')).toBe(FALLBACK_PERMISSION_META);
  });

  it('always yields a renderable meta even for garbage input', () => {
    const m = permissionMeta('definitely-not-a-permission');
    expect(m).toBe(FALLBACK_PERMISSION_META);
    assertRenderable(m);
  });
});

describe('permissionMeta — inherited Object.prototype keys never leak (regression)', () => {
  // A plain object literal inherits constructor/toString/hasOwnProperty/…. A
  // naive `PERMISSION_META[perm] ?? FALLBACK` would return those inherited
  // members as if they were PermissionMeta, and <ApiKeyPermissionBadge>
  // reading `.icon`/`.color` off a Function would render `<undefined />` and
  // crash on `neonColorMap[undefined]`. All of these MUST hit the fallback.
  const inherited = [
    'constructor',
    'toString',
    'hasOwnProperty',
    'valueOf',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    '__proto__',
  ];

  it.each(inherited)('resolves inherited "%s" to the safe fallback, not a prototype member', (key) => {
    const m = permissionMeta(key);
    expect(m).toBe(FALLBACK_PERMISSION_META);
    expect(typeof m.icon).not.toBe('undefined');
    assertRenderable(m);
  });

  it('never returns the Object constructor for perm="constructor"', () => {
    const m = permissionMeta('constructor');
    expect(m).not.toBe(Object);
    expect(m).toBe(FALLBACK_PERMISSION_META);
    expect(m.icon).toBe(Shield);
  });

  it('does not treat "toString" as a real permission', () => {
    const m = permissionMeta('toString');
    expect(typeof m.icon).not.toBe('function');
    expect(m.color).toBe('green');
  });
});

describe('permissionMeta — purity / no mutation', () => {
  it('does not mutate PERMISSION_META on unknown lookups', () => {
    const before = JSON.stringify(Object.keys(PERMISSION_META));
    permissionMeta('constructor');
    permissionMeta('__proto__');
    permissionMeta('whatever');
    expect(JSON.stringify(Object.keys(PERMISSION_META))).toBe(before);
    expect(Object.keys(PERMISSION_META)).toEqual(['read', 'read-write', 'admin']);
  });
});
