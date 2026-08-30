/**
 * repairPresentation contract tests.
 *
 * The backend emits stable machine tokens and no prose. These tests pin that
 * every token in the wire union maps to a distinct localized string, and that
 * an unrecognised token (a backend that shipped a new rule ahead of the UI)
 * degrades to an honest fallback rather than rendering the raw token or
 * crashing.
 */

import { describe, it, expect } from 'vitest';
import type {
  RepairConfidence,
  RepairEvidenceSource,
  RepairRule,
} from '@/api/hooks/useDataRepair';
import {
  blockedReasonLabel,
  confidenceLabel,
  confidenceVariant,
  evidenceSourceLabel,
  ruleExplanation,
  ruleLabel,
  sessionKindLabel,
} from './repairPresentation';

/** Deterministic `t`: returns the English fallback. */
const t = (_key: string, fallback: string): string => fallback;

const ALL_RULES: RepairRule[] = [
  'drive_open_charging_started',
  'drive_open_park_observed',
  'drive_end_after_contradiction',
  'charging_open_charge_ended',
  'charging_open_drive_started',
  'charging_end_after_contradiction',
];

const ALL_SOURCES: RepairEvidenceSource[] = [
  'signal_log',
  'drive_telemetry',
  'charging_telemetry',
  'drives',
  'charging_sessions',
];

describe('repairPresentation', () => {
  it('maps every rule token to a distinct label and explanation', () => {
    const labels = ALL_RULES.map((r) => ruleLabel(t, r));
    const whys = ALL_RULES.map((r) => ruleExplanation(t, r));

    expect(new Set(labels).size).toBe(ALL_RULES.length);
    expect(new Set(whys).size).toBe(ALL_RULES.length);
    labels.forEach((l) => expect(l.length).toBeGreaterThan(0));
    whys.forEach((w) => expect(w.length).toBeGreaterThan(0));
  });

  it('explains the reported drive-then-charging case in terms of the missed signal', () => {
    expect(ruleExplanation(t, 'drive_open_charging_started')).toMatch(
      /cannot drive and charge at once/i,
    );
    expect(ruleExplanation(t, 'drive_open_charging_started')).toMatch(/Park signal/i);
  });

  it('falls back honestly for an unknown rule instead of leaking the token', () => {
    const unknown = 'some_future_rule' as RepairRule;
    expect(ruleLabel(t, unknown)).toBe('Session boundary looks wrong');
    expect(ruleExplanation(t, unknown)).toBe(
      'Stored session state contradicts later durable evidence.',
    );
    expect(ruleLabel(t, unknown)).not.toContain('some_future_rule');
  });

  it('grades confidence without ever claiming success', () => {
    expect(confidenceLabel(t, 'high')).toBe('High confidence');
    expect(confidenceLabel(t, 'medium')).toBe('Medium confidence');
    expect(confidenceLabel(t, 'weird' as RepairConfidence)).toBe('Unrated confidence');

    // No badge variant may be `success` / `danger` — a suggestion is neither
    // proven nor a failure.
    expect(confidenceVariant('high')).toBe('info');
    expect(confidenceVariant('medium')).toBe('warning');
    expect(confidenceVariant('weird' as RepairConfidence)).toBe('neutral');
  });

  it('names every durable evidence source distinctly', () => {
    const labels = ALL_SOURCES.map((s) => evidenceSourceLabel(t, s));
    expect(new Set(labels).size).toBe(ALL_SOURCES.length);
    expect(evidenceSourceLabel(t, 'unknown_table' as RepairEvidenceSource)).toBe(
      'Durable history',
    );
  });

  it('explains why a suggestion is blocked, including the unknown case', () => {
    expect(blockedReasonLabel(t, 'overlaps_next_session')).toMatch(/overlapping the next one/i);
    expect(blockedReasonLabel(t, undefined)).toBe('This suggestion cannot be applied right now.');
    expect(blockedReasonLabel(t, 'brand_new_reason')).toBe(
      'This suggestion cannot be applied right now.',
    );
  });

  it('labels both session kinds', () => {
    expect(sessionKindLabel(t, 'drive')).toBe('Drive');
    expect(sessionKindLabel(t, 'charging')).toBe('Charging session');
  });
});
