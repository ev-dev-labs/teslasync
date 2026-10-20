import { Link } from 'react-router-dom';
import { PhysicsEvidenceBrief } from '../operationalbrief-n-z/PhysicsEvidenceBrief';
import { Badge, Text } from '@/components/ui';
import { Evidence, RawRows } from './Evidence';
import { type PhysicsPage, hours, seconds, time, unknown } from './PhysicsPageShell';
import type { SessionBoundary } from '@/types/teslaPhysics';

export default function PhysicsVaultSection({ physics }: { physics: PhysicsPage }) {
  const { report, t } = physics;
  const vault = report?.vault;
  const cert = vault?.certificate;
  const drives = cert?.drives ?? [];
  const charges = cert?.charges ?? [];
  const source = report?.evidence;
  const dwells = (vault?.etiquette_dwells_s ?? []).map((dwell, index) => ({ dwell, index }));
  const columns = (kind: 'drive' | 'charge') => [
    { key: 'id', header: t('teslaOnly.sessionId', 'ID'), render: (r: SessionBoundary) => r.id > 0
      ? <Link to={`/${kind === 'drive' ? 'drives' : 'charging'}/${r.id}`} className="text-[var(--theme-primary)] underline-offset-4 hover:underline">{r.id} →</Link> : unknown(t) },
    { key: 'kind', header: t('teslaOnly.kind', 'Kind'), render: (r: SessionBoundary) => r.kind },
    { key: 'started', header: t('teslaOnly.started', 'Started'), render: (r: SessionBoundary) => time(r.started_at, t) },
    { key: 'ended', header: t('teslaOnly.ended', 'Ended'), render: (r: SessionBoundary) => time(r.ended_at, t) },
    { key: 'rule', header: t('teslaOnly.endRule', 'End rule'), render: (r: SessionBoundary) => r.end_rule },
  ];
  return <>
    <Evidence title={physics.title} honesty={vault?.honesty}>
      <PhysicsEvidenceBrief physics={physics} id="physics-vault-summary" available={vault != null}
        description={t('teslaOnly.vaultCaution', 'A digest attests only to returned certificate boundaries under its rules; HMAC requires the configured key for verification. Neither digest proves telemetry completeness or a lifetime record.')}
        metrics={[
          { metricId: 'duration', occurrenceId: 'unknown', label: t('teslaOnly.unknownHours', 'Unknown'), rawValue: vault?.unknown_hours == null ? null : vault.unknown_hours * 3600, display: { formatter: raw => ({ value: hours(raw / 3600, t), unit: '' }) } },
          { metricId: 'count', occurrenceId: 'drives', label: t('teslaOnly.vaultDrives', 'Drive boundaries'), rawValue: cert ? drives.length : null },
          { metricId: 'count', occurrenceId: 'charges', label: t('teslaOnly.vaultCharges', 'Charge boundaries'), rawValue: cert ? charges.length : null },
          { metricId: 'count', occurrenceId: 'history', label: t('teslaOnly.historyRowsLabel', 'Bounded history rows'), rawValue: source?.history_available ? source.history_rows : null, context: source ? t('teslaOnly.vaultSourceRows', '{{count}} bounded history rows; {{drives}} drive and {{charges}} charge boundaries returned', { count: source.history_rows, drives: drives.length, charges: charges.length }) : undefined },
        ]} />
      <Text as="p" variant="bodySm">{t('teslaOnly.certificateWindow', 'Certificate window: {{from}} to {{to}} · issued {{issued}}', {
        from: time(cert?.from, t), to: time(cert?.to, t), issued: time(cert?.issued_at, t),
      })}</Text>
      <Badge variant={cert?.hmac_sha256 ? 'success' : 'warning'} size="sm">{cert?.hmac_sha256
        ? t('teslaOnly.hmacConfigured', 'HMAC configured: verify with the configured key')
        : t('teslaOnly.hashOnly', 'Hash only: not an authenticated signature')}</Badge>
      <Text as="p" variant="bodySm" className="break-all">{t('teslaOnly.integrity', 'Integrity')}: {cert?.integrity_sha256 || unknown(t)}</Text>
      {cert?.hmac_sha256 && <Text as="p" variant="caption" className="break-all">{t('teslaOnly.hmacDigest', 'HMAC-SHA256 digest')}: {cert.hmac_sha256}</Text>}
      <Text as="p" variant="caption">{cert?.rules}</Text><Text as="p" variant="caption">{cert?.honesty}</Text>
      {source ? <div className="flex flex-wrap gap-2">
        {!source.history_available && <Badge variant="warning" size="sm">{t('teslaOnly.vaultHistoryMissing', 'History unavailable: certificate boundaries do not prove telemetry coverage')}</Badge>}
        {source.history_truncated && <Badge variant="warning" size="sm">{t('teslaOnly.vaultHistoryPartial', 'History row cap reached: telemetry evidence is partial')}</Badge>}
        {source.drive_sessions_truncated && <Badge variant="warning" size="sm">{t('teslaOnly.vaultDrivePartial', 'Drive session cap reached: drive boundaries are partial')}</Badge>}
        {source.charge_sessions_truncated && <Badge variant="warning" size="sm">{t('teslaOnly.vaultChargePartial', 'Charge session cap reached: charge boundaries are partial')}</Badge>}
      </div> : <Text as="p" variant="caption">{t('teslaOnly.scopeUnavailable', 'Evidence coverage metadata was not returned; counts cannot establish completeness.')}</Text>}
      <div className="flex flex-wrap gap-2">{(vault?.firmware_versions ?? []).map((version) => <Badge key={version} variant="neutral" size="sm">{version}</Badge>)}</div>
      <RawRows title={t('teslaOnly.vaultDrives', 'Drive boundaries')} rows={[...drives].reverse()} columns={columns('drive')} tableId="physics:vault-drives" t={t}
        mobileColumns={['id', 'started', 'rule']} keyExtractor={(r) => `drive-${r.id}-${r.started_at}`} />
      <RawRows title={t('teslaOnly.vaultCharges', 'Charge boundaries')} rows={[...charges].reverse()} columns={columns('charge')} tableId="physics:vault-charges" t={t}
        mobileColumns={['id', 'started', 'rule']} keyExtractor={(r) => `charge-${r.id}-${r.started_at}`} />
      <RawRows title={t('teslaOnly.vaultEtiquette', 'Supercharger etiquette dwells')} rows={dwells} tableId="physics:vault-dwells" t={t}
        keyExtractor={(r) => String(r.index)} columns={[
          { key: 'dwell', align: 'right', header: t('teslaOnly.unplug', 'Complete → unplug'), render: (r) => seconds(r.dwell, t) },
        ]} />
    </Evidence>
  </>;
}
