/**
 * WidgetSettingsModal contract.
 *
 * The modal is the per-widget "gear" surface on the dashboard. It keeps a local
 * draft of the widget's `WidgetConfig`, seeded from `widget.config`, and only
 * reports it back through `onSave` when the user commits (Save then Close).
 * Which sections render is derived purely from `def.category`:
 *   - Vehicle selector  → every category EXCEPT `system` / `analytics`.
 *   - Time-range picker → `driving` | `charging` | `analytics` | `battery`.
 *   - Refresh interval + Appearance (show-title switch) → always.
 *
 * The suite locks, facet by facet:
 *   1. Open/closed rendering + the accessible, titled dialog (i18n-interpolated
 *      "{name} Settings").
 *   2. Category-driven section visibility (vehicle selector + time range).
 *   3. Each control reflects its config value and the committed draft carries the
 *      right partial update (vehicle, "all" reset, refresh interval, "default"
 *      reset, time range, show-title).
 *   4. Accessibility: the icon-free selects expose an accessible name, and the
 *      show-title control is a real `role="switch"`.
 *   5. The vehicle fallback label ("Vehicle {id}") and an empty fleet.
 *   6. Primary actions: Save persists-then-closes (in that order); Cancel and the
 *      modal Close (X) never save.
 *   7. Hardening / regression guard: reusing the mounted modal for a *different*
 *      widget resets the draft so edits never leak across widgets; a widget with
 *      no saved config renders every control at its default.
 *
 * i18n is stubbed so `t(key, fallback, vars)` returns the interpolated English
 * fallback, making the visible copy deterministic. `useVehicles` is mocked so no
 * network is touched. The suite runs under <StrictMode> to prove the render-phase
 * state sync (widget-id reset) is pure and does not double-fire.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// i18n stub: passthrough that honours the English default and interpolates
// {{var}} tokens so the count/name/id assertions are real.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// The fleet is injected per-test through this mutable holder (the `MOCK_` prefix
// lets vitest hoist the factory above it safely).
let MOCK_VEHICLES: Vehicle[] = [];
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: MOCK_VEHICLES }),
}));

import { WidgetSettingsModal } from './WidgetSettingsModal';
import type { Vehicle } from '@/types/vehicle';
import type { WidgetCategory, WidgetConfig, WidgetDef, WidgetInstance } from '../widgets/types';

function makeVehicle(id: number, display_name: string): Vehicle {
  return {
    id,
    vehicle_id: id,
    vin: `VIN-${id}`,
    display_name,
    model: 'Model 3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '',
    updated_at: '',
  };
}

function makeDef(category: WidgetCategory, name = 'Battery'): WidgetDef {
  return {
    id: `def-${category}`,
    name,
    description: '',
    category,
    defaultSize: { cols: 1, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    maxSize: { cols: 4, rows: 8 },
    // icon + component are never exercised by the modal — stub them.
    icon: (() => null) as unknown as WidgetDef['icon'],
    component: (() => null) as unknown as WidgetDef['component'],
  };
}

function makeWidget(config?: WidgetConfig, id = 'w-1'): WidgetInstance {
  return { id, widgetId: 'battery-gauge', config };
}

interface Opts {
  open?: boolean;
  category?: WidgetCategory;
  name?: string;
  config?: WidgetConfig;
  vehicles?: Vehicle[];
  widgetId?: string;
}

function setup(o: Opts = {}) {
  MOCK_VEHICLES = o.vehicles ?? [];
  const onClose = vi.fn();
  const onSave = vi.fn();
  const widget = makeWidget(o.config, o.widgetId);
  const def = makeDef(o.category ?? 'battery', o.name ?? 'Battery');
  const utils = render(
    <StrictMode>
      <WidgetSettingsModal
        widget={widget}
        def={def}
        open={o.open ?? true}
        onClose={onClose}
        onSave={onSave}
      />
    </StrictMode>,
  );
  return { onClose, onSave, ...utils };
}

/** The single committed config object handed to `onSave`. */
function committed(onSave: ReturnType<typeof vi.fn>): WidgetConfig {
  return (onSave.mock.calls[0]?.[0] ?? {}) as WidgetConfig;
}

