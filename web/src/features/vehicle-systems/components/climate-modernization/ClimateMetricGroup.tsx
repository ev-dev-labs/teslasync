import { Children, isValidElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StatGroup, type StatMetric, type StatPeriod } from '@/components/data-display';
import { Text } from '@/components/ui';

interface ClimateMetricProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  color?: 'cyan' | 'blue' | 'amber' | 'green' | 'purple';
}

function specialistMetric(props: ClimateMetricProps, occurrenceId: string): StatMetric {
  return {
    // Fan levels, enum/status strings and preformatted percent/temperature
    // values must not be coerced into generic counts, watts or temperatures.
    metricId: 'text',
    occurrenceId,
    rawValue: props.value === '—' ? null : String(props.value),
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
  return <StatGroup metrics={[specialistMetric(props, 'climate-single')]}
    period={{ kind: 'unknown', label: t('climate.page.overview', 'Climate overview') }} />;
}

/** A single canonical stat bank retains all specialist labels, values and context. */
export function ClimateMetricGroup({
  id, period, children,
}: {
  id: string;
  period: StatPeriod;
  children: ReactNode;
}) {
  const metrics = Children.toArray(children).map((child, index) => {
    if (!isValidElement<ClimateMetricProps>(child) || child.type !== ClimateMetric) {
      throw new Error('ClimateMetricGroup requires ClimateMetric children');
    }
    return specialistMetric(child.props, `${id}-${index}`);
  });
  return <StatGroup id={id} metrics={metrics} period={period} />;
}
