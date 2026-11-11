import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { JobProgressDrawer } from './JobProgressDrawer';
import { ToastProvider } from './Toast';
import {
  expectAppDesignDataMode, matchesAppDesignCss, matchingAppDesignDataRules,
  setAppDesignTestProfile,
} from './appDesignCss.test-utils';
import { SavedViewMenu } from '../data-display/SavedViewMenu';
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '../ui/app-designs/designs';
import { exportKeys, exportDownloadUrl, type ExportJobSummary } from '@/api/hooks/useExports';
import { savedViewsKeys } from '@/api/hooks/useSavedViews';
import type { SavedView } from '@/api/types';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';

const drawerPreference = 'teslasync.exportDrawer.state';
const fullName = 'Retained complete saved-view name with meaningful final evidence and no discarded suffix';
const savedViews: SavedView[] = [
  { id: 1, name: fullName, route: '/drives', query: 'sort=active', is_default: false,
    is_pinned: false, sort_order: 0, created_at: '2026-01-01', updated_at: '2026-01-01' },
  { id: 2, name: 'Another retained view', route: '/drives', query: 'sort=idle', is_default: false,
    is_pinned: false, sort_order: 1, created_at: '2026-01-01', updated_at: '2026-01-01' },
];

function cachedSources() {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, gcTime: 0 } } });
  const created_at = new Date(Date.now() - 300_000).toISOString();
  const jobs: ExportJobSummary[] = [
    { id: 'queued', type: 'charging', format: 'json', status: 'queued', created_at },
    { id: 'processing', type: 'drives', format: 'csv', status: 'processing', created_at },
    { id: 'ready', type: 'drives', format: 'csv', status: 'ready', file_size: 0, created_at },
    { id: 'failed', type: 'analytics', format: 'zip', status: 'failed',
      error_message: 'Retained failure: recover from exports', created_at },
    { id: 'expired', type: 'backup', format: 'zip', status: 'expired', file_size: 1536, created_at },
  ];
  client.setQueryData(exportKeys.jobs, jobs);
  client.setQueryData(savedViewsKeys.list('/drives'), savedViews);
  return client;
}

function captureRoot() {
  const root = document.documentElement;
  const attributes = Object.keys(getAppDesignAttributes('classic')).map(name => [name, root.getAttribute(name)] as const);
  const preference = localStorage.getItem(drawerPreference);
  localStorage.setItem(drawerPreference, 'open');
  return () => {
    for (const [name, value] of attributes) {
      if (value === null) root.removeAttribute(name);
      else root.setAttribute(name, value);
    }
    if (preference === null) localStorage.removeItem(drawerPreference);
    else localStorage.setItem(drawerPreference, preference);
  };
}

