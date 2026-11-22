import { Fragment, useMemo, type ReactNode } from 'react';
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
  /** Wrap display lines without changing the clipboard payload. Defaults to true for text. */
  wrap?: boolean;
}

// Large diagnostic documents can still wrap without creating thousands of gutter nodes.
const MAX_NUMBERED_LINES = 500;

export function CodeBlock({
  text,
  language,
  children,
  heading,
  ariaLabel,
  className,
  action,
  wrap,
}: CodeBlockProps) {
  const { t } = useTranslation();
  const langLabel = language?.trim() || 'text';
  // Markdown renderers can supply nullish text for an empty fence at runtime.
  const rawText = text ?? '';
  const display = children ?? rawText;
  const shouldWrap = wrap ?? typeof display === 'string';
  const numberedParts = useMemo(() => {
    if (!shouldWrap || typeof display !== 'string' || display === '') return null;
    const parts = display.split(/(\r\n|[\n\r])/, MAX_NUMBERED_LINES * 2);
    return parts.length < MAX_NUMBERED_LINES * 2 ? parts : null;
  }, [display, shouldWrap]);

  if (typeof rawText !== 'string') {
    throw new TypeError('CodeBlock text must be a string');
  }

  return (
    <div
      role="group"
      data-app-part="panel"
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
          {action ?? <CopyButton text={rawText} iconOnly variant="ghost" size="sm" className="min-h-11 min-w-11 md:min-h-9 md:min-w-0" />}
        </div>
      </div>
      <pre
        className={cn(
          typography.role.code,
          'min-w-0 max-w-full overflow-auto p-3 leading-relaxed',
          shouldWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
        )}
      >
        <code dir={numberedParts ? 'ltr' : undefined} className={numberedParts
          ? 'block border-s-2 border-[var(--border-strong)] ps-12 [overflow-wrap:anywhere]'
          : undefined}>
          {numberedParts ? numberedParts.map((part, index) => index % 2 === 1 ? part : (
            <Fragment key={index}>
              <span
                aria-hidden="true"
                data-code-line={index / 2 + 1}
                className="pointer-events-none relative inline-block h-[1lh] w-0 select-none align-bottom before:absolute before:end-2 before:top-0 before:tabular-nums before:text-[var(--text-secondary)] before:content-[attr(data-code-line)]"
              />
              {part}
            </Fragment>
          )) : display}
        </code>
      </pre>
    </div>
  );
}
