import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'
import { Textarea } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { ResultPanel } from '../ResultPanel'

export interface JwtDecoded {
  header: Record<string, unknown> | null
  payload: Record<string, unknown> | null
  /** Stable, non-localised failure code — the UI maps it to a translated message. */
  error?: 'invalid'
}

/**
 * Decode one base64url JWT segment to a UTF-8 string.
 *
 * JWT segments are base64url (RFC 7515 §2): `+`→`-`, `/`→`_`, and the `=`
 * padding stripped. The browser's `atob` only understands *standard* base64, so
 * decoding a raw segment throws "Invalid character" the moment it contains a `-`
 * or `_` — which is the common case for real signatures/payloads. The old code
 * fed the raw segment straight to `atob`, so any URL-safe token surfaced a bogus
 * "Invalid JWT". We normalise back to standard base64, restore the stripped
 * padding, then decode the resulting bytes as UTF-8 so multibyte claims (accented
 * names, emoji) don't turn into mojibake the way a naive `atob` would leave them.
 */
function base64UrlDecode(segment: string): string {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Parse a compact-serialised JWT into its decoded header + payload objects.
 *
 * Pure and framework-free so it is trivially unit-testable and reusable. Never
 * throws: any malformed input (too few segments, empty segment, non-base64,
 * non-JSON) resolves to `{ header: null, payload: null, error: 'invalid' }`.
 * Empty/whitespace input is the neutral idle state (no error).
 */
export function decodeJwt(token: string): JwtDecoded {
  const trimmed = token.trim()
  if (!trimmed) return { header: null, payload: null }

  const parts = trimmed.split('.')
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return { header: null, payload: null, error: 'invalid' }
  }

  try {
    const header = JSON.parse(base64UrlDecode(parts[0])) as Record<string, unknown>
    const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>
    return { header, payload }
  } catch {
    return { header: null, payload: null, error: 'invalid' }
  }
}

export function JwtDecoderTool() {
  const { t } = useTranslation()
  const [jwt, setJwt] = useState('')
  const decoded = useMemo(() => decodeJwt(jwt), [jwt])

  return (
    <ToolCard icon={KeyRound} color="purple" title={t('Jwt Decoder')} description={t('Jwt Decoder Desc')}>
      <div className="space-y-3">
        <Textarea
          label={t('Jwt Input')}
          rows={3}
          placeholder="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature"
          value={jwt}
          onChange={(e) => setJwt(e.target.value)}
        />
        {decoded.error && (
          <p role="alert" className="text-sm text-rose-300">
            {t('Invalid Jwt')}
          </p>
        )}
        {decoded.header && (
          <ResultPanel title={t('Jwt Header')} data={decoded.header} />
        )}
        {decoded.payload && (
          <ResultPanel title={t('Jwt Payload')} data={decoded.payload} />
        )}
      </div>
    </ToolCard>
  )
}
