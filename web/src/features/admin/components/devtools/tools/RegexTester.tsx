import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Regex } from 'lucide-react'
import { Input, Select, Badge, Textarea } from '@/components/ui'
import { ToolCard } from '../ToolCard'

const MAX_MATCHES = 1000

interface RegexMatch {
  match: string
  index: number
}

interface RegexResult {
  matches: RegexMatch[]
  error: string | null
  truncated: boolean
}

export function RegexTesterTool() {
  const { t } = useTranslation()
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [testStr, setTestStr] = useState('')

  const { matches, error, truncated } = useMemo<RegexResult>(() => {
    if (!pattern) return { matches: [], error: null, truncated: false }
    // Validate the pattern independently of the test string so an invalid
    // regex surfaces feedback immediately instead of a silent "0 Matches".
    let re: RegExp
    try {
      re = new RegExp(pattern, flags)
    } catch (err) {
      return {
        matches: [],
        error: err instanceof Error ? err.message : String(err),
        truncated: false,
      }
    }
    if (!testStr) return { matches: [], error: null, truncated: false }

    const results: RegexMatch[] = []
    let hitLimit = false
    if (flags.includes('g')) {
      let m: RegExpExecArray | null
      while ((m = re.exec(testStr)) !== null) {
        results.push({ match: m[0], index: m.index })
        // A zero-width match (e.g. `a*`) does not advance lastIndex; bump it so
        // the scan continues past it instead of stopping after one hit or
        // looping forever.
        if (m.index === re.lastIndex) re.lastIndex += 1
        if (results.length >= MAX_MATCHES) {
          hitLimit = true
          break
        }
      }
    } else {
      const m = re.exec(testStr)
      if (m) results.push({ match: m[0], index: m.index })
    }
    return { matches: results, error: null, truncated: hitLimit }
  }, [pattern, flags, testStr])

  const flagOptions = useMemo(
    () => [
      { value: 'g', label: 'g (global)' },
      { value: 'gi', label: 'gi (global, case-insensitive)' },
      { value: 'gm', label: 'gm (global, multiline)' },
      { value: 'gim', label: 'gim (all)' },
      { value: '', label: t('No Flags') },
    ],
    [t],
  )

  return (
    <ToolCard icon={Regex} color="red" title={t('Regex Tester')} description={t('Regex Tester Desc')}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Pattern')} placeholder="\\d+" value={pattern} onChange={(e) => setPattern(e.target.value)} icon={<Regex className="h-4 w-4" />} error={error ? t('Invalid pattern') : undefined} />
          <Select label={t('Flags')} options={flagOptions} value={flags} onChange={(e) => setFlags(e.target.value)} />
        </div>
        <Textarea label={t('Test String')} rows={3} value={testStr} onChange={(e) => setTestStr(e.target.value)} placeholder={t('Test String Placeholder')} />

        {error ? (
          <div role="alert" className="rounded bg-[var(--surface-overlay)] px-3 py-2">
            <p className="text-xs text-[var(--text-secondary)]">{t('Invalid regular expression')}</p>
            <code className="text-xs font-mono text-rose-300">{error}</code>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant={matches.length > 0 ? 'success' : 'neutral'} size="sm">
                {matches.length}{truncated ? '+' : ''} {t('Matches')}
              </Badge>
              {truncated && (
                <span className="text-xs text-[var(--text-muted)]">{t('Result limit reached')}</span>
              )}
            </div>
            {matches.length > 0 ? (
              <div className="space-y-1">
                {matches.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-1">
                    <Badge variant="info" size="sm">{i + 1}</Badge>
                    <code className="text-xs font-mono text-rose-300">{m.match || t('(empty match)')}</code>
                    <span className="text-xs text-[var(--text-muted)]">{t('At Index')} {m.index}</span>
                  </div>
                ))}
              </div>
            ) : (
              pattern !== '' && testStr !== '' && (
                <p className="text-xs text-[var(--text-secondary)]">{t('No matches found')}</p>
              )
            )}
          </>
        )}
      </div>
    </ToolCard>
  )
}
