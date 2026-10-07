import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '@/components/ui';
import { cn } from '@/lib/cn';

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
  // Guard against a runtime-undefined `text`. The prop is typed `string`, but
  // react-markdown can hand an empty fence through as `undefined`; without the
  // fallback we would copy / render the literal string "undefined".
  const rawText = text ?? '';
  return (
    <div
      role="group"
      aria-label={t('chatbot.aria.codeBlock', '{{language}} code snippet', {
        language: langLabel,
      })}
      className={cn(
        'relative rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-overlay)] my-2 overflow-hidden',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3 py-1.5 text-2xs uppercase tracking-wider text-[var(--text-secondary)]">
        <span className="font-mono">{langLabel}</span>
        <CopyButton text={rawText} iconOnly variant="ghost" size="sm" />
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-[var(--text-primary)] font-mono">
        <code>{children ?? rawText}</code>
      </pre>
    </div>
  );
}
