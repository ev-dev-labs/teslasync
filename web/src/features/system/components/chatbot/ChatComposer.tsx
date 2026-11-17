import type { KeyboardEventHandler, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Square } from 'lucide-react';
import { Button, Icon, Textarea } from '@/components/ui';

interface ChatComposerProps {
  inputRef: Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  waiting: boolean;
  sendDisabled: boolean;
}

/** Persistent composition stays outside the independently scrolling transcript. */
export function ChatComposer({
  inputRef,
  value,
  onChange,
  onKeyDown,
  onSend,
  onStop,
  streaming,
  waiting,
  sendDisabled,
}: ChatComposerProps) {
  const { t } = useTranslation();
  return (
    <form
      data-app-part="conversation-composer"
      data-app-form-section
      data-app-composer-state={waiting ? 'waiting' : streaming ? 'streaming' : value.trim() ? 'draft' : 'empty'}
      aria-label={t('chatbot.inputLabel', 'Message')}
      className="shrink-0 border-t border-[var(--border-subtle)] px-d-pad-x py-d-pad-y"
      onSubmit={(event) => {
        event.preventDefault();
        if (!sendDisabled && !streaming) onSend();
      }}
    >
      <div data-app-form-body className="mx-auto flex w-full max-w-3xl items-end gap-d-gap">
        <div className="min-w-0 flex-1">
          <Textarea
            ref={inputRef}
            id="chatbot-input"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('chatbot.placeholder', 'Ask Helix to investigate, compare, or explain…')}
            label={t('chatbot.inputLabel', 'Message')}
            aria-label={t('chatbot.inputLabel', 'Message')}
            rows={1}
            size="auto"
            className="max-h-40 min-h-11 resize-none"
          />
        </div>
        <div data-app-part="conversation-composer-actions" className="shrink-0">
          {streaming ? (
            <Button
              type="button"
              onClick={onStop}
              variant="secondary"
              size="auto"
              icon={<Icon icon={Square} />}
              aria-label={t('chatbot.actions.stopStreaming', 'Stop streaming')}
              title={t('chatbot.actions.stopHint', 'Stop reveal (Esc)')}
              className="min-h-11 min-w-11 md:min-h-10 md:min-w-0"
              wrapLabel
            >
              {t('chatbot.actions.stop', 'Stop')}
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={sendDisabled}
              variant="primary"
              size="auto"
              icon={<Icon icon={Send} />}
              aria-label={t('chatbot.actions.send', 'Send message')}
              className="min-h-11 min-w-11 md:min-h-10 md:min-w-0"
            />
          )}
        </div>
      </div>
    </form>
  );
}
