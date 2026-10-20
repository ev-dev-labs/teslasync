import { act, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiStreamState, AiToolActivity } from '@/hooks/useAiStream';
import english from '@/i18n/en.json';
import {
  getGlobalLocale,
  getGlobalPrecision,
  setGlobalLocale,
  setGlobalPrecision,
} from '@/lib/numberFormat';

import { HelixEvidenceTrail } from './HelixEvidenceTrail';

const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => motion,
}));

let previousLocale: string;
let previousPrecision: number;

beforeEach(() => {
  previousLocale = getGlobalLocale();
  previousPrecision = getGlobalPrecision();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  motion.reduce = false;
});

afterEach(() => {
  setGlobalLocale(previousLocale);
  setGlobalPrecision(previousPrecision);
});

async function renderTrail(
  activity: AiToolActivity[],
  state: AiStreamState = 'done',
  usage?: { in: number; out: number } | null,
) {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { translation: english } },
    interpolation: { escapeValue: false },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <HelixEvidenceTrail activity={activity} state={state} usage={usage} />
    </I18nextProvider>,
  );
}

describe('HelixEvidenceTrail phase-six execution metadata', () => {
  it.each(['draft_dashboard_layout', 'retrieve_docs', 'query_battery_status'])(
    'does not treat successful %s execution as a grounded or cited answer',
    async (name) => {
      await renderTrail([{ id: 'execution-only', name, status: 'succeeded' }]);
      const trail = screen.getByTestId('helix-evidence-trail');
      expect(trail).toHaveTextContent(name === 'query_battery_status' ? 'Battery status' : name);
      expect(trail.querySelector('[title]')).toHaveAttribute('title', name);
      expect(trail).toHaveTextContent('1 tool completed successfully.');
      expect(trail).not.toHaveTextContent(/Grounded in|TeslaSync sources?|Used|cited|verified/i);
    },
  );

  it('preserves order, repeated calls and raw unknown identifiers without exposing payloads', async () => {
    const activity = [
      { id: 'first', name: 'search_Future__ID<script>', status: 'succeeded',
        arguments: { privateValue: 'secret-input' }, data: { privateValue: 'secret-result' } },
      { id: 'second', name: 'retrieve_docs', status: 'failed' },
      { id: 'third', name: 'retrieve_docs', status: 'succeeded' },
    ] satisfies (AiToolActivity & { arguments?: unknown; data?: unknown })[];
    const before = JSON.stringify(activity);
    await renderTrail(activity);
    const trail = screen.getByTestId('helix-evidence-trail');
    const rows = trail.querySelectorAll('[title]');
    expect(Array.from(rows, (row) => row.getAttribute('title'))).toEqual(
      activity.map((item) => item.name),
    );
    expect(rows[0]).toHaveTextContent('search_Future__ID<script>');
    expect(rows).toHaveLength(3);
    expect(trail.querySelector('script')).toBeNull();
    expect(trail).not.toHaveTextContent(/secret-input|secret-result|arguments|privateValue/);
    expect(trail.querySelector('p')).toHaveTextContent('2 tools completed successfully. 1 tool was unavailable.');
    expect(JSON.stringify(activity)).toBe(before);
  });

  it('updates integer counts and tokens when saved numeric preferences change', async () => {
    const activity: AiToolActivity[] = Array.from({ length: 1234 }, (_, index) => ({
      id: String(index), name: 'query_future', status: 'succeeded',
    }));
    const usage = { in: 12345, out: 67890 };
    await renderTrail(activity, 'done', usage);
    const trail = screen.getByTestId('helix-evidence-trail');
    expect(trail).toHaveTextContent('1,234 tools completed successfully.');
    expect(trail.querySelector('p')).toHaveTextContent('1,234 tools completed successfully. 0 tools were unavailable. 80,235 tokens used.');
    act(() => {
      setGlobalLocale('de-DE');
      setGlobalPrecision(4);
    });
    expect(trail).toHaveTextContent('1.234 tools completed successfully.');
    expect(trail.querySelector('p')).toHaveTextContent('1.234 tools completed successfully. 0 tools were unavailable. 80.235 tokens used.');
    expect(usage).toEqual({ in: 12345, out: 67890 });
    expect(trail.querySelectorAll('[title]')).toHaveLength(1234);
  });

  it.each([null, { in: 0, out: 0 }])('keeps zero outcomes and omits nonpositive token totals (%j)', async (usage) => {
    await renderTrail([{ id: 'failed', name: 'query_future', status: 'failed' }], 'done', usage);
    const trail = screen.getByTestId('helix-evidence-trail');
    expect(trail).toHaveTextContent('Limited evidence');
    expect(trail.querySelector('p')).toHaveTextContent('0 tools completed successfully. 1 tool was unavailable.');
    expect(trail).not.toHaveTextContent('tokens');
  });

  it.each<AiStreamState>(['idle', 'streaming', 'paused-confirm', 'error'])(
    'does not add a completion footer in the %s state',
    async (state) => {
      await renderTrail([{ id: 'running', name: 'query_future', status: 'running' }], state, { in: 42, out: 10 });
      const trail = screen.getByRole('status');
      expect(trail).toHaveAttribute('aria-live', 'polite');
      expect(trail).toHaveTextContent('Gathering');
      expect(trail).toHaveTextContent('Reading');
      expect(trail.querySelector('p')).toBeNull();
      expect(trail).not.toHaveTextContent(/tokens|Grounded in/);
    },
  );

  it.each([false, true])('retains running feedback with combined motion reduction %s', async (reduce) => {
    motion.reduce = reduce;
    await renderTrail([{ id: 'running', name: 'query_future', status: 'running' }], 'streaming');
    const icon = screen.getByTestId('helix-evidence-trail').querySelector('.lucide-loader-circle');
    expect(icon).not.toBeNull();
    if (reduce) expect(icon).not.toHaveClass('animate-spin');
    else expect(icon).toHaveClass('animate-spin', 'motion-reduce:animate-none');
    expect(screen.getByRole('status')).toHaveTextContent('Reading');
  });

  it('preserves empty-activity suppression even with usage', async () => {
    const { container } = await renderTrail([], 'done', { in: 50, out: 25 });
    expect(container).toBeEmptyDOMElement();
  });
});
