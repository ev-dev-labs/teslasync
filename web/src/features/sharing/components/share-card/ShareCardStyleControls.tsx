import { useTranslation } from 'react-i18next';

import { HelpTooltip, Label, Select, Button, Text } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { SHARE_CARD_THEMES, type ShareCardTheme } from '../../lib/shareCard';
import type { ShareCardCompositionProps } from './types';

export function ShareCardStyleControls({
  theme,
  onThemeChange,
}: ShareCardCompositionProps) {
  const { t } = useTranslation();
  const themes = Object.keys(SHARE_CARD_THEMES) as ShareCardTheme[];

  return (
    <section
      data-testid="share-card-style-controls"
      aria-label={t('shareCard.style.aria', 'Share card SVG style controls')}
    >
      <LayoutCard
        title={t('shareCard.style.title', 'SVG style controls')}
        actions={(
          <HelpTooltip
            size="sm"
            i18nKey="shareCard.style.help"
            defaultValue="The deterministic 800 by 418 SVG is rendered locally. Theme colors are fixed into the exported file."
            ariaLabel={t('shareCard.style.helpLabel', 'More information about SVG style')}
          />
        )}
      >
        <Label>
          {t('shareCard.style.theme', 'Theme')}
        </Label>
        <Select
          id="share-card-theme"
          className="mt-2"
          aria-label={t('shareCard.style.theme', 'Theme')}
          value={theme}
          onChange={(event) => onThemeChange(event.target.value as ShareCardTheme)}
          options={[
            { value: 'midnight', label: t('shareCard.style.midnight', 'Midnight') },
            { value: 'aurora', label: t('shareCard.style.aurora', 'Aurora') },
            { value: 'ember', label: t('shareCard.style.ember', 'Ember') },
          ]}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {themes.map((key) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              size="sm"
              aria-label={t('shareCard.style.pickTheme', 'Use the {{name}} theme', {
                name: key,
              })}
              aria-pressed={theme === key}
              onClick={() => onThemeChange(key)}
              className={theme === key
                ? 'h-11 w-11 rounded-xl border-cyan-400/60 p-0'
                : 'h-11 w-11 rounded-xl border-[var(--border-subtle)] p-0'}
              style={{ background: SHARE_CARD_THEMES[key].bg }}
            >
              <span
                className="mx-auto block h-3 w-3 rounded-full"
                style={{ background: SHARE_CARD_THEMES[key].accent }}
                aria-hidden="true"
              />
            </Button>
          ))}
        </div>
        <Text as="p" variant="caption" className="mt-4">
          {t(
            'shareCard.style.note',
            'Metric values are converted from canonical SI only at this render and export boundary.',
          )}
        </Text>
      </LayoutCard>
    </section>
  );
}
