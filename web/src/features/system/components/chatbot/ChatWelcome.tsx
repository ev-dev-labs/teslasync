import { useTranslation } from 'react-i18next';
import { HelixMark } from '@/components/branding/HelixMark';
import { Heading, Text } from '@/components/ui';
import { SuggestedPrompts } from './SuggestedPrompts';

interface ChatWelcomeProps {
  /**
   * Called with a suggested-prompt string when a chip is clicked. The page
   * fills the composer and focuses it (it does NOT auto-submit) so the user
   * can edit before sending.
   */
  onPick: (text: string) => void;
}

/**
 * Empty-conversation hero shown when the active session has no messages.
 * Purely presentational: the Helix mark, a short prompt, and the suggested
 * prompt chip strip. Vertically + horizontally centered within its scroll
 * container via `flex-1` so it reads as the calm entry point to a chat.
 */
export function ChatWelcome({ onPick }: ChatWelcomeProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-10 text-center">
      <div className="relative">
        <div
          className="absolute inset-0 scale-150 rounded-full bg-purple-500/10 blur-xl"
          aria-hidden="true"
        />
        <div className="relative rounded-full border border-[var(--border-subtle)] bg-gradient-to-br from-purple-500/20 to-blue-500/20 p-6">
          <HelixMark className="h-12 w-12 text-purple-300" aria-hidden="true" />
        </div>
      </div>

      <div className="space-y-2">
        <Heading level="section">
          {t('chatbot.howCanIHelp', 'How can Helix help you?')}
        </Heading>
        <Text as="p" size="sm" color="secondary">
          {t(
            'chatbot.askAbout',
            'Investigate live fleet evidence, compare domains, or ask for cited TeslaSync guidance',
          )}
        </Text>
      </div>

      <SuggestedPrompts onPick={onPick} />
    </div>
  );
}
