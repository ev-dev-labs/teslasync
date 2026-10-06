import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeBlock as SharedCodeBlock } from '@/components/ui';

interface CodeBlockProps {
  /** Language hint from the markdown fence (e.g. "ts", "go", "bash"). */
  language?: string;
  /** Raw text content (used as the clipboard payload). */
  text: string;
  /**
   * Pre-rendered children produced by react-markdown. Kept separate from
   * `text` because the markdown renderer hands us already-escaped React
   * children, not a raw string.
   */
  children?: ReactNode;
  className?: string;
}

/**
 * Wrapper around `<pre><code>` blocks rendered by `<MarkdownRenderer>` for
 * fenced code. Adds a small header with the language tag (when set) and
 * a CopyButton that copies the raw text to the clipboard.
 *
 * No syntax highlighting — react-syntax-highlighter is not in the project
 * dependency set and adding it would push the chatbot bundle past the
 * 350KB entry budget enforced by `web/scripts/check-bundle-size.mjs`.
 * Plain mono styling keeps the bundle lean and is good enough for the
 * short snippets the assistant emits.
 */
export function CodeBlock({ language, text, children, className }: CodeBlockProps) {
  const { t } = useTranslation();
  const langLabel = language?.trim() || 'text';
  return (
    <SharedCodeBlock
      language={language}
      text={text ?? ''}
      ariaLabel={t('chatbot.aria.codeBlock', '{{language}} code snippet', {
        language: langLabel,
      })}
      className={className}
    >
      {children}
    </SharedCodeBlock>
  );
}
