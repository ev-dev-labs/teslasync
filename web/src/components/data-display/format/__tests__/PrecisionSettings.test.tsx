import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { Current } from '../Current';
import { Percentage } from '../Percentage';
import { Currency } from '../Currency';
import { FormattedNumber } from '../Number';
import { Duration } from '../Duration';
import { AnimatedNumber } from '../../AnimatedNumber';
import { MetricBar } from '../../MetricBar';
import { MetricTile } from '../../MetricTile';
import { StatCard } from '../../StatCard';
import { Delta } from '../../Delta';
import { BatteryDelta } from '../../BatteryDelta';
import { ProgressRing } from '../../ProgressRing';
import { RouteDisplay } from '../../RouteDisplay';
import { SourceLayerBadge } from '../../SourceLayerBadge';
import { LinearGauge } from '@/components/charts/LinearGauge';
import { ThresholdBar } from '@/components/charts/ThresholdBar';
import { BipolarBar } from '@/components/charts/BipolarBar';
import { MetricCard } from '../../MetricCard';
import { InlineMetric } from '../../InlineMetric';
import type { ReactNode } from 'react';

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/components/ui/Tooltip', () => ({
  Tooltip: ({ content, children }: { content: ReactNode; children: ReactNode }) =>
    <div title={String(content)}>{children}</div>,
}));

let previousPreferences: ReturnType<typeof getFormatterPreferences>;

