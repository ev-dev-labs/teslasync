/**
 * HealthOverview — the drivetrain-health page hero (alert banner + status panel).
 *
 * HealthOverview is a prop-driven presentational component with a single export.
 * It composes two responsibilities: an optional above-panel AlertBanner (shown
 * only for a degraded, fully-resolved query) and a GlassPanel that switches
 * between four mutually-exclusive states — loading (Skeleton), error
 * (QueryError), empty (EmptyState), and the populated status row. This suite
 * pins the behaviours that would silently regress and the two hardening fixes
 * this pass introduced — never a smoke render, never real network:
 *
 *   1. Query states — loading shows the Skeleton (and suppresses the panel body
 *      + alert + glow); a resolved error shows QueryError (resource name + the
 *      Error message) and its Retry calls back through `onRetry`; a resolved
 *      no-data state shows the EmptyState. Loading takes precedence over a
 *      simultaneous error (the `loading ? … : error ? …` ladder).
 *   2. Populated — good / warning / critical each bind the right status icon
 *      (CheckCircle vs AlertTriangle), section title, badge variant/size/dot,
 *      glow token (green/cyan/purple via HEALTH_GLOW), toned accent class
 *      (emerald/amber/rose-300), and the animated score + "%" suffix.
 *   3. Alert — warning/critical surface the AlertBanner with the matching
 *      variant (warning/danger via getAlertVariant), title, and body copy; the
 *      "good" status shows NO alert.
 *   4. Alert suppression — the banner never shows while loading, on error, or
 *      when there is no data, even for a non-good status (the `hasData &&
 *      !loading && !error` guard).
 *   5. Hardening — an empty / whitespace-only `motorStatus` (the parent passes
 *      `?? ''`) falls back to the "—" placeholder instead of a dangling
 *      "Motor State:" label; a non-finite `healthScore` renders 0, not "NaN%".
 *   6. a11y — every status / alert icon is decorative (aria-hidden) and status
 *      is carried by text (title + badge), never colour alone.
 *
 * Per the directory convention (see DriveDetailHeader.test.tsx /
 * WhyEndedPanel.test.tsx): react-i18next is stubbed to echo the English
 * fallback so asserted copy is decoupled from the locale bundle; the shared
 * barrels (@/components/ui, data-display, feedback, motion) and the lucide
 * icons are doubled with light components that surface their key props as DOM
 * so the composition contract is observable without the real animation /
 * tabular-number machinery. The pure ./helpers + ./constants render for real so
 * the variant/glow mapping is exercised end-to-end. user-event is not installed
 * in this repo, so the single interaction (Retry) goes through fireEvent.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { HealthStatus } from './constants';

// ── i18n: echo the English fallback (2nd arg) so assertions read real copy. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// ── Flatten the entry animation — framer-motion is irrelevant here. ──
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children?: ReactNode }) => <div data-testid="fade-in">{children}</div>,
}));

// ── lucide icons: surface which glyph + its decorative attrs so the
//    good→check / degraded→triangle branch is deterministically assertable. ──
vi.mock('lucide-react', () => ({
  CheckCircle: (props: Record<string, unknown>) => <svg data-testid="icon-check" {...props} />,
  AlertTriangle: (props: Record<string, unknown>) => <svg data-testid="icon-alert" {...props} />,
}));

// ── Shared UI barrel doubles — surface props as testable DOM. ──
vi.mock('@/components/ui', () => ({
  GlassPanel: ({ children, glow, className }: any) => (
    <section data-testid="glass-panel" data-glow={glow} className={className}>
      {children}
    </section>
  ),
  Badge: ({ children, variant, size, dot }: any) => (
    <span
      data-testid="badge"
      data-variant={variant}
      data-size={size}
      data-dot={dot ? 'true' : 'false'}
    >
      {children}
    </span>
  ),
  SectionTitle: ({ children }: any) => <h2 data-testid="section-title">{children}</h2>,
  Text: ({ children, as }: any) => {
    const Tag: any = as ?? 'span';
    return <Tag data-testid="motor-state">{children}</Tag>;
  },
  MetricValue: ({ children, className }: any) => (
    <div data-testid="metric-value" className={className}>
      {children}
    </div>
  ),
}));

vi.mock('@/components/data-display', () => ({
  AnimatedNumber: ({ value, suffix }: any) => (
    <span data-testid="animated-number" data-value={String(value)}>
      {String(value)}
      {suffix ?? ''}
    </span>
  ),
}));

vi.mock('@/components/feedback', () => ({
  AlertBanner: ({ children, variant, title, icon }: any) => (
    <div role="alert" data-testid="alert-banner" data-variant={variant}>
      {icon}
      <div data-testid="alert-title">{title}</div>
      <div data-testid="alert-body">{children}</div>
    </div>
  ),
  Skeleton: ({ height }: any) => <div data-testid="skeleton" data-height={String(height)} />,
  EmptyState: ({ message }: any) => <div data-testid="empty-state">{message}</div>,
  QueryError: ({ error, onRetry, resourceName }: any) => (
    <div data-testid="query-error" data-resource={resourceName}>
      <span data-testid="query-error-msg">
        {error instanceof Error ? error.message : String(error)}
      </span>
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  ),
}));

import { HealthOverview } from './HealthOverview';

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface Props {
  overallHealth: HealthStatus;
  healthScore: number;
  motorStatus: string;
  hasData: boolean;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    overallHealth: 'good',
    healthScore: 95,
    motorStatus: 'Idle',
    hasData: true,
    loading: false,
    error: undefined,
    onRetry: vi.fn(),
    ...overrides,
  };
}

const panel = () => screen.getByTestId('glass-panel');
const statusIcon = () =>
  within(panel()).queryByTestId('icon-check') ?? within(panel()).queryByTestId('icon-alert');

// ── 1. Query states ──────────────────────────────────────────────────────────

describe('HealthOverview — query states', () => {
  it('renders the Skeleton (and nothing else) while loading', () => {
    render(<HealthOverview {...makeProps({ loading: true, overallHealth: 'critical' })} />);

    const skeleton = within(panel()).getByTestId('skeleton');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute('data-height', '72');
    // No body, no alert, glow suppressed to 'none' — even for a degraded status.
    expect(screen.queryByTestId('section-title')).toBeNull();
    expect(screen.queryByTestId('alert-banner')).toBeNull();
    expect(panel()).toHaveAttribute('data-glow', 'none');
  });

  it('loading takes precedence over a simultaneous error', () => {
    render(
      <HealthOverview {...makeProps({ loading: true, error: new Error('db down') })} />,
    );

    expect(within(panel()).getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('query-error')).toBeNull();
  });

  it('surfaces QueryError (resource + message) and retries via onRetry', () => {
    const onRetry = vi.fn();
    render(
      <HealthOverview
        {...makeProps({ error: new Error('boom'), onRetry, hasData: true })}
      />,
    );

    const qe = screen.getByTestId('query-error');
    expect(qe).toHaveAttribute('data-resource', 'Drivetrain Health');
    expect(screen.getByTestId('query-error-msg')).toHaveTextContent('boom');
    // Error wins over stale data + suppresses the alert / glow.
    expect(screen.queryByTestId('section-title')).toBeNull();
    expect(screen.queryByTestId('alert-banner')).toBeNull();
    expect(panel()).toHaveAttribute('data-glow', 'none');

    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the EmptyState when there is no data', () => {
    render(<HealthOverview {...makeProps({ hasData: false })} />);

    expect(screen.getByTestId('empty-state')).toHaveTextContent(
      'No drivetrain health data available yet',
    );
    expect(screen.queryByTestId('section-title')).toBeNull();
    expect(screen.queryByTestId('skeleton')).toBeNull();
    expect(panel()).toHaveAttribute('data-glow', 'none');
  });
});

// ── 2. Populated — per-status binding ────────────────────────────────────────

describe('HealthOverview — populated (good)', () => {
  it('binds the healthy icon, title, badge, glow, accent, and score', () => {
    render(<HealthOverview {...makeProps({ overallHealth: 'good', healthScore: 95 })} />);

    // Healthy → CheckCircle, no alert, green glow.
    expect(within(panel()).getByTestId('icon-check')).toBeInTheDocument();
    expect(within(panel()).queryByTestId('icon-alert')).toBeNull();
    expect(screen.queryByTestId('alert-banner')).toBeNull();
    expect(panel()).toHaveAttribute('data-glow', 'green');

    expect(screen.getByTestId('section-title')).toHaveTextContent('Drivetrain Healthy');

    const badge = screen.getByTestId('badge');
    expect(badge).toHaveAttribute('data-variant', 'success');
    expect(badge).toHaveAttribute('data-size', 'lg');
    expect(badge).toHaveAttribute('data-dot', 'true');
    expect(badge).toHaveTextContent('GOOD');

    const score = screen.getByTestId('animated-number');
    expect(score).toHaveAttribute('data-value', '95');
    expect(score).toHaveTextContent('95%');

    // Toned accent paired with the metric — never a raw neon / text-white.
    expect(screen.getByTestId('metric-value')).toHaveClass('text-emerald-300');
  });
});

describe('HealthOverview — populated (warning)', () => {
  it('binds the warm icon, title, badge, cyan glow, and amber accent', () => {
    render(<HealthOverview {...makeProps({ overallHealth: 'warning', healthScore: 60 })} />);

    // Degraded → AlertTriangle in the panel body (not CheckCircle).
    expect(within(panel()).getByTestId('icon-alert')).toBeInTheDocument();
    expect(within(panel()).queryByTestId('icon-check')).toBeNull();
    expect(panel()).toHaveAttribute('data-glow', 'cyan');

    expect(screen.getByTestId('section-title')).toHaveTextContent('Drivetrain Running Warm');
    expect(screen.getByTestId('badge')).toHaveAttribute('data-variant', 'warning');
    expect(screen.getByTestId('metric-value')).toHaveClass('text-amber-300');
    expect(screen.getByTestId('animated-number')).toHaveAttribute('data-value', '60');
  });

  it('surfaces the warning AlertBanner above the panel', () => {
    render(<HealthOverview {...makeProps({ overallHealth: 'warning' })} />);

    const alert = screen.getByTestId('alert-banner');
    expect(alert).toHaveAttribute('data-variant', 'warning');
    expect(within(alert).getByTestId('alert-title')).toHaveTextContent(
      'Elevated Temperatures Detected',
    );
    expect(within(alert).getByTestId('alert-body')).toHaveTextContent(
      'above normal operating range',
    );
  });
});

describe('HealthOverview — populated (critical)', () => {
  it('binds the overheating title, danger badge, purple glow, and rose accent', () => {
    render(<HealthOverview {...makeProps({ overallHealth: 'critical', healthScore: 25 })} />);

    expect(panel()).toHaveAttribute('data-glow', 'purple');
    expect(screen.getByTestId('section-title')).toHaveTextContent('Drivetrain Overheating');
    expect(screen.getByTestId('badge')).toHaveAttribute('data-variant', 'danger');
    expect(screen.getByTestId('metric-value')).toHaveClass('text-rose-300');
  });

  it('surfaces the critical AlertBanner with danger variant + copy', () => {
    render(<HealthOverview {...makeProps({ overallHealth: 'critical' })} />);

    const alert = screen.getByTestId('alert-banner');
    expect(alert).toHaveAttribute('data-variant', 'danger');
    expect(within(alert).getByTestId('alert-title')).toHaveTextContent(
      'Critical Temperature Warning',
    );
    expect(within(alert).getByTestId('alert-body')).toHaveTextContent(
      'critically high temperatures',
    );
  });
});

// ── 3. Alert suppression (the hasData && !loading && !error guard) ────────────

describe('HealthOverview — alert suppression', () => {
  it('hides the alert while loading, even for a critical status', () => {
    render(<HealthOverview {...makeProps({ overallHealth: 'critical', loading: true })} />);
    expect(screen.queryByTestId('alert-banner')).toBeNull();
    expect(within(panel()).getByTestId('skeleton')).toBeInTheDocument();
  });

  it('hides the alert on error, even for a warning status', () => {
    render(
      <HealthOverview
        {...makeProps({ overallHealth: 'warning', error: new Error('x') })}
      />,
    );
    expect(screen.queryByTestId('alert-banner')).toBeNull();
    expect(screen.getByTestId('query-error')).toBeInTheDocument();
  });

  it('hides the alert when there is no data, even for a critical status', () => {
    render(<HealthOverview {...makeProps({ overallHealth: 'critical', hasData: false })} />);
    expect(screen.queryByTestId('alert-banner')).toBeNull();
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });
});

// ── 4. Hardening — motorStatus placeholder + non-finite score ────────────────

describe('HealthOverview — hardening', () => {
  it('shows the motor status when present', () => {
    render(<HealthOverview {...makeProps({ motorStatus: 'Driving' })} />);
    expect(screen.getByTestId('motor-state')).toHaveTextContent('Motor State: Driving');
  });

  it('falls back to "—" for an empty motor status (no dangling label)', () => {
    render(<HealthOverview {...makeProps({ motorStatus: '' })} />);

    const line = screen.getByTestId('motor-state');
    expect(line).toHaveTextContent('Motor State: —');
    // The label must never dangle with a bare trailing colon.
    expect(line.textContent?.endsWith(': ')).toBe(false);
  });

  it('falls back to "—" for a whitespace-only motor status', () => {
    render(<HealthOverview {...makeProps({ motorStatus: '   ' })} />);
    expect(screen.getByTestId('motor-state')).toHaveTextContent('Motor State: —');
  });

  it('renders a non-finite health score as 0, not "NaN%"', () => {
    render(<HealthOverview {...makeProps({ healthScore: Number.NaN })} />);

    const score = screen.getByTestId('animated-number');
    expect(score).toHaveAttribute('data-value', '0');
    expect(score.textContent).not.toContain('NaN');
    expect(score).toHaveTextContent('0%');
  });
});

// ── 5. Accessibility ─────────────────────────────────────────────────────────

describe('HealthOverview — a11y', () => {
  it('marks the healthy status icon decorative (aria-hidden)', () => {
    render(<HealthOverview {...makeProps({ overallHealth: 'good' })} />);
    expect(statusIcon()).toHaveAttribute('aria-hidden', 'true');
  });

  it('marks both the alert and status icons decorative and conveys status via text', () => {
    render(<HealthOverview {...makeProps({ overallHealth: 'critical' })} />);

    // Status is carried by title + badge text, not colour alone.
    expect(screen.getByTestId('section-title')).toHaveTextContent('Drivetrain Overheating');
    expect(screen.getByTestId('badge')).toHaveTextContent('CRITICAL');

    // The alert's own icon is decorative...
    const alert = screen.getByTestId('alert-banner');
    expect(within(alert).getByTestId('icon-alert')).toHaveAttribute('aria-hidden', 'true');
    // ...and so is the panel's status icon.
    expect(statusIcon()).toHaveAttribute('aria-hidden', 'true');
  });
});
