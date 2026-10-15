import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from './CopyButton';
import { Text } from './Typography';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';

export interface CodeBlockProps {
  /** Exact clipboard payload, independent of the displayed children. */
  text: string;
  language?: string;
  /** Already-rendered content; no parsing or highlighting is performed. */
  children?: ReactNode;
  heading?: ReactNode;
  ariaLabel?: string;
  className?: string;
  /** Replaces the default copy control, e.g. with caller-owned manual-copy feedback. */
  action?: ReactNode;
  /** Wrap display lines without changing the clipboard payload. */
  wrap?: boolean;
}

export function CodeBlock({
  text,
  language,
  children,
  heading,
  ariaLabel,
  className,
  action,
  wrap = false,
}: CodeBlockProps) {
  const { t } = useTranslation();
  const langLabel = language?.trim() || 'text';
  // Markdown renderers can supply nullish text for an empty fence at runtime.
  const rawText = text ?? '';
  if (typeof rawText !== 'string') {
    throw new TypeError('CodeBlock text must be a string');
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel ?? t('common.codeBlock.aria', '{{language}} code snippet', {
        language: langLabel,
      })}
      className={cn(
        'relative my-2 min-w-0 max-w-full overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)]',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5">
        <div className="min-w-0 break-words">
          {heading ?? <Text variant="label" mono>{langLabel}</Text>}
        </div>
        <div className="shrink-0">
          {action ?? <CopyButton text={rawText} iconOnly variant="ghost" size="sm" />}
        </div>
      </div>
      <pre
        className={cn(
          typography.role.code,
          'min-w-0 max-w-full overflow-auto p-3 leading-relaxed',
          wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
        )}
      >
        <code>{children ?? rawText}</code>
      </pre>
    </div>
  );
}
