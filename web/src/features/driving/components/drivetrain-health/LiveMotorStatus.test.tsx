/**
 * LiveMotorStatus — behaviour + hardening contract.
 *
 * LiveMotorStatus renders the full-width "Live Motor Status" band on the
 * drivetrain-health page. It owns no data source of its own — the parent feeds
 * it an already-resolved `MotorSnapshot`, an optional HV-isolation scalar, and a
 * `loading` flag — so these tests pin the display behaviour that matters and the
 * null / non-finite hardening this elevation added:
 *
 *   - the panel is a three-state switch: `loading && no snapshot` → a skeleton
 *     (never the metrics, never the empty state); `!snapshot` → the shared
 *     EmptyState (role="status") with the "no live motor" copy; otherwise the
 *     headline MetricCards + the inline motor/temperature/isolation grid;
 *   - a present snapshot always wins over `loading` (a background refetch never
 *     blanks live data back to a skeleton);
 *   - every scalar is non-finite-safe (the real bug this elevation fixed): a
 *     `NaN` power/rpm/torque/temp, an `Infinity` regen, or a `-Infinity` inverter
 *     temp now collapse to "—" instead of the fabricated "0 kW" / "0 RPM" /
 *     "0.00 °C" the old `!= null` + `safeNumber` path produced — while a genuine
 *     `0` still renders as a real value;
 *   - a per-sensor `null` reading renders "—" for that cell only, leaving its
 *     siblings intact;
 *   - a blank / whitespace-only shift-state or source collapses to "—" rather
 *     than an empty tile;
 *   - temperature-unit preference flows end-to-end through the REAL
 *     `convertTempFromSI` (°C vs °F);
 *   - the HV-isolation icon tint tracks the reading (green ≥500, amber ≥100, red
 *     <100 kΩ) and — the second bug fixed here — a non-finite / non-positive
 *     reading tints MUTED so the glyph agrees with the "—" value cell instead of
 *     flashing a false danger-red.
 *
 * `react-i18next` is mocked to echo the English fallback and `@/components/motion`
 * FadeIn is a passthrough (mirrors the sibling drive-detail convention). `useUnits`
 * is the settings-backed boundary hook, mocked to drive the °C/°F branch while the
 * pure SI temperature converter + `fmtNumber`/`fmtInt` run for real. The component
 * exposes no interactive controls, so there is no userEvent surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';

import { LiveMotorStatus } from './LiveMotorStatus';
import type { MotorSnapshot } from '@/api/types';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

/* ── Controllable mock state, hoisted above the vi.mock factories ─────────── */
const h = vi.hoisted(() => ({ temp: '\u00B0C' as '\u00B0C' | '\u00B0F' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// FadeIn wraps the panel in a framer-motion element that reaches for
// matchMedia via useMotionPreference; a passthrough keeps the DOM flat and the
// test focused on LiveMotorStatus' own output (sibling drive-detail convention).
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Drive the temperature unit while the REAL SI converter + number formatters
// run. The component only reads `unitPrefs.temperature`; the formatters are
// stubbed for shape completeness and are never exercised by this component.
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: h.temp,
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    },
    formatDistance: (v: unknown) => String(v ?? ''),
    formatSpeed: (v: unknown) => String(v ?? ''),
    formatTemperature: (v: unknown) => String(v ?? ''),
    formatPressure: (v: unknown) => String(v ?? ''),
    formatEnergy: (v: unknown) => String(v ?? ''),
    formatDuration: (v: unknown) => String(v ?? ''),
    formatPower: (v: unknown) => String(v ?? ''),
  }),
}));

/* ── Unicode glyphs (escaped to avoid encoding drift) ─────────────────────── */
const DASH = '\u2014'; // —
const DEGC = '\u00B0C';
const DEGF = '\u00B0F';
const OHM = '\u03A9'; // Ω

/* ── Fixtures ─────────────────────────────────────────────────────────────── */
function makeMotor(overrides: Partial<MotorSnapshot> = {}): MotorSnapshot {
  return {
    ts: '2026-07-05T00:00:00Z',
    created_at: '2026-07-05T00:00:00Z',
    torque_nm_front: 120,
    torque_nm_rear: 118.5,
    di_torque: null,
    motor_rpm_front: 3200,
    motor_rpm_rear: 3195,
    motor_temp_c_front: 48,
    motor_temp_c_rear: 52,
    inverter_temp_c: 41,
    inverter_temp_rear: null,
    heatsink_temp_front: null,
    heatsink_temp_rear: null,
    motor_current_front: null,
    motor_current_rear: null,
    state_front: null,
    state_rear: null,
    shift_state: 'D',
    vbat_front: null,
    vbat_rear: null,
    power_kw: 42.5,
    regen_kw: 12,
    battery_temp_c: 30,
    source: 'telemetry',
    ...overrides,
  };
}

type Props = ComponentProps<typeof LiveMotorStatus>;

