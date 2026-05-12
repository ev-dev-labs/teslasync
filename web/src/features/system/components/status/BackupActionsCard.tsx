/**
 * BackupActionsCard — wraps the backup status DefList with a
 * "Run quick backup now" mutation button.
 *
 * UX rules (per Phase 2 backup status):
 *   - Disable the button while the mutation is in flight so a
 *     double-click can't fire two backups.
 *   - Surface success/failure via the app toast system.
 *   - Invalidate backup-runs and backup-stats queries after the
 *     mutation settles so the page reflects the new run.
 *   - Permission errors (401/403) surface a clear message rather
 *     than a generic failure.
 */

import { type ReactNode, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui'
import { useToast } from '@/components/feedback/Toast'
import { triggerQuickBackup } from '@/api/devtools'
import { ApiError } from '@/api/client'

interface BackupActionsCardProps {
  /** The DefList rows already rendered for the backup section. */
  children: ReactNode
}

export function BackupActionsCard({ children }: BackupActionsCardProps) {
  const qc = useQueryClient()
  const toast = useToast()

  const mutation = useMutation({
    mutationFn: triggerQuickBackup,
    onSuccess: () => {
      toast.success('Quick backup started')
      qc.invalidateQueries({ queryKey: ['backup-runs'] })
      qc.invalidateQueries({ queryKey: ['system-status', 'backup-stats'] })
    },
    onError: (err: unknown) => {
      const status = err instanceof ApiError ? err.status : null
      if (status === 401 || status === 403) {
        toast.error('Quick backup requires admin permission.')
      } else {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        toast.error(`Backup failed: ${msg}`)
      }
    },
  })

  const handleRun = useCallback(() => {
    if (mutation.isPending) return
    mutation.mutate()
  }, [mutation])

  return (
    <div className="space-y-4">
      {children}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/[0.06]">
        <Button
          variant="primary"
          size="sm"
          onClick={handleRun}
          disabled={mutation.isPending}
          className="gap-2"
        >
          <Play className={mutation.isPending ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
          {mutation.isPending ? 'Starting…' : 'Run quick backup now'}
        </Button>
        <Link
          to="/backup"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-cyan-300 hover:text-cyan-200 hover:bg-white/[0.04]"
        >
          Manage backups & restore
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}