beforeEach(() => {
  previousPreferences = getFormatterPreferences();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

afterEach(() => {
  cleanup();
  setGlobalPrecision(previousPreferences.precision);
  setGlobalLocale(previousPreferences.locale);
});

describe('mounted numeric displays follow formatter settings', () => {
  it('keeps explicitly counted gauge units and their scales integer-formatted', () => {
    render(
      <>
        <LinearGauge value={1234} max={5000} label="cycles" unit=" cycles" kind="count" />
        <ThresholdBar value={1234} min={0} max={5000} label="events" unit=" events" kind="count" />
        <BipolarBar value={1234} max={5000} label="samples" unit=" samples" kind="count" />
      </>,
    );
    act(() => setGlobalPrecision(4));
    expect(screen.getAllByText('1,234')).toHaveLength(3);
    expect(screen.getByText('0 – 5,000 cycles')).toBeInTheDocument();
    expect(screen.getByText('5,000 events')).toBeInTheDocument();
  });
  it('uses measurement/count kinds instead of integer magnitude or translated labels', () => {
    render(
      <>
        <LinearGauge value={42} max={100} label="nombre" unit="%" />
        <ThresholdBar value={42} min={0} max={100} label="nombre" unit="V" />
        <BipolarBar value={42} max={100} label="nombre" unit="W" />
        <MetricTile value={42} label="nombre" unit="A" />
        <MetricTile value={1234} label="measurement-sounding label" unit="requests" kind="count" />
        <AnimatedNumber value={42} duration={0} kind="measurement" />
        <AnimatedNumber value={42} duration={0} kind="count" decimals={1} />
        <StatCard value={42} label="typed card" kind="measurement" />
        <MetricCard value={42} label="typed metric" kind="measurement" />
        <InlineMetric value={42} icon={null} kind="measurement" />
      </>,
    );
    expect(screen.getAllByText('42.00')).toHaveLength(8);
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('42.0')).toBeInTheDocument();
    act(() => setGlobalPrecision(3));
    expect(screen.getAllByText('42.000')).toHaveLength(8);
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('42.0')).toBeInTheDocument();
  });

  it('updates battery percentages, progress summaries and age tooltips without changing geometry', () => {
    const { container } = render(
      <>
        <BatteryDelta startPct={80} endPct={78.7654} />
        <ProgressRing value={1} max={3} centerLabel="00:30" />
        <SourceLayerBadge source="l1" ageMs={1234.56} />
      </>,
    );
    const arc = container.querySelector('circle[stroke-linecap]');
    const offset = arc?.getAttribute('stroke-dashoffset');
    expect(screen.getByText('−1.23%')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName('Progress: 33.33%');
    expect(screen.getByTitle(/age: 1.23 s/)).toBeInTheDocument();
    act(() => setGlobalPrecision(3));
    expect(screen.getByText('−1.235%')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAccessibleName('Progress: 33.333%');
    expect(screen.getByTitle(/age: 1.235 s/)).toBeInTheDocument();
    expect(arc?.getAttribute('stroke-dashoffset')).toBe(offset);
    expect(screen.getByText('00:30')).toBeInTheDocument();
  });

  it('keeps endpoint classification canonical while coordinates follow the diagnostic floor and settings', () => {
    render(<RouteDisplay start={{ lat: 47.7111, lon: -122.18 }} end={{ lat: 47.7144, lon: -122.18 }} testId="route" />);
    const route = screen.getByTestId('route');
    // These endpoints exceed 100m but share the historic 2dp comparison key.
    expect(route).toHaveTextContent('round trip');
    expect(route).toHaveTextContent('47.71110');
    act(() => setGlobalPrecision(7));
    expect(route).toHaveTextContent('47.7111000');
    expect(route).toHaveTextContent('round trip');
    act(() => setGlobalPrecision(0));
    expect(route).toHaveTextContent('47.71110');
    expect(route).toHaveTextContent('round trip');
  });
  it('updates measurements, percentages and currency including hover titles without new props', () => {
    const { container } = render(
      <>
        <Current amps={12.3456} />
        <Percentage ratio={0.123456} />
        <Currency value={12.3456} />
        <FormattedNumber value={12.3456} unit="V" />
        <Current amps={0} />
        <Current amps={null} />
      </>,
    );
    expect(screen.getByText('12.35 A')).toHaveAttribute('title', '12.35 A');
    expect(screen.getByText('12.35%')).toHaveAttribute('title', '12.35%');
    expect(screen.getByText('$12.35')).toHaveAttribute('title', '$12.35');

    act(() => setGlobalPrecision(3));
    expect(screen.getByText('12.346 A')).toHaveAttribute('title', '12.346 A');
    expect(screen.getByText('12.346%')).toHaveAttribute('title', '12.346%');
    expect(screen.getByText('$12.346')).toHaveAttribute('title', '$12.346');
    expect(screen.getByText('12.346 V')).toHaveAttribute('title', '12.346 V');
    expect(screen.getByText('0.000 A')).toBeInTheDocument();
    expect(screen.getByText('—')).not.toHaveAttribute('title');

    act(() => {
      setGlobalPrecision(0);
      setGlobalLocale('de-DE');
    });
    expect(screen.getByText('12 A')).toBeInTheDocument();
    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(container.textContent).not.toContain('NaN');
    act(() => setGlobalPrecision(1));
    expect(screen.getByText('12,3 A')).toHaveAttribute('title', '12,3 A');
  });

  it('preserves explicit overrides, integer counter defaults, clock and caller-formatted strings', () => {
    render(
      <>
        <Current amps={1.23456} precision={4} />
        <Currency value={1.23456} precision={1} />
        <AnimatedNumber value={1234} duration={0} />
        <MetricTile value={42} label="count" />
        <MetricTile value="1.234 diagnostic" label="formatted" />
        <StatCard value="03:04" label="caller clock" />
        <Duration ms={125_000} variant="clock" className="clock-duration" />
      </>,
    );
    const clock = document.querySelector('.clock-duration')?.textContent;
    act(() => setGlobalPrecision(3));
    expect(screen.getByText('1.2346 A')).toBeInTheDocument();
    expect(screen.getByText('$1.2')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('1.234 diagnostic')).toBeInTheDocument();
    expect(screen.getByText('03:04')).toBeInTheDocument();
    expect(document.querySelector('.clock-duration')?.textContent).toBe(clock);
    expect(screen.getByTitle('125,000.000 ms')).toBeInTheDocument();
  });

  it('updates a mounted bar and percentage delta without changing raw accessibility values', () => {
    render(
      <>
        <MetricBar value={12.3456} max={100} label="measurement" color="#fff" />
        <Delta metric={{ unit: 'count', direction: 'neutral' }} current={4} previous={3} display="both" />
      </>,
    );
    const bar = screen.getByRole('progressbar');
    expect(screen.getByText('12.35')).toBeInTheDocument();
    expect(screen.getByText('(33.33%)')).toBeInTheDocument();
    act(() => setGlobalPrecision(3));
    expect(screen.getByText('12.346')).toBeInTheDocument();
    expect(screen.getByText('(33.333%)')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(bar).toHaveAttribute('aria-valuenow', '12.3456');
  });
});
