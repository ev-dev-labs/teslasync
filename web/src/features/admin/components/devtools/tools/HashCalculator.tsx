import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Hash } from 'lucide-react'
import { Button, Textarea, CopyButton } from '@/components/ui'
import { ToolCard } from '../ToolCard'

const HASH_INPUT_ID = 'devtools-hash-input'

/**
 * SubtleCrypto is only exposed in a secure context (HTTPS or literal
 * `localhost`). When TeslaSync is served over plain HTTP on a LAN IP or a
 * custom hostname, `crypto.subtle` is `undefined` even on current browsers —
 * the same constraint that gates `crypto.randomUUID` (see lib/safeUUID.ts).
 * Returning `null` lets the caller surface a precise "needs secure context"
 * message instead of the generic TypeError the bare `crypto.subtle.digest`
 * call used to throw.
 */
function getSubtle(): SubtleCrypto | null {
  if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle
  return null
}

export function HashCalculatorTool() {
  const { t } = useTranslation()
  const [inputVal, setInputVal] = useState('')
  const [hashResult, setHashResult] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [computing, setComputing] = useState(false)

  const compute = useCallback(async () => {
    if (!inputVal) return
    const subtle = getSubtle()
    if (!subtle) {
      setHashResult('')
      setErrorMsg(
        t('devtools.utils.hashInsecureContext', 'SHA-256 requires a secure context (HTTPS or localhost).'),
      )
      return
    }
    setComputing(true)
    setErrorMsg('')
    try {
      const data = new TextEncoder().encode(inputVal)
      const hashBuffer = await subtle.digest('SHA-256', data)
      const hex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
      setHashResult(hex)
    } catch {
      setHashResult('')
      setErrorMsg(t('devtools.utils.hashError', 'Could not compute hash.'))
    } finally {
      setComputing(false)
    }
  }, [inputVal, t])

  return (
    <ToolCard icon={Hash} color="red" title={t('Hash Calculator')} description={t('Hash Calculator Desc')}>
      <div className="space-y-3">
        <Textarea
          id={HASH_INPUT_ID}
          rows={2}
          label={t('devtools.utils.hashInputLabel', 'Text to hash')}
          value={inputVal}
          onChange={(e) => {
            setInputVal(e.target.value)
            // A stale hash must never linger against edited input.
            setHashResult('')
            setErrorMsg('')
          }}
          placeholder={t('devtools.utils.hashPlaceholder', 'Enter text to hash...')}
        />
        <Button
          variant="primary"
          size="sm"
          loading={computing}
          disabled={inputVal.length === 0}
          onClick={() => void compute()}
          icon={<Hash className="h-3.5 w-3.5" />}
        >
          {t('devtools.utils.computeSha256', 'Compute Sha256')}
        </Button>
        {errorMsg && (
          <p role="alert" className="text-sm text-rose-300">
            {errorMsg}
          </p>
        )}
        {hashResult && (
          <div role="status" className="flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-2">
            <code className="flex-1 break-all text-xs font-mono text-rose-300">{hashResult}</code>
            <CopyButton text={hashResult} />
          </div>
        )}
      </div>
    </ToolCard>
  )
}
