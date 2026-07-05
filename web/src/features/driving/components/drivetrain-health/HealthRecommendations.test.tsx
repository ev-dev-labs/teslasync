/**
 * HealthRecommendations — behaviour, branch, count, and a11y coverage for the
 * file's sole export.
 *
 * The component is a pure derivation: given the drivetrain's `overallHealth`
 * status it assembles a prioritised tip list and renders each row with a colour
 * treatment + status icon. There is no data source, so the surface under test is
 * the branch table and the way priority is communicated:
 *
 *   1. STATUS BRANCHES — `good` yields the four general (low) tips; `warning`
 *      prepends the three medium mitigations; `critical` additionally prepends
 *      the two high-urgency tips AND inherits the warning mitigations
 *      (2 + 3 + 4 = 9). The row counts and specific copy are asserted per branch.
 *   2. PRIORITY A11Y (the hardening this pass adds) — priority was previously
 *      conveyed only by the row colour and an aria-hidden icon (WCAG 1.4.1). The
 *      component now emits a VisuallyHidden "Urgent"/"Important" cue so screen-
 *      reader users perceive urgency; the visible colour classes stay in place.
 *   3. ICON SEMANTICS — every status/decorative icon is aria-hidden, so the
 *      announced content is text-only.
 *   4. i18n — the panel title, tip copy, and priority cues all resolve through
 *      translation keys with English fallbacks (the spy pins the contract).
 *   5. RESILIENCE — the tip set re-derives when the prop changes, and an
 *      unexpected status value degrades to the general tips without crashing.
 *
 * Strategy: the component takes a single prop and touches no network, so a bare
 * render() suffices. `react-i18next` is mocked so `t(key, fallback)` renders the
 * English fallback deterministically while a spy records (key, fallback) pairs.
 * A matchMedia stub is installed before any module evaluates because FadeIn /
 * StaggerContainer → useMotionPreference → framer-motion's useReducedMotion
 * reaches for it under jsdom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// jsdom lacks matchMedia; the motion wrappers read it at render for the
// reduced-motion preference. Install a benign stub before anything evaluates.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// i18n → return the developer fallback so labels read as real English; the spy
// records the (key, fallback) pairs so the i18n contract can be asserted.
const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}));
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({ t: tSpy, i18n: { language: 'en', changeLanguage: vi.fn() } }),
  };
});

import { HealthRecommendations } from './HealthRecommendations';
import type { HealthStatus } from './constants';

/** English fallbacks mirrored from the component so assertions read literally. */
const TIP = {
  criticalStop:
    'Temperatures are critically high. Consider pulling over safely and letting the vehicle cool down.',
  serviceUrgent:
    'Schedule an urgent service appointment. Critical temperatures may indicate a coolant system issue.',
  reduceLoad:
    'Reduce driving intensity and avoid hard acceleration to allow components to cool.',
  checkCoolant:
    'Schedule a service appointment to inspect the coolant system and fluid levels.',
  avoidSupercharging:
    'Avoid Supercharging while temperatures are elevated. Use Level 2 charging instead.',
  regularService:
    'Keep up with regular service intervals for optimal drivetrain health and longevity.',
  gentleAccel:
    'Gentle acceleration helps maintain lower motor temperatures and extends component life.',
  precondition:
    'Precondition the battery in cold weather for better thermal performance and driving efficiency.',
  monitorTemps:
    'Monitor drivetrain temperatures after spirited driving sessions or long highway stretches.',
} as const;

const URGENT = 'Urgent recommendation:';
const IMPORTANT = 'Important recommendation:';

function renderRecs(overallHealth: HealthStatus) {
  return render(<HealthRecommendations overallHealth={overallHealth} />);
}

/** Each tip renders exactly one `<p>` (the title is an <h3>) → a stable count. */
function tipCount(container: HTMLElement): number {
  return container.querySelectorAll('p').length;
}

/** Rows carrying a given border-colour token (high = red, medium = amber). */
function coloredRows(container: HTMLElement, token: string): number {
  return container.querySelectorAll(`[class*="${token}"]`).length;
}

beforeEach(() => {
  tSpy.mockClear();
});

describe('HealthRecommendations — panel chrome + icon a11y', () => {
  it('renders the panel title as a level-3 heading resolved through i18n', () => {
    renderRecs('good');

    expect(
      screen.getByRole('heading', { level: 3, name: 'Health Recommendations' }),
    ).toBeInTheDocument();
    expect(tSpy).toHaveBeenCalledWith('drivetrain.recommendations', 'Health Recommendations');
  });

  it('marks every status icon as decorative so only the text is announced', () => {
    const { container } = renderRecs('critical');

    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'));
  });
});

