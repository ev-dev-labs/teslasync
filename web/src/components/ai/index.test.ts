import { describe, expect, expectTypeOf, it } from 'vitest';
import * as ai from './index';
import { AINLDashboardComposer, type DashboardLayoutDraft } from './AINLDashboardComposer';
import { AINLGrafanaPanel, type GrafanaPanelDraft } from './AINLGrafanaPanel';
import { AINLSqlPlayground, type ReadonlySQLDraft } from './AINLSqlPlayground';
import { AISignalExplorerNlFilter, type SignalFilterDraft } from './AISignalExplorerNlFilter';
import { AIMqttSseInspectorExplanations } from './AIMqttSseInspectorExplanations';
import { withAiFeature } from './withAiFeature';

describe('AI public category API', () => {
  it('re-exports the existing optional feature components without wrapping or replacing them', () => {
    expect(ai.AINLDashboardComposer).toBe(AINLDashboardComposer);
    expect(ai.AINLGrafanaPanel).toBe(AINLGrafanaPanel);
    expect(ai.AINLSqlPlayground).toBe(AINLSqlPlayground);
    expect(ai.AISignalExplorerNlFilter).toBe(AISignalExplorerNlFilter);
    expect(ai.AIMqttSseInspectorExplanations).toBe(AIMqttSseInspectorExplanations);
  });

  it('preserves typed proposal payloads at the category boundary', () => {
    expectTypeOf<ai.DashboardLayoutDraft>().toEqualTypeOf<DashboardLayoutDraft>();
    expectTypeOf<ai.GrafanaPanelDraft>().toEqualTypeOf<GrafanaPanelDraft>();
    expectTypeOf<ai.ReadonlySQLDraft>().toEqualTypeOf<ReadonlySQLDraft>();
    expectTypeOf<ai.SignalFilterDraft>().toEqualTypeOf<SignalFilterDraft>();
  });

  it('preserves the custom feature gate factory without exposing ambiguous normalization helpers', () => {
    expect(ai.withAiFeature).toBe(withAiFeature);
    expect(ai).not.toHaveProperty('normalizeDriveId');
    expect(ai).not.toHaveProperty('normalizeTripId');
  });
});
