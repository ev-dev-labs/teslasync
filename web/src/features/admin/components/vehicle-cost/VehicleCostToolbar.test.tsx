/**
 * VehicleCostToolbar contract + hardening tests.
 *
 * The toolbar is the pure-presentational control strip for the Vehicle Ingest
 * Cost page — a trailing-window `<Select>` and a manual refresh `<Button>`. It
 * owns no data source, so there is no loading / error / empty branch to pin;
 * instead these tests exercise every prop-driven facet of the two controls:
 *
 *   1. Structure — the "Window" label, exactly one combobox, and the icon-only
 *      refresh button all render, and the label is wired to the select.
 *   2. Options — every `WINDOW_OPTIONS` preset is offered with the right label
 *      and its numeric `days` as the option value.
 *   3. Value reflection — the controlled select mirrors `windowDays`, including
 *      across a rerender.
 *   4. Window change — choosing a preset calls `onWindowChange` exactly once
 *      with a *number* (not the raw string) so the parent's `since` date math
 *      stays valid.
 *   5. Refresh — clicking fires `onRefresh`; while `refreshing` the button is
 *      disabled, marked `aria-busy`, does not re-fire, and spins its icon; when
 *      idle it is enabled, not busy, and static.
 *   6. Accessibility — the icon-only button exposes a real name and the
 *      decorative icon is hidden from assistive tech.
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` yields the English default
 * and assertions read against the real copy. `@testing-library/user-event` is
 * not installed in this repo, so interactions use `fireEvent` — matching every
 * sibling suite (GasPriceControlPanel, CostByVehicleChart, …).
 */
import { type ComponentProps, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { VehicleCostToolbar } from './VehicleCostToolbar';
import { WINDOW_OPTIONS } from './constants';

type Props = ComponentProps<typeof VehicleCostToolbar>;

function renderToolbar(overrides: Partial<Props> = {}) {
  const onWindowChange = overrides.onWindowChange ?? vi.fn();
  const onRefresh = overrides.onRefresh ?? vi.fn();
  const props: Props = {
    windowDays: 7,
    refreshing: false,
    ...overrides,
    onWindowChange,
    onRefresh,
  };
  const utils = render(<VehicleCostToolbar {...props} />);
  return { ...utils, onWindowChange, onRefresh };
}

const REFRESH_NAME = /refresh vehicle cost data/i;

describe('VehicleCostToolbar — structure', () => {
  it('renders the Window label, a single combobox, and the refresh button', () => {
    renderToolbar();

    expect(screen.getByText('Window')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: REFRESH_NAME }),
    ).toBeInTheDocument();
  });

  it('wires the "Window" label to the select so it has an accessible name', () => {
    renderToolbar();

    // The <label> wraps the Caption + Select, so the select's accessible name
    // resolves to the visible "Window" copy.
    expect(screen.getByRole('combobox')).toHaveAccessibleName(/window/i);
  });
});

describe('VehicleCostToolbar — window options', () => {
  it('offers every WINDOW_OPTIONS preset with its translated label', () => {
    renderToolbar();

    const options = within(screen.getByRole('combobox')).getAllByRole('option');
    expect(options).toHaveLength(WINDOW_OPTIONS.length);
    expect(options.map((o) => o.textContent)).toEqual([
      'Last 1 day',
      'Last 7 days',
      'Last 30 days',
      'Last 90 days',
    ]);
  });

  it('uses the numeric day count as each option value', () => {
    renderToolbar();

    const options = within(screen.getByRole('combobox')).getAllByRole(
      'option',
    ) as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(['1', '7', '30', '90']);
  });
});

describe('VehicleCostToolbar — value reflection', () => {
  it('reflects the current windowDays as the selected value across a rerender', () => {
    const { rerender } = renderToolbar({ windowDays: 1 });
    expect(screen.getByRole('combobox')).toHaveValue('1');

    rerender(
      <VehicleCostToolbar
        windowDays={90}
        refreshing={false}
        onWindowChange={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByRole('combobox')).toHaveValue('90');
  });
});

describe('VehicleCostToolbar — window change', () => {
  it('calls onWindowChange exactly once with the chosen preset', () => {
    const { onWindowChange } = renderToolbar({ windowDays: 7 });

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '30' },
    });

    expect(onWindowChange).toHaveBeenCalledTimes(1);
    expect(onWindowChange).toHaveBeenCalledWith(30);
  });

  it('passes a number (not the raw string) so downstream date math stays valid', () => {
    const { onWindowChange } = renderToolbar();

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '90' },
    });

    const arg = (onWindowChange as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(typeof arg).toBe('number');
    expect(arg).toBe(90);
  });
});

describe('VehicleCostToolbar — refresh', () => {
  it('calls onRefresh when the enabled refresh button is clicked', () => {
    const { onRefresh } = renderToolbar({ refreshing: false });

    fireEvent.click(screen.getByRole('button', { name: REFRESH_NAME }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables the button and marks it aria-busy while a refresh is in flight', () => {
    renderToolbar({ refreshing: true });

    const btn = screen.getByRole('button', { name: REFRESH_NAME });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('does not re-fire onRefresh while already refreshing (button is disabled)', () => {
    const { onRefresh } = renderToolbar({ refreshing: true });

    fireEvent.click(screen.getByRole('button', { name: REFRESH_NAME }));

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('leaves the button enabled and not busy when idle', () => {
    renderToolbar({ refreshing: false });

    const btn = screen.getByRole('button', { name: REFRESH_NAME });
    expect(btn).toBeEnabled();
    expect(btn).not.toHaveAttribute('aria-busy');
  });
});

describe('VehicleCostToolbar — refresh icon', () => {
  it('spins the icon and keeps it aria-hidden while refreshing', () => {
    renderToolbar({ refreshing: true });

    const icon = screen
      .getByRole('button', { name: REFRESH_NAME })
      .querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass('animate-spin');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not spin the icon when idle', () => {
    renderToolbar({ refreshing: false });

    const icon = screen
      .getByRole('button', { name: REFRESH_NAME })
      .querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).not.toHaveClass('animate-spin');
    expect(icon).toHaveClass('h-4', 'w-4');
  });
});
