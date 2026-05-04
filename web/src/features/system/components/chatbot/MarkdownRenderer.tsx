import { lazy, Suspense, type ReactNode } from 'react';
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
 * Code blocks delegate to `<CodeBlock>` (Phase 40 / Prompt 56) which adds
 * a copy-to-clipboard affordance and a language tag.
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
                  className="rounded bg-[var(--surface-2)] px-1 py-0.5 text-[0.85em] font-mono"
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
            return <h1 className="text-base font-semibold text-[var(--text-primary)] mt-3 mb-1">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-sm font-semibold text-[var(--text-primary)] mt-2.5 mb-1">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-sm font-semibold text-[var(--text-primary)] mt-2 mb-1">{children}</h3>;
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-2">
                <table className="text-xs border-collapse border border-[var(--border-subtle)]">
                  {children}
                </table>
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

export function MarkdownRenderer({ children }: MarkdownRendererProps) {
  return (
    <Suspense
      fallback={
        // While the lazy chunk loads, render the raw text with line
        // breaks preserved — keeps assistant replies readable even on
        // slow connections.
        <p className="whitespace-pre-wrap">{children}</p>
      }
    >
      <div className="prose-chat space-y-1">
        <ReactMarkdownLazy>{children}</ReactMarkdownLazy>
      </div>
    </Suspense>
  );
}
