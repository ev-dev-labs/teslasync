import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Button, GlassPanel, Heading } from '@/components/ui';
import type { DataStateSource } from '@/api/dataState';
import { VehiclePanelGrid } from './VehiclePanelGrid';
import { VehicleSourcePanel } from './VehicleSourcePanel';

describe('independent production vehicle sources', () => {
  it('keeps neighboring evidence and both panel shells through first-load, empty and fatal error', () => {
    const retry = vi.fn();
    const view = (query: DataStateSource<unknown>) => (
      <MemoryRouter>
        <VehiclePanelGrid label="synthetic independent source fixture" items={[
          { id: 'state', size: 'half', content:
            <VehicleSourcePanel query={{ ...query, refetch: retry }} label="Live source"
              renderEmpty={false} emptyMessage="No live observations" errorMessage="Live request failed">
              <GlassPanel><Heading level="panel">Live source</Heading>Live facts</GlassPanel>
            </VehicleSourcePanel>
          },
          { id: 'history', size: 'half', content:
            <VehicleSourcePanel query={{ data: ['real retained fixture row'], isSuccess: true }}
              label="History source" emptyMessage="No history" errorMessage="History failed">
              <GlassPanel><Heading level="panel">History source</Heading><Button>Open history</Button>Independent history fact</GlassPanel>
            </VehicleSourcePanel>
          },
        ]} />
      </MemoryRouter>
    );
    const { container, rerender } = render(view({ isPending: true }));
    const history = screen.getByRole('button', { name: 'Open history' });
    expect(screen.getByRole('status', { name: 'Loading Live source' })).toBeInTheDocument();
    rerender(view({ isSuccess: true }));
    expect(screen.getByText('No live observations')).toBeVisible();
    rerender(view({ error: new Error('Fixture network failure'), isError: true }));
    expect(container.querySelectorAll('[data-print-card]')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Live source' })).toBeVisible();
    expect(screen.getByText('Independent history fact')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open history' })).toBe(history);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByText('Live facts')).not.toBeInTheDocument();
  });

  it('retains the same focused content on failed refresh and paused/offline refresh, never synthetic production prose', () => {
    const retained = { observation: 7 };
    const view = (query: DataStateSource<unknown>) => (
      <MemoryRouter>
        <VehicleSourcePanel query={query} label="Battery snapshot" emptyMessage="No observations" errorMessage="Battery failed">
          <GlassPanel><Heading level="panel">Battery snapshot</Heading><Button>Inspect retained observation</Button><span>Observation 7</span></GlassPanel>
        </VehicleSourcePanel>
      </MemoryRouter>
    );
    const { rerender } = render(view({ data: retained, isSuccess: true }));
    const control = screen.getByRole('button', { name: 'Inspect retained observation' });
    control.focus();
    rerender(view({ data: retained, error: new Error('Refresh failed'), isError: true }));
    expect(screen.getByText('Observation 7')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Inspect retained observation' })).toBe(control);
    expect(control).toHaveFocus();
    expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
    expect(screen.queryByText(/synthetic/i)).not.toBeInTheDocument();
    rerender(view({ data: retained, fetchStatus: 'paused' }));
    expect(screen.getByText('Observation 7')).toBeVisible();
    expect(screen.getByText('The latest values are temporarily unavailable. Previously loaded data remains visible.')).toBeVisible();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.getByRole('button', { name: 'Inspect retained observation' })).toBe(control);
    expect(control).toHaveFocus();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });

  it('does not treat a state response envelope without its state field as measured values', () => {
    render(<VehicleSourcePanel query={{ data: { state: null }, isSuccess: true }}
      available={false} renderEmpty={false} label="Battery source"
      emptyMessage="No battery state" errorMessage="Battery failed">
      <span>Fabricated battery zero</span>
    </VehicleSourcePanel>);
    expect(screen.getByRole('heading', { name: 'Battery source' })).toBeVisible();
    expect(screen.getByText('No battery state')).toBeVisible();
    expect(screen.queryByText('Fabricated battery zero')).not.toBeInTheDocument();
  });
});
