import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DrivesBriefSource } from './DrivesBriefSource';
import { DrivesAnalysisFailure } from './DrivesAnalysisFailure';

describe('DrivesBriefSource', () => {
  it('keeps the brief title but withholds invented activity and status during initial loading', () => {
    render(<DrivesBriefSource initial fatalError={null} onRetry={vi.fn()}>
      <div>Resolved operating facts</div>
    </DrivesBriefSource>);
    expect(screen.getByRole('heading', { name: 'Activity, efficiency, and exceptions in context' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Resolved operating facts')).not.toBeInTheDocument();
  });

  it('keeps the title and exposes source-specific recovery after an initial failure', () => {
    const onRetry = vi.fn();
    render(<MemoryRouter>
      <DrivesBriefSource initial={false} fatalError={new Error('request failed')} onRetry={onRetry}>
        <div>Resolved operating facts</div>
      </DrivesBriefSource>
    </MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Activity, efficiency, and exceptions in context' })).toBeInTheDocument();
    expect(screen.getByText('Drive history could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('Resolved operating facts')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('preserves usable children without an extra surface when the fatal error is absent', () => {
    render(<DrivesBriefSource initial={false} fatalError={null} onRetry={vi.fn()}>
      <div>Retained operating facts</div>
    </DrivesBriefSource>);
    expect(screen.getByText('Retained operating facts')).toBeInTheDocument();
    expect(screen.queryByText('Drive history could not be loaded')).not.toBeInTheDocument();
  });

  it('does not manufacture an awaiting-data brief from a null response', () => {
    render(<DrivesBriefSource initial={false} unavailable fatalError={null} onRetry={vi.fn()}>
      <div>0 completed drives</div>
    </DrivesBriefSource>);
    expect(screen.getByText('Drive history is unavailable')).toBeInTheDocument();
    expect(screen.queryByText('0 completed drives')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('DrivesAnalysisFailure', () => {
  it('retains the analysis landmark and both panel titles with independently reachable retry actions', () => {
    const onRetry = vi.fn();
    render(<MemoryRouter><DrivesAnalysisFailure error={new Error('request failed')} onRetry={onRetry} /></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Trends and highlights' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Drives over time' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Highlights' })).toBeInTheDocument();
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    expect(retries).toHaveLength(2);
    fireEvent.click(retries[1]);
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
