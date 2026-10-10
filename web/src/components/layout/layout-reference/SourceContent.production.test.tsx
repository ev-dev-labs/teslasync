import type { ReactNode } from 'react';
import { createInstance, type i18n } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import { EmptyState } from '@/components/feedback/EmptyState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Button } from '@/components/ui/Button';
import { useDataState } from '@/hooks/useDataState';
import { ApiError } from '@/lib/resilience';
import { typography } from '@/lib/tokens';
import { LayoutCard } from './LayoutCard';
import { SourceContent, type SourceContentProps, type SourceState } from './SourceContent';

vi.unmock('react-i18next');
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

let translations: i18n;

beforeEach(async () => {
  translations = createInstance();
  await translations.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: {} },
      fr: {
        translation: {
          developerReference: { layout: { source: { loading: 'Chargement de {{label}}' } } },
          dataSources: { staleMessage: 'Les données précédentes restent visibles pendant la récupération.' },
          error: { retry: 'Réessayer' },
        },
      },
    },
  });
});

const baseProps = {
  label: 'Drive history',
  emptyMessage: 'No drives match this range.',
  errorMessage: 'Drive history could not be loaded.',
} satisfies Pick<SourceContentProps, 'label' | 'emptyMessage' | 'errorMessage'>;

function mount(children: ReactNode) {
  return render(
    <I18nextProvider i18n={translations}>
      <MemoryRouter initialEntries={['/source']}>{children}</MemoryRouter>
    </I18nextProvider>,
  );
}

function TrustSource({ source }: { source: DataStateSource<number> }) {
  const trust = useDataState(source);
  const state: SourceState = trust.fatalError
    ? 'error'
    : !trust.hasData
      ? 'loading'
      : trust.status === 'stale'
        ? 'retained'
        : 'ready';
  return (
    <SourceContent {...baseProps} state={state} error={trust.fatalError ?? trust.refreshError}
      errorRecovery={trust.retry ? { onRetry: trust.retry } : undefined}>
      <span data-testid="real-reading">{trust.data}</span>
      <span>All drive rows</span>
      <span>Drive annotations and exports</span>
    </SourceContent>
  );
}

