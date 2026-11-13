import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from '@/components/ui';
import { PACK_APPEARANCES } from '../types';
import InstrumentLayout from './InstrumentLayout';

const radialAppearances = new Set([
  'studio', 'iconic', 'ambient', 'analog', 'observatory', 'material', 'deco', 'memphis',
]);

describe.each(Object.values(PACK_APPEARANCES))('native instrument composition: %s', appearance => {
  it('qualifies only the actual radial renderer while retaining source geometry, details and actions', () => {
    const refresh = vi.fn();
    const { container } = render(<InstrumentLayout appearance={appearance} family="ring"
      headline={<strong>25%</strong>} reading={{ value: 25, max: 100, label: 'Recovery', color: '#123456' }}
      context={<span>Retained historical source</span>}
      instrument={<svg role="img" aria-label="Caller plot" viewBox="0 0 7 11"><path d="M0 5 L5 0" /></svg>}
      details={<Button onClick={refresh}>Refresh source</Button>} />);
    const gauge = container.querySelector('svg[data-chart-family="radial-gauge"]');
    if (radialAppearances.has(appearance)) {
      expect(gauge).toHaveAttribute('data-app-part', 'chart-gauge');
      expect(gauge).not.toHaveAttribute('data-app-part', 'chart chart-plot');
      expect(gauge).toHaveAttribute('data-chart-variant', 'embedded');
      expect(gauge).toHaveAttribute('viewBox', '0 0 100 100');
      expect(gauge).toHaveAttribute('aria-hidden', 'true');
      expect(gauge).toHaveClass('absolute', 'inset-0', 'size-full', '-rotate-90');
      expect(gauge?.parentElement).toHaveAttribute('data-app-metric', 'ring');
      expect(gauge?.querySelector('[data-chart-gauge-track]')).toHaveAttribute('r', '45');
      if (appearance === 'analog') {
        expect(gauge).toHaveAttribute('data-chart-gauge-shape', 'needle');
        expect(gauge?.querySelectorAll('[data-chart-gauge-tick]')).toHaveLength(11);
        const needle = gauge?.querySelector('[data-chart-gauge-marker]');
        const angle = -157.5 * Math.PI / 180;
        expect(Number(needle?.getAttribute('x2'))).toBeCloseTo(50 + 35 * Math.cos(angle));
        expect(Number(needle?.getAttribute('y2'))).toBeCloseTo(50 + 35 * Math.sin(angle));
        expect(needle).toHaveAttribute('stroke', '#123456');
        expect(gauge?.querySelector('[data-chart-gauge-fill]')).toBeNull();
      } else {
        expect(gauge).toHaveAttribute('data-chart-gauge-shape', 'arc');
        const arc = gauge?.querySelector('[data-chart-gauge-fill]');
        expect(arc).toHaveAttribute('stroke-dasharray', '25 100');
        expect(arc).toHaveAttribute('pathLength', '100');
        expect(arc).toHaveAttribute('stroke-width', appearance === 'iconic' ? '8' : '5');
        expect(arc).toHaveAttribute('stroke', '#123456');
      }
    } else {
      expect(gauge).toBeNull();
    }
    const source = screen.getByRole('img', { name: 'Caller plot' });
    expect(source).not.toHaveAttribute('data-chart-family');
    expect(source).not.toHaveAttribute('data-app-part');
    expect(source.querySelector('path')).toHaveAttribute('d', 'M0 5 L5 0');
    expect(screen.getByText('Retained historical source')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh source' }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});

it.each([
  { value: 0, max: 100, ratio: 0 },
  { value: 2.25, max: 10, ratio: 0.225 },
  { value: -5, max: 100, ratio: 0 },
  { value: 125, max: 100, ratio: 1 },
  { value: 10, max: 0, ratio: null },
  { value: 10, max: -1, ratio: null },
  { value: 10, max: Number.NaN, ratio: null },
  { value: 10, max: Infinity, ratio: null },
])('preserves native arc and needle ratio geometry for $value / $max', ({ value, max, ratio }) => {
  const view = render(<InstrumentLayout appearance="studio" family="ring" headline={<span>Source reading</span>}
    reading={{ value, max, label: 'Coverage' }} />);
  let gauge = view.container.querySelector('[data-chart-family="radial-gauge"]')!;
  expect(gauge.querySelector('[data-chart-gauge-track]')).toBeInTheDocument();
  const arc = gauge.querySelector('[data-chart-gauge-fill]');
  if (ratio == null) expect(arc).toBeNull();
  else expect(arc).toHaveAttribute('stroke-dasharray', `${ratio * 100} 100`);

  view.rerender(<InstrumentLayout appearance="analog" family="ring" headline={<span>Source reading</span>}
    reading={{ value, max, label: 'Coverage' }} />);
  gauge = view.container.querySelector('[data-chart-family="radial-gauge"]')!;
  const needle = gauge.querySelector('[data-chart-gauge-marker]');
  expect(gauge.querySelectorAll('[data-chart-gauge-tick]')).toHaveLength(11);
  if (ratio == null) expect(needle).toBeNull();
  else {
    const angle = (ratio * 270 - 225) * Math.PI / 180;
    expect(Number(needle?.getAttribute('x2'))).toBeCloseTo(50 + 35 * Math.cos(angle));
    expect(Number(needle?.getAttribute('y2'))).toBeCloseTo(50 + 35 * Math.sin(angle));
  }
});

it.each([null, Number.NaN, Infinity, -Infinity])('never creates a native radial reading for %s', value => {
  const { container } = render(<InstrumentLayout appearance="analog" family="ring" headline={<span>Unknown</span>}
    reading={{ value, max: 100, label: 'Coverage' }} />);
  expect(container.querySelector('[data-chart-family="radial-gauge"]')).toBeNull();
  expect(screen.getByText('Unknown')).toBeInTheDocument();
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
});

it('does not replace shared fallback ownership or invent a gauge without a lead', () => {
  const view = render(<InstrumentLayout appearance="pixel" family="ring" headline={<span>25%</span>}
    reading={{ value: 25, max: 100, label: 'Coverage' }} />);
  expect(view.container.querySelector('[data-app-metric="segments"]')).toBeInTheDocument();
  expect(view.container.querySelector('[data-chart-family="radial-gauge"]')).toBeNull();
  view.rerender(<InstrumentLayout appearance="precision" family="meter" headline={<span>25%</span>}
    reading={{ value: 25, max: 100, label: 'Coverage' }} />);
  expect(view.container.querySelector('[data-app-metric="bar"]')).toBeInTheDocument();
  expect(view.container.querySelector('[data-chart-family="radial-gauge"]')).toBeNull();
  view.rerender(<InstrumentLayout appearance="studio" family="ring"
    reading={{ value: 25, max: 100, label: 'Coverage' }} />);
  expect(view.container.querySelector('[data-chart-family="radial-gauge"]')).toBeNull();
});
