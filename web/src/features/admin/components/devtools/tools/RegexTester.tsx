import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Regex } from 'lucide-react'
import { Input, Select, Badge, Textarea } from '@/components/ui'
import { ToolCard } from '../ToolCard'

export function RegexTesterTool() {
  const { t } = useTranslation()
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [testStr, setTestStr] = useState('')

  const matches = useMemo(() => {
    if (!pattern || !testStr) return []
    try {
      const re = new RegExp(pattern, flags)
      const results: { match: string; index: number }[] = []
      let m: RegExpExecArray | null
      if (flags.includes('g')) {
        while ((m = re.exec(testStr)) !== null) {
          results.push({ match: m[0], index: m.index })
          if (!m[0]) break
        }
      } else {
        m = re.exec(testStr)
        if (m) results.push({ match: m[0], index: m.index })
      }
      return results
    } catch {
      return []
    }
  }, [pattern, flags, testStr])

  const flagOptions = [
    { value: 'g', label: 'g (global)' },
    { value: 'gi', label: 'gi (global, case-insensitive)' },
    { value: 'gm', label: 'gm (global, multiline)' },
    { value: 'gim', label: 'gim (all)' },
    { value: '', label: t('No Flags') },
  ]

  return (
    <ToolCard icon={Regex} color="red" title={t('Regex Tester')} description={t('Regex Tester Desc')}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Pattern')} placeholder="\\d+" value={pattern} onChange={(e) => setPattern(e.target.value)} icon={<Regex className="h-4 w-4" />} />
          <Select label={t('Flags')} options={flagOptions} value={flags} onChange={(e) => setFlags(e.target.value)} />
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-white/70">{t('Test String')}</span>
          <Textarea rows={3} value={testStr} onChange={(e) => setTestStr(e.target.value)} placeholder={t('Test String Placeholder')} />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={matches.length > 0 ? 'success' : 'neutral'} size="sm">
            {matches.length} {t('Matches')}
          </Badge>
        </div>
        {matches.length > 0 && (
          <div className="space-y-1">
            {matches.map((m, i) => (
              <div key={i} className="flex items-center gap-2 rounded bg-black/20 px-3 py-1">
                <Badge variant="info" size="sm">{i + 1}</Badge>
                <code className="text-xs font-mono text-neon-red">{m.match}</code>
                <span className="text-xs text-white/40">{t('At Index')} {m.index}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </ToolCard>
  )
}
