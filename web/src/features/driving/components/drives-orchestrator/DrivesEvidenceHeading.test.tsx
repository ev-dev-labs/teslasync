import { createInstance } from 'i18next';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Drive } from '@/types/driving';
import { DrivesEvidenceHeading } from './DrivesEvidenceHeading';

const english = createInstance();
type Props = Parameters<typeof DrivesEvidenceHeading>[0];
const drive: Drive = {
  id: 1, vehicleId: 7, startTs: '2026-10-11T10:00:00Z', endTs: null,
  durationS: 0, distanceM: 0, startAddress: null, endAddress: null,
  startLat: null, startLon: null, endLat: null, endLon: null,
  startBatteryPct: null, endBatteryPct: null, energyUsedWh: null,
  regenEnergyWh: null, avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null,
  outsideTempAvgC: null, insideTempAvgC: null, score: null, endedStatus: null,
  createdAt: '', updatedAt: '',
};

beforeAll(async () => { await english.init({ lng: 'en', resources: {} }); });
afterEach(cleanup);

function mount(overrides: Partial<Props> = {}) {
  const setUrlBatch = vi.fn();
  const props: Props = {
    t: english.getFixedT('en'), hasDrivePayload: true, fmtCompact: value => String(value),
    sortedDrives: [drive], desktopEvidence: false, fsdDataAvailable: true,
    sortBy: 'date', setUrlBatch, ...overrides,
  };
  return { setUrlBatch, ...render(<DrivesEvidenceHeading {...props} />) };
}

describe('DrivesEvidenceHeading pilot presentation and sort preservation', () => {
  it('keeps the heading, loaded count and all four named sort actions with neutral selected chrome', () => {
    const { container } = mount();
    expect(screen.getByRole('heading', { name: 'Drive evidence(1)' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(4);
    const recent = screen.getByRole('button', { name: 'Sort by Recent' });
    expect(recent).toHaveAttribute('aria-pressed', 'true');
    expect(recent).toHaveClass('bg-[var(--control-bg)]', 'min-h-11', 'min-w-11', 'md:min-h-9');
    expect(container.querySelector('[class*="cyan-"]')).toBeNull();
    expect(container.querySelectorAll('svg[aria-hidden="true"][focusable="false"]')).toHaveLength(3);
  });

  it.each([
    ['Recent', null], ['Distance', 'distance'], ['Efficiency', 'efficiency'], ['FSD share', 'fsd'],
  ] as const)('preserves the exact %s sort reset and never mutates workspace or collection scope', (label, sort) => {
    const { setUrlBatch } = mount();
    fireEvent.click(screen.getByRole('button', { name: `Sort by ${label}` }));
    expect(setUrlBatch).toHaveBeenCalledExactlyOnceWith({ sort, sortdir: null, page: null });
  });

  it('keeps unavailable FSD disabled without disabling the other sorts', () => {
    const { setUrlBatch } = mount({ fsdDataAvailable: false });
    const fsd = screen.getByRole('button', { name: 'Sort by FSD share' });
    expect(fsd).toBeDisabled();
    fireEvent.click(fsd);
    expect(setUrlBatch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sort by Distance' })).toBeEnabled();
  });

  it('keeps keyboard activation and the selected pressed state', async () => {
    const user = userEvent.setup();
    const { setUrlBatch } = mount({ sortBy: 'distance' });
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Sort by Distance' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(setUrlBatch).toHaveBeenCalledExactlyOnceWith({ sort: 'distance', sortdir: null, page: null });
    expect(screen.getByRole('button', { name: 'Sort by Distance' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([true, false])('keeps the heading without inventing actions for desktop=%s', desktopEvidence => {
    mount({ desktopEvidence });
    expect(screen.getByRole('heading')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(desktopEvidence ? 0 : 4);
  });

  it.each([true, false])('distinguishes measured empty count from unknown payload=%s', hasDrivePayload => {
    mount({ sortedDrives: [], hasDrivePayload });
    expect(screen.getByRole('heading')).toHaveTextContent(hasDrivePayload ? '(0)' : '(—)');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
