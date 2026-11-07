import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Button } from '@/components/ui';
import StatusLayout from '../families/SecurityStatusLayout';
import StatusPresentation from '../StatusPresentation';
import StatStatusPresentation from '../StatStatusPresentation';
import { PackBoundary } from '../PackBoundary';
import { PACK_APPEARANCES } from '../types';

describe.each(Object.values(PACK_APPEARANCES))('status %s', appearance => {
  it('retains zero, signed readings, independent unknowns and actual controller callbacks', () => {
    const retry = vi.fn();
    render(<StatusLayout appearance={appearance}
      headline={<span>0 observed failures</span>} icon={null}
      details={<><span>-120 Nm</span><span>Temperature —</span>
        <Button onClick={retry}>Retry source</Button><Button disabled>Unavailable action</Button></>}
    />);
    expect(screen.getByText('0 observed failures')).toBeInTheDocument();
    expect(screen.getByText('-120 Nm')).toBeInTheDocument();
    expect(screen.getByText('Temperature —')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unavailable action' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry source' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

it.each(Object.entries(PACK_APPEARANCES))('reuses the existing statistic readout without losing values, units or context in %s', async (id, appearance) => {
  const { container } = render(<PackBoundary requestedPackId={id}>
    <StatStatusPresentation
      stats={[
        { label: 'Observed failures', value: 0 },
        { label: 'Torque', value: -120, unit: 'Nm' },
        { label: 'Temperature', value: null, unit: '°C' },
      ]}
      icon={null} cols={2} footer={<span>Independent historical source</span>}
    >
      <span>Classic statistics</span>
    </StatStatusPresentation>
  </PackBoundary>);
  await waitFor(() => expect(container.querySelector(`[data-status-appearance="${appearance}"]`)).not.toBeNull());
  expect(screen.queryByText('Classic statistics')).not.toBeInTheDocument();
  for (const value of ['Observed failures', '0', 'Torque', '-120', 'Nm', 'Temperature', '—', 'Independent historical source']) {
    expect(screen.getByText(value, { exact: true })).toBeInTheDocument();
  }
});

it('preserves detail state and focus when Owner reorders the same mounted slots', () => {
  function Details() {
    const [expanded, setExpanded] = useState(false);
    return <Button onClick={() => setExpanded(value => !value)}>{expanded ? 'Collapse evidence' : 'Expand evidence'}</Button>;
  }
  const props = { headline: <span>Assessment unknown</span>, icon: null, details: <Details /> };
  const view = render(<StatusLayout {...props} appearance="studio" />);
  fireEvent.click(screen.getByRole('button', { name: 'Expand evidence' }));
  const control = screen.getByRole('button', { name: 'Collapse evidence' });
  control.focus();
  view.rerender(<StatusLayout {...props} appearance="owner" />);
  expect(screen.getByRole('button', { name: 'Collapse evidence' })).toBe(control);
  expect(control).toHaveFocus();
  view.rerender(<StatusLayout {...props} appearance="pixel" />);
  expect(screen.getByRole('button', { name: 'Collapse evidence' })).toBe(control);
});

it('loads the shared status family without replacing the mounted data/action controller', async () => {
  function Controller() {
    const [pending, setPending] = useState(false);
    const action = <Button disabled={pending} onClick={() => setPending(true)}>{pending ? 'Pending source action' : 'Source action'}</Button>;
    return <StatusPresentation headline={action} icon={null} details={null}><div>Classic status {action}</div></StatusPresentation>;
  }
  const view = render(<PackBoundary requestedPackId="classic"><Controller /></PackBoundary>);
  fireEvent.click(screen.getByRole('button', { name: 'Source action' }));
  view.rerender(<PackBoundary requestedPackId="v4"><Controller /></PackBoundary>);
  await waitFor(() => expect(screen.queryByText('Classic status')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Pending source action' })).toBeDisabled();
});
