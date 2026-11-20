import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useCurrentPersonalDevice } from '@/api/hooks/usePersonalDelivery'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { Button, ErrorText, Input, Select, Text, Toggle } from '@/components/ui'
import { currencyFractionDigits, formatCurrencyValue, parseCurrencyText } from '@/lib/currencyFormat'
import { refreshPersonalDeliveryWorker } from '@/lib/personalPush'
import type { SmartPublicFeeTerms, SmartPublicFeeTermsInput } from '@/types/smartCharging'
import { usePersonalBrowser } from '../personal-delivery/usePersonalBrowser'

export type PublicFeePlace = { id: number; name: string; updated_at: string }

interface Props {
  scope: PersonalScope
  vehicleId: number
  places: readonly PublicFeePlace[]
  current: SmartPublicFeeTerms | null
  disabled: boolean
  onSave: (terms: SmartPublicFeeTermsInput) => Promise<void>
  onCancel: () => void
}

export function PublicFeeTermsForm({ scope, vehicleId, places, current, disabled, onSave, onCancel }: Props) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const [place, setPlace] = useState(current ? String(current.place_id) : '')
  const [source, setSource] = useState(current?.source_url ?? '')
  const [currency, setCurrency] = useState(current?.currency ?? '')
  const [amount, setAmount] = useState(() => {
    if (!current) return ''
    const digits = currencyFractionDigits(current.currency, locale)
    return formatCurrencyValue(current.fee_per_minute_minor / 10 ** digits, current.currency, locale, digits)
  })
  const [grace, setGrace] = useState(current ? String(current.grace_s / 60) : '')
  const [days, setDays] = useState('1')
  const [publicSite, setPublicSite] = useState(false)
  const [unconditional, setUnconditional] = useState(false)
  const [push, setPush] = useState(false)
  const [busy, setBusy] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [failed, setFailed] = useState(false)
  const browser = usePersonalBrowser()
  const device = useCurrentPersonalDevice(scope, browser.subscription?.endpoint ?? null, browser.generation, push)
  const deviceId = device.isSuccess && !device.isFetching && device.data?.verified ? device.data.id : null
  const placeRecord = places.find(({ id }) => String(id) === place)
  const locked = disabled || busy

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (locked) return
    const code = currency.trim().toUpperCase()
    const value = parseCurrencyText(amount, code, locale)
    const unrounded = value == null ? 0 : value * 10 ** currencyFractionDigits(code, locale)
    const minor = Math.round(unrounded)
    const graceS = Number(grace) * 60
    const durationDays = Number(days)
    if (!placeRecord || !publicSite || !unconditional || !/^https:\/\/[^?#]+$/i.test(source.trim()) ||
      !/^[A-Z]{3}$/.test(code) || minor < 1 || minor > 100_000 || Math.abs(minor - unrounded) > 1e-7 ||
      !Number.isInteger(graceS) || graceS < 120 || graceS > 3600 ||
      !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 30 || (push && deviceId == null)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setFailed(false)
    setBusy(true)
    try {
      if (push) await refreshPersonalDeliveryWorker()
      await onSave({
        vehicle_id: vehicleId, place_id: placeRecord.id, place_updated_at: placeRecord.updated_at,
        confirmed_public_site: true, confirmed_unconditional: true, currency: code,
        fee_per_minute_minor: minor, grace_s: graceS, source_url: source.trim(),
        valid_until: new Date(Date.now() + durationDays * 86_400_000).toISOString(),
        ...(push && deviceId != null ? { push_device_id: deviceId,
          push_title: t('smartCharging.publicFee.pushTitle', 'A charging fee may start soon'),
          push_body: t('smartCharging.publicFee.pushBody', 'Charging has finished. Open TeslaSync for the reviewed fee terms and timing.'),
        } : {}),
      })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <Select label={t('smartCharging.publicFee.place', 'Reviewed public charging place')} value={place}
        placeholder={t('smartCharging.selectPlace', 'Select a charging place')}
        options={places.map((item) => ({ value: String(item.id), label: item.name }))}
        onChange={(event) => setPlace(event.target.value)} disabled={locked} />
      <Input label={t('smartCharging.publicFee.source', 'Operator’s public terms URL')} type="url" required
        value={source} maxLength={1024} onChange={(event) => setSource(event.target.value)} disabled={locked} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={t('smartCharging.publicFee.currency', 'Currency code (ISO 4217)')} required
          value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value)} disabled={locked} />
        <Input label={t('smartCharging.publicFee.amount', 'Fee amount per minute')} required inputMode="decimal"
          value={amount} onChange={(event) => setAmount(event.target.value)} disabled={locked} />
        <Input label={t('smartCharging.publicFee.grace', 'Grace period after completion (minutes)')} required
          type="number" min={2} max={60} value={grace} onChange={(event) => setGrace(event.target.value)} disabled={locked} />
        <Input label={t('smartCharging.publicFee.validDays', 'Terms are valid for (days)')} required type="number"
          min={1} max={30} value={days} onChange={(event) => setDays(event.target.value)} disabled={locked} />
      </div>
      <Toggle label={t('smartCharging.publicFee.confirmPlace', 'I verified this location is a public charging site')}
        checked={publicSite} onChange={setPublicSite} disabled={locked} />
      <Toggle label={t('smartCharging.publicFee.confirmTerms', 'I reviewed fixed terms that apply after completion while connected, with no occupancy or other conditions')}
        checked={unconditional} onChange={setUnconditional} disabled={locked} />
      <Toggle label={t('smartCharging.publicFee.allowPush', 'Send fee reminders to this verified browser')}
        checked={push} onChange={setPush} disabled={locked} />
      {push && deviceId == null && (
        <Text as="p" variant="bodySm">
          {device.isFetching || browser.status === 'checking'
            ? t('smartCharging.publicFee.checkDevice', 'Checking this browser’s verification…')
            : t('smartCharging.publicFee.verifyDevice', 'Confirm this browser in Personal browser notifications before enabling push. You can still save the review without push.')}
        </Text>
      )}
      {invalid && <ErrorText role="alert">
        {t('smartCharging.publicFee.invalid', 'Enter a public HTTPS source, exact fee and currency, 2–60 minutes of grace, and 1–30 days of validity. Both reviews are required.')}
      </ErrorText>}
      {failed && <ErrorText role="alert">{t('smartCharging.changeFailed', 'The change was not saved. Refresh and try again.')}</ErrorText>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={locked || (push && deviceId == null)}>
          {t('smartCharging.publicFee.save', 'Save reviewed terms')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>{t('common.cancel', 'Cancel')}</Button>
      </div>
    </form>
  )
}
