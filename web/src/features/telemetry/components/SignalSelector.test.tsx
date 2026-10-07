/**
 * SignalSelector — behaviour + hardening coverage.
 *
 * SignalSelector is the `ComboboxMulti` wrapper shared by every signal
 * multi-select surface (Signal Explorer, Signal Log Viewer). It owns NO data —
 * `options` / `value` are props and every change is a callback — so these specs
 * drive it purely through props and assert its OWN behaviour:
 *
 *   1. Label: the computed "Signals (N / max)" token reflects the selection
 *      count, honours an explicit numeric `max`, drops the "/ max" half when
 *      `max` is null (uncapped), and yields entirely to `labelOverride`.
 *   2. Layer-help tooltip: rendered with an accessible trigger + body by
 *      default, and omitted when `showLayerHelp={false}`.
 *   3. Combobox wiring: exposes a labelled combobox with the search placeholder,
 *      lists the provided options, appends the chosen signal on select (and
 *      drops it from the dropdown), and renders each option in a mono span.
 *   4. Cap enforcement: the cap flows to ComboboxMulti as `maxItems` and blocks
 *      selecting past it; `max={null}` allows unlimited selections.
 *   5. Resilience (the hardening this file adds): an `undefined` `value` renders
 *      a zero count instead of throwing on `.length`; an `undefined` `options`
 *      renders the empty-results state instead of throwing on `.filter`.
 *   6. Layout: a custom `className` merges onto the `w-full` root.
 *
 * The real shared UI (ComboboxMulti, HelpTooltip → Tooltip, Label) is rendered
 * — only react-i18next is mocked to resolve developer fallback strings AND
 * interpolate `{{var}}` placeholders (so ComboboxMulti's "Remove {{label}}"
 * chip labels read like the English UI). Interactions use fireEvent (user-event
 * is not a dependency of this codebase — see web/package.json), matching
 * ./LiveSignalTail.test.tsx / ./SignalCompareControls.test.tsx.
 */
import { useState } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// jsdom lacks matchMedia; some transitive shared UI reads it during render.
// Install a benign stub before any module imports it (matches sibling specs).
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

// i18n → resolve the developer fallback so assertions read like the English UI,
// and interpolate `{{var}}` placeholders. Handles all call shapes used in the
// render tree: `t(key)`, `t(key, 'Default')`, `t(key, 'Default {{x}}', { x })`
// (ComboboxMulti chip/aria labels), and `t(key, { defaultValue })` (HelpTooltip).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (template: string, vars?: Record<string, unknown>): string =>
    vars
      ? template.replace(/\{\{(\w+)\}\}/g, (_full, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        )
      : template;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown): string => {
        if (typeof second === 'string') {
          return interpolate(second, third as Record<string, unknown> | undefined);
        }
        if (second && typeof second === 'object') {
          const opts = second as { defaultValue?: string } & Record<string, unknown>;
          return interpolate(opts.defaultValue ?? key, opts);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { SignalSelector, type SignalSelectorProps } from './SignalSelector';

const OPTIONS = ['battery_level', 'vehicle_speed', 'charge_state'];

// The search placeholder uses a real HORIZONTAL ELLIPSIS (U+2026); keep it
// byte-identical so getByPlaceholderText matches.
const SEARCH_PLACEHOLDER = 'Search signals…';

const LAYER_HELP_ARIA = 'More info about signal layers (L1, L2, log)';
const LAYER_HELP_BODY = /three live-state layers/i;

/**
 * Controlled harness so add/remove interactions round-trip through real state,
 * exactly like the Signal Explorer / Log Viewer pages that own the selection.
 */
function ControlledSelector({
  initial = [],
  onChangeSpy,
  ...rest
}: {
  initial?: string[];
  onChangeSpy?: (next: string[]) => void;
} & Omit<Partial<SignalSelectorProps>, 'value' | 'onChange'>) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <SignalSelector
      options={OPTIONS}
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChangeSpy?.(next);
      }}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SignalSelector — label', () => {
  it('shows "Signals (N / max)" with the default cap of 5 and reflects the selection count', () => {
    const { rerender } = render(<SignalSelector options={OPTIONS} value={[]} onChange={vi.fn()} />);
    expect(screen.getByText('Signals (0 / 5)')).toBeInTheDocument();

    rerender(
      <SignalSelector options={OPTIONS} value={['battery_level', 'vehicle_speed']} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Signals (2 / 5)')).toBeInTheDocument();
  });

  it('honours an explicit numeric max in the label', () => {
    render(<SignalSelector options={OPTIONS} value={['battery_level']} onChange={vi.fn()} max={3} />);
    expect(screen.getByText('Signals (1 / 3)')).toBeInTheDocument();
  });

  it('drops the "/ max" token when max is null (uncapped)', () => {
    render(
      <SignalSelector
        options={OPTIONS}
        value={['battery_level', 'vehicle_speed']}
        onChange={vi.fn()}
        max={null}
      />,
    );
    expect(screen.getByText('Signals (2)')).toBeInTheDocument();
    // No capped "(N / M)" form leaks through.
    expect(screen.queryByText('Signals (2 / 5)')).not.toBeInTheDocument();
  });

  it('renders labelOverride verbatim instead of the computed label, keeping the tooltip', () => {
    render(
      <SignalSelector
        options={OPTIONS}
        value={['battery_level']}
        onChange={vi.fn()}
        labelOverride="Choose signals to plot"
      />,
    );
    expect(screen.getByText('Choose signals to plot')).toBeInTheDocument();
    expect(screen.queryByText('Signals (1 / 5)')).not.toBeInTheDocument();
    // The help affordance is independent of the label text.
    expect(screen.getByRole('button', { name: LAYER_HELP_ARIA })).toBeInTheDocument();
  });
});

