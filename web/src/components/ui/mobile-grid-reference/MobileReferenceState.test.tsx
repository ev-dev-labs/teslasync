import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '../app-designs/designs';
import { matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils';
import { MobileReferenceState } from './MobileReferenceState';
import { MobileGridReference } from './MobileGridReference';
import { referenceCallbacks, referenceModel } from './testFixtures';

afterEach(cleanup);
describe('mobile states and retained-data behavior', () => {
  it('renders exactly three same-group loading placeholders', () => {
    const { container } = render(<MobileReferenceState state={{ kind: 'loading' }} callbacks={referenceCallbacks()} />);
    expect(container.querySelectorAll('[data-grid-skeleton]')).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });
  it('Clear and Retry belong to the caller, including pending retry disabling', () => {
    const callbacks = referenceCallbacks();
    const { rerender } = render(<MobileReferenceState state={{ kind: 'noMatch', query: 'xyz' }} callbacks={callbacks} />);
    expect(screen.getByText('Nothing matches “xyz”')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(callbacks.onClear).toHaveBeenCalledTimes(1);
    rerender(<MobileReferenceState state={{ kind: 'error', message: 'Synthetic error', retained: false }} callbacks={callbacks} />);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveAttribute('data-app-feedback-kind', 'notice');
    expect(screen.getByRole('alert')).toHaveAttribute('data-app-tone', 'danger');
    expect(screen.getByText('Synthetic error')).toHaveAttribute('data-app-part', 'feedback-content feedback-message');
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute('data-app-part', 'button feedback-retry');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
    rerender(<MobileReferenceState state={{ kind: 'error', message: 'Synthetic error', retained: true, retrying: true }} callbacks={callbacks} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  });
  it('retains rows for a refresh failure but never invents a singleton summary', () => {
    const model = referenceModel();
    const { container, rerender } = render(<MobileGridReference model={{ ...model,
      state: { kind: 'error', message: 'Refresh failed', retained: true } }}
      callbacks={referenceCallbacks()} desktop={<div>Frozen desktop slot</div>} />);
    expect(container.querySelectorAll('[data-card]')).toHaveLength(1);
    expect(container.querySelector('[data-group-summary]')).toBeNull();
    expect(screen.getByText('Frozen desktop slot')).toBeInTheDocument();
    rerender(<MobileGridReference model={{ ...model,
      state: { kind: 'error', message: 'Initial failure', retained: false } }}
      callbacks={referenceCallbacks()} desktop={<div>Frozen desktop slot</div>} />);
    expect(container.querySelector('[data-card]')).toBeNull();
    expect(container.querySelector('.mgr-group')).toBeInTheDocument();
  });
  it.each(PACK_IDS)('binds the actual group, sticky header and retained-error notice to the nearest %s design', packId => {
    const model = referenceModel();
    const group = model.groups[0]!;
    const { container, rerender } = render(<div data-app-design-preview="" {...getAppDesignAttributes(packId)}>
      <MobileGridReference model={{ ...model, groups: [{ ...group, memberCount: 2 }],
        state: { kind: 'error', message: 'Retained source failure', retained: true } }}
        callbacks={referenceCallbacks()} desktop={<div>Independent desktop content</div>} />
      <div data-app-design-preview=""><MobileGridReference model={model}
        callbacks={referenceCallbacks()} desktop={null} /></div>
    </div>);
    const release = observeAppDesignScopes(container);
    try {
      const well = container.querySelector('.mgr-group');
      const header = well?.querySelector('[data-group-header]');
      if (!well || !header) throw new Error('Missing mobile group surface or header');
      const identitySelectors: string[] = [];
      postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'packs', APP_DESIGN_PACK_FILES[packId]), 'utf8'))
        .walkRules(rule => { identitySelectors.push(...rule.selectors); });
      expect(well?.matches('[data-app-part~="panel"][data-surface-variant="standalone"]')).toBe(true);
      expect(identitySelectors.some(selector => selector.includes('[data-app-part~="panel"]') && well.matches(selector))).toBe(true);
      expect(well?.getAttribute('data-app-design-owner')).toContain(`pack-${packId}`);
      expect(header).toHaveAttribute('data-app-part', 'table-head');
      expect(header).toHaveClass('sticky', 'top-0');
      expect(identitySelectors.some(selector => selector.includes('[data-app-part~="table-head"]') && header.matches(selector))).toBe(true);
      expect(header?.getAttribute('data-app-design-owner')).toContain(`pack-${packId}`);
      expect(header?.querySelector('[data-group-summary]')).toHaveTextContent(group.summary ?? '');
      expect(well?.querySelectorAll('[data-card]')).toHaveLength(1);
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.getByRole('alert').getAttribute('data-app-design-owner')).toContain(`pack-${packId}`);
      expect(matchesAppDesignCss(screen.getByRole('alert'), '[data-app-feedback-kind="notice"]')
        .some(match => match.selector.includes(`[data-app-feedback="${getAppDesignAttributes(packId)['data-app-feedback']}"]`))).toBe(true);
      expect(matchesAppDesignCss(screen.getByText('Retained source failure'), '[data-app-part~="feedback-content"]')).not.toHaveLength(0);
      expect(matchesAppDesignCss(screen.getByRole('button', { name: 'Retry' }), '[data-app-part~="feedback-retry"]')).not.toHaveLength(0);
      const neutralWell = container.querySelector('[data-app-design-preview] [data-app-design-preview] .mgr-group');
      expect(neutralWell).not.toHaveAttribute('data-app-design-owner');
      expect(identitySelectors.some(selector => neutralWell?.matches(selector)
        && selector.includes('[data-app-part~="panel"]'))).toBe(false);
      expect(screen.getByText('Independent desktop content')).toBeInTheDocument();

      rerender(<MobileGridReference model={{ ...model, groups: [{ ...group, label: undefined }] }}
        callbacks={referenceCallbacks()} desktop={null} />);
      expect(container.querySelector('[data-group-header]')).toBeNull();
      expect(container.querySelectorAll('[data-card]')).toHaveLength(1);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {
      release();
    }
  });
});
