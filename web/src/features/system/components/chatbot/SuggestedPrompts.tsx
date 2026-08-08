import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui';

/**
 * Static, in-process source of suggestion chips shown on an empty
 * conversation. Defined as a const today so it can be replaced with a
 * backend-fed endpoint later without touching the component shape.
 *
 * Each entry has an `i18nKey` + `defaultValue` so translations are
 * drop-in via the existing i18n pipeline.
 */
export interface ChatSuggestion {
  i18nKey: string;
  defaultValue: string;
}

export function getChatSuggestions(): ChatSuggestion[] {
  return [
    {
      i18nKey: 'chatbot.suggestion.readiness',
      defaultValue:
        'Give me a fleet readiness briefing using battery, alerts, and recent charging.',
    },
    {
      i18nKey: 'chatbot.suggestion.attention',
      defaultValue:
        'Which vehicle needs attention first, and what evidence supports it?',
    },
    {
      i18nKey: 'chatbot.suggestion.crossDomain',
      defaultValue:
        'Compare recent driving efficiency and charging patterns across my vehicles.',
    },
    {
      i18nKey: 'chatbot.suggestion.knowledge',
      defaultValue:
        'How do I configure alerts in TeslaSync? Cite the relevant documentation.',
    },
  ];
}

interface SuggestedPromptsProps {
  /**
   * Called with the suggestion text when a chip is clicked. The page
   * fills the input and focuses it but does NOT auto-submit, so the user
   * can edit the prompt before sending.
   */
  onPick: (text: string) => void;
}

/**
 * Empty-state chip strip shown above the input on a fresh conversation.
 * Intentionally compact (4 chips, single row that wraps on narrow widths)
 * so it doesn't dominate the message area.
 */
export function SuggestedPrompts({ onPick }: SuggestedPromptsProps) {
  const { t } = useTranslation();
  const suggestions = getChatSuggestions();

  return (
    <ul
      className="flex flex-wrap gap-2 justify-center max-w-2xl mx-auto list-none p-0 m-0"
      aria-label={t('chatbot.aria.suggestions', 'Suggested prompts')}
    >
      {suggestions.map((s) => {
        // Guarantee a non-empty accessible name: the sparkle icon is
        // decorative (aria-hidden), so an empty/whitespace translation would
        // otherwise leave the chip with no name. Fall back to the English
        // default in that case for both the label and the picked value.
        const translated = t(s.i18nKey, s.defaultValue);
        const text = translated.trim() ? translated : s.defaultValue;
        return (
          <li key={s.i18nKey}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPick(text)}
              icon={<Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
              className="rounded-full border border-[var(--border-subtle)] hover:border-purple-500/30 hover:text-purple-300"
            >
              {text}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
