import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const broker = 'mqtts://complete-broker-name-with-specialist-deployment-details.example.org:8883';
vi.mock('@/api/hooks/useTelemetry', () => ({
  useMQTTStatus: () => ({
    data: { connected: true, broker: 'mqtts://complete-broker-name-with-specialist-deployment-details.example.org:8883', vehicles: [{ signal_count: 0, signals_per_second: 0, last_received: null }] },
    isLoading: false, isFetching: false, isStale: false, isError: false, dataUpdatedAt: 0, refetch: vi.fn(),
  }),
}));

import MQTTStatusWidget from './MQTTStatusWidget';

describe('MQTT canonical details preserve full values', () => {
  it('keeps broker and last-message definitions, with unknown time distinct from measured zero counters', () => {
    render(<MemoryRouter><MQTTStatusWidget size={{ cols: 2, rows: 2 }} /></MemoryRouter>);
    expect(screen.getByText(broker)).toBeInTheDocument();
    expect(screen.getByText(broker)).toHaveAttribute('title', broker);
    const definitions = screen.getByText(broker).closest('dl');
    expect(definitions).not.toBeNull();
    if (!definitions) throw new Error('Expected the canonical definition list');
    expect(within(definitions).getByText('Last message')).toBeInTheDocument();
    expect(within(definitions).getByText('Broker')).toBeInTheDocument();
    expect(within(definitions).getByText('—')).toBeInTheDocument();
    expect(screen.getByText('0.00')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
  });
});
