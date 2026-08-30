import { lazy, Suspense, memo, type ReactNode } from 'react';
import { Heading, Table, Text } from '@/components/ui';
import { CodeBlock } from './CodeBlock';

/**
 * MarkdownRenderer — renders an assistant chat message as sanitized markdown.
 *
 * The actual react-markdown + remark-gfm bundle is lazy-loaded behind
 * `React.lazy()` so it only ships with the chatbot route chunk and never
 * hits the entry bundle (the bundle-size budget in
 * `web/scripts/check-bundle-size.mjs` is tight).
 *
 * Sanitization: react-markdown is safe-by-default — it does NOT render
 * raw HTML embedded in the markdown source. We deliberately do NOT enable
 * `rehype-raw`, so a malicious assistant response containing
 * `<script>alert(1)</script>` renders as escaped text, never executes.
 *
 * Links open in a new tab with `rel="noopener noreferrer"` so the chatbot
 * surface can't be used as a redirect vector.
 *
 * Code blocks delegate to `<CodeBlock>` for copy-to-clipboard and language tags.
 */

const ReactMarkdownLazy = lazy(async () => {
  const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
    import('react-markdown'),
    import('remark-gfm'),
  ]);

  // Wrap the imported component in a forwardRef-free functional shim so
  // we can pass our `components` map without re-importing remarkGfm at
  // every call site.
  function Markdown({ children }: { children: string }) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Inline + fenced code share the same `code` renderer in
          // react-markdown — `className` carries the language hint
          // (`language-ts`, `language-go`, …) for fenced blocks; inline
          // code has no className.
          code({ className, children, ...props }) {
            const match = /language-([\w-]+)/.exec(className ?? '');
            const text = String(children ?? '').replace(/\n$/, '');

            if (!match) {
              return (
                <code
                  className="rounded bg-[var(--surface-2)] px-1 py-0.5 text-xs font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <CodeBlock language={match[1]} text={text}>
                {children as ReactNode}
              </CodeBlock>
            );
          },
          // react-markdown wraps fenced code in <pre><code>; the <pre>
          // would add an extra background/padding layer on top of our
          // CodeBlock styling, so collapse it to a fragment for fenced
          // code (CodeBlock provides its own <pre>).
          pre({ children }) {
            return <>{children}</>;
          },
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-300 underline decoration-purple-500/40 underline-offset-2 hover:decoration-purple-300"
                {...props}
              >
                {children}
              </a>
            );
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 my-1 space-y-0.5">{children}</ol>;
          },
          h1({ children }) {
            return <Heading level="panel" as="h1" className="mt-3 mb-1">{children}</Heading>;
          },
          h2({ children }) {
            return (
              <Text as="h2" size="sm" weight="semibold" color="primary" className="mt-2.5 mb-1">
                {children}
              </Text>
            );
          },
          h3({ children }) {
            return (
              <Text as="h3" size="sm" weight="semibold" color="primary" className="mt-2 mb-1">
                {children}
              </Text>
            );
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-2">
                <Table className="text-xs border border-[var(--border-subtle)]">
                  {children}
                </Table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2 py-1 text-left font-semibold text-[var(--text-primary)]">
                {children}
              </th>
            );
          },
          td({ children }) {
            return <td className="border border-[var(--border-subtle)] px-2 py-1 text-[var(--text-primary)]">{children}</td>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    );
  }
  return { default: Markdown };
});

interface MarkdownRendererProps {
  /** Raw markdown source. */
  children: string;
}

// Memoised: exactly one <MarkdownRenderer> is mounted per assistant message,
// and the chat list re-renders on state changes unrelated to a given bubble
// (hover, a sibling reply streaming). `children` is a primitive string, so the
// default shallow prop compare skips a full react-markdown re-parse whenever the
// text for this bubble is unchanged.
export const MarkdownRenderer = memo(function MarkdownRenderer({
  children,
}: MarkdownRendererProps) {
  // Normalise to a string before handing off to the fallback / react-markdown.
  // The prop is typed `string`, but the chatbot feeds `streamedText ?? content`
  // and a JS caller could still slip a null/undefined through — rendering that
  // into react-markdown is a runtime foot-gun, so guard it at the boundary.
  const source = children ?? '';
  return (
    <Suspense
      fallback={
        // While the lazy chunk loads, render the raw text with line
        // breaks preserved — keeps assistant replies readable even on
        // slow connections.
        <p className="whitespace-pre-wrap">{source}</p>
      }
    >
      <div className="prose-chat space-y-1">
        <ReactMarkdownLazy>{source}</ReactMarkdownLazy>
      </div>
    </Suspense>
  );
});
