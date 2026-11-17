import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDesignBridge } from './AppDesignBridge';

const selection = vi.hoisted(() => ({
  packId: 'v7', appWide: true, isReady: false, error: null as string | null, retry: vi.fn(),
}));
const preload = vi.hoisted(() => vi.fn<(packId: string) => Promise<void>>());
vi.mock('@/hooks/useWidgetDesignPack', () => ({ useWidgetDesignPack: () => selection }));
vi.mock('@/features/dashboard/widgets/designPacks/packModules', () => ({ preloadPackModules: preload }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('saved appearance startup', () => {
  beforeEach(() => {
    Object.assign(selection, { packId: 'v7', appWide: true, isReady: false, error: null });
    selection.retry.mockReset();
    preload.mockReset();
    preload.mockResolvedValue(undefined);
  });
  afterEach(() => { cleanup(); });

  it('holds the application until the verified profile and its presentations are ready', async () => {
    const loading = deferred();
    preload.mockReturnValue(loading.promise);
    const view = render(<AppDesignBridge><div data-testid="application">Application</div></AppDesignBridge>);
    expect(screen.queryByTestId('application')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    selection.isReady = true;
    view.rerender(<AppDesignBridge><div data-testid="application">Application</div></AppDesignBridge>);
    expect(document.documentElement).toHaveAttribute('data-app-design-pack', 'v7');
    expect(screen.queryByTestId('application')).not.toBeInTheDocument();
    await waitFor(() => expect(preload).toHaveBeenCalledWith('v7'));
    await act(async () => { loading.resolve(); });
    expect(screen.getByTestId('application')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('data-app-design-pack', 'v7');
  });

  it('applies Classic before application layout effects measure the shell', () => {
    selection.packId = 'classic';
    selection.isReady = true;
    const measured = vi.fn();
    function Application() {
      useLayoutEffect(() => { measured(document.documentElement.getAttribute('data-app-design-pack')); }, []);
      return <div>Application</div>;
    }
    render(<AppDesignBridge><Application /></AppDesignBridge>);
    expect(measured).toHaveBeenCalledWith('classic');
  });

  it('waits for the current selection when profiles change during preload', async () => {
    selection.isReady = true;
    const first = deferred();
    const second = deferred();
    preload.mockImplementation(packId => packId === 'v7' ? first.promise : second.promise);
    const view = render(<AppDesignBridge><div data-testid="application">Application</div></AppDesignBridge>);
    await waitFor(() => expect(preload).toHaveBeenCalledWith('v7'));
    selection.packId = 'v2';
    view.rerender(<AppDesignBridge><div data-testid="application">Application</div></AppDesignBridge>);
    await waitFor(() => expect(preload).toHaveBeenCalledWith('v2'));
    await act(async () => { first.resolve(); });
    expect(screen.queryByTestId('application')).not.toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('data-app-design-pack', 'v2');
    await act(async () => { second.resolve(); });
    expect(screen.getByTestId('application')).toBeInTheDocument();
  });

  it('allows a retry or explicit default when identity verification fails', () => {
    selection.error = 'offline';
    render(<AppDesignBridge><div data-testid="application">Application</div></AppDesignBridge>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(selection.retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with default appearance' }));
    expect(screen.getByTestId('application')).toBeInTheDocument();
    expect(document.documentElement).not.toHaveAttribute('data-app-design-pack');
  });

  it('allows explicit continuation while verification is still pending', () => {
    render(<AppDesignBridge><div data-testid="application">Application</div></AppDesignBridge>);
    expect(screen.queryByTestId('application')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with default appearance' }));
    expect(screen.getByTestId('application')).toBeInTheDocument();
  });

  it('retries a presentation preload failure before revealing the application', async () => {
    selection.isReady = true;
    preload.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    render(<AppDesignBridge><div data-testid="application">Application</div></AppDesignBridge>);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('application')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByTestId('application')).toBeInTheDocument());
    expect(preload).toHaveBeenCalledTimes(2);
  });

  it('keeps already-mounted content usable if later verification is revoked', async () => {
    selection.isReady = true;
    const view = render(<AppDesignBridge><input aria-label="Draft" /></AppDesignBridge>);
    const input = await screen.findByRole('textbox', { name: 'Draft' });
    fireEvent.change(input, { target: { value: 'Unsaved input' } });
    selection.isReady = false;
    selection.error = 'identity changed';
    view.rerender(<AppDesignBridge><input aria-label="Draft" /></AppDesignBridge>);
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsaved input');
    expect(document.documentElement).not.toHaveAttribute('data-app-design-pack');
  });
});
