import { useTranslation } from 'react-i18next';
import { Users, Mail, Clock, AlertTriangle } from 'lucide-react';

import { StatStrip } from '@/components/data-display';

interface AccessKpiBandProps {
  /** Total drivers currently shared on the vehicle. */
  drivers: number | null | undefined;
  /** Total share invitations (all statuses). */
  invitations: number | null | undefined;
  /** Invitations still awaiting acceptance. */
  pending: number | null | undefined;
  /** Pending invitations expiring within the next 7 days. */
  expiringSoon: number | null | undefined;
  retained?: boolean;
}

/**
 * Full-width KPI band for the Vehicle Access page. Summarises driver and
 * invitation counts derived from the same hook data the tables render, so the
 * numbers never disagree with the detail bands below.
 */
export function AccessKpiBand({ drivers, invitations, pending, expiringSoon, retained = false }: AccessKpiBandProps) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t('vehicleAccess.kpis', 'Access summary')}
    >
      <StatStrip
        id="vehicle-access-summary"
        retained={retained}
        period={{ kind: 'snapshot', label: t('vehicleAccess.snapshot', 'Latest access records'), observedAt: null,
          provenance: `${t('dataSources.labels.vehicleDrivers', 'Vehicle drivers')} / ${t('dataSources.labels.shareInvitations', 'Share invitations')}` }}
        metrics={[
          { metricId: 'count', occurrenceId: 'drivers', label: t('vehicleAccess.kpi.drivers', 'Drivers'), rawValue: drivers ?? null,
            context: <Users className="h-5 w-5" aria-hidden="true" /> },
          { metricId: 'count', occurrenceId: 'invitations', label: t('vehicleAccess.kpi.invitations', 'Invitations'), rawValue: invitations ?? null,
            context: <Mail className="h-5 w-5" aria-hidden="true" /> },
          { metricId: 'count', occurrenceId: 'pending', label: t('vehicleAccess.kpi.pending', 'Pending'), rawValue: pending ?? null,
            context: <Clock className="h-5 w-5" aria-hidden="true" /> },
          { metricId: 'count', occurrenceId: 'expiring', label: t('vehicleAccess.kpi.expiringSoon', 'Expiring soon'), rawValue: expiringSoon ?? null,
            context: <AlertTriangle className="h-5 w-5" aria-hidden="true" /> },
        ]}
      />
    </section>
  );
}
