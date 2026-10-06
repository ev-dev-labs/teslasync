import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { GeofenceStatusList, type GeofenceListRow } from './GeofenceStatusList';

const fences: GeofenceListRow[] = [
  { id: 'first', name: 'A very long first geofence name that must remain complete', radius: 500, enabled: true, inside: true, validMap: true },
  { id: 'second', name: 'Disabled inside fence', radius: 0, enabled: false, inside: true, validMap: true },
  { id: 'third', name: 'Missing radius fence', radius: null, enabled: true, inside: false, validMap: false },
];

describe('geofence rich definition rows', () => {
  it('keeps every source-ordered fence, full label, radius and disabled precedence', () => {
    render(<GeofenceStatusList fences={fences} hasCoords formatRadius={radius => radius == null ? '—' : `${radius} m`} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toHaveClass('min-h-[44px]');
    expect(within(rows[0]).getByText(fences[0].name)).toBeVisible();
    expect(within(rows[0]).getByText('Radius: 500 m')).toBeVisible();
    expect(within(rows[0]).getByText('Inside')).toBeVisible();
    expect(within(rows[1]).getByText('Disabled')).toBeVisible();
    expect(within(rows[1]).getByText('Radius: 0 m')).toBeVisible();
    expect(within(rows[2]).getByText('Radius: —')).toBeVisible();
    expect(within(rows[2]).queryByText('Outside')).not.toBeInTheDocument();
    expect(rows[0].querySelector('dt')).not.toHaveClass('truncate');
  });

  it('does not turn unknown coordinates into an outside status', () => {
    render(<GeofenceStatusList fences={[{ ...fences[0], inside: false }]} hasCoords={false} formatRadius={() => '500 m'} />);
    expect(screen.queryByText('Outside')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeVisible();
  });
});
