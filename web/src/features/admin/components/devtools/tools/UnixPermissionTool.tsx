import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { Input, Select } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { CopyButton } from '@/components/ui'
import { PERMS } from '../constants'

export function UnixPermissionTool() {
  const { t } = useTranslation()
  const [octal, setOctal] = useState('755')

  const symbolic = useMemo(() => {
    if (octal.length !== 3 || !/^[0-7]{3}$/.test(octal)) return null
    return (PERMS[octal[0] ?? '0'] ?? '---') + (PERMS[octal[1] ?? '0'] ?? '---') + (PERMS[octal[2] ?? '0'] ?? '---')
  }, [octal])

  const presetOptions = [
    { value: '755', label: '755 (rwxr-xr-x)' },
    { value: '644', label: '644 (rw-r--r--)' },
    { value: '700', label: '700 (rwx------)' },
    { value: '600', label: '600 (rw-------)' },
    { value: '777', label: '777 (rwxrwxrwx)' },
    { value: '444', label: '444 (r--r--r--)' },
  ]

  return (
    <ToolCard icon={Lock} color="green" title={t('Unix Perm')} description={t('Unix Perm Desc')}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Octal Perm')} placeholder="755" value={octal} onChange={(e) => setOctal(e.target.value)} icon={<Lock className="h-4 w-4" />} />
          <Select label={t('Presets')} options={presetOptions} value={octal} onChange={(e) => setOctal(e.target.value)} />
        </div>
        {symbolic && (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded bg-[var(--surface-overlay)] px-3 py-2 text-center">
              <span className="text-xs text-[var(--text-secondary)]">{t('Owner')}</span>
              <p className="font-mono text-sm text-emerald-300">{symbolic.slice(0, 3)}</p>
            </div>
            <div className="rounded bg-[var(--surface-overlay)] px-3 py-2 text-center">
              <span className="text-xs text-[var(--text-secondary)]">{t('Group')}</span>
              <p className="font-mono text-sm text-cyan-300">{symbolic.slice(3, 6)}</p>
            </div>
            <div className="rounded bg-[var(--surface-overlay)] px-3 py-2 text-center">
              <span className="text-xs text-[var(--text-secondary)]">{t('Other')}</span>
              <p className="font-mono text-sm text-amber-300">{symbolic.slice(6)}</p>
            </div>
          </div>
        )}
        {symbolic && (
          <div className="flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-2">
            <code className="text-sm font-mono text-white">{symbolic}</code>
            <CopyButton text={symbolic} />
          </div>
        )}
      </div>
    </ToolCard>
  )
}
