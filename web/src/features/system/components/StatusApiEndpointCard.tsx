/**
 * StatusApiEndpointCard — one entry in the Status API reference grid.
 *
 * Renders a single documented endpoint: HTTP method, path (with a copy
 * affordance), optional query string, prose description, and a collapsible
 * example JSON response. Pure presentation — the parent page owns the data.
 */

import { type ReactNode, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { GlassPanel, Badge, Accordion, CopyButton, Text, Caption } from '@/components/ui'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'

export interface StatusApiEndpointCardProps {
  method: 'GET'
  path: string
  description: string
  query?: string
  example: object
  /** Optional leading glyph for quick visual identification. */
  icon?: ReactNode
}

export function StatusApiEndpointCard({
  method,
  path,
  description,
  query,
  example,
  icon,
}: StatusApiEndpointCardProps) {
  const { t } = useTranslation()

  // Serialize the example once per `example` change. JSON.stringify can throw
  // on inputs the type system can't rule out at the call boundary (circular
  // references, BigInt), and a single malformed example must not crash the
  // whole reference grid — so guard it and fall back to a placeholder. An
  // empty example likewise renders a placeholder instead of a bare "{}".
  const { json, isEmpty, failed } = useMemo(() => {
    const value = example ?? {}
    const empty =
      value == null || typeof value !== 'object' || Object.keys(value).length === 0
    try {
      return { json: JSON.stringify(value, null, 2), isEmpty: empty, failed: false }
    } catch {
      return { json: '', isEmpty: empty, failed: true }
    }
  }, [example])

  return (
    <GlassPanel hover glow="cyan" className="flex h-full flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="info" size="sm">{method}</Badge>
        {icon && (
          <span className="inline-flex text-cyan-300 [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">
            {icon}
          </span>
        )}
        <Text as="code" mono size="sm" className="min-w-0 break-all text-cyan-300">
          {path}
        </Text>
        <CopyButton
          text={path}
          iconOnly
          size="sm"
          ariaLabel={t('statusApi.copyPath', 'Copy endpoint path {{path}}', { path })}
          className="ml-auto shrink-0"
        />
      </div>

      {query && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Caption className="uppercase tracking-wider">{t('statusApi.query', 'Query')}</Caption>
          <Text as="code" mono size="xs" color="secondary" className="break-all">
            ?{query}
          </Text>
        </div>
      )}

      <Text as="p" variant="bodySm" className="leading-relaxed">
        {description}
      </Text>

      <Accordion
        title={t('statusApi.exampleResponse', 'Example response')}
        className="mt-auto"
        bodyClassName="p-0"
      >
        {failed || isEmpty ? (
          <Text as="p" size="sm" color="muted" className="p-3">
            {failed
              ? t('statusApi.exampleUnavailable', 'Example response is unavailable.')
              : t('statusApi.exampleEmpty', 'No example response available.')}
          </Text>
        ) : (
          <pre
            className={cn(
              'max-h-72 overflow-auto p-3 leading-relaxed bg-[var(--surface-overlay)]',
              typography.family.mono,
              typography.size['2xs'],
              typography.color.secondary,
            )}
          >
            {json}
          </pre>
        )}
      </Accordion>
    </GlassPanel>
  )
}