const selectByLabel = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement;

afterEach(() => {
  cleanup();
  MOCK_VEHICLES = [];
});

describe('WidgetSettingsModal — rendering', () => {
  it('renders nothing when closed', () => {
    setup({ open: false, name: 'Battery Health' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Battery Health Settings')).toBeNull();
  });

  it('renders an accessible, i18n-titled dialog with the core sections when open', () => {
    setup({ category: 'battery', name: 'Battery Health' });
    // Title is interpolated from def.name, not hard-coded English.
    expect(screen.getByRole('dialog', { name: 'Battery Health Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Refresh Interval' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    // battery is both a vehicle- and a chart-widget → all four sections present.
    expect(selectByLabel('Vehicle')).toBeInTheDocument();
    expect(selectByLabel('Time Range')).toBeInTheDocument();
  });

  it('gives every icon-free select an accessible name', () => {
    setup({ category: 'battery' });
    // If these throw, the selects have no programmatic label (a11y regression).
    expect(selectByLabel('Vehicle').tagName).toBe('SELECT');
    expect(selectByLabel('Refresh Interval').tagName).toBe('SELECT');
    expect(selectByLabel('Time Range').tagName).toBe('SELECT');
  });
});

describe('WidgetSettingsModal — vehicle selector', () => {
  it('lists every fleet vehicle plus an "all" option', () => {
    setup({
      category: 'vehicle',
      vehicles: [makeVehicle(1, 'Red Model 3'), makeVehicle(2, 'Blue Model Y')],
    });
    expect(selectByLabel('Vehicle').value).toBe('all');
    expect(screen.getByText('All Vehicles (first)')).toBeInTheDocument();
    expect(screen.getByText('Red Model 3')).toBeInTheDocument();
    expect(screen.getByText('Blue Model Y')).toBeInTheDocument();
  });

  it('falls back to a localized "Vehicle {id}" label when a car has no display name', () => {
    setup({ category: 'vehicle', vehicles: [makeVehicle(7, '')] });
    expect(screen.getByText('Vehicle 7')).toBeInTheDocument();
  });

  it('hides the vehicle selector for system widgets', () => {
    setup({ category: 'system' });
    expect(screen.queryByRole('combobox', { name: 'Vehicle' })).toBeNull();
  });

  it('hides the vehicle selector for analytics widgets', () => {
    setup({ category: 'analytics' });
    expect(screen.queryByRole('combobox', { name: 'Vehicle' })).toBeNull();
  });

  it('reflects the saved vehicle and commits a different selection', () => {
    const { onSave } = setup({
      category: 'vehicle',
      vehicles: [makeVehicle(1, 'Red'), makeVehicle(2, 'Blue')],
      config: { vehicleId: 1 },
    });
    const select = selectByLabel('Vehicle');
    expect(select.value).toBe('1');
    fireEvent.change(select, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(committed(onSave).vehicleId).toBe(2);
  });

  it('clears the vehicle filter when "All Vehicles" is chosen', () => {
    const { onSave } = setup({
      category: 'vehicle',
      vehicles: [makeVehicle(1, 'Red')],
      config: { vehicleId: 1 },
    });
    fireEvent.change(selectByLabel('Vehicle'), { target: { value: 'all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(committed(onSave).vehicleId).toBeUndefined();
  });

  it('renders without crashing when the fleet is empty', () => {
    setup({ category: 'vehicle', vehicles: [] });
    const select = selectByLabel('Vehicle');
    expect(select.value).toBe('all');
    expect(screen.getByText('All Vehicles (first)')).toBeInTheDocument();
  });
});

describe('WidgetSettingsModal — time range', () => {
  it('shows the time-range picker for chart widgets', () => {
    setup({ category: 'driving' });
    expect(selectByLabel('Time Range')).toBeInTheDocument();
  });

  it('hides the time-range picker for non-chart widgets', () => {
    setup({ category: 'climate' });
    expect(screen.queryByRole('combobox', { name: 'Time Range' })).toBeNull();
  });

  it('defaults the time range to 7d and commits a change', () => {
    const { onSave } = setup({ category: 'driving' });
    const select = selectByLabel('Time Range');
    expect(select.value).toBe('7d');
    fireEvent.change(select, { target: { value: '30d' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(committed(onSave).timeRange).toBe('30d');
  });
});

describe('WidgetSettingsModal — refresh interval', () => {
  it('defaults to "Default" and commits a chosen interval as a number', () => {
    const { onSave } = setup({ category: 'battery' });
    const select = selectByLabel('Refresh Interval');
    expect(select.value).toBe('default');
    fireEvent.change(select, { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(committed(onSave).refreshRate).toBe(15);
  });

  it('clears a custom refresh interval when "Default" is chosen', () => {
    const { onSave } = setup({ category: 'battery', config: { refreshRate: 30 } });
    const select = selectByLabel('Refresh Interval');
    expect(select.value).toBe('30');
    fireEvent.change(select, { target: { value: 'default' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(committed(onSave).refreshRate).toBeUndefined();
  });
});

describe('WidgetSettingsModal — appearance toggle', () => {
  it('renders the show-title switch checked by default and commits turning it off', () => {
    const { onSave } = setup({ category: 'battery' });
    const sw = screen.getByRole('switch', { name: 'Show widget title' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(committed(onSave).showTitle).toBe(false);
  });

  it('reflects a persisted showTitle:false as an unchecked switch', () => {
    setup({ category: 'battery', config: { showTitle: false } });
    expect(screen.getByRole('switch', { name: 'Show widget title' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});

describe('WidgetSettingsModal — primary actions', () => {
  it('cancels without saving', () => {
    const { onSave, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves the config then closes, in that order', () => {
    const { onSave, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    // The config must be handed off before the modal tears down.
    expect(onSave.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });

  it('closes via the modal Close (X) affordance without saving', () => {
    const { onSave, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('WidgetSettingsModal — hardening', () => {
  it('defaults every control when the widget has no saved config', () => {
    setup({ category: 'battery', config: undefined });
    expect(selectByLabel('Vehicle').value).toBe('all');
    expect(selectByLabel('Refresh Interval').value).toBe('default');
    expect(selectByLabel('Time Range').value).toBe('7d');
    expect(screen.getByRole('switch', { name: 'Show widget title' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('resets the draft when the modal is reused for a different widget (no cross-widget leak)', () => {
    MOCK_VEHICLES = [];
    const onSave = vi.fn();
    const onClose = vi.fn();
    const def = makeDef('driving', 'Drive');
    const widgetA = makeWidget({ timeRange: '30d' }, 'w-A');
    const { rerender } = render(
      <StrictMode>
        <WidgetSettingsModal widget={widgetA} def={def} open onClose={onClose} onSave={onSave} />
      </StrictMode>,
    );
    const timeSelect = () => screen.getByRole('combobox', { name: 'Time Range' }) as HTMLSelectElement;
    expect(timeSelect().value).toBe('30d');

    // Edit widget A's draft in-place.
    fireEvent.change(timeSelect(), { target: { value: '90d' } });
    expect(timeSelect().value).toBe('90d');

    // Reuse the SAME mounted modal for a different widget instance.
    const widgetB = makeWidget({ timeRange: '24h' }, 'w-B');
    rerender(
      <StrictMode>
        <WidgetSettingsModal widget={widgetB} def={def} open onClose={onClose} onSave={onSave} />
      </StrictMode>,
    );

    // The draft must reflect B's saved config, not A's uncommitted '90d' edit.
    expect(timeSelect().value).toBe('24h');
  });
});
