import { render, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { OutageAutobiography, SessionCertificate } from '@/types/teslaPhysics';
import { downloadJSON, defaultExportFilename } from '@/lib/csvExport';
import { formatDateTime } from '@/lib/dateFormat';

const selected = vi.hoisted(() => ({ vehicleId: 7 as number | null }));
vi.mock('@/lib/csvExport', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadJSON: vi.fn(),
}));
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: { locale: 'en-US', decimal_precision: 2, currency_symbol: '$' }, settingsUnavailable: false }),
}));

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
  useSelectedVehicle: () => ({ vehicleId: selected.vehicleId }),
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

const sources = vi.hoisted(() => ({ outage: vi.fn(), certificate: vi.fn() }));

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
  useOutageAutobiography: (vehicleId: string | undefined) => sources.outage(vehicleId),
  useSessionCertificate: (vehicleId: string | undefined) => sources.certificate(vehicleId),
}));

import OutageAutobiographyPage from './OutageAutobiographyPage';

function renderPage() {
  return render(<MemoryRouter><OutageAutobiographyPage /></MemoryRouter>);
}

describe('OutageAutobiographyPage', () => {
  beforeEach(() => {
    selected.vehicleId = 7;
    vi.mocked(downloadJSON).mockClear();
    sources.outage.mockClear();
    sources.certificate.mockClear();
    sources.outage.mockReturnValue(queryStub(outage));
    sources.certificate.mockReturnValue(queryStub(certificate));
  });

  it('treats unknown MQTT as unknown and keeps replay/event-time honesty', () => {
    renderPage();
    expect(screen.getByText('Outage autobiography')).toBeInTheDocument();
    expect(screen.getByText('MQTT state unknown')).toBeInTheDocument();
    expect(screen.getByText('Replay keeps event time')).toBeInTheDocument();
    expect(screen.getByText(/gap is not a measured zero/i)).toBeInTheDocument();
    expect(screen.queryByText('MQTT not connected')).not.toBeInTheDocument();
  });

  it('keeps outage evidence and certificate recovery independent', () => {
    const retry = vi.fn();
    sources.certificate.mockReturnValue({
      ...queryStub(undefined),
      error: new Error('certificate unavailable'),
      isError: true,
      refetch: retry,
    });
    renderPage();
    expect(screen.getByText('MQTT state unknown')).toBeInTheDocument();
    expect(screen.getByText(outage.notes[0])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Session certificate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps the outage panel and certificate visible when no outage data has resolved', () => {
    sources.outage.mockReturnValue(queryStub(undefined));
    renderPage();
    expect(screen.getByRole('heading', { name: 'Catch-up after MQTT or carbon loss' })).toBeInTheDocument();
    expect(screen.getByText('No outage evidence has been recorded for this vehicle yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Session certificate' })).toBeEnabled();
  });

  it('retains notes and certificate export affordance after refresh failure', () => {
    sources.outage.mockReturnValue({ ...queryStub(outage), error: new Error('outage refresh'), isError: true });
    sources.certificate.mockReturnValue({ ...queryStub(certificate), error: new Error('certificate refresh'), isError: true });
    renderPage();
    expect(screen.getByText(outage.notes[1])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Session certificate' })).toBeEnabled();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(within(screen.getAllByTestId('stale-refresh-warning')[0]!).getByText('Outage autobiography may be out of date')).toBeInTheDocument();
  });
});


describe('OutageAutobiographyPage contract states', () => {
  beforeEach(() => {
    selected.vehicleId = 7;
    sources.outage.mockClear();
    sources.certificate.mockClear();
    vi.mocked(downloadJSON).mockClear();
    sources.outage.mockReturnValue(queryStub(outage));
    sources.certificate.mockReturnValue(queryStub(certificate));
  });

  it('keeps both source sections and directs missing selection to the header', () => {
    selected.vehicleId = null;
    sources.outage.mockReturnValue({ ...queryStub(undefined), isPending: true, isSuccess: false });
    sources.certificate.mockReturnValue({ ...queryStub(undefined), isPending: true, isSuccess: false });
    renderPage();
    expect(screen.getByRole('heading', { name: 'Outage evidence' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Session certificate' })).toBeInTheDocument();
    expect(screen.getAllByText('Choose a vehicle in the header to view outage evidence and its session certificate.').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('No outage evidence has been recorded for this vehicle yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Session certificate' })).toBeDisabled();
    expect(sources.outage).toHaveBeenCalledWith(undefined);
    expect(sources.certificate).toHaveBeenCalledWith(undefined);
  });

  it('keeps initial paused sources unknown rather than claiming empty evidence', () => {
    const paused = { ...queryStub(undefined), isPending: true, isSuccess: false, fetchStatus: 'paused' as const };
    sources.outage.mockReturnValue(paused);
    sources.certificate.mockReturnValue(paused);
    renderPage();
    expect(screen.getAllByText('Waiting for a connection before this source can load. Missing evidence remains unknown.')).toHaveLength(2);
    expect(screen.queryByText('No outage evidence has been recorded for this vehicle yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('A session certificate is not available for this vehicle yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('labels paused retained evidence honestly without losing notes or the certificate', () => {
    sources.outage.mockReturnValue({ ...queryStub(outage), fetchStatus: 'paused' as const });
    sources.certificate.mockReturnValue({ ...queryStub(certificate), fetchStatus: 'paused' as const });
    renderPage();
    expect(screen.getByText('Retained source · Connection paused; source freshness is not confirmed.')).toBeInTheDocument();
    expect(screen.getByText(outage.notes[0])).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Session certificate' })).toBeEnabled();
  });

  it('explains missing details without inventing replay failure or zero incidents', () => {
    sources.outage.mockReturnValue(queryStub({ ...outage, replay_preserves_event_time: false, notes: [] }));
    renderPage();
    expect(screen.getByRole('heading', { name: 'Outage evidence' })).toBeInTheDocument();
    expect(screen.getByText('No replay assurance or outage notes were supplied. Missing details do not establish zero incidents.')).toBeInTheDocument();
    expect(screen.queryByText('Replay keeps event time')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Session certificate' })).toBeEnabled();
  });

  it('isolates outage failure and retry from the available certificate', () => {
    const retry = vi.fn();
    sources.outage.mockReturnValue({ ...queryStub(undefined), error: new Error('outage unavailable'), isError: true, isSuccess: false, refetch: retry });
    renderPage();
    expect(screen.getAllByText(/Unable to load outage evidence/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('heading', { name: 'Outage evidence' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Session certificate' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps each source loading independently without displaying confirmed empty copy', () => {
    sources.outage.mockReturnValue({ ...queryStub(undefined), isPending: true, isLoading: true, isSuccess: false, fetchStatus: 'fetching' as const });
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading Outage autobiography' })).toBeInTheDocument();
    expect(screen.getByText('The session certificate is available for download with its original evidence intact.')).toBeInTheDocument();
    expect(screen.queryByText('No outage evidence has been recorded for this vehicle yet.')).not.toBeInTheDocument();
  });

  it('distinguishes an unresolved idle source from a resolved empty source', () => {
    sources.outage.mockReturnValue({ ...queryStub(undefined), isSuccess: false });
    sources.certificate.mockReturnValue(queryStub(undefined));
    renderPage();
    expect(screen.getByText('This source has not resolved yet; missing evidence is not a confirmed empty result.')).toBeInTheDocument();
    expect(screen.getByText('A session certificate is not available for this vehicle yet.')).toBeInTheDocument();
  });

  it.each([true, false])('keeps confirmed MQTT %s distinct from unknown and preserves measured zero', connected => {
    sources.outage.mockReturnValue(queryStub({ ...outage, mqtt_connected: connected, gap_s: 0 }));
    renderPage();
    expect(screen.getByText(connected ? 'MQTT connected' : 'MQTT not connected')).toBeInTheDocument();
    expect(screen.queryByText('MQTT state unknown')).not.toBeInTheDocument();
    expect(screen.getByText('Gap 0 min')).toBeInTheDocument();
  });

  it('exports the original certificate payload and retains a wrapping mobile action', () => {
    renderPage();
    const button = screen.getByRole('button', { name: 'Session certificate' });
    expect(button).toHaveClass('min-h-11', 'md:min-h-9', 'whitespace-normal', 'max-w-full');
    fireEvent.click(button);
    expect(downloadJSON).toHaveBeenCalledExactlyOnceWith(defaultExportFilename('session-certificate'), certificate);
    expect(vi.mocked(downloadJSON).mock.calls[0]?.[1]).toBe(certificate);
    expect(sources.outage).toHaveBeenCalledWith('7');
    expect(sources.certificate).toHaveBeenCalledWith('7');
  });

  it('retains display-time formatting and original event timestamps', () => {
    renderPage();
    expect(screen.getAllByText(formatDateTime(outage.last_telemetry_at!)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Original event time; a missing timestamp does not imply zero traffic/)).toBeInTheDocument();
    expect(screen.getByText(outage.notes[0])).toBeInTheDocument();
    expect(outage.gap_s).toBe(600);
    expect(certificate.integrity_sha256).toBe('abc');
  });
});
