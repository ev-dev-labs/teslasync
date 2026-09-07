import { describe, expect, it } from 'vitest';

import { fsdInsights } from '../components/fsd-insights/__tests__/fixtures';
import { buildFsdCommuteExperiment } from './fsdCommuteExperiment';

describe('buildFsdCommuteExperiment', () => {
  it('treats same-route firmware + commute as an experiment with reset honesty', () => {
    const experiment = buildFsdCommuteExperiment(fsdInsights());
    expect(experiment.firmwarePair).toEqual({ from: '2026.8.1', to: '2026.20.3' });
    expect(experiment.firmware[0]?.verdict).toBe('changed');
    expect(experiment.commutes[0]?.windowLabel).toContain('Evening');
    expect(experiment.commutes[0]?.unknownDays).toBe(0);
  });

  it('refuses a share when either month is unknown', () => {
    const base = fsdInsights();
    base.drive_analytics.commute_identities[0].this_month.fsd_share_pct = null;
    base.drive_analytics.commute_identities[0].share_change_pct_points = null;
    const experiment = buildFsdCommuteExperiment(base);
    expect(experiment.commutes[0]?.verdict).toBe('unknown');
  });
});
