import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AcDcStatsPanel } from './AcDcStatsPanel';
import type { AcDcBucket } from './helpers';

vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : String(fallback?.defaultValue ?? key);
      const variables = options ?? (typeof fallback === 'object' ? fallback : {});
      return text.replace(/{{(\w+)}}/g, (_, name: string) => String(variables[name] ?? name));
    },
    i18n: { language: 'en' },
  }),
}));

describe('charging type billing evidence', () => {
  it('shows unknown cost and rate without claiming unpriced sessions were free', () => {
    const empty: AcDcBucket = {
      energy: 0, energyUsed: 0, cost: 0, count: 0,
      totalDuration: 0, freeCount: 0, freeEnergy: 0,
    };
    render(
      <AcDcStatsPanel breakdown={{
        ac: { ...empty, energy: 52.5, energyUsed: 52.5, cost: null, count: 2, totalDuration: 120 },
        dc: empty,
        total: { energy: 52.5, cost: null, freeCount: 0, freeEnergy: 0 },
      }} />,
    );
    expect(screen.getByRole('table', { name: 'Charging stats by type' })).toBeInTheDocument();
    const row = screen.getByRole('row', { name: /AC charging/ });
    expect(within(row).getAllByText('—')).toHaveLength(3);
    expect(screen.queryByText('Free charged')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Energy split: 100% AC, 0% DC' })).toBeInTheDocument();
  });
});
