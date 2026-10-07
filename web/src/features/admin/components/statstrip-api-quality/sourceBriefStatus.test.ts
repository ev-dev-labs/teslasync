import { describe, expect, it } from 'vitest';
import { sourceBriefStatus } from './sourceBriefStatus';

const t = (_key: string, fallback: string) => fallback;
describe('operational summary source status', () => {
  it('describes successful retrieval without inventing a healthy or scored domain posture', () => {
    expect(sourceBriefStatus({ status: 'ok', isRefreshing: false }, false, t))
      .toEqual({ statusLabel: 'Source loaded', statusTone: 'neutral' });
  });
  it('keeps actual retained and fatal source states distinct', () => {
    expect(sourceBriefStatus({ status: 'stale', isRefreshing: false }, false, t).statusLabel).toBe('Retained source');
    expect(sourceBriefStatus({ status: 'initialFailure', isRefreshing: false }, false, t).statusLabel).toBe('Source unavailable');
    expect(sourceBriefStatus({ status: 'initial', isRefreshing: false }, true, t).statusLabel).toBe('Loading source');
  });
});
