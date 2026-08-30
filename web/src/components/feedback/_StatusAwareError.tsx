import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  CircleSlash2,
  Clock,
  FileQuestion,
  Lock,
  Server,
  ServerOff,
  ShieldX,
  TimerOff,
  TriangleAlert,
  WifiOff,
} from 'lucide-react'
// Direct module path, NOT the `@/components/ui` category barrel. The barrel
// pulls in `ui/SignalConfigModal`, which imports the feedback barrel, so a
// barrel import here closes a `feedback/index.ts` <-> `ErrorDisplay.tsx`
// cycle that Rollup reports as CYCLIC_CROSS_CHUNK_REEXPORT (broken chunk
// execution order). Intra-`components/` imports use direct paths; the
// category-barrel convention applies to feature/page call sites.
import { Button } from '@/components/ui/Button'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { classifyError } from '@/lib/errorClassification'
import { ErrorState, type ErrorStateProps } from './_ErrorState'
import { ErrorHelpLinks } from './ErrorHelpLinks'
import { PermissionGuidanceNotice } from './PermissionGuidanceNotice'

export interface StatusAwareErrorProps {
  error: unknown
  onRetry?: () => void
  compact?: boolean
  className?: string
  resourceName?: string
  listHref?: string
  message?: string
}

export function StatusAwareError({
  error,
  onRetry,
  compact,
  className,
  resourceName,
  listHref,
  message,
}: StatusAwareErrorProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const kind = classifyError(error, online)

  useEffect(() => {
    if (!error || kind !== 'offline' || !onRetry) return
    let fired = false
    const handler = () => {
      if (fired) return
      fired = true
      onRetry()
    }
    window.addEventListener('online', handler, { once: true })
    return () => window.removeEventListener('online', handler)
  }, [error, kind, onRetry])

  if (!error) return null

  const retryAction = onRetry ? (
    <Button type="button" onClick={onRetry} variant="secondary" size="sm">
      {t('error.retry', 'Retry')}
    </Button>
  ) : undefined
  const baseProps = { compact, className } satisfies Pick<
    ErrorStateProps,
    'compact' | 'className'
  >

  /**
   * HELP-05 / HELP-10 wiring.
   *
   * This component is the shared destination for every failed query in the
   * app (`QueryError` is a thin re-export), which makes it the one place
   * where "what failed" can become "where to go next" without touching a
   * single page.
   *
   * Suppressed in `compact` mode: inline mutation errors sit inside forms and
   * table rows where a multi-line link list would be worse than nothing.
   */
  const footer = compact ? undefined : (
    <div className="space-y-3">
      {(kind === 'unauthorized' || kind === 'forbidden') && (
        <PermissionGuidanceNotice
          kind={kind === 'unauthorized' ? 'unauthenticated' : 'forbidden'}
        />
      )}
      <ErrorHelpLinks kind={kind} />
    </div>
  )
  let state: Omit<ErrorStateProps, 'compact' | 'className'>
  switch (kind) {
    case 'waiting':
      state = {
        Icon: Clock,
        role: 'status',
        tone: 'info',
        title: t('error.waiting.title', 'Waiting for upstream'),
        message: t(
          'error.waiting.message',
          "We're pausing requests briefly. Data will refresh automatically.",
        ),
      }
      break
    case 'not_found': {
      const thing = resourceName ?? t('error.notFound.thingDefault', 'Resource')
      state = {
        Icon: FileQuestion,
        title: t('error.notFound.title', '{{thing}} not found', { thing }),
        message: t(
          'error.notFound.message',
          'It may have been deleted or the link is wrong.',
        ),
        action: listHref ? (
          <Button
            type="button"
            onClick={() => navigate(listHref)}
            variant="secondary"
            size="sm"
          >
            {t('error.notFound.cta', 'Back to list')}
          </Button>
        ) : undefined,
      }
      break
    }
    case 'unauthorized':
      state = {
        Icon: Lock,
        title: t('error.unauthorized.title', 'Sign in required'),
        message: t(
          'error.unauthorized.message',
          'Your session has expired. Please sign in again.',
        ),
        action: (
          <Button
            type="button"
            onClick={() => {
              window.location.href = '/login'
            }}
            variant="secondary"
            size="sm"
          >
            {t('error.unauthorized.cta', 'Sign in')}
          </Button>
        ),
      }
      break
    case 'forbidden':
      state = {
        Icon: ShieldX,
        title: t('error.forbidden.title', 'Permission denied'),
        // The "ask an administrator" half of this sentence moved into
        // <PermissionGuidanceNotice> below, which says it with concrete steps
        // and names who can grant access. Saying it twice made the card read
        // like two different pieces of advice.
        message: t(
          'error.forbidden.message',
          'Your account does not have permission to view or change this resource.',
        ),
      }
      break
    case 'timed_out':
      state = {
        Icon: TimerOff,
        tone: 'warning',
        title: t('error.timeout.title', 'Request timed out'),
        message: t(
          'error.timeout.message',
          'The service did not respond in time. Existing data has not been changed.',
        ),
        action: retryAction,
      }
      break
    case 'unsupported':
      state = {
        Icon: CircleSlash2,
        role: 'status',
        tone: 'neutral',
        title: t('error.unsupported.title', 'Feature not supported'),
        message: t(
          'error.unsupported.message',
          'This feature is not available with the current server or deployment configuration.',
        ),
      }
      break
    case 'unavailable':
      state = {
        Icon: ServerOff,
        tone: 'warning',
        title: t('error.unavailable.title', 'Service unavailable'),
        message: t(
          'error.unavailable.message',
          'A required service is temporarily unavailable. Try again after it recovers.',
        ),
        action: retryAction,
      }
      break
    case 'server':
      state = {
        Icon: Server,
        title: t('error.serverError.title', 'Server error'),
        message: t(
          'error.serverError.message',
          'Something went wrong on our end. Please try again.',
        ),
        action: retryAction,
      }
      break
    case 'request':
      state = {
        Icon: TriangleAlert,
        title: t('error.request.title', 'Request could not be completed'),
        message: t(
          'error.request.message',
          'Review the request and try again. No changes were applied.',
        ),
        action: retryAction,
      }
      break
    case 'offline':
      state = {
        Icon: WifiOff,
        role: 'status',
        tone: 'warning',
        title: t('error.network.offlineTitle', "You're offline"),
        message: t(
          'error.network.offlineDetail',
          "We'll retry automatically when your connection returns.",
        ),
        action: onRetry ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled
            aria-disabled="true"
          >
            {t('error.network.retryWhenOnline', 'Retry when online')}
          </Button>
        ) : undefined,
      }
      break
    case 'network':
    default:
      state = {
        Icon: AlertCircle,
        title: t('error.network.title', "Can't reach server"),
        message: t(
          'error.network.message',
          'Check your internet connection and try again.',
        ),
        action: retryAction,
      }
      break
  }

  return (
    <ErrorState
      {...baseProps}
      {...state}
      message={message ?? state.message}
      footer={footer}
    />
  )
}
