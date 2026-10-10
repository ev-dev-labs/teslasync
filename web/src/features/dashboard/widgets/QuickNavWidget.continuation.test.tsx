import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWidget } from '../components/continuation-dashboard-2/testSupport';
import QuickNavWidget from './QuickNavWidget';

describe('canonical quick navigation typography', () => {
  it('keeps native navigation, all ordered destinations and complete descriptions', () => {
    renderWidget(<QuickNavWidget size={{ cols: 1, rows: 4 }} />);
    const links = screen.getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual(['/drives', '/charging', '/analytics', '/battery']);
    for (const label of ['Trip history', 'Sessions & costs', 'Fleet insights', 'Health & degradation']) {
      expect(screen.getByText(label)).toBeVisible();
      expect(screen.getByText(label)).not.toHaveClass('truncate');
    }
    expect(screen.getByRole('navigation', { name: 'Quick navigation' })).toBeVisible();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });
});
