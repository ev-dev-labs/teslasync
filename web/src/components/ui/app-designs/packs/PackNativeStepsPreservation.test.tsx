// @vitest-environment node
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import postcss from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import { OrderedStepList } from '@/components/data-display/OrderedStepList';
import { Stepper, type OnboardingStep } from '@/features/onboarding/components/Stepper';
import DashboardsPage from '@/features/power-user/pages/DashboardsPage';
import { WidgetRankedList } from '@/features/dashboard/widgets/shared/WidgetRankedList';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '../designs';

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

const steps: OnboardingStep[] = [
  { key: 'done', title: 'Confirmed anchor', description: 'Source-confirmed setup', done: true },
  { key: 'current', title: 'Current anchor', description: 'Ready action', done: false,
    cta: { label: 'Recover anchor', onClick: () => {} } },
  { key: 'pending', title: 'Later anchor', description: 'Not started', done: false },
  { key: 'unknown', title: 'Unknown anchor', description: 'No completion evidence', done: null },
];
const stepperMarkup = renderToStaticMarkup(<Stepper steps={steps} />);

function nativeMarkup() {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  client.setQueryData(['settings'], { locale: 'en-US', ai_enabled: false });
  try {
    return renderToStaticMarkup(<QueryClientProvider client={client}><MemoryRouter>
      <Stepper steps={steps} />
      <OrderedStepList aria-label="Passive source instructions" steps={[
        { id: 'first', title: 'First instruction' }, { id: 'second', title: 'Second instruction' },
      ]} />
      <DashboardsPage />
      <WidgetRankedList items={[{ id: 'reading', label: 'Ordinary ranked list', value: 0, formattedValue: '0' }]} />
    </MemoryRouter></QueryClientProvider>);
  } finally { client.clear(); }
}

const markup = nativeMarkup();
const sheets = PACK_IDS.map(pack => {
  const rules: postcss.Rule[] = [];
  postcss.parse(readFileSync(new URL(`./${APP_DESIGN_PACK_FILES[pack]}`, import.meta.url), 'utf8'))
    .walkRules(rule => { rules.push(rule); });
  return { pack, rules };
});

function declarations(element: Element, rules: postcss.Rule[]) {
  return rules.filter(rule => element.matches(rule.selector)).flatMap(rule =>
    rule.nodes.filter((node): node is postcss.Declaration => node.type === 'decl')
      .map(node => ({ property: node.prop, value: node.value, selector: rule.selector })));
}

describe.each(sheets)('$pack native steps identity preservation', ({ pack, rules }) => {
  it('keeps native ordered steps, rows, circles and connectors outside generic list geometry', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const doc = dom.window.document;
    for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) doc.documentElement.setAttribute(name, value);
    doc.body.innerHTML = markup;
    const release = observeAppDesignScopes(doc.documentElement);
    try {
      const lists = doc.querySelectorAll('[data-app-list="steps"]');
      expect(lists).toHaveLength(3);
      for (const list of lists) {
        expect(declarations(list, rules), list.outerHTML).toEqual([]);
        for (const slot of list.querySelectorAll(
          ':scope > li, [data-app-part~="step-indicator"], [data-app-part~="step-connector"], [data-app-part~="step-body"]',
        )) {
          expect(declarations(slot, rules), slot.outerHTML).toEqual([]);
        }
      }
      expect(lists[0].classList.contains('gap-5')).toBe(true);
      expect(lists[0].classList.contains('sm:gap-6')).toBe(true);
      expect([...lists[0].children].map(row => row.getAttribute('data-state')))
        .toEqual(['done', 'current', 'pending', 'unknown']);
      expect(lists[0].querySelectorAll('[aria-current="step"]')).toHaveLength(1);
      expect(lists[0].querySelectorAll('button')).toHaveLength(1);
      for (const circle of lists[0].querySelectorAll('[data-app-part~="step-indicator"]')) {
        expect(circle.classList.contains('h-9') && circle.classList.contains('w-9')).toBe(true);
      }
      const connectors = lists[0].querySelectorAll('[data-app-part~="step-connector"]');
      expect(connectors).toHaveLength(3);
      expect([...connectors].every(connector => connector.classList.contains('w-px'))).toBe(true);
      const workflow = doc.querySelector('[data-app-step-kind="dashboard-workflow"]')!.parentElement!;
      expect(workflow.classList.contains('gap-3') && workflow.classList.contains('sm:gap-4')).toBe(true);
      expect(workflow.children).toHaveLength(3);
      for (const row of workflow.children) {
        expect(row.classList.contains('flex') && row.classList.contains('p-3')).toBe(true);
        const indicator = row.querySelector('[data-app-part~="step-indicator"]')!;
        expect(indicator.classList.contains('h-9') && indicator.classList.contains('w-9')).toBe(true);
      }
      const ordinary = doc.querySelector('[data-app-list="ranked"]')!;
      expect([ordinary, ...ordinary.children].flatMap(element => declarations(element, rules)).length).toBeGreaterThan(0);
    } finally { release(); dom.window.close(); }
  });

  it('keeps steps neutral at incomplete boundaries without leaking ancestor identity geometry', async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const doc = dom.window.document;
    for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) doc.documentElement.setAttribute(name, value);
    const preview = doc.createElement('section');
    preview.setAttribute('data-app-design-preview', '');
    const nextPack = PACK_IDS[(PACK_IDS.indexOf(pack) + 1) % PACK_IDS.length];
    for (const [name, value] of Object.entries(getAppDesignAttributes(nextPack))) preview.setAttribute(name, value);
    preview.innerHTML = stepperMarkup;
    doc.body.append(preview);
    const release = observeAppDesignScopes(doc.documentElement);
    try {
      const list = preview.querySelector('[data-app-list="steps"]')!;
      expect(list.getAttribute('data-app-design-owner')).toContain(`pack-${nextPack}`);
      for (const sheet of sheets) {
        for (const target of [list, ...list.querySelectorAll('[data-app-part~="list-row"]')]) {
          expect(declarations(target, sheet.rules)).toEqual([]);
        }
      }
      preview.removeAttribute('data-app-header');
      await Promise.resolve();
      expect(list.hasAttribute('data-app-design-owner')).toBe(false);
      for (const sheet of sheets) expect(declarations(list, sheet.rules)).toEqual([]);
      expect(preview.querySelectorAll('[data-app-part~="step-connector"]')).toHaveLength(3);
    } finally { release(); dom.window.close(); }
  });
});
