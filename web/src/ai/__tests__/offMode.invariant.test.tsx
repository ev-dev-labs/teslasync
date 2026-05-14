// Phase-50 / 0001 — F0 AI-Off Contract.
//
// Off-mode invariant suite. ADR-015 §I5 says: "When ai_mode='off',
// no AI surface renders into the DOM." The most direct way to prove
// it is: walk every feature in the registry, mount the smallest
// realistic AI component for each, and assert nothing carrying its
// `data-ai-feature` attribute is in the rendered tree.
//
// Slice F0 only seeds `chatbot-llm`; later slices add their own
// entries to `internal/ai/features/registry.go` (and, via aigen,
// `web/src/ai/features.ts`). The loop below iterates the generated
// registry, so future slices automatically get coverage here without
// editing this file — provided each slice ships its component as the
// return value of `withAiFeature(...)` (enforced by the
// `teslasync/ai-component-must-be-wrapped` ESLint rule and by
// `tools/aivet`).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AI_FEATURES, AI_FEATURE_IDS } from '@/ai/features';
import { withAiFeature } from '@/components/ai/withAiFeature';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

const offModeSettings: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
  ai_mode: 'off',
  ai_features: {},
  ai_provider_config: {},
  ai_cost_cap_cents: 0,
};

beforeEach(() => {
  mockUseSettings.mockReset();
  mockUseSettings.mockReturnValue({ settings: offModeSettings });
});

describe('AI-off contract — DOM invariant', () => {
  it('seeded registry contains at least the chatbot-llm feature', () => {
    // Sanity: aigen kept the TS mirror in sync. Removing this also
    // removes the only thing keeping the loop below honest.
    expect(AI_FEATURE_IDS.length).toBeGreaterThanOrEqual(1);
    expect(AI_FEATURES['chatbot-llm']).toBeDefined();
  });

  for (const id of AI_FEATURE_IDS) {
    it(`renders nothing for feature "${id}" when ai_mode='off'`, () => {
      // The "real" page component lives in a feature directory we
      // don't import here — the invariant is about the wrapper, not
      // about any specific inner render. Mount a tiny placeholder
      // through the canonical wrapper so we're testing exactly the
      // gate every real AI surface goes through.
      function Inner() {
        return (
          <div>
            <span>placeholder body for {id}</span>
            <button type="button">go</button>
          </div>
        );
      }
      Inner.displayName = `${id}-Inner`;
      const Wrapped = withAiFeature(id, Inner);

      const { container } = render(<Wrapped />);

      // 1. The marker attribute must not exist.
      expect(container.querySelector('[data-ai-feature]')).toBeNull();

      // 2. Each registered uiTestId for this feature must NOT be
      //    in the rendered tree.
      for (const tid of AI_FEATURES[id].uiTestIds) {
        expect(screen.queryByTestId(tid)).not.toBeInTheDocument();
      }

      // 3. The inner placeholder must not render either — proves
      //    the gate, not just its scaffolding, is the thing
      //    producing the empty tree.
      expect(screen.queryByText(`placeholder body for ${id}`)).not.toBeInTheDocument();
    });
  }
});
