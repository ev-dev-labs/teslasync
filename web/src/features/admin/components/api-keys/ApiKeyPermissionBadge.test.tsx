/**
 * ApiKeyPermissionBadge contract.
 *
 * The badge maps an API-key permission string onto a neon-tinted chip whose
 * saturated hue is confined to the background/ring while the label uses the
 * toned 300-level text from `neonColorMap` (never "neon body text"). Colour is
 * always paired with a distinct lucide icon so the permission level is not
 * conveyed by colour alone, and the icon is decorative (`aria-hidden`) so a
 * screen reader announces only the human-readable label.
 *
 * Coverage:
 *   1. Each known permission (read / read-write / admin) → correct label,
 *      icon glyph, and neon colour trio (bg + ring + text).
 *   2. Typography stays token-clean (text-2xs + font-semibold, no neon body).
 *   3. Unknown + empty permission strings fail *closed* to the least-privilege
 *      "Read" presentation rather than throwing or rendering "Admin".
 *   4. The optional `className` is appended without dropping the base chip
 *      classes, and a caller-supplied text colour wins (tailwind-merge).
 *   5. a11y: the icon is aria-hidden and the chip's accessible text is the label.
 *   6. The glyph is distinct per level, not merely recoloured.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Deterministic i18n: `t(key, fallback)` returns the English fallback so the
// visible-label assertions don't depend on translation-file contents. Mirrors
// the pattern used by the sibling QueueStatusPanel / UserImpersonateButton
// tests in this feature directory.
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { ApiKeyPermissionBadge } from './ApiKeyPermissionBadge';

function renderBadge(perm: string, className?: string) {
  const { container } = render(
    <ApiKeyPermissionBadge perm={perm} className={className} />,
  );
  const chip = container.querySelector('span');
  const svg = container.querySelector('svg');
  return { container, chip, svg };
}

describe('ApiKeyPermissionBadge', () => {
  it('renders the read permission with emerald text on a neon-green chip', () => {
    const { chip, svg } = renderBadge('read');
    expect(chip).not.toBeNull();
    expect(chip?.textContent?.trim()).toBe('Read');
    expect(chip?.className).toContain('bg-neon-green/10');
    expect(chip?.className).toContain('ring-neon-green/20');
    expect(chip?.className).toContain('text-emerald-300');
    // Plain Shield glyph for read-only access.
    expect(svg?.getAttribute('class') ?? '').toContain('lucide-shield');
  });

  it('renders the read-write permission with amber text on a neon-amber chip', () => {
    const { chip, svg } = renderBadge('read-write');
    expect(chip?.textContent?.trim()).toBe('Read-Write');
    expect(chip?.className).toContain('bg-neon-amber/10');
    expect(chip?.className).toContain('ring-neon-amber/20');
    expect(chip?.className).toContain('text-amber-300');
    // ShieldAlert — a different glyph from the plain Shield used for read.
    expect(svg?.getAttribute('class') ?? '').toContain('lucide-shield-alert');
  });

  it('renders the admin permission with purple text on a neon-purple chip', () => {
    const { chip, svg } = renderBadge('admin');
    expect(chip?.textContent?.trim()).toBe('Admin');
    expect(chip?.className).toContain('bg-neon-purple/10');
    expect(chip?.className).toContain('ring-neon-purple/20');
    expect(chip?.className).toContain('text-purple-300');
    expect(svg?.getAttribute('class') ?? '').toContain('lucide-crown');
  });

  it('keeps typography token-clean (2xs semibold, no neon body text)', () => {
    const { chip } = renderBadge('read');
    expect(chip).toHaveClass('text-2xs');
    expect(chip).toHaveClass('font-semibold');
    // Toned 300-level text only — never a raw `text-neon-*` body colour.
    expect(chip?.className ?? '').not.toMatch(/text-neon-/);
  });

  it('fails closed to the least-privilege Read chip for an unknown permission', () => {
    const { chip, svg } = renderBadge('super-admin');
    expect(chip?.textContent?.trim()).toBe('Read');
    expect(chip).not.toHaveTextContent('Admin');
    expect(chip?.className).toContain('text-emerald-300');
    expect(svg?.getAttribute('class') ?? '').toContain('lucide-shield');
  });

  it('fails closed to Read for an empty permission string without throwing', () => {
    expect(() => render(<ApiKeyPermissionBadge perm="" />)).not.toThrow();
    expect(screen.getByText('Read')).toBeInTheDocument();
  });

  it('appends a caller className while preserving the base chip classes', () => {
    const { chip } = renderBadge('read', 'ml-2 shrink-0');
    expect(chip).toHaveClass('ml-2');
    expect(chip).toHaveClass('shrink-0');
    expect(chip).toHaveClass('inline-flex');
    expect(chip).toHaveClass('rounded-full');
  });

  it('lets a caller-supplied text colour override the default via tailwind-merge', () => {
    const { chip } = renderBadge('read', 'text-rose-300');
    expect(chip?.className).toContain('text-rose-300');
    expect(chip?.className).not.toContain('text-emerald-300');
  });

  it('marks the icon decorative so the accessible name is just the label', () => {
    const { chip, svg } = renderBadge('admin');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg).toHaveClass('h-3', 'w-3');
    // Only the label text is exposed to assistive tech.
    expect(chip?.textContent?.trim()).toBe('Admin');
  });

  it('uses a distinct glyph per permission level, not just a recolour', () => {
    const glyph = (perm: string) =>
      render(<ApiKeyPermissionBadge perm={perm} />)
        .container.querySelector('svg')
        ?.getAttribute('class') ?? '';
    const read = glyph('read');
    const readWrite = glyph('read-write');
    const admin = glyph('admin');
    expect(read).not.toEqual(readWrite);
    expect(readWrite).not.toEqual(admin);
    expect(read).not.toEqual(admin);
  });

  it('renders as a single inline span chip containing one icon', () => {
    const { container } = render(<ApiKeyPermissionBadge perm="read" />);
    const spans = container.querySelectorAll('span');
    expect(spans).toHaveLength(1);
    expect(spans[0].tagName).toBe('SPAN');
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});