describe('real actionable saved-view and export-job records', () => {
  it.each(PACK_IDS)('%s binds both open saved-view surfaces and every native job state', async pack => {
    const restore = captureRoot();
    setAppDesignTestProfile(document.documentElement, pack);
    const client = cachedSources();
    const apply = vi.fn();
    const view = render(<QueryClientProvider client={client}><MemoryRouter><ToastProvider>
      <SavedViewMenu route="/drives" currentQuery="sort=active" onApply={apply} />
      <JobProgressDrawer />
    </ToastProvider></MemoryRouter></QueryClientProvider>);
    const release = observeAppDesignScopes(document.documentElement);
    const mode = APPLICATION_DESIGNS[pack].data;
    try {
      fireEvent.click(screen.getByRole('button', { name: `Saved views: ${fullName}` }));
      const menu = screen.getByRole('menu', { name: 'Saved views' });
      const list = menu.querySelector('[data-app-list="saved-views"]')!;
      await waitFor(() => expect(list).toHaveAttribute('data-app-design-owner'));
      const checkSavedList = (element: Element) => {
        expectAppDesignDataMode(element, mode, '[data-app-list="saved-views"]');
        expect(element.children).toHaveLength(2);
        for (const row of element.children) {
          expectAppDesignDataMode(row, mode, '[data-app-record="saved-view"]');
          expect(row).toHaveClass('flex', 'flex-wrap');
          const label = row.querySelector('[data-app-record-slot="label"]')!;
          expectAppDesignDataMode(label, mode, '[data-app-record-slot="label"]');
          expect(matchingAppDesignDataRules(label).some(match => match.declarations['white-space'] === 'normal')).toBe(true);
          expect(label).toHaveAttribute('type', 'button');
          const actions = row.querySelectorAll('[data-app-record-slot="action"]');
          expect(actions).toHaveLength(4);
          for (const action of actions) {
            expect(action).toHaveAttribute('data-app-part', 'button');
            expect(action).toHaveAttribute('type', 'button');
            expect(action).toHaveClass('h-11', 'w-11');
          }
          for (const match of matchesAppDesignCss(row)) {
            expect(match.declarations).not.toHaveProperty('display');
            expect(match.declarations).not.toHaveProperty('grid-template-columns');
          }
        }
        expect(element.children[0]).toHaveAttribute('data-app-record-state', 'active');
        expect(element.children[1]).toHaveAttribute('data-app-record-state', 'idle');
        expect(matchingAppDesignDataRules(element.children[0]).some(match => match.declarations['outline-width'] === '2px')).toBe(true);
        expect(element.querySelector('[data-app-record-slot="label"]')?.textContent).toBe(fullName);
        expect(element.querySelector('[data-app-part~="metric"], [role="table"], [role="grid"]')).toBeNull();
      };
      checkSavedList(list);

      const drawer = screen.getByRole('region', { name: 'Export job progress' });
      const jobs = drawer.querySelectorAll('[data-app-record-kind="export-job"]');
      expect([...jobs].map(job => job.getAttribute('data-app-job-status')))
        .toEqual(['queued', 'processing', 'ready', 'failed', 'expired']);
      for (const job of jobs) {
        expectAppDesignDataMode(job.parentElement!, mode, '[data-app-list="export-jobs"]');
        expectAppDesignDataMode(job, mode, '[data-app-record-kind="export-job"]');
        expect(job).toHaveClass('flex', 'flex-wrap', 'items-center', 'gap-2');
        const body = job.querySelector('[data-app-part~="job-body"]')!;
        expect(job.children[1]).toBe(body);
        expectAppDesignDataMode(body, mode, '[data-app-part~="job-body"]');
        for (const part of ['job-label', 'job-format', 'job-context']) {
          expectAppDesignDataMode(body.querySelector(`[data-app-part~="${part}"]`)!, mode, `[data-app-part~="${part}"]`);
        }
        for (const match of matchesAppDesignCss(job)) expect(match.declarations).not.toHaveProperty('display');
        expect(job.querySelector('[data-metric-track], [role="progressbar"], [data-app-part~="metric"]')).toBeNull();
      }
      const ready = jobs[2];
      expect(ready.querySelector('[data-app-part~="job-context"]')).toHaveTextContent('0 B');
      const download = within(ready as HTMLElement).getByRole('link', { name: 'Download Drives export' });
      expect(download).toHaveAttribute('href', exportDownloadUrl('ready'));
      expect(download).toHaveAttribute('data-app-part', 'button');
      expect(download).toHaveAttribute('data-app-variant', 'outline');
      expect(download).toHaveAttribute('target', '_blank');
      expect(drawer.querySelectorAll('a')).toHaveLength(1);
      const failed = jobs[3];
      const error = failed.querySelector('[data-app-part~="job-error"]')!;
      expectAppDesignDataMode(error, mode, '[data-app-part~="job-error"]');
      expect(error.textContent).toBe('Retained failure: recover from exports');
      expect(error).toHaveClass('text-[var(--semantic-danger)]');
      for (const match of matchesAppDesignCss(error)) expect(match.declarations).not.toHaveProperty('color');
      expect(failed.querySelector('[data-app-part~="job-context"]')).toHaveTextContent('—');
      expect(jobs[4].querySelector('[data-app-part~="job-context"]')).toHaveTextContent('KB');
      expect(drawer.querySelector('[data-app-part~="badge"]')).toHaveAttribute('data-app-variant', 'neutral');

      fireEvent.click(within(menu).getByRole('button', { name: 'Manage views' }));
      const dialog = screen.getByRole('dialog', { name: 'Manage views' });
      const managed = dialog.querySelector('[data-app-list="saved-views"]')!;
      await waitFor(() => expect(managed).toHaveAttribute('data-app-design-owner'));
      checkSavedList(managed);
      fireEvent.click(within(managed as HTMLElement).getByRole('button', { name: 'Another retained view' }));
      expect(apply).toHaveBeenCalledExactlyOnceWith('sort=idle');
    } finally {
      release();
      view.unmount();
      client.clear();
      restore();
    }
  });

  it('does not borrow live-root data framing across actual complete or incomplete job previews', () => {
    const restore = captureRoot();
    setAppDesignTestProfile(document.documentElement, 'v1');
    const client = cachedSources();
    const view = render(<QueryClientProvider client={client}><MemoryRouter>
      <div data-testid="complete" data-app-design-preview="" {...getAppDesignAttributes('blueprint')}><JobProgressDrawer /></div>
      <div data-testid="incomplete" data-app-design-preview="" data-app-design-pack="v1"><JobProgressDrawer /></div>
    </MemoryRouter></QueryClientProvider>);
    const release = observeAppDesignScopes(document.documentElement);
    try {
      for (const node of screen.getByTestId('complete').querySelectorAll('[data-app-record-kind], [data-app-part^="job-"]')) {
        expectAppDesignDataMode(node, 'ledger');
      }
      for (const node of screen.getByTestId('incomplete').querySelectorAll('[data-app-record-kind], [data-app-part^="job-"]')) {
        expect(node).not.toHaveAttribute('data-app-design-owner');
        expect(matchesAppDesignCss(node)).toHaveLength(0);
      }
    } finally {
      release();
      view.unmount();
      client.clear();
      restore();
    }
  });
});
