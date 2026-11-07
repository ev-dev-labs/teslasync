import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackBoundary } from '../designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackId } from '../designPacks/types';
import WidgetClimateReadout from './WidgetClimateReadout';

function readout(pack: PackId, value: string) {
  return <PackBoundary requestedPackId={pack}><WidgetClimateReadout>
    <span>{value}</span>
  </WidgetClimateReadout></PackBoundary>;
}

describe.each(Object.entries(PACK_APPEARANCES))('climate readout %s', (pack, appearance) => {
  it('preserves the caller reading without inventing a numeric scale or interactive dial', () => {
    const view = render(readout(pack as PackId, '-10°C'));
    expect(screen.getByText('-10°C')).toBeVisible();
    expect(view.container.querySelector('[data-climate-readout]')).toHaveAttribute('data-climate-readout', appearance);
    const arc = view.container.querySelector('circle[stroke-dasharray]');
    expect(arc).toHaveAttribute('stroke-dasharray', '285 371');
    expect(view.container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    for (const role of ['meter', 'progressbar', 'slider', 'button']) expect(screen.queryByRole(role)).not.toBeInTheDocument();

    view.rerender(readout(pack as PackId, '32°F'));
    expect(screen.getByText('32°F')).toBeVisible();
    expect(arc).toHaveAttribute('stroke-dasharray', '285 371');
    view.rerender(readout(pack as PackId, 'Unknown'));
    expect(screen.getByText('Unknown')).toBeVisible();
    expect(arc).toHaveAttribute('stroke-dasharray', '285 371');
  });
});

it('keeps Classic markup unchanged and isolates gradients between widget instances', () => {
  const view = render(readout('classic', '0°C'));
  expect(view.container.innerHTML).toBe('<span>0°C</span>');
  view.rerender(<>{readout('v1', 'Inside')}{readout('v1', 'Outside')}</>);
  const gradients = [...view.container.querySelectorAll('linearGradient')].map(gradient => gradient.id);
  expect(new Set(gradients).size).toBe(2);
  expect([...view.container.querySelectorAll('circle[stroke-dasharray]')].map(arc => arc.getAttribute('stroke')))
    .toEqual(gradients.map(id => `url(#${id})`));
});
