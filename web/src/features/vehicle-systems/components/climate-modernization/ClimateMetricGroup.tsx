import { Children, isValidElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type StatMetric, type StatPeriod } from '@/components/data-display';
import { VehicleOperationalBrief } from '../operationalbrief-all/VehicleOperationalBrief';
import { Text } from '@/components/ui';

interface ClimateMetricProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  color?: 'cyan' | 'blue' | 'amber' | 'green' | 'purple';
  metric?: Pick<StatMetric, 'metricId' | 'rawValue' | 'display'>;
}

function specialistMetric(props: ClimateMetricProps, occurrenceId: string): StatMetric {
  return {
    metricId: props.metric?.metricId ?? 'status',
    occurrenceId,
    rawValue: props.metric ? props.metric.rawValue : props.value === '—' ? null : String(props.value),
    display: props.metric?.display,
    label: props.label,
    description: [props.label, props.subtitle].filter(Boolean).join(' · '),
    context: (
      <div data-climate-tone={props.color} className="flex min-w-0 items-center gap-2">
        {props.icon && <span aria-hidden="true" className="shrink-0">{props.icon}</span>}
        {props.subtitle && <Text as="span" variant="bodySm">{props.subtitle}</Text>}
      </div>
    ),
  };
}

/** Also renders usefully on its own; the group collects these typed props. */
export function ClimateMetric(props: ClimateMetricProps) {
  const { t } = useTranslation();
  return <VehicleOperationalBrief id="climate-single" title={props.label} metrics={[specialistMetric(props, 'climate-single')]}
    period={{ kind: 'unknown', label: t('climate.page.overview', 'Climate overview') }} />;
}

/** A single canonical stat bank retains all specialist labels, values and context. */
export function ClimateMetricGroup({
  id, period, children, title, retained,
}: {
  id: string;
  period: StatPeriod;
  children: ReactNode;
  title: string;
  retained?: boolean;
}) {
  const metrics = Children.toArray(children).map((child, index) => {
    if (!isValidElement<ClimateMetricProps>(child) || child.type !== ClimateMetric) {
      throw new Error('ClimateMetricGroup requires ClimateMetric children');
    }
    return specialistMetric(child.props, `${id}-${index}`);
  });
  return <VehicleOperationalBrief embedded id={id} title={title} metrics={metrics} period={period} retained={retained} />;
}
