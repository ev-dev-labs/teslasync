import { createInstance } from 'i18next';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import { computePeriodStats } from '@/lib/drivesAggregation';
import { DrivesSourceNotices } from './DrivesSourceNotices';

const english = createInstance();
type Props = Parameters<typeof DrivesSourceNotices>[0];
type FsdPayload = NonNullable<Props['fsdState']['data']>;
beforeAll(async () => { await english.init({ lng: 'en', resources: {} }); });
afterEach(cleanup);

function mount(overrides: Partial<Props> = {}) {
  const refetchFsd = vi.fn();
  const props: Props = {
    t: english.getFixedT('en'),
    drivesState: deriveDataState({ data: [], isSuccess: true }, { provenance: 'historical' }),
    fsdRangeSupported: true,
    fsdState: deriveDataState<FsdPayload>({ isPending: true }),
    fsdDataAvailable: false, refetchFsd, isDrivesLoading: false,
    currentStats: computePeriodStats([]), missingEfficiencyCount: 0, ...overrides,
  };
  return { refetchFsd, ...render(<DrivesSourceNotices {...props} />) };
}

describe('DrivesSourceNotices pilot independent source trust and retry', () => {
  it('keeps FSD initial loading quiet without inventing unavailable or partial data', () => {
    const { container } = mount({ isDrivesLoading: true });
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps unsupported-range explanation without offering a misleading FSD retry', () => {
    mount({ fsdRangeSupported: false });
    expect(screen.getByText('FSD evidence is unavailable for this range')).toBeInTheDocument();
    expect(screen.getByText(/FSD attribution supports up to 366 days/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps fatal FSD failure source-local with one reachable wrapping retry and unchanged callback', () => {
    const { refetchFsd } = mount({
      fsdState: deriveDataState<FsdPayload>({ error: new Error('FSD source failed'), isError: true }),
    });
    expect(screen.getByText('FSD evidence could not be loaded')).toBeInTheDocument();
    const explanation = screen.getByText(/Drive history remains available, but FSD badges/);
    expect(explanation.tagName).toBe('P');
    expect(explanation).toHaveClass('min-w-0', 'break-words');
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'whitespace-normal');
    fireEvent.click(retry);
    expect(refetchFsd).toHaveBeenCalledOnce();
  });

  it('keeps retained drive refresh failure nonfatal with independent retry and visible partial evidence', () => {
    const retry = vi.fn();
    const drivesState = deriveDataState({
      data: [], error: new Error('Drive refresh failed'), isError: true, refetch: retry,
    }, { provenance: 'historical' });
    mount({
      drivesState, missingEfficiencyCount: 2,
      currentStats: { ...computePeriodStats([]), count: 3, efficiencyMeasuredCount: 1 },
    });
    expect(drivesState.fatalError).toBeNull();
    expect(screen.getByText('Drive History may be out of date')).toBeInTheDocument();
    expect(screen.getByText('Efficiency evidence is partial')).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 drives include measured energy/)).toBeInTheDocument();
    expect(screen.queryByText('FSD evidence could not be loaded')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('preserves paused retained data without claiming a proven device-offline state', () => {
    mount({ drivesState: deriveDataState({ data: [], fetchStatus: 'paused' }) });
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });

  it.each([true, false])('suppresses partial-efficiency notice while initial loading=%s', isDrivesLoading => {
    mount({
      isDrivesLoading, missingEfficiencyCount: 1,
      currentStats: { ...computePeriodStats([]), count: 1 },
    });
    expect(screen.queryByText('Efficiency evidence is partial') != null).toBe(!isDrivesLoading);
  });
});
