import {
  BookOpen,
  Database,
  Divide,
  Filter,
  Info,
  ThermometerSun,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';

interface RegenMethodologyListProps {
  historyLimit: number;
}

export function RegenMethodologyList({
  historyLimit,
}: RegenMethodologyListProps) {
  const { t } = useTranslation();
  const methods = [
    {
      icon: <Database className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'regen.method.scopes',
        'The /analytics/regen totals cover the complete selected date window and are not capped. Detailed evidence comes separately from /drives and is capped at {{limit}} returned rows.',
        { limit: fmtInt(historyLimit) },
      ),
    },
    {
      icon: <Divide className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'regen.method.weighting',
        'Every aggregate ratio shown here is energy-weighted: summed recovered Wh ÷ summed positive drive-energy Wh. It is not an average of drive percentages.',
      ),
    },
    {
      icon: <Filter className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'regen.method.eligibility',
        'A detailed drive is eligible when regen energy is finite and non-negative and drive energy is finite and positive. Measured zero regen is valid 0%; missing, negative, or non-positive inputs are excluded.',
      ),
    },
    {
      icon: <BookOpen className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'regen.method.months',
        'Calendar-month buckets count every valid dated returned row. Months without an eligible energy pair keep recovered energy, drive energy, and recovery share unavailable; measured zero regen is 0% only with a positive drive-energy denominator. The trend displays at most the latest 24 observed months.',
      ),
    },
    {
      icon: <ThermometerSun className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'regen.method.descriptive',
        'Ambient-temperature and starting-SoC comparisons are descriptive associations. Route, elevation, traffic, HVAC use, weather, and trip length may differ; no causal effect is claimed.',
      ),
    },
    {
      icon: <Info className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'regen.method.capacity',
        'Equivalent full-pack cycles use an estimated usable battery capacity reported by the aggregate endpoint. The estimate is provenance context, not a measured capacity test.',
      ),
    },
  ];

  return (
    <ul className="mt-5 grid gap-3 lg:grid-cols-2">
      {methods.map((method) => (
        <li
          key={method.text}
          className="flex items-start gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] p-3"
        >
          <span className="mt-0.5 shrink-0 text-cyan-300">{method.icon}</span>
          <Text as="span" variant="bodySm">{method.text}</Text>
        </li>
      ))}
    </ul>
  );
}
