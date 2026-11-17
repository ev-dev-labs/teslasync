import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { FsdObservatoryJournalTable } from './FsdObservatoryJournalTable';
import { fsdInsights } from './__tests__/fixtures';

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDateTime: (value: string) => `preferred:${value}` }),
}));

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

describe('FsdObservatoryJournalTable native anchor controls', () => {
  it('retains journal/reset order, unknown drive absence and native modified/keyboard navigation', async () => {
    const user = userEvent.setup();
    const events = fsdInsights().drive_analytics.observatory.timeline;
    const { container } = render(
      <MemoryRouter>
        <FsdObservatoryJournalTable events={events} />
        <Location />
      </MemoryRouter>,
    );
    const sourceLinks = events.filter(event => event.kind === 'drive' && event.drive_id != null);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(sourceLinks.length);
    links.forEach((link, index) => {
      expect(link).toHaveAttribute('href', `/drives/${sourceLinks[index].drive_id}`);
      expect(link).toHaveTextContent(`preferred:${sourceLinks[index].at}`);
      expect(link).toHaveAttribute('data-app-part', 'button');
      expect(link).toHaveAttribute('data-app-variant', 'ghost');
      expect(link).toHaveAttribute('data-app-size', 'sm');
      expect(link).not.toHaveAttribute('role', 'button');
    });
    expect(screen.getAllByTestId('fsd-observatory-reset').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('tr[data-app-part~="table-row"]').length).toBeGreaterThanOrEqual(events.length);
    let preventedByRouter = true;
    const cancelBrowserNavigation = (event: MouseEvent) => {
      preventedByRouter = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener('click', cancelBrowserNavigation, { once: true });
    try {
      fireEvent.click(links[0], { ctrlKey: true });
    } finally {
      document.removeEventListener('click', cancelBrowserNavigation);
    }
    expect(preventedByRouter).toBe(false);
    expect(screen.getByTestId('location')).toHaveTextContent('/');
    links[0].focus();
    expect(links[0]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent(`/drives/${sourceLinks[0].drive_id}`);
  });
});
