import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { ResultPanel } from './ResultPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}));

const payload = { z: 'first\nsecond', a: [0, false, ''] };
const serialized = JSON.stringify(payload, null, 2);
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

describe('native result source-to-consumer adoption', () => {
  it.each(PACK_IDS)('%s composes the actual bounded code and error without losing source truth', async pack => {
    const tree = (error?: string) => (
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <ResultPanel title="Captured response" context="Submitted context" data={payload} error={error} />
      </div>
    );
    const view = render(tree());
    const host = view.container.firstElementChild!;
    const release = observeAppDesignScopes(host);
    try {
      const panel = host.querySelector('[data-app-panel-kind="code"]')!;
      const body = panel.querySelector('pre')!;
      expect(body.textContent).toBe(serialized);
      expect(body).toHaveClass('max-h-64', 'overflow-auto', 'p-2');
      const panelRules = matchesAppDesignCss(panel, '[data-app-panel-kind="code"]');
      const bodyRules = matchesAppDesignCss(body, '[data-app-code-slot="body"]');
      expect(panelRules.length).toBeGreaterThan(0);
      expect(bodyRules.length).toBeGreaterThan(0);
      for (const match of [...panelRules, ...bodyRules]) {
        expect(Object.keys(match.declarations).every(property => ['outline', 'outline-offset'].includes(property))).toBe(true);
        expect(match.selector).toContain('data-app-design-owner');
      }
      expect(panel.querySelector('[data-app-code-slot="context"]')).toHaveTextContent('Submitted context');
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(serialized));

      const error = 'upstream failed\nretain exact diagnostic order';
      view.rerender(tree(error));
      const alert = screen.getByRole('alert');
      const errorPanel = alert.closest('[data-app-feedback-kind="error"]')!;
      await waitFor(() => expect(errorPanel).toHaveAttribute('data-app-design-owner'));
      expect(alert.textContent).toBe(error);
      expect(matchesAppDesignCss(errorPanel, '[data-app-feedback-kind="error"]').length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
      expect(host.querySelector('pre')).toBeNull();
      expect(screen.getByText('Submitted context')).toBeInTheDocument();
    } finally { release(); }
  });

  it('leaves default and nested widget-only output outside app-wide consumers', () => {
    const view = render(<ResultPanel title="Unselected" data={payload} />);
    const unselected = view.container.querySelector('[data-app-panel-kind="code"]')!;
    expect(unselected).not.toHaveAttribute('data-app-design-owner');
    expect(matchesAppDesignCss(unselected, '[data-app-panel-kind="code"]')).toEqual([]);
    view.rerender(
      <div data-app-design-preview="" {...getAppDesignAttributes('cyber')}>
        <div data-app-design-preview="">
          <ResultPanel title="Widget only" data={payload} />
        </div>
      </div>,
    );
    const release = observeAppDesignScopes(view.container.firstElementChild!);
    try {
      const panel = view.container.querySelector('[data-app-panel-kind="code"]')!;
      expect(panel).not.toHaveAttribute('data-app-design-owner');
      expect(matchesAppDesignCss(panel, '[data-app-panel-kind="code"]')).toEqual([]);
      expect(panel.querySelector('pre')?.textContent).toBe(serialized);
    } finally { release(); }
  });
});
