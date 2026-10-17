import { useTranslation } from 'react-i18next';
import { Text, Caption, HelpTooltip, type HelpTooltipProps } from '@/components/ui';

export function MiniStat({ label, value, help }: {
  label: string; value: string; help?: HelpTooltipProps;
}) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3 text-center">
      <span className="mb-1 inline-flex items-center gap-1">
        <Caption>{label}</Caption>
        {help && (
          <HelpTooltip
            size="xs"
            {...help}
            ariaLabel={help.ariaLabel ?? t('lifetime.moreInfoAbout', 'More info about {{label}}', { label })}
          />
        )}
      </span>
      <Text as="p" size="lg" weight="semibold" color="primary" className="break-words">{value}</Text>
    </div>
  );
}
