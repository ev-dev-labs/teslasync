import { useTranslation } from 'react-i18next';
import { Badge, PanelTitle, Text } from '@/components/ui';
import { Icons } from '@/lib/icons';
import { cn } from '@/lib/cn';

export interface CalculationDetailsProps {
  methods?: readonly string[];
  sources?: readonly string[];
  period?: string | null;
  coverage?: string | null;
  version?: string | null;
  exclusions?: readonly string[];
  className?: string;
}

function unique(values: readonly string[] | undefined): string[] {
  return Array.from(
    new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  );
}

export function CalculationDetails({
  methods,
  sources,
  period,
  coverage,
  version,
  exclusions,
  className,
}: CalculationDetailsProps) {
  const { t } = useTranslation();
  const methodList = unique(methods);
  const sourceList = unique(sources);
  const exclusionList = unique(exclusions);
  const unavailable = t(
    'calculationDetails.unavailable',
    'Not supplied by this analysis.',
  );

  const rows = [
    {
      label: t('calculationDetails.method', 'Method'),
      value: methodList.length > 0 ? methodList.join(' · ') : unavailable,
    },
    {
      label: t('calculationDetails.sources', 'Data sources'),
      value: sourceList.length > 0 ? sourceList.join(' · ') : unavailable,
    },
    {
      label: t('calculationDetails.period', 'Analysis period'),
      value: period?.trim() || unavailable,
    },
    {
      label: t('calculationDetails.coverage', 'Coverage'),
      value: coverage?.trim() || unavailable,
    },
    {
      label: t('calculationDetails.version', 'Calculation version'),
      value: version?.trim() || unavailable,
    },
  ];

  return (
    <section
      aria-label={t(
        'calculationDetails.title',
        'How this was calculated',
      )}
      className={cn(
        'rounded-shape-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4',
        className,
      )}
      data-testid="calculation-details"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Icons.database className="h-4 w-4" aria-hidden="true" />
          {t('calculationDetails.title', 'How this was calculated')}
        </PanelTitle>
        <Badge variant="neutral" size="sm">
          {t('calculationDetails.provenance', 'Provenance')}
        </Badge>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>
              <Text as="span" size="xs" weight="semibold" color="primary">
                {row.label}
              </Text>
            </dt>
            <dd>
              <Text as="span" size="xs" color="muted">
                {row.value}
              </Text>
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
        <Text as="p" size="xs" weight="semibold" color="primary">
          {t('calculationDetails.exclusions', 'Exclusions and limitations')}
        </Text>
        {exclusionList.length > 0 ? (
          <ul className="mt-1 space-y-1">
            {exclusionList.map((item) => (
              <li key={item}>
                <Text as="span" size="xs" className="text-amber-300">
                  {item}
                </Text>
              </li>
            ))}
          </ul>
        ) : (
          <Text as="p" size="xs" color="muted" className="mt-1">
            {t(
              'calculationDetails.noExclusions',
              'No additional exclusions were supplied.',
            )}
          </Text>
        )}
      </div>
    </section>
  );
}
