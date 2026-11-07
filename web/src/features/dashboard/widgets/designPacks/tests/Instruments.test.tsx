import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Button } from '@/components/ui';
import InstrumentLayout from '../families/InstrumentLayout';
import { SegmentedMeter } from '@/components/data-display';
import InstrumentPresentation from '../InstrumentPresentation';
import { PackBoundary } from '../PackBoundary';
import { PACK_APPEARANCES } from '../types';

describe.each(Object.values(PACK_APPEARANCES))('instrument %s', appearance => {
  it('retains a measured zero, signed supporting readings, source context and controller actions', () => {
    const refresh = vi.fn();
    const { container } = render(<InstrumentLayout
      appearance={appearance} family="ring"
      headline={<strong>0%</strong>}
      reading={{ value: 0, max: 100, label: 'Recovery', unit: '%' }}
      context={<span>Historical analysis</span>}
      details={<><span>-120 Wh recovered</span><Button onClick={refresh}>Refresh source</Button></>}
    />);
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('-120 Wh recovered')).toBeInTheDocument();
    expect(screen.getByText('Historical analysis')).toBeInTheDocument();
    expect(container.querySelector(`[data-instrument-appearance="${appearance}"]`)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh source' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does not turn a missing observation into zero or a successful state', () => {
    render(<InstrumentLayout appearance={appearance} family="meter"
      headline={<span>—</span>} reading={{ value: null, max: 100, label: 'Coverage' }}
      details={<Button disabled>Source unavailable</Button>} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Source unavailable' })).toBeDisabled();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });
});

it('preserves fractional pixel cells on a non-percent scale and exposes the original reading', () => {
  render(<SegmentedMeter value={2.25} max={10} label="Measured coverage" />);
  const meter = screen.getByRole('meter', { name: /Measured coverage: 2.25/ });
  expect(meter).toHaveAttribute('aria-valuenow', '2.25');
  expect(meter).toHaveAttribute('aria-valuemax', '10');
  const cells = Array.from(meter.children).map(cell => cell.firstElementChild as HTMLElement);
  expect(cells).toHaveLength(20);
  expect(cells[3].style.width).toBe('100%');
  expect(cells[4].style.width).toBe('50%');
  expect(cells[5].style.width).toBe('0%');
});

it.each(['line', 'bars', 'map'] as const)('retains the original %s graphic and controls without inventing a headline or numeric scale', family => {
  const { container } = render(<InstrumentLayout appearance="pixel" family={family}
    instrument={<svg role="img" aria-label="Original source plot"><path d="M0 5 L5 0" strokeDasharray="4 2" /></svg>}
    details={<Button disabled>Source unavailable</Button>} />);
  expect(container.querySelector(`[data-widget-family="${family}"]`)).not.toBeNull();
  expect(screen.getByRole('img', { name: 'Original source plot' }).querySelector('path')).toHaveAttribute('stroke-dasharray', '4 2');
  expect(screen.getByRole('button', { name: 'Source unavailable' })).toBeDisabled();
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

it('preserves the provided semantic icon in Pixel instead of replacing every instrument with a battery', () => {
  render(<InstrumentLayout appearance="pixel" family="meter" headline={<span>Source reading</span>}
    icon={<svg data-testid="original-semantic-icon"><path d="M0 0 L5 5" /></svg>} />);
  expect(screen.getByTestId('original-semantic-icon')).toBeInTheDocument();
});

it.each([
  { value: null, max: 100, expected: /No reading/ },
  { value: Number.NaN, max: 100, expected: /No reading/ },
  { value: -5, max: 100, expected: /-5/ },
  { value: 120, max: 100, expected: /120/ },
  { value: 10, max: 0, expected: /10/ },
])('does not announce a fabricated in-range meter for $value / $max', ({ value, max, expected }) => {
  render(<SegmentedMeter value={value} max={max} label="Coverage" />);
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: expected })).not.toHaveAttribute('aria-valuenow');
});

it('retains a mounted detail interaction when its position changes between appearances', () => {
  function Details() {
    const [count, setCount] = useState(0);
    return <Button onClick={() => setCount(value => value + 1)}>Count {count}</Button>;
  }
  const props = { family: 'meter' as const, headline: <span>Measured coverage</span>, details: <Details /> };
  const view = render(<InstrumentLayout {...props} appearance="owner" />);
  fireEvent.click(screen.getByRole('button', { name: 'Count 0' }));
  view.rerender(<InstrumentLayout {...props} appearance="pixel" />);
  fireEvent.click(screen.getByRole('button', { name: 'Count 1' }));
  expect(screen.getByRole('button', { name: 'Count 2' })).toBeInTheDocument();
});

it('keeps Classic intact and loads a non-Classic instrument without replacing its controller state', async () => {
  function Controller() {
    const [count, setCount] = useState(0);
    const control = <Button onClick={() => setCount(value => value + 1)}>Source action {count}</Button>;
    return <InstrumentPresentation family="meter" headline={control}><div>Classic layout {control}</div></InstrumentPresentation>;
  }
  const view = render(<PackBoundary requestedPackId="classic"><Controller /></PackBoundary>);
  expect(screen.getByText('Classic layout')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Source action 0' }));
  view.rerender(<PackBoundary requestedPackId="v4"><Controller /></PackBoundary>);
  await waitFor(() => expect(screen.queryByText('Classic layout')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Source action 1' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Source action 1' }));
  expect(screen.getByRole('button', { name: 'Source action 2' })).toBeInTheDocument();
});
