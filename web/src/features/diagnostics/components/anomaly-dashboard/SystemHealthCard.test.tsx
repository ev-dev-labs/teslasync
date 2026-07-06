import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SystemHealthCard } from './SystemHealthCard';
import { healthSeverity } from './anomalyHelpers';

// t(key, fallback) → fallback, mirroring the repo's presentational-component
// test convention (see SourceLayerBadge / ScoreBadge). This keeps the render
// free of a real i18n instance while still exercising every t(...) call site;
// when a key has no default we fall back to the key so a leak is observable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

function renderCard(props: { category: string | null | undefined; status: string | null | undefined }) {
  // Wrap in <ul> so the rendered <li> resolves to an accessible `listitem`
  // role — matching how AnomalyDashboardPage mounts these rows.
  return render(
    <ul>
      <SystemHealthCard {...props} />
    </ul>,
  );
}

describe('SystemHealthCard', () => {
  it('renders the category glyph, label, and status badge for a normal battery row', () => {
    const { container } = renderCard({ category: 'battery', status: 'normal' });

    const item = screen.getByRole('listitem');
    expect(screen.getByText('battery')).toBeInTheDocument();
    expect(screen.getByText('normal')).toBeInTheDocument();
    // 'normal' → success (green) tone on the row container.
    expect(item.className).toContain('bg-emerald-500/10');
    expect(item.className).toContain('border-emerald-500/30');
    // Known category → its own lucide glyph, not the fallback shield.
    expect(container.querySelector('svg.lucide-battery')).not.toBeNull();
    expect(container.querySelector('svg.lucide-shield')).toBeNull();
  });

  it('maps the wire status "warning" to the warn (amber) tone', () => {
    const { container } = renderCard({ category: 'tires', status: 'warning' });

    const item = screen.getByRole('listitem');
    expect(item.className).toContain('bg-amber-500/10');
    expect(screen.getByText('warning')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-car')).not.toBeNull();
  });

  it('maps the wire status "critical" to the critical (red) tone', () => {
    const { container } = renderCard({ category: 'motors', status: 'critical' });

    const item = screen.getByRole('listitem');
    expect(item.className).toContain('bg-red-500/10');
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-zap')).not.toBeNull();
  });

  it('renders an "info" status as a neutral info tone, NOT a misleading green success', () => {
    // Regression guard: the backend can emit "info" for a category whose worst
    // anomaly is info-severity (severityOrder info=2 < normal=3), so this path
    // is real — it must read as neutral, never as an all-clear green success.
    const { container } = renderCard({ category: 'hvac', status: 'info' });

    const item = screen.getByRole('listitem');
    expect(item.className).toContain('bg-sky-500/10');
    expect(item.className).not.toContain('bg-emerald-500/10');
    expect(screen.getByText('info')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-wind')).not.toBeNull();
  });

  it('falls back to the shield glyph for an unknown category while still showing its label', () => {
    const { container } = renderCard({ category: 'frunk', status: 'normal' });

    expect(container.querySelector('svg.lucide-shield')).not.toBeNull();
    expect(container.querySelector('svg.lucide-battery')).toBeNull();
    expect(screen.getByText('frunk')).toBeInTheDocument();
  });

  it('handles a null status without leaking an i18n key and stays neutral (not green)', () => {
    const { container } = renderCard({ category: 'charging', status: null });

    const item = screen.getByRole('listitem');
    expect(item.className).toContain('bg-sky-500/10');
    expect(item.className).not.toContain('bg-emerald-500/10');
    // Status label falls back to a friendly 'Unknown' — never 'anomaly.status.'.
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText(/anomaly\.status/)).toBeNull();
    expect(container.querySelector('svg.lucide-activity')).not.toBeNull();
  });

  it('handles a null/undefined category with the shield glyph and an Unknown label', () => {
    const { container } = renderCard({ category: undefined, status: 'critical' });

    expect(container.querySelector('svg.lucide-shield')).not.toBeNull();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText(/anomaly\.category/)).toBeNull();
    // The (valid) status is still respected.
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(screen.getByRole('listitem').className).toContain('bg-red-500/10');
  });

  it('exposes the full category name via a title attribute on the truncated label', () => {
    renderCard({ category: 'battery', status: 'normal' });

    const label = screen.getByText('battery');
    expect(label).toHaveAttribute('title', 'battery');
    expect(label.className).toContain('truncate');
  });

  it('marks decorative glyphs aria-hidden so screen readers announce text only', () => {
    const { container } = renderCard({ category: 'battery', status: 'warning' });

    // One glyph for the category icon, one for the SeverityBadge icon.
    const hidden = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(hidden.length).toBeGreaterThanOrEqual(2);
  });

  describe('healthSeverity', () => {
    it.each([
      ['critical', 'critical'],
      ['warning', 'warn'],
      ['normal', 'success'],
    ] as const)('maps the known status %s → %s', (status, expected) => {
      expect(healthSeverity(status)).toBe(expected);
    });

    it.each(['info', 'degraded', '', 'ok', 'unknown-future-state'])(
      'maps the unrecognized status %p to neutral info (never success)',
      (status) => {
        expect(healthSeverity(status)).toBe('info');
      },
    );

    it.each([null, undefined])('is null-safe for %p and returns info', (status) => {
      expect(healthSeverity(status)).toBe('info');
    });
  });
});
