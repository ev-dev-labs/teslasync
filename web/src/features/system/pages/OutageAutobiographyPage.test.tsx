import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { OutageAutobiography, SessionCertificate } from '@/types/teslaPhysics';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => undefined }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

const outage: OutageAutobiography = {
  vehicle_id: 7,
  last_telemetry_at: '2026-03-03T11:50:00Z',
  gap_s: 600,
  mqtt_connected: null,
  replay_preserves_event_time: true,
  unknown_since: '2026-03-03T11:50:00Z',
  notes: [
    'Queued MQTT messages that carry the original event time are replayed with that time, not ingest time.',
    'A gap with no samples stays unknown. Absence is not a measured zero.',
  ],
  honesty: 'Gaps stay unknown.',
};

const certificate: SessionCertificate = {
  vehicle_id: 7,
  issued_at: '2026-03-03T12:00:00Z',
  from: '2026-02-01T00:00:00Z',
  to: '2026-03-03T12:00:00Z',
  rules: 'Park ends drives. Disconnected ends charges.',
  drives: [],
  charges: [],
  integrity_sha256: 'abc',
  hmac_sha256: null,
  honesty: 'Hashed export of session boundaries.',
};

function queryStub<T>(data: T) {
  return {
    data,
    error: null,
    isError: false,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isSuccess: true,
    fetchStatus: 'idle' as const,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  };
}

vi.mock('@/api/hooks/useTeslaPhysics', () => ({
  useOutageAutobiography: () => queryStub(outage),
  useSessionCertificate: () => queryStub(certificate),
}));

import OutageAutobiographyPage from './OutageAutobiographyPage';

describe('OutageAutobiographyPage', () => {
  it('treats unknown MQTT as unknown and keeps replay/event-time honesty', () => {
    render(<OutageAutobiographyPage />);
    expect(screen.getByText('Outage autobiography')).toBeInTheDocument();
    expect(screen.getByText('MQTT state unknown')).toBeInTheDocument();
    expect(screen.getByText('Replay keeps event time')).toBeInTheDocument();
    expect(screen.getByText(/gap is not a measured zero/i)).toBeInTheDocument();
    expect(screen.queryByText('MQTT not connected')).not.toBeInTheDocument();
  });
});
