import { describe, expect, it } from 'vitest';
import generatedEnglish from '@/i18n/en/locale-driving-drivetrain-health.json';
import { createEnglishI18n } from '@/test/createEnglishI18n';
import { motorStateLabel } from './DrivetrainSummary';

describe('DrivetrainSummary labels', () => {
  it('resolves the overall health labels from the canonical catalog', async () => {
    const i18n = await createEnglishI18n();
    const t = i18n.getFixedT('en', 'translation');
    expect(['good', 'warning', 'critical'].map((status) => t(`drivetrain.health.${status}`)))
      .toEqual(['Good', 'Warning', 'Critical']);
  });

  it('localizes recognized motor states and keeps other source values and unknown distinct', async () => {
    const i18n = await createEnglishI18n();
    const t = i18n.getFixedT('en', 'translation') as (key: string, fallback: string) => string;
    expect(['Normal', 'Warm', 'Overheating', 'Idle'].map((raw) => motorStateLabel(raw, t)))
      .toEqual(['Normal', 'Warm', 'Overheating', 'Idle']);
    expect(motorStateLabel(' overheating ', t)).toBe('Overheating');
    expect(motorStateLabel('Derated', t)).toBe('Derated');
    expect(motorStateLabel('', t)).toBe('—');
    expect(motorStateLabel(null, t)).toBe('—');
    expect(motorStateLabel(undefined, t)).toBe('—');
  });

  it('uses canonical keys rather than echoing the raw value through a lookup miss', () => {
    const calls: string[] = [];
    const spy = (key: string, fallback: string) => { calls.push(key); return `[${fallback}]`; };
    expect(motorStateLabel('Idle', spy)).toBe('[Idle]');
    expect(motorStateLabel('Warm', spy)).toBe('[Warm]');
    expect(calls).toEqual(['drivetrain.motorStateValue.idle', 'drivetrain.warm']);
    expect(JSON.stringify(generatedEnglish)).toContain('motorStateValue');
  });
});