describe('HealthRecommendations — good status', () => {
  it('shows only the four general low-priority tips', () => {
    const { container } = renderRecs('good');

    expect(tipCount(container)).toBe(4);
    expect(screen.getByText(TIP.regularService)).toBeInTheDocument();
    expect(screen.getByText(TIP.gentleAccel)).toBeInTheDocument();
    expect(screen.getByText(TIP.precondition)).toBeInTheDocument();
    expect(screen.getByText(TIP.monitorTemps)).toBeInTheDocument();
  });

  it('omits every warning/critical tip and any urgency cue when healthy', () => {
    const { container } = renderRecs('good');

    expect(screen.queryByText(TIP.criticalStop)).toBeNull();
    expect(screen.queryByText(TIP.reduceLoad)).toBeNull();
    expect(screen.queryByText(URGENT)).toBeNull();
    expect(screen.queryByText(IMPORTANT)).toBeNull();
    // No colour-coded urgency rows for a healthy drivetrain.
    expect(coloredRows(container, 'border-neon-red')).toBe(0);
    expect(coloredRows(container, 'border-neon-amber')).toBe(0);
  });
});

describe('HealthRecommendations — warning status', () => {
  it('prepends the three medium mitigation tips above the general tips', () => {
    const { container } = renderRecs('warning');

    expect(tipCount(container)).toBe(7);
    expect(screen.getByText(TIP.reduceLoad)).toBeInTheDocument();
    expect(screen.getByText(TIP.checkCoolant)).toBeInTheDocument();
    expect(screen.getByText(TIP.avoidSupercharging)).toBeInTheDocument();
  });

  it('does not escalate to the critical high-priority tips', () => {
    renderRecs('warning');

    expect(screen.queryByText(TIP.criticalStop)).toBeNull();
    expect(screen.queryByText(TIP.serviceUrgent)).toBeNull();
    expect(screen.queryByText(URGENT)).toBeNull();
  });

  it('gives each medium tip an "Important" SR cue and an amber row (no red)', () => {
    const { container } = renderRecs('warning');

    expect(screen.getAllByText(IMPORTANT)).toHaveLength(3);
    expect(coloredRows(container, 'border-neon-amber')).toBe(3);
    expect(coloredRows(container, 'border-neon-red')).toBe(0);
    expect(tSpy).toHaveBeenCalledWith(
      'drivetrain.priority.important',
      'Important recommendation:',
    );
  });
});

describe('HealthRecommendations — critical status', () => {
  it('stacks the two high, three medium, and four general tips (2+3+4)', () => {
    const { container } = renderRecs('critical');

    expect(tipCount(container)).toBe(9);
    expect(screen.getByText(TIP.criticalStop)).toBeInTheDocument();
    expect(screen.getByText(TIP.serviceUrgent)).toBeInTheDocument();
    // critical inherits the warning mitigations too.
    expect(screen.getByText(TIP.reduceLoad)).toBeInTheDocument();
    expect(screen.getByText(TIP.regularService)).toBeInTheDocument();
  });

  it('flags the two critical tips as urgent for assistive tech and paints them red', () => {
    const { container } = renderRecs('critical');

    expect(screen.getAllByText(URGENT)).toHaveLength(2);
    expect(screen.getAllByText(IMPORTANT)).toHaveLength(3);
    expect(coloredRows(container, 'border-neon-red')).toBe(2);
    expect(coloredRows(container, 'border-neon-amber')).toBe(3);
  });

  it('resolves the critical tip copy and urgent cue through their i18n keys', () => {
    renderRecs('critical');

    expect(tSpy).toHaveBeenCalledWith('drivetrain.tips.criticalStop', TIP.criticalStop);
    expect(tSpy).toHaveBeenCalledWith('drivetrain.tips.serviceUrgent', TIP.serviceUrgent);
    expect(tSpy).toHaveBeenCalledWith('drivetrain.priority.urgent', 'Urgent recommendation:');
  });
});

describe('HealthRecommendations — re-derivation + resilience', () => {
  it('re-derives the tip set when the status prop changes', () => {
    const { container, rerender } = renderRecs('good');

    expect(tipCount(container)).toBe(4);
    expect(screen.queryByText(TIP.criticalStop)).toBeNull();

    rerender(<HealthRecommendations overallHealth="critical" />);

    expect(tipCount(container)).toBe(9);
    expect(screen.getByText(TIP.criticalStop)).toBeInTheDocument();
    expect(screen.getAllByText(URGENT)).toHaveLength(2);
  });

  it('degrades to the general tips for an unexpected status value without crashing', () => {
    const { container } = render(
      <HealthRecommendations overallHealth={'unknown' as unknown as HealthStatus} />,
    );

    expect(tipCount(container)).toBe(4);
    expect(screen.getByText(TIP.regularService)).toBeInTheDocument();
    expect(screen.queryByText(URGENT)).toBeNull();
    expect(screen.queryByText(IMPORTANT)).toBeNull();
  });
});