describe('SignalSelector — layer-help tooltip', () => {
  it('renders the layer-help trigger and its body by default', () => {
    render(<SignalSelector options={OPTIONS} value={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: LAYER_HELP_ARIA })).toBeInTheDocument();
    expect(screen.getByText(LAYER_HELP_BODY)).toBeInTheDocument();
  });

  it('omits the tooltip entirely when showLayerHelp is false', () => {
    render(<SignalSelector options={OPTIONS} value={[]} onChange={vi.fn()} showLayerHelp={false} />);
    expect(screen.queryByRole('button', { name: /signal layers/i })).not.toBeInTheDocument();
    expect(screen.queryByText(LAYER_HELP_BODY)).not.toBeInTheDocument();
  });
});

describe('SignalSelector — combobox wiring', () => {
  it('exposes a labelled signal combobox with the search placeholder', () => {
    render(<SignalSelector options={OPTIONS} value={[]} onChange={vi.fn()} />);
    const combo = screen.getByRole('combobox', { name: /signals/i });
    expect(combo).toBeInTheDocument();
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toBe(combo);
  });

  it('lists the provided options and appends the chosen signal on select', () => {
    const onChangeSpy = vi.fn();
    render(<ControlledSelector onChangeSpy={onChangeSpy} />);

    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: 'battery_level' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'battery_level' }));
    expect(onChangeSpy).toHaveBeenCalledWith(['battery_level']);

    // The chosen signal becomes a removable chip and leaves the dropdown.
    expect(screen.getByRole('button', { name: 'Remove battery_level' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'battery_level' })).not.toBeInTheDocument();
  });

  it('renders each option label in a monospace span', () => {
    render(<SignalSelector options={OPTIONS} value={[]} onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('combobox'));

    const mono = screen.getByText('vehicle_speed');
    expect(mono.tagName).toBe('SPAN');
    expect(mono.className).toContain('font-mono');
  });
});

describe('SignalSelector — cap enforcement', () => {
  it('passes the cap to the combobox and blocks selecting beyond it', () => {
    const onChangeSpy = vi.fn();
    render(<ControlledSelector initial={['battery_level', 'vehicle_speed']} max={2} onChangeSpy={onChangeSpy} />);

    // Visible label reflects the 2 / 2 cap.
    expect(screen.getByText('Signals (2 / 2)')).toBeInTheDocument();

    fireEvent.focus(screen.getByRole('combobox'));
    // The remaining option is offered but capped — clicking must not add it.
    fireEvent.click(screen.getByRole('option', { name: 'charge_state' }));

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Remove charge_state' })).not.toBeInTheDocument();
  });

  it('allows unlimited selections when max is null', () => {
    const onChangeSpy = vi.fn();
    render(<ControlledSelector initial={['battery_level', 'vehicle_speed']} max={null} onChangeSpy={onChangeSpy} />);

    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'charge_state' }));

    expect(onChangeSpy).toHaveBeenCalledWith(['battery_level', 'vehicle_speed', 'charge_state']);
    expect(screen.getByText('Signals (3)')).toBeInTheDocument();
  });
});

describe('SignalSelector — resilience (null safety)', () => {
  it('renders a zero count instead of throwing when value is undefined', () => {
    const onChange = vi.fn();
    expect(() =>
      render(
        <SignalSelector
          options={OPTIONS}
          value={undefined as unknown as string[]}
          onChange={onChange}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByText('Signals (0 / 5)')).toBeInTheDocument();
  });

  it('renders the empty-results state instead of throwing when options is undefined', () => {
    const onChange = vi.fn();
    expect(() =>
      render(
        <SignalSelector
          options={undefined as unknown as string[]}
          value={['battery_level']}
          onChange={onChange}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByText('Signals (1 / 5)')).toBeInTheDocument();

    // The combobox still mounts; opening it shows "No results" rather than crashing.
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('No results')).toBeInTheDocument();
  });
});

describe('SignalSelector — layout', () => {
  it('merges a custom className onto the w-full root wrapper', () => {
    const { container } = render(
      <SignalSelector options={OPTIONS} value={[]} onChange={vi.fn()} className="mt-4" />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass('w-full');
    expect(root).toHaveClass('mt-4');
  });
});
