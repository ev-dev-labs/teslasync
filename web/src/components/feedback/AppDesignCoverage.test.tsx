import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { getAppDesignAttributes, APPLICATION_DESIGNS } from '../ui/app-designs/designs';
import type { PackId } from '@/features/dashboard/widgets/designPacks/types';
import { DataSourceNotice } from './DataSourceNotice';
import { EmptyState } from './EmptyState';
import { InlineCallout } from './InlineCallout';

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

describe('application design feedback composition contract', () => {
  it.each(Object.keys(APPLICATION_DESIGNS) as PackId[])(
    '%s retains independent source states and source-specific recovery',
    (pack) => {
      const retryCached = vi.fn();
      const retryFailed = vi.fn();
      const retryReady = vi.fn();
      const { container, rerender } = render(
        <div data-app-design-preview {...getAppDesignAttributes(pack)} dir="rtl">
          <DataSourceNotice sources={[
            { id: 'cached', label: 'Retained history', query: { data: [], isError: true, refetch: retryCached } },
            { id: 'failed', label: 'Unavailable observations', query: { isError: true, refetch: retryFailed } },
            { id: 'loading', label: 'Loading observations', query: { isFetching: true } },
            { id: 'pending', label: 'Waiting for prerequisite', query: {} },
            { id: 'paused', label: 'Paused observations', query: { fetchStatus: 'paused' } },
            { id: 'ready', label: 'Measured zero', query: { data: 0, refetch: retryReady } },
          ]} />
          <p>Retained reading: 0,00 km</p>
        </div>,
      );
      const notice = screen.getByRole('status');
      expect(notice).toHaveAttribute('data-app-part', 'feedback');
      expect(notice).toHaveAttribute('data-data-state', 'partial');
      expect(notice).toHaveAttribute('data-app-tone', 'warning');
      expect(notice).toHaveAttribute('aria-live', 'polite');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('Retained reading: 0,00 km')).toBeInTheDocument();
      expect(screen.getByText('Refresh paused')).toBeInTheDocument();
      expect(screen.queryByText('Paused offline')).not.toBeInTheDocument();
      expect([...container.querySelectorAll('[data-app-source-state]')].map(
        row => row.getAttribute('data-app-source-state'),
      )).toEqual(['refreshFailed', 'failed', 'loading', 'pending', 'paused', 'ready']);
      fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Retained history' }));
      expect(retryCached).toHaveBeenCalledOnce();
      expect(retryFailed).not.toHaveBeenCalled();
      expect(retryReady).not.toHaveBeenCalled();
      rerender(
        <div data-app-design-preview {...getAppDesignAttributes(pack)}>
          <DataSourceNotice sources={[{ id: 'ready', label: 'Measured zero', query: { data: 0 } }]} />
          <p>Retained reading: 0,00 km</p>
        </div>,
      );
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByText('Retained reading: 0,00 km')).toBeInTheDocument();
    },
  );

  it('keeps navigation and imperative recovery keyboard reachable', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(
      <MemoryRouter>
        <div data-app-design-preview {...getAppDesignAttributes('terminal')}>
          <EmptyState
            message="No matches in this time range"
            actionTo={{ label: 'Review filters', to: '/drives?range=custom' }}
            secondaryAction={{ label: 'Retry observations', onClick: retry }}
          />
          <InlineCallout variant="warning" action={{ label: 'Review retained source', onClick: retry }}>
            Stored observations are still available.
          </InlineCallout>
        </div>
      </MemoryRouter>,
    );
    const navigation = screen.getByRole('link', { name: 'Review filters' });
    expect(navigation).toHaveAttribute('href', '/drives?range=custom');
    await user.tab();
    expect(navigation).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Retry observations' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(retry).toHaveBeenCalledOnce();
    await user.tab();
    expect(screen.getByRole('button', { name: /Review retained source/ })).toHaveFocus();
    await user.keyboard(' ');
    expect(retry).toHaveBeenCalledTimes(2);
  });
});
