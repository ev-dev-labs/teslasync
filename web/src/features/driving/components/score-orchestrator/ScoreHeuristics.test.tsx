import { createInstance } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Drive } from '@/types/driving';
import { localScoreExplanation, localScoreInsight, scoreDrive } from './scoreDomain';
import { ScoreHeroSection } from './ScoreHeroSection';
import { ScoreExtremesSection } from './ScoreExtremesSection';
import type { ScoreSectionProps } from './scoreSectionTypes';

vi.mock('@/components/ui', () => {
  const Content = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    GlassPanel: Content, PanelTitle: Content, Text: Content, Caption: Content, Badge: Content,
    HelpTooltip: ({ text }: { text: string }) => <div data-testid="score-help">{text}</div>,
  };
});
vi.mock('@/components/charts', () => ({
  LinearGauge: ({ value }: { value: number }) => <div data-testid="gauge">{value}</div>,
}));
vi.mock('@/components/data-display', () => ({
  AnimatedNumber: ({ value }: { value: number }) => <span>{value}</span>,
  KVList: ({ items }: { items: { id: string; label: string; value: string }[] }) =>
    <div>{items.map(item => <div key={item.id}>{item.label}: {item.value}</div>)}</div>,
}));
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../continuation-driving-primary/ScoreExtremeDrive', () => ({
  ScoreExtremeDrive: ({ insight, entry, sourceFallback }: {
    insight: string; entry: unknown; sourceFallback: ReactNode;
  }) => <div>{sourceFallback ?? (entry ? insight : 'No drives available')}</div>,
}));
vi.mock('./ScorePeriodStatisticsPanel', () => ({
  ScorePeriodStatisticsPanel: () => <div>Period statistics retained</div>,
}));

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: {}, fallbackLng: 'en' });
const t = i18n.t;
const drive: Drive = {
  id: 1, vehicleId: 7, startTs: '2026-10-14T12:00:00Z', endTs: null,
  durationS: 1800, distanceM: 100_000, energyUsedWh: 13_000,
  avgPowerW: 15_000, maxSpeedMps: 30, regenEnergyWh: null, avgSpeedMps: null,
  startAddress: null, endAddress: null, startLat: null, startLon: null,
  endLat: null, endLon: null, startBatteryPct: null, endBatteryPct: null,
  outsideTempAvgC: null, insideTempAvgC: null, score: null, endedStatus: null,
  createdAt: '', updatedAt: '',
};
const score = scoreDrive(drive)!;
const heroModel = {
  t, noDrivesMsg: 'No drives', overallReading: 95, overallGrade: 'A+',
  trendColor: '', TrendIcon: () => null, trendLabel: 'Stable',
  apiScore: undefined, hasDrivePayload: true, scoredDrives: [{ drive, score }],
} satisfies ScoreSectionProps<'t' | 'noDrivesMsg' | 'overallReading' | 'overallGrade'
  | 'trendColor' | 'TrendIcon' | 'trendLabel' | 'apiScore' | 'hasDrivePayload' | 'scoredDrives'>['model'];

describe('drive-score heuristic disclosure', () => {
  it('preserves the populated score and refuses incomplete evidence', () => {
    expect(score).toEqual({
      total: 95, efficiency: 40, smoothness: 25, speed: 30, grade: 'A+', whPerKm: 130,
    });
    expect(scoreDrive({ ...drive, avgPowerW: null })).toBeNull();
    expect(scoreDrive({ ...drive, energyUsedWh: null })).toBeNull();
    expect(scoreDrive({ ...drive, maxSpeedMps: null })).toBeNull();
  });

  it('does not use temperature, regen, average speed or an existing score as local inputs', () => {
    expect(scoreDrive({
      ...drive, outsideTempAvgC: -30, regenEnergyWh: 99_000, avgSpeedMps: 80, score: 1,
    })).toEqual(score);
    const explanation = localScoreExplanation(t);
    for (const input of ['energy divided by distance', 'average power', 'maximum speed']) {
      expect(explanation).toContain(input);
    }
    expect(explanation).toContain('not acceleration or braking events');
  });

  it.each([
    ['best', 40, 25, 'low recorded energy per distance'],
    ['best', 20, 25, 'low average power'],
    ['best', 20, 20, 'maximum speed'],
    ['worst', 10, 5, 'high recorded energy per distance'],
    ['worst', 20, 5, 'high average power'],
    ['worst', 20, 20, 'maximum speed'],
  ] as const)('labels the %s explanation as heuristic for %s/%s', (kind, efficiency, smoothness, input) => {
    const insight = localScoreInsight(t, kind, { ...score, efficiency, smoothness });
    expect(insight).toMatch(/^Local heuristic:/);
    expect(insight).toContain(input);
    expect(insight).not.toContain('cold weather');
    expect(insight).not.toContain('braking detected.');
  });

  it('discloses local inputs in the hero without changing its score', () => {
    render(<ScoreHeroSection model={heroModel} driveState={() => null} scoreState={() => null} />);
    expect(screen.getByTestId('gauge')).toHaveTextContent('95');
    expect(screen.getByTestId('score-help')).toHaveTextContent(localScoreExplanation(t));
    expect(screen.getAllByText(localScoreExplanation(t))).toHaveLength(2);
  });

  it('keeps the server explanation distinct from local heuristics', () => {
    render(<ScoreHeroSection model={{
      ...heroModel, overallReading: 82, overallGrade: 'A',
      apiScore: { overall: 82, grade: 'A', efficiency: 30, smoothness: 22,
        speedDiscipline: 30, totalDrives: 12, trend: 'up' },
    }} driveState={() => null} scoreState={() => null} />);
    expect(screen.getByTestId('gauge')).toHaveTextContent('82');
    expect(screen.getByText(/Overall score supplied by the server/)).toBeInTheDocument();
    expect(screen.getByTestId('score-help')).toHaveTextContent('smoothness of acceleration, braking, and cornering');
    expect(screen.getByText('Based on 12 drives')).toBeInTheDocument();
  });

  it('wires local explanations into both extremes and preserves the breakdown and statistics', () => {
    render(<ScoreExtremesSection model={{
      t, bestDrive: { drive, score }, worstDrive: { drive, score: { ...score, efficiency: 10 } },
      formatDistance: String, formatEfficiency: String, noDrivesMsg: 'No drives',
      efficiencyReading: 40, smoothnessReading: 25, speedReading: 30, overallReading: 95,
      completeDistance: true, completeDuration: true, filteredDrives: [drive],
      measuredMaxSpeeds: [30], formatSpeed: String, fmtInt: String, allScores: [score],
    }} driveState={() => null} scoreState={() => null} />);
    expect(screen.getByText(localScoreInsight(t, 'best', score))).toBeInTheDocument();
    expect(screen.getByText(localScoreInsight(t, 'worst', { ...score, efficiency: 10 }))).toBeInTheDocument();
    expect(screen.getByText('Smoothness: 25/30')).toBeInTheDocument();
    expect(screen.getByText('Total: 95/100')).toBeInTheDocument();
    expect(screen.getByText(localScoreExplanation(t))).toBeInTheDocument();
    expect(screen.getByText('Period statistics retained')).toBeInTheDocument();
  });

  it('does not invent an insight for missing drives', () => {
    expect(localScoreInsight(t, 'best', undefined)).toBe('');
    expect(localScoreInsight(t, 'worst', undefined)).toBe('');
  });
});