function renderStatus(overrides: Partial<Props> = {}) {
  const props: Props = {
    motorLatest: makeMotor(),
    isolationResistance: 650,
    loading: false,
    ...overrides,
  };
  return render(<LiveMotorStatus {...props} />);
}

/** Read a MetricCard value cell (`<p class="text-xl">`) addressed by its label. */
function cardValue(label: string): string {
  const labelEl = screen.getByText(label);
  const labelP = labelEl.closest('p');
  return labelP?.nextElementSibling?.textContent ?? '';
}

/** Read an InlineMetric value span addressed by its trailing label span. */
function inlineValue(label: string): string {
  const labelEl = screen.getByText(label);
  return labelEl.previousElementSibling?.textContent ?? '';
}

/** Read the class attribute of the Shield glyph inside the HV-isolation metric. */
function isolationIconClass(): string {
  const labelEl = screen.getByText('HV Isolation');
  const svg = labelEl.parentElement?.querySelector('svg');
  return svg?.getAttribute('class') ?? '';
}

beforeEach(() => {
  h.temp = '\u00B0C';
  // Pin formatter globals so fmtNumber/fmtInt are deterministic regardless of
  // which other suites ran first (mirrors the page-test convention).
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
});

/* ── Three-state switch ───────────────────────────────────────────────────── */
describe('LiveMotorStatus — render states', () => {
  it('shows a skeleton while loading with no snapshot yet (no metrics, no empty state)', () => {
    const { container } = renderStatus({ motorLatest: null, loading: true });

    // The panel title is always present regardless of state.
    expect(screen.getByText('Live Motor Status')).toBeInTheDocument();
    // A single animate-pulse bar stands in for the metric grid.
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // Neither the metrics nor the empty state may show while loading.
    expect(screen.queryByText('Shift State')).not.toBeInTheDocument();
    expect(screen.queryByText('No live motor telemetry yet')).not.toBeInTheDocument();
  });

  it('shows the shared EmptyState (role=status) when there is no snapshot', () => {
    const { container } = renderStatus({ motorLatest: null, loading: false });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('No live motor telemetry yet');
    // No skeleton, no metric cards in the empty branch.
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByText('Power')).not.toBeInTheDocument();
  });

  it('treats undefined motorLatest the same as null (EmptyState, not a crash)', () => {
    renderStatus({ motorLatest: undefined });
    expect(screen.getByRole('status')).toHaveTextContent('No live motor telemetry yet');
  });

  it('renders live data even while loading when a snapshot is present', () => {
    const { container } = renderStatus({ loading: true });

    // A present snapshot wins over `loading` — a refetch never blanks live data.
    expect(cardValue('Power')).toBe('42.50 kW');
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

/* ── Populated metrics ────────────────────────────────────────────────────── */
describe('LiveMotorStatus — populated metrics', () => {
  it('renders every headline metric card with its formatted value', () => {
    renderStatus();

    expect(cardValue('Shift State')).toBe('D');
    expect(cardValue('Power')).toBe('42.50 kW');
    expect(cardValue('Regen')).toBe('12.00 kW');
    expect(cardValue('Source')).toBe('telemetry');
  });

  it('renders the inline rpm + torque metrics with unit suffixes and locale separators', () => {
    renderStatus();

    expect(inlineValue('Front Motor RPM')).toBe('3,200 RPM');
    expect(inlineValue('Rear Motor RPM')).toBe('3,195 RPM');
    expect(inlineValue('Front Torque')).toBe('120.00 Nm');
    expect(inlineValue('Rear Torque')).toBe('118.50 Nm');
  });

  it('renders every temperature through the real °C converter', () => {
    renderStatus();

    expect(inlineValue('Front Motor Temp')).toBe(`48.00 ${DEGC}`);
    expect(inlineValue('Rear Motor Temp')).toBe(`52.00 ${DEGC}`);
    expect(inlineValue('Inverter Temp')).toBe(`41.00 ${DEGC}`);
    expect(inlineValue('Battery Temp')).toBe(`30.00 ${DEGC}`);
  });

  it('formats the HV isolation reading with its kΩ suffix', () => {
    renderStatus({ isolationResistance: 650 });
    expect(inlineValue('HV Isolation')).toBe(`650.00 k${OHM}`);
  });
});

/* ── Null & absent fields ─────────────────────────────────────────────────── */
describe('LiveMotorStatus — null & absent fields', () => {
  it('shows "—" for individually null metrics while siblings still render', () => {
    renderStatus({
      motorLatest: makeMotor({
        power_kw: null,
        motor_rpm_front: null,
        motor_temp_c_front: null,
      }),
    });

    expect(cardValue('Power')).toBe(DASH);
    expect(inlineValue('Front Motor RPM')).toBe(DASH);
    expect(inlineValue('Front Motor Temp')).toBe(DASH);

    // Neighbours are unaffected — only the null cells collapse.
    expect(cardValue('Regen')).toBe('12.00 kW');
    expect(inlineValue('Rear Motor RPM')).toBe('3,195 RPM');
    expect(inlineValue('Rear Motor Temp')).toBe(`52.00 ${DEGC}`);
  });

  it('shows "—" for a blank or whitespace-only shift state and source', () => {
    renderStatus({ motorLatest: makeMotor({ shift_state: '   ', source: '' }) });

    expect(cardValue('Shift State')).toBe(DASH);
    expect(cardValue('Source')).toBe(DASH);
  });

  it('shows "—" for HV isolation when the reading is absent or non-positive', () => {
    const { unmount } = renderStatus({ isolationResistance: undefined });
    expect(inlineValue('HV Isolation')).toBe(DASH);
    unmount();

    renderStatus({ isolationResistance: 0 });
    expect(inlineValue('HV Isolation')).toBe(DASH);
  });
});

/* ── Non-finite hardening (the real bug fixed here) ───────────────────────── */
describe('LiveMotorStatus — non-finite safety', () => {
  it('collapses NaN / ±Infinity readings to "—" instead of fabricating a zero', () => {
    const { container } = renderStatus({
      motorLatest: makeMotor({
        power_kw: Number.NaN,
        regen_kw: Number.POSITIVE_INFINITY,
        motor_rpm_front: Number.NaN,
        torque_nm_front: Number.POSITIVE_INFINITY,
        motor_temp_c_front: Number.NaN,
        inverter_temp_c: Number.NEGATIVE_INFINITY,
      }),
      isolationResistance: Number.NaN,
    });

    expect(cardValue('Power')).toBe(DASH);
    expect(cardValue('Regen')).toBe(DASH);
    expect(inlineValue('Front Motor RPM')).toBe(DASH);
    expect(inlineValue('Front Torque')).toBe(DASH);
    expect(inlineValue('Front Motor Temp')).toBe(DASH);
    expect(inlineValue('Inverter Temp')).toBe(DASH);
    expect(inlineValue('HV Isolation')).toBe(DASH);

    // Regression guards: the old path coerced NaN/Infinity → a fabricated 0.
    expect(container.textContent).not.toContain('0.00 kW');
    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('Infinity');
  });

  it('keeps a finite sibling metric while a non-finite one collapses', () => {
    renderStatus({ motorLatest: makeMotor({ power_kw: Number.NaN, regen_kw: 8 }) });

    expect(cardValue('Power')).toBe(DASH);
    expect(cardValue('Regen')).toBe('8.00 kW');
  });

  it('still renders a genuine zero reading as a real value, not "—"', () => {
    renderStatus({ motorLatest: makeMotor({ power_kw: 0 }) });
    // A present-but-zero power is meaningful data, not an absence.
    expect(cardValue('Power')).toBe('0.00 kW');
  });
});

/* ── Temperature unit preference ──────────────────────────────────────────── */
describe('LiveMotorStatus — temperature unit preference', () => {
  it('converts the SI celsius payload to °F when that is the user preference', () => {
    h.temp = '\u00B0F';
    renderStatus();

    // 48 °C → 118.4 °F and 30 °C → 86.0 °F via the real convertTempFromSI.
    expect(inlineValue('Front Motor Temp')).toBe(`118.40 ${DEGF}`);
    expect(inlineValue('Battery Temp')).toBe(`86.00 ${DEGF}`);
    expect(inlineValue('Front Motor Temp')).not.toContain(DEGC);
  });
});

/* ── HV isolation status tint ─────────────────────────────────────────────── */
describe('LiveMotorStatus — HV isolation tint', () => {
  it('tints the icon green for a healthy reading (≥500 kΩ)', () => {
    renderStatus({ isolationResistance: 650 });
    expect(isolationIconClass()).toContain('text-emerald-300');
    expect(inlineValue('HV Isolation')).toBe(`650.00 k${OHM}`);
  });

  it('tints amber for a marginal reading (100–499 kΩ)', () => {
    renderStatus({ isolationResistance: 250 });
    expect(isolationIconClass()).toContain('text-amber-300');
    expect(inlineValue('HV Isolation')).toBe(`250.00 k${OHM}`);
  });

  it('tints red for a low reading (<100 kΩ)', () => {
    renderStatus({ isolationResistance: 50 });
    expect(isolationIconClass()).toContain('text-rose-300');
    expect(inlineValue('HV Isolation')).toBe(`50.00 k${OHM}`);
  });

  it('tints muted and shows "—" for a non-finite reading (icon agrees with value)', () => {
    renderStatus({ isolationResistance: Number.POSITIVE_INFINITY });
    // The bug this elevation fixed: a non-finite reading no longer flashes a
    // false danger-red while the value cell reads "—".
    expect(isolationIconClass()).toContain('text-[var(--text-muted)]');
    expect(isolationIconClass()).not.toContain('text-rose-300');
    expect(inlineValue('HV Isolation')).toBe(DASH);
  });
});
