import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { summarizeParking } from '../../lib/parkingDwell';
import { ParkingMethodCaveats } from './ParkingMethodCaveats';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown, options?: Record<string, unknown>) =>
    typeof fallback === 'string' ? fallback.replace(/{{(\w+)}}/g, (match, name: string) => String(options?.[name] ?? match)) : key }),
}));
vi.mock('@/hooks/useDateFormat', () => ({ useDateFormat: () => ({
  formatDateTime: (value: Date) => value.toISOString(),
}) }));

describe('ParkingMethodCaveats cap/window notice', () => {
  it.each([false, true])('owns only the framed factual notice, with capped=%s interpretation intact', (capped) => {
    const start = '2026-07-01T00:00:00Z';
    const end = '2026-07-03T00:00:00Z';
    const model = summarizeParking([], { startInstant: start, endInstantExclusive: end, nowMs: Date.parse(end), timeZone: 'UTC', rowLimit: 25 });
    model.coverage.recordsReturned = capped ? 25 : 4;
    model.coverage.possiblyCapped = capped;
    const { container } = render(<ParkingMethodCaveats summary={model} rangeStart={start} rangeEnd={end} />);
    const notices = container.querySelectorAll('[data-app-feedback-kind="notice"]');
    expect(notices).toHaveLength(1);
    const notice = notices[0];
    expect(notice).toHaveAttribute('data-app-part', 'feedback');
    expect(notice).toHaveAttribute('data-app-tone', 'neutral');
    expect(notice.querySelector('[data-app-part="feedback-content"] > [data-app-part="feedback-message"]'))
      .toHaveTextContent(capped
        ? 'Because results are newest-first, older drives inside the selected window may be omitted; all results are observed-window descriptions.'
        : '4 server-scoped drives from the selected window, up to the 25-drive request cap.');
    expect(notice).not.toHaveAttribute('role', 'alert');
    expect(container).toHaveTextContent('parking before the first returned drive cannot be reconstructed.');
    expect(container.querySelectorAll('[data-app-part="feedback"]')).toHaveLength(1);
    const selectors: string[] = [];
    postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
      .walkRules(rule => {
        selectors.push(...rule.selectors.filter(selector =>
          selector.includes('data-app-feedback-kind="notice"') && selector.includes('data-app-design-owner')));
      });
    const host = container.firstElementChild!;
    host.setAttribute('data-app-design-preview', '');
    const originalContent = notice.textContent;
    const release = observeAppDesignScopes(host);
    try {
      for (const pack of Object.keys(APPLICATION_DESIGNS) as Array<keyof typeof APPLICATION_DESIGNS>) {
        for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) host.setAttribute(name, value);
        const refresh = observeAppDesignScopes(host);
        try {
          expect(selectors.filter(selector => selector.includes(`[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`))
            .some(selector => notice.matches(selector))).toBe(true);
          expect(notice.textContent).toBe(originalContent);
        } finally { refresh(); }
      }
      for (const name of Object.keys(getAppDesignAttributes('classic'))) host.removeAttribute(name);
      const refresh = observeAppDesignScopes(host);
      try {
        expect(selectors.some(selector => notice.matches(selector))).toBe(false);
      } finally { refresh(); }
    } finally { release(); }
  });
});
