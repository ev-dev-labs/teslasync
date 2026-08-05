import { describe, it, expect } from 'vitest';
import {
  classifyReason,
  deriveMetadataCandidates,
  deriveMotionCandidate,
  deriveTelemetryCandidates,
  mergeEventCandidates,
} from '../lib/eventDetection';
import type { IncidentSequenceEvent } from '../lib/timelineAlignment';

describe('classifyReason', () => {
  it('maps known reason keywords to event types', () => {
    expect(classifyReason('sentry_aware_object_detection')).toBe('sentry_trigger');
    expect(classifyReason('user_interaction_dashcam_panel_click')).toBe('manual_save');
    expect(classifyReason('crash_detected_impact')).toBe('impact');
  });

  it('falls back to unknown for unrecognized or absent reasons', () => {
    expect(classifyReason('totally_new_reason_code')).toBe('unknown');
    expect(classifyReason(null)).toBe('unknown');
    expect(classifyReason(undefined)).toBe('unknown');
  });
});

describe('deriveMetadataCandidates', () => {
  it('produces a medium-confidence candidate with an honest basis when event.json has a reason', () => {
    const candidates = deriveMetadataCandidates({
      source: 'SentryClips',
      eventSidecar: { timestamp: null, city: null, est_lat: null, est_lon: null, reason: 'sentry_aware_object_detection', camera: null },
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe('sentry_trigger');
    expect(candidates[0].confidence).toBe('medium');
    expect(candidates[0].basis.join(' ')).toContain('event.json reason');
  });

  it('produces a low-confidence sentry candidate from folder alone', () => {
    const candidates = deriveMetadataCandidates({ source: 'SentryClips', eventSidecar: null });
    expect(candidates[0].type).toBe('sentry_trigger');
    expect(candidates[0].confidence).toBe('low');
    expect(candidates[0].basis.join(' ')).toContain('SentryClips');
  });

  it('produces a manual_save candidate for SavedClips with no sidecar', () => {
    const candidates = deriveMetadataCandidates({ source: 'SavedClips', eventSidecar: null });
    expect(candidates[0].type).toBe('manual_save');
  });

  it('produces no candidates for RecentClips with no sidecar', () => {
    const candidates = deriveMetadataCandidates({ source: 'RecentClips', eventSidecar: null });
    expect(candidates).toHaveLength(0);
  });
});

describe('deriveMotionCandidate', () => {
  it('returns nothing when motion analysis was not run or unavailable', () => {
    expect(deriveMotionCandidate({ status: 'not_run' })).toHaveLength(0);
    expect(deriveMotionCandidate({ status: 'unavailable', reason: 'no canvas' })).toHaveLength(0);
  });

  it('returns nothing below the low threshold', () => {
    expect(deriveMotionCandidate({ status: 'ok', score: 0.01, samplePairs: 5 })).toHaveLength(0);
  });

  it('labels the basis honestly as a pixel-difference score, never object detection', () => {
    const candidates = deriveMotionCandidate({ status: 'ok', score: 0.5, samplePairs: 5 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe('motion');
    expect(candidates[0].confidence).toBe('high');
    const basisText = candidates[0].basis.join(' ').toLowerCase();
    expect(basisText).toContain('pixel-difference');
    expect(basisText).not.toContain('object detected');
    expect(basisText).not.toContain('license plate detected');
    // The disclaimer explicitly says recognition was NOT performed — that's
    // the honest behavior we want, distinct from claiming detection ran.
    expect(basisText).toContain('no object/person/plate recognition was performed');
  });
});

describe('deriveTelemetryCandidates', () => {
  it('converts hard_brake/hard_accel/sharp_turn incident events, ignoring other kinds', () => {
    const events: IncidentSequenceEvent[] = [
      { id: '1', atSeconds: 3, kind: 'hard_brake', signal: 'Brake', description: 'braked hard', zScore: 6 },
      { id: '2', atSeconds: 4, kind: 'state_change', signal: 'DoorState', description: 'door opened', zScore: 0 },
      { id: '3', atSeconds: 5, kind: 'signal_spike', signal: 'Other', description: 'spike', zScore: 3.5 },
    ];
    const candidates = deriveTelemetryCandidates(events);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe('hard_brake');
    expect(candidates[0].atSeconds).toBe(3);
    expect(candidates[0].confidence).toBe('high');
  });
});

describe('mergeEventCandidates', () => {
  it('sorts whole-clip candidates (null atSeconds) before timed candidates, then chronologically', () => {
    const merged = mergeEventCandidates(
      [{ id: 'a', type: 'unknown', confidence: 'low', atSeconds: 10, basis: [] }],
      [{ id: 'b', type: 'sentry_trigger', confidence: 'low', atSeconds: null, basis: [] }],
      [{ id: 'c', type: 'motion', confidence: 'medium', atSeconds: 2, basis: [] }],
    );
    expect(merged.map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });
});
