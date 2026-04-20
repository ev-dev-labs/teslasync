import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'
import { Textarea } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { ResultPanel } from '../ResultPanel'

interface JwtDecoded {
  header: Record<string, unknown> | null
  payload: Record<string, unknown> | null
  error?: string
}

export function JwtDecoderTool() {
  const { t } = useTranslation()
  const [jwt, setJwt] = useState('')
  const decoded = useMemo<JwtDecoded>(() => {
    if (!jwt.trim()) return { header: null, payload: null }
    try {
      const parts = jwt.split('.')
      if (parts.length < 2) return { header: null, payload: null, error: t('Invalid Jwt') }
      const header = JSON.parse(atob(parts[0] ?? '')) as Record<string, unknown>
      const payload = JSON.parse(atob(parts[1] ?? '')) as Record<string, unknown>
      return { header, payload }
    } catch {
      return { header: null, payload: null, error: t('Invalid Jwt') }
    }
  }, [jwt, t])

  return (
    <ToolCard icon={KeyRound} color="purple" title={t('Jwt Decoder')} description={t('Jwt Decoder Desc')}>
      <div className="space-y-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-white/70">{t('Jwt Input')}</span>
          <Textarea
            rows={3}
            placeholder="eyJhbGciOiJSUzI1NiIs..."
            value={jwt}
            onChange={(e) => setJwt(e.target.value)}
          />
        </div>
        {decoded.error && <p className="text-sm text-neon-red">{decoded.error}</p>}
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
