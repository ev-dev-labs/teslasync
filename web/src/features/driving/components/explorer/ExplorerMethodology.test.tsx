import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Drive } from '@/types/driving';
import { summarizeExplorer } from '../../lib/explorer';
import { ExplorerMethodology } from './ExplorerMethodology';

const translations = vi.hoisted(() => ({
  prefix: '',
  duplicate: false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      if (translations.duplicate && key.startsWith('explorer.method.')) {
        return 'Shared translation';
      }
      return translations.prefix + fallback.replace(
        /{{(\w+)}}/g,
        (match, name: string) => String(values?.[name] ?? match),
      );
    },
  }),
}));

function arrival(id: number, endLat: number): Drive {
  return {
    id,
    vehicleId: 1,
    startTs: `2026-01-0${id}T08:00:00Z`,
    endTs: `2026-01-0${id}T08:30:00Z`,
    durationS: 1_800,
    distanceM: 10_000,
    startAddress: null,
    endAddress: null,
    startLat: 37,
    startLon: -122,
    endLat,
    endLon: -122,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 2_000,
    regenEnergyWh: null,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: null,
    insideTempAvgC: null,
    score: null,
    endedStatus: null,
    createdAt: '',
    updatedAt: '',
  };
}

const drives = [
  arrival(1, 37),
  arrival(2, 37),
  arrival(3, 37),
  arrival(4, 38),
  arrival(5, 39),
];
const state = { isLoading: false, error: null, onRetry: vi.fn() };

function methodItems() {
  return within(screen.getByRole('list')).getAllByRole('listitem');
}

beforeEach(() => {
  translations.prefix = '';
  translations.duplicate = false;
});

describe('ExplorerMethodology', () => {
  it('preserves populated evidence, methodology order and bounded-window copy', () => {
    const summary = summarizeExplorer(drives, { historyLimit: 100 });
    render(<ExplorerMethodology summary={summary} state={state} />);

    const items = methodItems();
    expect(items).toHaveLength(6);
    [
      'Valid drive-end coordinates',
      'The most-observed arrival cell',
      'When base evidence is supported',
      'Distances use great-circle geometry',
      'A valid drive-end timestamp',
      'Findings describe 5 rows returned',
    ].forEach((text, index) => expect(items[index]).toHaveTextContent(text));
    expect(items[5]).toHaveTextContent('100-row API cap');
    expect(screen.getByText('Base evidence supported')).toBeInTheDocument();
    expect(screen.getByText('5/3')).toBeInTheDocument();
    expect(screen.getByText('3/2')).toBeInTheDocument();
    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByText(/Comparative rankings additionally require/)).toBeInTheDocument();
  });

  it('retains each list item when translations and window evidence change', () => {
    const summary = summarizeExplorer(drives, { historyLimit: 100 });
    const { rerender } = render(
      <ExplorerMethodology summary={summary} state={state} />,
    );
    const originalItems = methodItems();
    const originalText = originalItems.map((item) => item.textContent);

    translations.prefix = 'Translated: ';
    rerender(<ExplorerMethodology summary={summary} state={state} />);
    methodItems().forEach((item, index) => {
      expect(item).toBe(originalItems[index]);
      expect(item.textContent).toBe(`Translated: ${originalText[index]}`);
    });

    rerender(
      <ExplorerMethodology
        summary={summarizeExplorer(drives, { historyLimit: 5 })}
        state={state}
      />,
    );
    methodItems().forEach((item, index) => {
      expect(item).toBe(originalItems[index]);
    });
    expect(originalItems[5]).toHaveTextContent('The 5-row API cap was reached');
    expect(originalItems[5]).not.toHaveTextContent('Findings describe');
  });

  it('supports duplicate translated descriptions without key collisions', () => {
    translations.duplicate = true;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <ExplorerMethodology
          summary={summarizeExplorer(drives)}
          state={state}
        />,
      );
      expect(methodItems()).toHaveLength(6);
      methodItems().forEach((item) => {
        expect(item).toHaveTextContent('Shared translation');
      });
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
