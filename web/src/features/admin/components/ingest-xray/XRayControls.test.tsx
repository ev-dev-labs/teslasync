/**
 * XRayControls — behaviour + regression tests.
 *
 * XRayControls is the controlled toolbar for the Ingest X-Ray page: a vehicle
 * picker plus window + bucket dropdowns, all constrained to server-accepted
 * values. The suite mounts the REAL component (with the real shared <Select>)
 * and drives every branch through props + fireEvent, plus unit-tests the
 * exported `largestValidBucket` clamp helper.
 *
 * Coverage:
 *   1. largestValidBucket — returns the coarsest bucket strictly below each
 *      window and never one that would trip the server `bucket >= window` 400.
 *   2. Rendering — three labelled comboboxes reflect the current window/bucket
 *      and the selected (or placeholder) vehicle.
 *   3. Vehicle-label null-safety — display_name wins, then vin, then an
 *      id fallback; an empty vehicle list still renders the placeholder only.
 *   4. Interaction — choosing a vehicle emits its numeric id, the placeholder
 *      emits null, and the bucket dropdown emits its value verbatim.
 *   5. Bucket/window guard (the fix) — buckets >= the window are disabled, a
 *      window change that keeps the bucket valid does NOT touch the bucket, and
 *      narrowing the window below the active bucket clamps it down (the
 *      previously-unhandled 400 path).
 *   6. Accessibility — every control exposes an aria-label accessible name.
 *
 * react-i18next is mocked (mirroring the sibling FeedbackStatTile test) so the
 * English fallbacks — including the `{{id}}` interpolation — render
 * deterministically without locale files. The component is pure/presentational
 * so no network stubbing is required.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type { ComponentProps } from 'react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, vars?: Record<string, unknown>) => {
        const tpl = typeof fallback === 'string' ? fallback : key;
        if (!vars) return tpl;
        let out = tpl;
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
        return out;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { XRayControls, largestValidBucket } from './XRayControls';
import type { Vehicle } from '@/api/types';
import type { IngestXRayBucket, IngestXRayWindow } from '@/types/admin-diagnostics';

type Props = ComponentProps<typeof XRayControls>;

const BUCKET_SECS: Record<IngestXRayBucket, number> = {
  '30s': 30,
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
};
const WINDOW_SECS: Record<IngestXRayWindow, number> = {
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
};
const ALL_WINDOWS: IngestXRayWindow[] = ['5m', '15m', '1h', '6h', '24h'];

function mkVehicle(over: Partial<Vehicle> & { id: number }): Vehicle {
  return {
    id: over.id,
    vehicle_id: over.id,
    vin: '',
    display_name: '',
    model: 'model3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function baseProps(over: Partial<Props> = {}): Props {
  return {
    vehicles: [
      mkVehicle({ id: 1, display_name: 'Model 3 Perf' }),
      mkVehicle({ id: 2, display_name: '', vin: 'VIN0000000000002' }),
      mkVehicle({ id: 7, display_name: '', vin: '' }),
    ],
    vehicleId: null,
    windowSel: '1h',
    bucketSel: '1m',
    onVehicleChange: vi.fn(),
    onWindowChange: vi.fn(),
    onBucketChange: vi.fn(),
    ...over,
  };
}

const combobox = (name: string) =>
  screen.getByRole('combobox', { name }) as HTMLSelectElement;

afterEach(() => {
  cleanup();
});

describe('largestValidBucket', () => {
  it('returns the coarsest bucket strictly smaller than the window', () => {
    expect(largestValidBucket('5m')).toBe('1m');
    expect(largestValidBucket('15m')).toBe('5m');
    expect(largestValidBucket('1h')).toBe('15m');
    expect(largestValidBucket('6h')).toBe('1h');
    expect(largestValidBucket('24h')).toBe('1h');
  });

  it('never returns a bucket equal to or larger than the window', () => {
    for (const w of ALL_WINDOWS) {
      const bucket = largestValidBucket(w);
      expect(BUCKET_SECS[bucket]).toBeLessThan(WINDOW_SECS[w]);
    }
  });
});

describe('XRayControls — rendering', () => {
  it('renders three labelled comboboxes reflecting the current window and bucket', () => {
    render(<XRayControls {...baseProps({ windowSel: '6h', bucketSel: '5m' })} />);

    expect(combobox('Vehicle')).toBeInTheDocument();
    expect(combobox('Window').value).toBe('6h');
    expect(combobox('Bucket').value).toBe('5m');
  });

  it('selects the placeholder when no vehicle is chosen', () => {
    render(<XRayControls {...baseProps({ vehicleId: null })} />);

    const vehicle = combobox('Vehicle');
    expect(vehicle.value).toBe('');
    const first = within(vehicle).getAllByRole('option')[0];
    expect(first.textContent).toContain('Select vehicle');
  });

  it('reflects the active vehicle id as the selected option', () => {
    render(<XRayControls {...baseProps({ vehicleId: 2 })} />);
    expect(combobox('Vehicle').value).toBe('2');
  });
});

describe('XRayControls — vehicle label fallbacks', () => {
  it('labels each vehicle by display_name, then vin, then an id fallback', () => {
    render(<XRayControls {...baseProps()} />);

    const labels = within(combobox('Vehicle'))
      .getAllByRole('option')
      .map((o) => o.textContent);

    expect(labels).toContain('Model 3 Perf'); // display_name wins
    expect(labels).toContain('VIN0000000000002'); // empty name → vin
    expect(labels).toContain('Vehicle 7'); // empty name + vin → id fallback
  });

  it('renders only the placeholder when the vehicle list is empty', () => {
    render(<XRayControls {...baseProps({ vehicles: [] })} />);

    const options = within(combobox('Vehicle')).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('Select vehicle');
  });
});

describe('XRayControls — interactions', () => {
  it('emits the numeric id when a vehicle is chosen', () => {
    const props = baseProps({ vehicleId: null });
    render(<XRayControls {...props} />);

    fireEvent.change(combobox('Vehicle'), { target: { value: '2' } });
    expect(props.onVehicleChange).toHaveBeenCalledWith(2);
    expect(props.onVehicleChange).toHaveBeenCalledTimes(1);
  });

  it('emits null when the placeholder is chosen', () => {
    const props = baseProps({ vehicleId: 2 });
    render(<XRayControls {...props} />);

    fireEvent.change(combobox('Vehicle'), { target: { value: '' } });
    expect(props.onVehicleChange).toHaveBeenCalledWith(null);
  });

  it('emits the chosen bucket verbatim', () => {
    const props = baseProps({ windowSel: '24h', bucketSel: '1m' });
    render(<XRayControls {...props} />);

    fireEvent.change(combobox('Bucket'), { target: { value: '15m' } });
    expect(props.onBucketChange).toHaveBeenCalledWith('15m');
  });
});

describe('XRayControls — bucket/window guard', () => {
  it('disables every bucket that is >= the current window', () => {
    render(<XRayControls {...baseProps({ windowSel: '5m' })} />);

    const opts = within(combobox('Bucket')).getAllByRole('option') as HTMLOptionElement[];
    const enabled = opts.filter((o) => !o.disabled).map((o) => o.value);
    const disabled = opts.filter((o) => o.disabled).map((o) => o.value);

    expect(enabled).toEqual(['30s', '1m']); // < 5m (300s)
    expect(disabled).toEqual(['5m', '15m', '1h']); // >= 5m (300s)
  });

  it('does not touch the bucket when a window change keeps it valid', () => {
    const props = baseProps({ windowSel: '1h', bucketSel: '1m' });
    render(<XRayControls {...props} />);

    fireEvent.change(combobox('Window'), { target: { value: '6h' } });

    expect(props.onWindowChange).toHaveBeenCalledWith('6h');
    expect(props.onBucketChange).not.toHaveBeenCalled();
  });

  it('clamps the bucket down when the window is narrowed below it (prevents a bucket>=window 400)', () => {
    const props = baseProps({ windowSel: '24h', bucketSel: '1h' });
    render(<XRayControls {...props} />);

    fireEvent.change(combobox('Window'), { target: { value: '5m' } });

    expect(props.onWindowChange).toHaveBeenCalledWith('5m');
    // 1h (3600s) >= 5m (300s) → clamp to the coarsest bucket under 5m.
    expect(props.onBucketChange).toHaveBeenCalledWith('1m');
  });

  it('clamps a stranded 1h bucket to 15m when the window is narrowed to 1h', () => {
    // Second clamp boundary: 1h bucket (3600s) equals a 1h window (3600s), so
    // bucket >= window trips — the coarsest bucket strictly under 1h is 15m.
    const props = baseProps({ windowSel: '24h', bucketSel: '1h' });
    render(<XRayControls {...props} />);

    fireEvent.change(combobox('Window'), { target: { value: '1h' } });

    expect(props.onWindowChange).toHaveBeenCalledWith('1h');
    expect(props.onBucketChange).toHaveBeenCalledWith('15m');
  });
});

describe('XRayControls — accessibility', () => {
  it('exposes an accessible name on every control', () => {
    render(<XRayControls {...baseProps()} />);

    expect(screen.getByRole('combobox', { name: 'Vehicle' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Window' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Bucket' })).toBeInTheDocument();
  });
});
