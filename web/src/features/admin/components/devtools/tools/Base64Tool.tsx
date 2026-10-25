import { useState, useMemo, useCallback } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Braces } from 'lucide-react'
import { Button, Textarea, CopyButton } from '@/components/ui'
import { ToolCard } from '../ToolCard'

type Mode = 'encode' | 'decode'

/**
 * UTF-8-safe Base64 encode. `btoa` only accepts Latin1 code points and throws
 * `InvalidCharacterError` on anything above U+00FF (emoji, CJK, most accents),
 * so we first serialise the string to UTF-8 bytes and hand `btoa` a binary
 * string it can digest. Encoding therefore never throws for arbitrary text.
 */
function encodeBase64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary)
}

/**
 * UTF-8-safe Base64 decode. `atob` yields a Latin1 binary string; we widen it
 * back to bytes and decode as UTF-8 so multi-byte characters round-trip.
 * Throws `InvalidCharacterError` for malformed Base64 — the caller surfaces it
 * as an inline error instead of a silent blank panel.
 */
function decodeBase64(input: string): string {
  const bytes = Uint8Array.from(atob(input), (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function Base64Tool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('encode')
  const [inputVal, setInputVal] = useState('')

  const result = useMemo<{ value: string; error: boolean }>(() => {
    if (!inputVal) return { value: '', error: false }
    try {
      const value = mode === 'encode' ? encodeBase64(inputVal) : decodeBase64(inputVal)
      return { value, error: false }
    } catch {
      return { value: t('devtools.utils.invalidInput', 'Invalid input'), error: true }
    }
  }, [inputVal, mode, t])

  const selectEncode = useCallback(() => setMode('encode'), [])
  const selectDecode = useCallback(() => setMode('decode'), [])
  const handleInput = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => setInputVal(e.target.value),
    [],
  )

  const placeholder =
    mode === 'encode' ? t('devtools.utils.base64PlaceholderEncode', 'Hello World') : 'SGVsbG8gV29ybGQ='

  return (
    <ToolCard
      icon={Braces}
      color="amber"
      title={t('devtools.utils.base64', 'Base64')}
      description={t('devtools.utils.base64Desc', 'Encode and decode Base64 text')}
    >
      <div className="space-y-3">
        <div className="flex gap-2" role="group" aria-label={t('devtools.utils.base64Mode', 'Conversion mode')}>
          <Button
            variant={mode === 'encode' ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={mode === 'encode'}
            onClick={selectEncode}
          >
            {t('devtools.utils.encode', 'Encode')}
          </Button>
          <Button
            variant={mode === 'decode' ? 'primary' : 'ghost'}
            size="sm"
            aria-pressed={mode === 'decode'}
            onClick={selectDecode}
          >
            {t('devtools.utils.decode', 'Decode')}
          </Button>
        </div>
        <Textarea
          id="base64-input"
          label={t('devtools.utils.inputLabel', 'Input')}
          rows={3}
          value={inputVal}
          onChange={handleInput}
          placeholder={placeholder}
        />
        {result.error && (
          <p role="alert" className="text-sm text-rose-300">
            {result.value}
          </p>
        )}
        {!result.error && result.value && (
          <div className="rounded bg-[var(--surface-overlay)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary)]">
                {t('devtools.utils.outputLabel', 'Output')}
              </span>
              <CopyButton text={result.value} />
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-all text-sm font-mono text-cyan-300">{result.value}</pre>
          </div>
        )}
      </div>
    </ToolCard>
  )
}
