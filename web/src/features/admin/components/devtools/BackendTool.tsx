import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { Button, Badge } from '@/components/ui'
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
    mutationFn: () => apiFetch(endpoint, method, bodyBuilder?.()),
  })

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
          {t('Run')}
        </Button>
        {mutation.data && (
          <Badge variant={mutation.data.error ? 'danger' : 'success'} size="sm" dot>
            {mutation.data.error ? t('Failed') : t('Success')}
          </Badge>
        )}
      </div>
      {mutation.data && (
        <ResultPanel
          title={title}
          data={mutation.data.error ? undefined : mutation.data}
          error={typeof mutation.data.error === 'string' ? mutation.data.error : undefined}
        />
      )}
    </ToolCard>
  )
}
