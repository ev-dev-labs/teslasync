/**
 * NotificationSoundChannelRow — full behavioural coverage.
 *
 * The row is a leaf presentational control: a labelled switch (per-channel
 * on/off) beside a "Test" button that plays the cue on demand. Every facet is
 * pinned here:
 *   • both controls render with the correct, accessible names derived from
 *     `label` — the switch takes its name from the visible label, the Test
 *     button interpolates the channel name into its aria-label so the per-row
 *     Test buttons are distinguishable to assistive tech;
 *   • the switch mirrors `enabled` via `aria-checked` across both variants;
 *   • toggling the switch calls `onToggle` with the *negated* state, and the
 *     Test button calls `onTest` exactly once without toggling the switch;
 *   • the master gate dims the row (`opacity-60`) when off yet keeps both
 *     controls enabled and interactive — the documented "dims but stays
 *     interactive" contract — and leaves the row undimmed when on;
 *   • a11y / hardening: the Test control is an explicit `type="button"` (a bare
 *     <button> would default to submit and could post an enclosing form), its
 *     glyph is decorative (aria-hidden), and both controls are native,
 *     focusable <button>s and therefore keyboard operable.
 *
 * The component imports the `@/components/ui` barrel, which transitively drags
 * framer-motion and react-i18next into the module graph, so both are stubbed:
 * framer-motion to a passthrough to keep module load hermetic in jsdom, and
 * react-i18next to echo the English fallback with `{{name}}` interpolation so
 * the copy (and the interpolated aria-label) is deterministic without booting
 * the real catalog. `@testing-library/user-event` is not installed in this
 * repo, so interactions are driven with `fireEvent`, matching every sibling
 * test in this directory.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const Component = (props.as as string) ?? 'div';
        const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>;
        return <Component {...(rest as Record<string, unknown>)}>{children as ReactNode}</Component>;
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
  useInView: () => true,
  useMotionValue: (v: unknown) => ({ get: () => v, set: vi.fn(), on: vi.fn() }),
  useSpring: (v: unknown) => ({ get: () => v, set: vi.fn(), on: vi.fn() }),
  useTransform: () => ({ get: () => 0, set: vi.fn(), on: vi.fn() }),
  animate: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = fallback ?? _key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { NotificationSoundChannelRow } from './NotificationSoundChannelRow';

type RowProps = ComponentProps<typeof NotificationSoundChannelRow>;

const LABEL = 'Critical alerts';

/** Render the row with sensible defaults and spy callbacks; override per case. */
function setup(overrides: Partial<RowProps> = {}) {
  const onToggle = vi.fn();
  const onTest = vi.fn();
  const utils = render(
    <NotificationSoundChannelRow
      label={LABEL}
      enabled={false}
      master
      onToggle={onToggle}
      onTest={onTest}
      {...overrides}
    />,
  );
  return { onToggle, onTest, ...utils };
}

// The switch owns the `switch` role; the Test control is the only `button`
// (the switch's implicit button role is overridden by role="switch").
const getSwitch = () => screen.getByRole('switch');
const getTestButton = (label: string = LABEL) =>
  screen.getByRole('button', { name: `Test ${label} sound` });

describe('NotificationSoundChannelRow — rendering & accessible names', () => {
  it('renders the channel label and a descriptively-labelled Test button', () => {
    setup();

    // The switch takes its accessible name from the visible label.
    expect(screen.getByRole('switch', { name: LABEL })).toBeInTheDocument();
    expect(screen.getByText(LABEL)).toBeInTheDocument();
    // The Test button's accessible name interpolates the channel name.
    expect(getTestButton()).toBeInTheDocument();
    // …while its visible text stays the short "Test".
    expect(screen.getByText('Test')).toBeInTheDocument();
  });

  it('interpolates the channel name into each Test aria-label', () => {
    setup({ label: 'Charge complete' });

    expect(getTestButton('Charge complete')).toBeInTheDocument();
    // The previous channel's name must not leak into a differently-labelled row.
    expect(screen.queryByRole('button', { name: `Test ${LABEL} sound` })).toBeNull();
  });
});

describe('NotificationSoundChannelRow — switch state & interaction', () => {
  it('reflects an off channel as aria-checked="false"', () => {
    setup({ enabled: false });
    expect(getSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('reflects an on channel as aria-checked="true"', () => {
    setup({ enabled: true });
    expect(getSwitch()).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onToggle with true when toggled on from off', () => {
    const { onToggle } = setup({ enabled: false });

    fireEvent.click(getSwitch());

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('calls onToggle with false when toggled off from on', () => {
    const { onToggle } = setup({ enabled: true });

    fireEvent.click(getSwitch());

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(false);
  });
});

describe('NotificationSoundChannelRow — Test button', () => {
  it('invokes onTest exactly once on click', () => {
    const { onTest } = setup();

    fireEvent.click(getTestButton());

    expect(onTest).toHaveBeenCalledTimes(1);
  });

  it('does not toggle the switch when only the Test button is pressed', () => {
    const { onToggle, onTest } = setup();

    fireEvent.click(getTestButton());

    expect(onTest).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('NotificationSoundChannelRow — master gate', () => {
  it('dims the row when the master gate is off', () => {
    const { container } = setup({ master: false });
    expect(container.firstChild as HTMLElement).toHaveClass('opacity-60');
  });

  it('does not dim the row when the master gate is on', () => {
    const { container } = setup({ master: true });
    expect(container.firstChild as HTMLElement).not.toHaveClass('opacity-60');
  });

  it('keeps both controls interactive while dimmed (master off)', () => {
    const { onToggle, onTest } = setup({ master: false, enabled: false });
    const sw = getSwitch();
    const testBtn = getTestButton();

    // Dimmed but never disabled — the documented contract.
    expect(sw).not.toBeDisabled();
    expect(testBtn).not.toBeDisabled();

    fireEvent.click(sw);
    fireEvent.click(testBtn);

    expect(onToggle).toHaveBeenCalledWith(true);
    expect(onTest).toHaveBeenCalledTimes(1);
  });
});

describe('NotificationSoundChannelRow — accessibility & hardening', () => {
  it('renders the Test control as an explicit type="button" (never a submit)', () => {
    setup();
    // A bare <button> defaults to type="submit" and would post an enclosing
    // <form>; the explicit type keeps the Test cue side-effect-free.
    expect(getTestButton()).toHaveAttribute('type', 'button');
  });

  it('marks the Test glyph as decorative so it is hidden from assistive tech', () => {
    setup();
    const icon = getTestButton().querySelector('svg');

    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('exposes both controls as native, focusable buttons (keyboard operable)', () => {
    setup();
    const sw = getSwitch();
    const testBtn = getTestButton();

    expect(sw.tagName).toBe('BUTTON');
    expect(testBtn.tagName).toBe('BUTTON');

    sw.focus();
    expect(sw).toHaveFocus();
    testBtn.focus();
    expect(testBtn).toHaveFocus();
  });
});
