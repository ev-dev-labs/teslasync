import { useState, useMemo, useCallback, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'lucide-react'
import { Button, Textarea, CopyButton } from '@/components/ui'
import { ToolCard } from '../ToolCard'

export type UrlEncoderMode = 'encode' | 'decode'

export interface UrlTransformResult {
  /** Transformed value on success. Empty string for the idle (no input) state. */
  output: string
  /** True when the codec rejected the input (malformed percent-escapes / lone surrogate). */
  error: boolean
}

/**
 * Encode or decode a string with the URI-component codec.
 *
 * Pure and framework-free so it is trivially unit-testable and holds no i18n
 * dependency. Both directions can throw a `URIError`: `decodeURIComponent`
 * rejects malformed escapes (a lone "%", "%zz", a truncated "%E0%A4"), and
 * `encodeURIComponent` rejects lone UTF-16 surrogates. The old code caught the
 * throw but returned the *localised error string* as the output, so the failure
 * was rendered inside the styled output panel — complete with a Copy button —
 * as if it were a legitimate result. We instead surface a structured `error`
 * flag the UI maps to an assertive alert, keeping the output panel truthful.
 */
export function transformUrl(mode: UrlEncoderMode, input: string): UrlTransformResult {
  if (!input) return { output: '', error: false }
  try {
    const output = mode === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input)
    return { output, error: false }
  } catch {
    return { output: '', error: true }
  }
}

export function UrlEncoderTool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<UrlEncoderMode>('encode')
  const [inputVal, setInputVal] = useState('')

  const result = useMemo(() => transformUrl(mode, inputVal), [mode, inputVal])

  const handleInputChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setInputVal(e.target.value)
  }, [])
  const selectEncode = useCallback(() => setMode('encode'), [])
  const selectDecode = useCallback(() => setMode('decode'), [])

  return (
    <ToolCard icon={Link} color="cyan" title={t('Url Encoder')} description={t('Url Encoder Desc')}>
      <div className="space-y-3">
        <div className="flex gap-2" role="group" aria-label={t('devtools.url.modeGroup', 'Encoding mode')}>
          <Button
            variant={mode === 'encode' ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={mode === 'encode'}
            onClick={selectEncode}
          >
            {t('Encode')}
          </Button>
          <Button
            variant={mode === 'decode' ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={mode === 'decode'}
            onClick={selectDecode}
          >
            {t('Decode')}
          </Button>
        </div>
        <Textarea
          label={t('Input Label')}
          rows={2}
          value={inputVal}
          onChange={handleInputChange}
          placeholder={mode === 'encode' ? 'hello world&foo=bar' : 'hello%20world%26foo%3Dbar'}
        />
        {result.error && (
          <p role="alert" className="text-sm text-rose-300">
            {t('Invalid Input')}
          </p>
        )}
        {result.output && (
          <div className="rounded bg-[var(--surface-overlay)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary)]">{t('Output Label')}</span>
              <CopyButton text={result.output} />
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-all text-sm font-mono text-cyan-300">{result.output}</pre>
          </div>
        )}
      </div>
    </ToolCard>
  )
}
