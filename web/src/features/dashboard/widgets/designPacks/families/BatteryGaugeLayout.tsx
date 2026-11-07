import type { BatteryGaugePresentationProps } from '../viewModels/BatteryGaugeViewModel';

interface BatteryGaugeLayoutProps extends Pick<BatteryGaugePresentationProps, 'status' | 'details'> {
  className: string;
  detailsFirst?: boolean;
}

export default function BatteryGaugeLayout({ status, details, className, detailsFirst = false }: BatteryGaugeLayoutProps) {
  return <div className={className}>{detailsFirst ? details : status}{detailsFirst ? status : details}</div>;
}
