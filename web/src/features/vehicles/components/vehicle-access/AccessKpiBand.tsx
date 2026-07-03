import { useTranslation } from 'react-i18next';
import { Users, Mail, Clock, AlertTriangle } from 'lucide-react';

import { MetricCard } from '@/components/data-display';

interface AccessKpiBandProps {
  /** Total drivers currently shared on the vehicle. */
  drivers: number;
  /** Total share invitations (all statuses). */
  invitations: number;
  /** Invitations still awaiting acceptance. */
  pending: number;
  /** Pending invitations expiring within the next 7 days. */
  expiringSoon: number;
}

/**
 * Full-width KPI band for the Vehicle Access page. Summarises driver and
 * invitation counts derived from the same hook data the tables render, so the
 * numbers never disagree with the detail bands below.
 */
export function AccessKpiBand({ drivers, invitations, pending, expiringSoon }: AccessKpiBandProps) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t('vehicleAccess.kpis', 'Access summary')}
      className="grid grid-cols-2 gap-4 lg:grid-cols-4"
    >
      <MetricCard
        label={t('vehicleAccess.kpi.drivers', 'Drivers')}
        value={drivers}
        icon={<Users className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('vehicleAccess.kpi.invitations', 'Invitations')}
        value={invitations}
        icon={<Mail className="h-5 w-5" aria-hidden="true" />}
        color="blue"
      />
      <MetricCard
        label={t('vehicleAccess.kpi.pending', 'Pending')}
        value={pending}
        icon={<Clock className="h-5 w-5" aria-hidden="true" />}
        color="amber"
      />
      <MetricCard
        label={t('vehicleAccess.kpi.expiringSoon', 'Expiring Soon')}
        value={expiringSoon}
        icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
        color="red"
      />
    </section>
  );
}
