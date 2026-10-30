import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Typography';
import { Tooltip } from '@/components/ui/Tooltip';
import type { RefObject } from 'react';

export function CardDescription({ title, description, boundaryRef }: {
  title: string; description: string; boundaryRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip content={description} multiline boundaryRef={boundaryRef}>
      <Button
        type="button"
        variant="ghost"
        aria-label={t('developerReference.layout.card.descriptionHelp', 'Read full description for {{title}}', { title })}
        className="h-auto min-h-11 w-full min-w-0 justify-start rounded-none p-0 text-start"
        onClick={event => event.currentTarget.focus()}
        onKeyDown={event => {
          if (event.key === 'Escape') event.currentTarget.blur();
        }}
      >
        <Text as="span" variant="bodySm" data-card-desc className="min-h-11 min-w-0 flex-1 break-words line-clamp-2">
          {description}
        </Text>
      </Button>
    </Tooltip>
  );
}
