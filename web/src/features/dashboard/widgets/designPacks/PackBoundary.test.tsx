import { useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui';
import { PACK_MANIFEST, resolveAvailablePackId, resolvePackId } from './manifest';
import { PackBoundary, usePackModule, usePackPresentation } from './PackBoundary';

vi.mock('@/lib/errorReporter', () => ({ reportFrontendError: vi.fn() }));

function ExistingController() {
  const [count, setCount] = useState(0);
  const pack = usePackPresentation();
  return (
    <div>
      <span data-testid="presentation">{pack}</span>
      <span data-testid="controller-state">{count}</span>
      <Button onClick={() => setCount(value => value + 1)}>Existing action</Button>
    </div>
  );
}

function ModuleController({ load }: { load: () => Promise<{ default: ComponentType }> }) {
  const Presentation = usePackModule(usePackPresentation(), load);
  return <><ExistingController />{Presentation && <Presentation />}</>;
}

function PortalScope() {
  return createPortal(<span data-testid="portal-pack">{usePackPresentation()}</span>, document.body);
}

describe('PackBoundary', () => {
  it('keeps the existing controller mounted with its state and actions across pack requests', () => {
    const view = render(<PackBoundary requestedPackId="classic"><ExistingController /></PackBoundary>);
    fireEvent.click(screen.getByRole('button', { name: 'Existing action' }));
    view.rerender(<PackBoundary requestedPackId="v3"><ExistingController /></PackBoundary>);
    expect(screen.getByTestId('presentation')).toHaveTextContent('v3');
    expect(screen.getByTestId('controller-state')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: 'Existing action' }));
    expect(screen.getByTestId('controller-state')).toHaveTextContent('2');
  });

  it('falls back to Classic for unknown, null, and retired IDs without suppressing content', () => {
    const view = render(<PackBoundary requestedPackId="retired"><ExistingController /></PackBoundary>);
    expect(screen.getByTestId('presentation')).toHaveTextContent('classic');
    view.rerender(<PackBoundary requestedPackId={null}><ExistingController /></PackBoundary>);
    expect(screen.getByRole('button', { name: 'Existing action' })).toBeInTheDocument();
    expect(resolvePackId('retired')).toBe('classic');
    expect(resolvePackId(null)).toBe('classic');
    expect(resolveAvailablePackId('v7')).toBe('v7');
  });

  it('records all eight distinct IDs without claiming unavailable presentations are active', () => {
    expect(PACK_MANIFEST.map(entry => entry.id)).toEqual([
      'classic', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7',
    ]);
    expect(PACK_MANIFEST.every(entry => entry.available)).toBe(true);
    expect(resolvePackId('v5')).toBe('v5');
  });

  it('does not request presentation modules while Classic is selected', () => {
    const load = vi.fn();
    render(<PackBoundary requestedPackId="classic"><ModuleController load={load} /></PackBoundary>);
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByTestId('presentation')).toHaveTextContent('classic');
  });

  it('shows failed imports and retries without resetting the existing controller', async () => {
    const load = vi.fn<() => Promise<{ default: ComponentType }>>()
      .mockRejectedValueOnce(new Error('synthetic module failure'))
      .mockResolvedValueOnce({ default: () => <p>Loaded presentation</p> });
    render(<PackBoundary requestedPackId="v3"><ModuleController load={load} /></PackBoundary>);
    fireEvent.click(screen.getByRole('button', { name: 'Existing action' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Component failed to load');
    expect(screen.getByTestId('controller-state')).toHaveTextContent('1');
    expect(screen.getByTestId('presentation')).toHaveTextContent('v3');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Loaded presentation')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('controller-state')).toHaveTextContent('1');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('propagates the selected presentation through a fullscreen-style portal', () => {
    const view = render(<PackBoundary requestedPackId="v5"><PortalScope /></PackBoundary>);
    expect(screen.getByTestId('portal-pack')).toHaveTextContent('v5');
    view.rerender(<PackBoundary requestedPackId="classic"><PortalScope /></PackBoundary>);
    expect(screen.getByTestId('portal-pack')).toHaveTextContent('classic');
  });
});
