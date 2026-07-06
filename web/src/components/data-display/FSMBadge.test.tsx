/**
 * FSMBadge — behaviour + hardening contract.
 *
 * FSMBadge chips a finite-state-machine type (the backend `fsm_name`) with a
 * colour-coded, translated short label. The invariants worth pinning:
 *
 *   - Every one of the eight canonical machines in `@/types/fsm` maps to a
 *     stable label + Badge variant (a missing machine used to fall through to a
 *     raw snake_case string — the regression this guards).
 *   - Labels resolve through i18n (`t(key, fallback)`), never hardcoded copy.
 *   - Lookup is case-insensitive and whitespace-trimmed.
 *   - Unknown, empty, or nullish input never yields an empty chip — it shows the
 *     raw value or the em-dash placeholder.
 *   - An extra className is forwarded to the shared Badge shell.
 *
 * i18n is stubbed via a hoisted spy that returns the `defaultValue` argument, so
 * we can both assert the rendered English copy AND that the correct key/fallback
 * pair was threaded through.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({ t: tSpy }),
  };
});

import { FSMBadge } from './FSMBadge';

const VARIANT_BG = {
  info: 'bg-blue-100',
  success: 'bg-green-100',
  warning: 'bg-yellow-100',
  danger: 'bg-red-100',
  neutral: 'bg-gray-100',
} as const;

interface KnownCase {
  type: string;
  label: string;
  variant: keyof typeof VARIANT_BG;
  key: string;
}

const KNOWN: KnownCase[] = [
  { type: 'vehicle', label: 'Vehicle', variant: 'info', key: 'fsm.typeLabel.vehicle' },
  { type: 'drive_session', label: 'Drive', variant: 'success', key: 'fsm.typeLabel.driveSession' },
  { type: 'charge_session', label: 'Charge', variant: 'warning', key: 'fsm.typeLabel.chargeSession' },
  { type: 'command', label: 'Command', variant: 'danger', key: 'fsm.typeLabel.command' },
  { type: 'notification', label: 'Notify', variant: 'neutral', key: 'fsm.typeLabel.notification' },
  { type: 'alert_cooldown', label: 'Cooldown', variant: 'neutral', key: 'fsm.typeLabel.alertCooldown' },
  { type: 'automation', label: 'Automation', variant: 'info', key: 'fsm.typeLabel.automation' },
  {
    type: 'telemetry_connection',
    label: 'Telemetry',
    variant: 'info',
    key: 'fsm.typeLabel.telemetryConnection',
  },
];

/** The Badge renders a single outer <span>; return it or fail loudly. */
function chip(container: HTMLElement): HTMLSpanElement {
  const el = container.querySelector('span');
  if (!el) throw new Error('FSMBadge did not render a span');
  return el as HTMLSpanElement;
}

beforeEach(() => {
  tSpy.mockClear();
});

describe('FSMBadge — canonical machine types', () => {
  it.each(KNOWN)('renders $type as "$label" with the $variant variant', ({ type, label, variant }) => {
    const { container } = render(<FSMBadge type={type} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(chip(container).className).toContain(VARIANT_BG[variant]);
  });

  it.each(KNOWN)('threads the i18n key + English fallback for $type', ({ type, label, key }) => {
    render(<FSMBadge type={type} />);
    expect(tSpy).toHaveBeenCalledWith(key, label);
  });

  it('covers all eight registered FSM machines with unique labels', () => {
    expect(KNOWN).toHaveLength(8);
    const labels = KNOWN.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);

    render(
      <>
        {KNOWN.map((c) => (
          <FSMBadge key={c.type} type={c.type} />
        ))}
      </>,
    );
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe('FSMBadge — input normalization', () => {
  it('matches case-insensitively for uppercase input', () => {
    const { container } = render(<FSMBadge type="DRIVE_SESSION" />);
    expect(screen.getByText('Drive')).toBeInTheDocument();
    expect(chip(container).className).toContain('bg-green-100');
  });

  it('ignores surrounding whitespace', () => {
    const { container } = render(<FSMBadge type="  charge_session  " />);
    expect(screen.getByText('Charge')).toBeInTheDocument();
    expect(chip(container).className).toContain('bg-yellow-100');
  });
});

describe('FSMBadge — unknown / empty / nullish input never blanks the chip', () => {
  it('shows the raw trimmed value with the neutral variant for an unknown type', () => {
    const { container } = render(<FSMBadge type="  mystery_machine  " />);
    expect(screen.getByText('mystery_machine')).toBeInTheDocument();
    expect(chip(container).className).toContain('bg-gray-100');
  });

  it('renders the em-dash placeholder (via i18n) for an empty string', () => {
    const { container } = render(<FSMBadge type="" />);
    expect(chip(container).textContent).toBe('—');
    expect(tSpy).toHaveBeenCalledWith('fsm.typeLabel.unknown', '—');
  });

  it('renders the placeholder for a whitespace-only string', () => {
    const { container } = render(<FSMBadge type="   " />);
    expect(chip(container).textContent).toBe('—');
  });

  it('renders the placeholder when type is null', () => {
    const { container } = render(<FSMBadge type={null} />);
    expect(chip(container).textContent).toBe('—');
    expect(chip(container).className).toContain('bg-gray-100');
  });

  it('renders the placeholder when type is undefined', () => {
    const { container } = render(<FSMBadge type={undefined} />);
    expect(chip(container).textContent).toBe('—');
  });
});

describe('FSMBadge — shell + passthrough', () => {
  it('forwards an extra className onto the badge chip', () => {
    const { container } = render(<FSMBadge type="vehicle" className="ml-2 shrink-0" />);
    const el = chip(container);
    expect(el.className).toContain('ml-2');
    expect(el.className).toContain('shrink-0');
  });

  it('renders an accessible span chip whose text is the label', () => {
    const { container } = render(<FSMBadge type="command" />);
    const el = chip(container);
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toContain('rounded-full');
    expect(el.textContent).toBe('Command');
  });
});
