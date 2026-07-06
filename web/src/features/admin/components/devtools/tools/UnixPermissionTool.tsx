import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { Input, Select, CopyButton } from '@/components/ui'
import { EmptyState } from '@/components/feedback'
import { ToolCard } from '../ToolCard'
import { PERMS } from '../constants'

// The preset catalogue is static, so build the <Select> option objects once at
// module load instead of allocating a fresh array (a new `options` reference)
// on every render.
const PRESET_OPTIONS = [
  { value: '755', label: '755 (rwxr-xr-x)' },
  { value: '644', label: '644 (rw-r--r--)' },
  { value: '700', label: '700 (rwx------)' },
  { value: '600', label: '600 (rw-------)' },
  { value: '777', label: '777 (rwxrwxrwx)' },
  { value: '444', label: '444 (r--r--r--)' },
]

// Exactly three octal digits, each 0–7 (the full key set of PERMS).
const OCTAL_RE = /^[0-7]{3}$/

type PermResult =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'ok'; owner: string; group: string; other: string; symbolic: string }

/**
 * UnixPermissionTool — converts a 3-digit octal permission (e.g. `755`) into its
 * rwx symbolic notation, broken down per scope (owner / group / other).
 *
 * The output is a proper `empty | invalid | ok` state machine rather than a pair
 * of truthiness gates, so exactly one branch renders and the panel is never
 * blank (guideline #6): an empty field shows a "type something" hint and a
 * malformed value shows a corrective hint instead of the section silently
 * disappearing. The per-scope triad is derived once and kept intact (the old
 * code concatenated the three parts and then re-sliced them back out). Every
 * visible string carries an English default so a missing translation never
 * leaks a raw key.
 */
export function UnixPermissionTool() {
  const { t } = useTranslation()
  const [octal, setOctal] = useState('755')

  const result = useMemo<PermResult>(() => {
    if (octal.trim() === '') return { kind: 'empty' }
    if (!OCTAL_RE.test(octal)) return { kind: 'invalid' }
    const owner = PERMS[octal[0]]
    const group = PERMS[octal[1]]
    const other = PERMS[octal[2]]
    return { kind: 'ok', owner, group, other, symbolic: owner + group + other }
  }, [octal])

  return (
    <ToolCard
      icon={Lock}
      color="green"
      title={t('Unix Perm', 'Unix Permissions')}
      description={t('Unix Perm Desc', 'Convert an octal permission (e.g. 755) to rwx symbolic notation.')}
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={t('Octal Perm', 'Octal Permission')}
            placeholder="755"
            inputMode="numeric"
            value={octal}
            onChange={(e) => setOctal(e.target.value)}
            icon={<Lock className="h-4 w-4" aria-hidden="true" />}
          />
          <Select
            label={t('Presets', 'Presets')}
            options={PRESET_OPTIONS}
            value={octal}
            onChange={(e) => setOctal(e.target.value)}
          />
        </div>
        {result.kind === 'ok' ? (
          <>
            <ul
              className="grid gap-2 sm:grid-cols-3"
              aria-label={t('Unix Perm Results', 'Permission breakdown by scope')}
            >
              <li className="rounded bg-[var(--surface-overlay)] px-3 py-2 text-center">
                <span className="text-xs text-[var(--text-secondary)]">{t('Owner', 'Owner')}</span>
                <p className="font-mono text-sm text-emerald-300">{result.owner}</p>
              </li>
              <li className="rounded bg-[var(--surface-overlay)] px-3 py-2 text-center">
                <span className="text-xs text-[var(--text-secondary)]">{t('Group', 'Group')}</span>
                <p className="font-mono text-sm text-cyan-300">{result.group}</p>
              </li>
              <li className="rounded bg-[var(--surface-overlay)] px-3 py-2 text-center">
                <span className="text-xs text-[var(--text-secondary)]">{t('Other', 'Other')}</span>
                <p className="font-mono text-sm text-amber-300">{result.other}</p>
              </li>
            </ul>
            <div className="flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-2">
              <code className="text-sm font-mono text-[var(--text-primary)]">{result.symbolic}</code>
              <CopyButton text={result.symbolic} />
            </div>
          </>
        ) : (
          <EmptyState
            message={
              result.kind === 'empty'
                ? t('Unix Perm Empty', 'Enter a 3-digit octal value to see its symbolic notation.')
                : t('Unix Perm Invalid', 'Enter a valid 3-digit octal value (digits 0–7), e.g. 755.')
            }
            className="py-8"
          />
        )}
      </div>
    </ToolCard>
  )
}