describe('SourceContent production recovery contract', () => {
  it('keeps long RTL recovery copy complete with a wrapping, reachable retry and retained zero', () => {
    const retry = vi.fn();
    const retryLabel = 'Retry the affected source without replacing previously loaded drive history';
    const retainedMessage = 'Previously loaded drive history and every annotation remain available while the affected source recovers.';
    translations.addResource('en', 'translation', 'error.retry', retryLabel);
    mount(
      <div dir="rtl">
        <SourceContent {...baseProps} state="retained" retainedMessage={retainedMessage}
          errorRecovery={{ onRetry: retry }}>
          <span>All drive rows</span><span>Annotations and exports</span><span>{0}</span>
        </SourceContent>
      </div>,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(retainedMessage);
    expect(status).toHaveClass(typography.color.secondary);
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status.parentElement).toHaveClass('min-w-0', 'break-words');
    expect(status.closest('[dir]')).toHaveAttribute('dir', 'rtl');
    const action = screen.getByRole('button', { name: retryLabel });
    expect(action).toHaveAttribute('type', 'button');
    expect(action).toHaveClass('h-auto', 'max-w-full', 'min-h-11', 'md:min-h-9', 'whitespace-normal');
    expect(within(action).getByText(retryLabel)).toHaveClass('min-w-0', 'break-words');
    expect(screen.getByText('All drive rows')).toBeInTheDocument();
    expect(screen.getByText('Annotations and exports')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(action);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('keeps caller-sized loading geometry inside the localized named status boundary', async () => {
    await translations.changeLanguage('fr');
    const retry = vi.fn();
    mount(
      <SourceContent {...baseProps} label="Historique" state="loading"
        loadingContent={<Skeleton height={220} className="w-full" />}
        emptyContent={<span>{baseProps.emptyMessage}</span>}
        errorRecovery={{ onRetry: retry }}>
        <span>All drive rows</span>
      </SourceContent>,
    );
    const loading = screen.getByRole('status', { name: 'Chargement de Historique' });
    const skeleton = loading.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveStyle({ height: '220px' });
    expect(skeleton).toHaveClass('w-full');
    expect(loading.querySelector('.h-6')).not.toBeInTheDocument();
    expect(loading.querySelector('.h-24')).not.toBeInTheDocument();
    expect(screen.queryByText(baseProps.emptyMessage)).not.toBeInTheDocument();
    expect(screen.queryByText('All drive rows')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
  });

  it('renders all caller-prepared loading content without adding a duplicate skeleton body', () => {
    mount(
      <SourceContent {...baseProps} state="loading" loadingContent={
        <><span>All drive rows</span><span>Annotations and exports</span></>
      }>
        <span>Drive annotations and exports</span>
      </SourceContent>,
    );
    const loading = screen.getByRole('status', { name: 'Loading Drive history' });
    expect(within(loading).getByText('All drive rows')).toBeInTheDocument();
    expect(within(loading).getByText('Annotations and exports')).toBeInTheDocument();
    expect(loading.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument();
    expect(screen.queryByText('Drive annotations and exports')).not.toBeInTheDocument();
  });

  it('preserves caller-owned specialist prerequisite copy and actions without default-body duplication', () => {
    const changeVehicle = vi.fn();
    const suppressed = vi.fn();
    const { container } = mount(
      <SourceContent {...baseProps} state="empty"
        loadingContent={<span>All drive rows</span>}
        emptyContent={
          <EmptyState message="Historique conservé"
            action={{ label: 'Change vehicle', onClick: changeVehicle }} />
        }
        emptyRecovery={{ action: { label: 'Clear filters', onClick: suppressed } }}>
        <span>Annotations and exports</span>
      </SourceContent>,
    );
    const status = screen.getByRole('status');
    expect(container.querySelector('[data-empty-state]')).toContainElement(status);
    expect(status).toHaveTextContent('Historique conservé');
    expect(screen.queryByText(baseProps.emptyMessage)).not.toBeInTheDocument();
    expect(screen.queryByText('All drive rows')).not.toBeInTheDocument();
    expect(screen.queryByText('Annotations and exports')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    expect(changeVehicle).not.toHaveBeenCalled();
    expect(suppressed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Change vehicle' }));
    expect(changeVehicle).toHaveBeenCalledTimes(1);
    expect(suppressed).not.toHaveBeenCalled();
  });

  it('keeps a caller-prepared unresolved body and every caller-owned navigation action', () => {
    const { container } = mount(
      <Routes>
        <Route path="/source" element={
          <SourceContent {...baseProps} state="empty" emptyContent={
            <>
              <span>Historique conservé</span>
              <EmptyState message="Annotations and exports"
                actionTo={{ label: 'Configure source', to: '/settings' }} />
            </>
          }>
            <span>All drive rows</span>
          </SourceContent>
        } />
        <Route path="/settings" element={<span>Source settings destination</span>} />
      </Routes>,
    );
    const body = container.querySelector('[data-empty-state]');
    expect(body).toContainElement(screen.getByText('Historique conservé'));
    expect(body).toContainElement(screen.getByText('Annotations and exports'));
    expect(screen.queryByText(baseProps.emptyMessage)).not.toBeInTheDocument();
    expect(screen.queryByText('All drive rows')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Configure source' });
    expect(body).toContainElement(link);
    expect(link).toHaveAttribute('href', '/settings');
    fireEvent.click(link);
    expect(screen.getByText('Source settings destination')).toBeInTheDocument();
  });

  it.each([null, undefined])('uses meaningful loading and empty defaults for a %s slot', (slot) => {
    const clearFilters = vi.fn();
    const view = (state: SourceState) => (
      <I18nextProvider i18n={translations}>
        <MemoryRouter>
          <SourceContent {...baseProps} state={state} loadingContent={slot} emptyContent={slot}
            emptyRecovery={{ action: { label: 'Clear filters', onClick: clearFilters } }}>
            <span>All drive rows</span>
          </SourceContent>
        </MemoryRouter>
      </I18nextProvider>
    );
    const { rerender, container } = render(view('loading'));
    const loading = screen.getByRole('status', { name: 'Loading Drive history' });
    expect(loading).toHaveClass('space-y-3');
    expect(loading.querySelector('.h-6.w-2\\/3')).toHaveAttribute('aria-hidden', 'true');
    expect(loading.querySelector('.h-24.w-full')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(view('empty'));
    expect(container.querySelector('[data-empty-state]')).toContainElement(screen.getByRole('status'));
    expect(screen.getByRole('status')).toHaveClass('py-6');
    expect(screen.getByText(baseProps.emptyMessage)).toBeInTheDocument();
    expect(screen.queryByText('All drive rows')).not.toBeInTheDocument();
    expect(clearFilters).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(clearFilters).toHaveBeenCalledTimes(1);
  });

  it('ignores both specialist slots during ready and retained refresh recovery without remounting children', () => {
    const retry = vi.fn();
    const exportRows = vi.fn();
    const view = (state: SourceState) => (
      <I18nextProvider i18n={translations}>
        <MemoryRouter>
          <SourceContent {...baseProps} state={state} error={new ApiError('refresh', 500)}
            loadingContent={<span>{baseProps.errorMessage}</span>}
            emptyContent={<span>{baseProps.emptyMessage}</span>}
            errorRecovery={{ onRetry: retry }}>
            <span data-testid="mounted-rows">All drive rows</span>
            <span>Annotations and exports</span><span>{0}</span>
            <Button onClick={exportRows}>Export retained rows</Button>
          </SourceContent>
        </MemoryRouter>
      </I18nextProvider>
    );
    const { rerender } = render(view('ready'));
    const rows = screen.getByTestId('mounted-rows');
    const action = screen.getByRole('button', { name: 'Export retained rows' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(view('retained'));
    expect(screen.getByTestId('mounted-rows')).toBe(rows);
    expect(screen.getByRole('button', { name: 'Export retained rows' })).toBe(action);
    expect(screen.getByText('Annotations and exports')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByText(baseProps.errorMessage)).not.toBeInTheDocument();
    expect(screen.queryByText(baseProps.emptyMessage)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    fireEvent.click(action);
    expect(exportRows).toHaveBeenCalledTimes(1);
    rerender(view('ready'));
    expect(screen.getByTestId('mounted-rows')).toBe(rows);
    expect(screen.getByRole('button', { name: 'Export retained rows' })).toBe(action);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it.each(['loading', 'empty', 'error', 'ready', 'retained'] as const)(
    'isolates supplied slots and recovery from the independent neighbor when the source is %s',
    (state) => {
      const retry = vi.fn();
      const neighborAction = vi.fn();
      mount(
        <>
          <LayoutCard title="Drive history panel" footer={<span>Source footer</span>}>
            <SourceContent {...baseProps} state={state} error={new ApiError('failure', 500)}
              loadingContent={<span>Historique</span>}
              emptyContent={<span>Historique conservé</span>}
              errorRecovery={{ onRetry: retry }}>
              <span>All drive rows</span><span>Annotations and exports</span><span>{0}</span>
            </SourceContent>
          </LayoutCard>
          <LayoutCard title="Charging panel" footer={<span>Independent footer</span>}>
            <SourceContent {...baseProps} state="ready">
              <span>All charging sessions</span><span>Charging chart and annotations</span>
              <Button onClick={neighborAction}>Export charging</Button>
            </SourceContent>
          </LayoutCard>
        </>,
      );
      expect(screen.getByRole('heading', { name: 'Drive history panel' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Charging panel' })).toBeInTheDocument();
      expect(screen.getByText('Source footer')).toBeInTheDocument();
      expect(screen.getByText('Independent footer')).toBeInTheDocument();
      expect(screen.queryByText('Historique') !== null).toBe(state === 'loading');
      expect(screen.queryByText('Historique conservé') !== null).toBe(state === 'empty');
      expect(screen.queryByRole('alert') !== null).toBe(state === 'error');
      expect(screen.queryByText('All drive rows') !== null).toBe(state === 'ready' || state === 'retained');
      if (state === 'error' || state === 'retained') {
        expect(retry).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(retry).toHaveBeenCalledTimes(1);
      }
      if (state === 'error') expect(screen.getByRole('alert')).toHaveTextContent(baseProps.errorMessage);
      if (state === 'retained') expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
      const neighbor = screen.getByText('All charging sessions').closest<HTMLElement>('[data-card]');
      expect(neighbor).not.toBeNull();
      if (!neighbor) throw new Error('Neighbor panel shell is missing');
      expect(within(neighbor).getByText('Charging chart and annotations')).toBeInTheDocument();
      expect(within(neighbor).queryByRole('status')).not.toBeInTheDocument();
      expect(within(neighbor).queryByRole('alert')).not.toBeInTheDocument();
      fireEvent.click(within(neighbor).getByRole('button', { name: 'Export charging' }));
      expect(neighborAction).toHaveBeenCalledTimes(1);
    },
  );

  it('renders every ready child, including a real zero, despite an incidental error', () => {
    mount(
      <SourceContent {...baseProps} state="ready" error={new Error('background')}>
        <span>All drive rows</span><span>Annotations and exports</span><span>{0}</span>
      </SourceContent>,
    );
    expect(screen.getByText('All drive rows')).toBeInTheDocument();
    expect(screen.getByText('Annotations and exports')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the original loading geometry and localized source label, not children or recovery', async () => {
    await translations.changeLanguage('fr');
    const retry = vi.fn();
    mount(
      <SourceContent {...baseProps} label="Historique" state="loading" errorRecovery={{ onRetry: retry }}>
        <span>All drive rows</span>
      </SourceContent>,
    );
    const loading = screen.getByRole('status', { name: 'Chargement de Historique' });
    expect(loading.querySelector('.h-6.w-2\\/3')).toHaveAttribute('aria-hidden', 'true');
    expect(loading.querySelector('.h-24.w-full')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText('All drive rows')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
  });

  it('uses compact fatal recovery and invokes a real retry exactly once on click', () => {
    const retry = vi.fn();
    mount(
      <SourceContent {...baseProps} state="error" error={new ApiError('server', 500)}
        errorRecovery={{ onRetry: retry }}>
        <span>All drive rows</span>
      </SourceContent>,
    );
    expect(screen.getByRole('alert')).toHaveClass('p-3');
    expect(screen.getByText(baseProps.errorMessage)).toBeInTheDocument();
    expect(screen.queryByText('All drive rows')).not.toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('retains the required message-only fatal API without inventing a retry', () => {
    mount(<SourceContent {...baseProps} state="error"><span>All drive rows</span></SourceContent>);
    expect(screen.getByRole('alert')).toHaveTextContent(baseProps.errorMessage);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('forwards the existing not-found resource and navigation recovery API', () => {
    mount(
      <Routes>
        <Route path="/source" element={
          <SourceContent {...baseProps} state="error" error={new ApiError('gone', 404)}
            errorRecovery={{ resourceName: 'Drive', listHref: '/drives' }}>
            <span>All drive rows</span>
          </SourceContent>
        } />
        <Route path="/drives" element={<span>Drive list destination</span>} />
      </Routes>,
    );
    expect(screen.getByText('Drive not found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));
    expect(screen.getByText('Drive list destination')).toBeInTheDocument();
  });

  it('does not invent a not-found destination when navigation recovery is absent', () => {
    mount(
      <SourceContent {...baseProps} state="error" error={new ApiError('gone', 404)}>
        <span>All drive rows</span>
      </SourceContent>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(baseProps.errorMessage);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows an empty source without requiring or inventing an action', () => {
    const { container } = mount(
      <SourceContent {...baseProps} state="empty"><span>All drive rows</span></SourceContent>,
    );
    expect(container.querySelector('[data-empty-state]')).toContainElement(screen.getByRole('status'));
    expect(screen.getByRole('status')).toHaveClass('py-6');
    expect(screen.getByText(baseProps.emptyMessage)).toBeInTheDocument();
    expect(screen.queryByText('All drive rows')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('forwards both meaningful empty actions without running either automatically', () => {
    const clearFilters = vi.fn();
    const changeVehicle = vi.fn();
    mount(
      <SourceContent {...baseProps} state="empty" emptyRecovery={{
        action: { label: 'Clear filters', onClick: clearFilters },
        secondaryAction: { label: 'Change vehicle', onClick: changeVehicle },
      }}>
        <span>All drive rows</span>
      </SourceContent>,
    );
    expect(clearFilters).not.toHaveBeenCalled();
    expect(changeVehicle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(clearFilters).toHaveBeenCalledTimes(1);
    expect(changeVehicle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Change vehicle' }));
    expect(changeVehicle).toHaveBeenCalledTimes(1);
    expect(clearFilters).toHaveBeenCalledTimes(1);
  });

  it.each(['primary', 'secondary'] as const)('preserves %s link navigation and precedence over callbacks', (slot) => {
    const suppressed = vi.fn();
    const recovery: SourceContentProps['emptyRecovery'] = slot === 'primary'
      ? {
          action: { label: 'Suppressed callback', onClick: suppressed },
          actionTo: { label: 'Configure source', to: '/settings' },
        }
      : {
          secondaryAction: { label: 'Suppressed callback', onClick: suppressed },
          secondaryActionTo: { label: 'Configure source', to: '/settings' },
        };
    mount(
      <Routes>
        <Route path="/source" element={
          <SourceContent {...baseProps} state="empty" emptyRecovery={recovery}>
            <span>All drive rows</span>
          </SourceContent>
        } />
        <Route path="/settings" element={<span>Source settings destination</span>} />
      </Routes>,
    );
    const link = screen.getByRole('link', { name: 'Configure source' });
    expect(link).toHaveAttribute('href', '/settings');
    expect(screen.queryByRole('button', { name: 'Suppressed callback' })).not.toBeInTheDocument();
    fireEvent.click(link);
    expect(screen.getByText('Source settings destination')).toBeInTheDocument();
    expect(suppressed).not.toHaveBeenCalled();
  });

  it('uses a generic retained notice and never replaces any child with an error', () => {
    mount(
      <SourceContent {...baseProps} state="retained" error={new ApiError('refresh', 500)}>
        <span>All drive rows</span><span>Annotations and exports</span><span>{0}</span>
      </SourceContent>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Previously loaded data remains visible while affected sources recover.',
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('All drive rows')).toBeInTheDocument();
    expect(screen.getByText('Annotations and exports')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText(/synthetic/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('localizes retained copy and retry without losing content or firing automatically', async () => {
    await translations.changeLanguage('fr');
    const retry = vi.fn();
    mount(
      <SourceContent {...baseProps} state="retained" error={new Error('refresh')}
        errorRecovery={{ onRetry: retry }}>
        <span>All drive rows</span>
      </SourceContent>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Les données précédentes restent visibles pendant la récupération.',
    );
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('All drive rows')).toBeInTheDocument();
  });

  it('accepts a caller-specific localized retained message', () => {
    mount(
      <SourceContent {...baseProps} state="retained" retainedMessage="Historique conservé">
        <span>All drive rows</span>
      </SourceContent>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Historique conservé');
    expect(screen.queryByText(/Previously loaded data/)).not.toBeInTheDocument();
    expect(screen.getByText('All drive rows')).toBeInTheDocument();
  });

  it('preserves mounted retained content and its actions across refresh failure and recovery', () => {
    const exportRows = vi.fn();
    const view = (state: SourceState) => (
      <I18nextProvider i18n={translations}>
        <MemoryRouter>
          <SourceContent {...baseProps} state={state} error={state === 'retained' ? new Error('refresh') : undefined}>
            <span data-testid="mounted-rows">All drive rows</span>
            <Button onClick={exportRows}>Export retained rows</Button>
          </SourceContent>
        </MemoryRouter>
      </I18nextProvider>
    );
    const { rerender } = render(view('ready'));
    const rows = screen.getByTestId('mounted-rows');
    const action = screen.getByRole('button', { name: 'Export retained rows' });
    rerender(view('retained'));
    expect(screen.getByTestId('mounted-rows')).toBe(rows);
    expect(screen.getByRole('button', { name: 'Export retained rows' })).toBe(action);
    fireEvent.click(action);
    expect(exportRows).toHaveBeenCalledTimes(1);
    rerender(view('ready'));
    expect(screen.getByTestId('mounted-rows')).toBe(rows);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps real zero and all retained children through the existing DataState contract', () => {
    const retry = vi.fn();
    mount(<TrustSource source={{ data: 0, error: new ApiError('refresh', 500), refetch: retry }} />);
    expect(screen.getByTestId('real-reading')).toHaveTextContent('0');
    expect(screen.getByText('All drive rows')).toBeInTheDocument();
    expect(screen.getByText('Drive annotations and exports')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('allows only the existing DataState fatalError to replace unretained content', () => {
    mount(<TrustSource source={{ error: new ApiError('initial failure', 500) }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(baseProps.errorMessage);
    expect(screen.queryByTestId('real-reading')).not.toBeInTheDocument();
    expect(screen.queryByText('All drive rows')).not.toBeInTheDocument();
  });

  it.each(['ready', 'loading', 'error', 'empty', 'retained'] as const)(
    'preserves both panel shells and the successful neighbor while the source is %s',
    (state) => {
      const neighborAction = vi.fn();
      mount(
        <>
          <LayoutCard title="Drive history panel" footer={<span>Source footer</span>}>
            <SourceContent {...baseProps} state={state} error={new ApiError('failure', 500)}>
              <span>All drive rows</span>
            </SourceContent>
          </LayoutCard>
          <LayoutCard title="Charging panel" actions={<Button onClick={neighborAction}>Export charging</Button>}
            footer={<span>Independent footer</span>}>
            <SourceContent {...baseProps} state="ready">
              <span>All charging sessions</span><span>Charging chart and annotations</span>
            </SourceContent>
          </LayoutCard>
        </>,
      );
      expect(screen.getByRole('heading', { name: 'Drive history panel' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Charging panel' })).toBeInTheDocument();
      expect(screen.getByText('Source footer')).toBeInTheDocument();
      expect(screen.getByText('Independent footer')).toBeInTheDocument();
      const neighbor = screen.getByText('All charging sessions').closest<HTMLElement>('[data-card]');
      expect(neighbor).not.toBeNull();
      if (!neighbor) throw new Error('Neighbor panel shell is missing');
      expect(within(neighbor).getByText('Charging chart and annotations')).toBeInTheDocument();
      fireEvent.click(within(neighbor).getByRole('button', { name: 'Export charging' }));
      expect(neighborAction).toHaveBeenCalledTimes(1);
    },
  );
});
