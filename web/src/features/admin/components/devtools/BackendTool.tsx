import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { Button, Badge } from '@/components/ui'
import { getErrorMessage } from '@/lib/errorMessage'
import { ToolCard } from './ToolCard'
import { ResultPanel } from './ResultPanel'
import { apiFetch } from './helpers'

interface BackendToolProps {
  icon: React.ElementType
  color: string
  title: string
  description: string
  endpoint: string
  method?: 'GET' | 'POST' | 'DELETE'
  bodyBuilder?: () => unknown
  children?: React.ReactNode
}

export function BackendTool({
  icon,
  color,
  title,
  description,
  endpoint,
  method = 'GET',
  bodyBuilder,
  children,
}: BackendToolProps) {
  const { t } = useTranslation()
  const mutation = useMutation({
    networkMode: 'always',
    mutationFn: () => apiFetch(endpoint, method, bodyBuilder?.()),
  })

  const result = mutation.data
  const rawError: unknown = mutation.error ?? result?.error
  const hasError = mutation.isError || Boolean(rawError)
  const errorText = hasError
    ? getErrorMessage(rawError, t('devtools.backendTool.requestFailed', 'Request failed'))
    : undefined

  return (
    <ToolCard icon={icon} color={color} title={title} description={description}>
      {children}
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
          icon={<Play className="h-3.5 w-3.5" />}
        >
          {t('devtools.backendTool.run', 'Run')}
        </Button>
        {(result || hasError) && (
          <Badge
            variant={hasError ? 'danger' : 'success'}
            size="sm"
            dot
            role="status"
          >
            {hasError
              ? t('devtools.backendTool.failed', 'Failed')
              : t('devtools.backendTool.success', 'Success')}
          </Badge>
        )}
      </div>
      {(result || hasError) && (
        <ResultPanel title={title} data={hasError ? undefined : result} error={errorText} />
      )}
    </ToolCard>
  )
}
