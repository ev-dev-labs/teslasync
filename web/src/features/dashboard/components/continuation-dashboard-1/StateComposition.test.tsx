import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StateComposition } from './StateComposition';

describe('dashboard state composition preservation', () => {
  it('keeps caller order, exact percentages and all evidence when a tiny fill is omitted', () => {
    render(<StateComposition summary="Prepared state proportions" segments={[
      { id: 'first', label: 'Driving', widthPercent: 99.8, color: 'cyan', detail: '99.8% · 100 min' },
      { id: 'second', label: 'Idle', widthPercent: 0.2, color: 'orange', hideFromTrack: true, detail: '0.2% · 0.2 min' },
    ]} />);
    const track = screen.getByRole('img', { name: 'Prepared state proportions' });
    expect(track.children).toHaveLength(1);
    expect(track.children[0]).toHaveStyle({ width: '99.8%' });
    const entries = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('Driving');
    expect(entries[1]).toHaveTextContent('Idle');
    expect(entries[1]).toHaveTextContent('0.2% · 0.2 min');
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it.each([NaN, Infinity, -1, 101])('retains textual evidence instead of inventing a valid scale for %s', widthPercent => {
    render(<StateComposition summary="Invalid source scale" segments={[
      { id: 'unknown', label: 'Source reading', widthPercent, color: 'gray', detail: 'Original source evidence' },
    ]} />);
    expect(screen.getByRole('group', { name: 'Invalid source scale' })).toBeInTheDocument();
    expect(screen.getByText('Original source evidence')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
