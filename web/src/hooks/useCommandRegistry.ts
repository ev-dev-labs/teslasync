import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/components/ui/ThemeProvider'
import { useToast } from '@/components/feedback/Toast'
import { useSelectedVehicleStore } from '@/store/selectedVehicle'
import {
  commandRegistry,
  scoreCommand,
  type CommandContext,
  type CommandDefinition,
  type CommandSection,
} from '@/lib/commandRegistry'

/**
 * Resolved palette command — what {@link CommandPalette} consumes after the
 * registry is wired to live React context.
 */
export interface ResolvedCommand {
  id: string
  label: string
  section: CommandSection | string
  icon: CommandDefinition['icon']
  keywords: string[]
  shortcut?: string
  /** Tag commands that originate from the static registry — used for recent storage */
  source: 'registry' | 'extension'
  invoke: () => void | Promise<void>
}

/**
 * useCommandRegistry.
 *
 * Resolves the static {@link commandRegistry} against live React handles
 * (navigate, theme, toast, queryClient) and returns:
 *   - `commands`: ready-to-render palette items (filterable / sortable)
 *   - `getById(id)`: lookup by stable id (used to replay recent commands)
 *   - `filter(query)`: fuzzy-filter & sort by relevance score
 *
 * The hook is intentionally cheap to call from anywhere — every dependency is
 * already provided by the app's root providers (ThemeProvider, ToastProvider,
 * QueryClientProvider, BrowserRouter, SelectedVehicleProvider).
 */
export function useCommandRegistry() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { setMode, setTheme } = useTheme()
  const toast = useToast()
  const { setVehicleId } = useSelectedVehicleStore()
  const { t } = useTranslation()

  const ctx = useMemo<CommandContext>(
    () => ({
      navigate,
      setMode,
      setTheme,
      setVehicleId,
      invalidateAll: async () => {
        await queryClient.invalidateQueries()
      },
      t,
      toast: {
        success: (msg: string) => toast.success(msg),
        error: (msg: string) => toast.error(msg),
        info: (msg: string) => toast.info(msg),
      },
    }),
    [navigate, setMode, setTheme, setVehicleId, queryClient, toast, t],
  )

  const commands = useMemo<ResolvedCommand[]>(
    () =>
      commandRegistry.map((def) => ({
        id: def.id,
        label: t(def.labelKey, def.labelFallback),
        section: def.section,
        icon: def.icon,
        keywords: def.keywords ?? [],
        shortcut: def.shortcut,
        source: 'registry' as const,
        invoke: () => def.perform(ctx),
      })),
    [ctx, t],
  )

  const getById = useCallback(
    (id: string): ResolvedCommand | undefined => commands.find((c) => c.id === id),
    [commands],
  )

  const filter = useCallback(
    (query: string): ResolvedCommand[] => {
      if (!query.trim()) return commands
      const scored = commands
        .map((c) => ({ c, score: scoreCommand(query, c.label, c.keywords) }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
      return scored.map((s) => s.c)
    },
    [commands],
  )

  return { commands, getById, filter }
}
