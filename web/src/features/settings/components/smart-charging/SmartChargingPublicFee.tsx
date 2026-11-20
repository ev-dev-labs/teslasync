import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { isApiError } from '@/api/client'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import { usePublicFeeDecision, usePublicFeeTerms, useSmartChargingChange } from '@/api/hooks/useSmartCharging'
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { Button, ErrorText, PanelTitle, Text } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import { useDateFormat } from '@/hooks/useDateFormat'
import { currencyFractionDigits, formatCurrencyValue } from '@/lib/currencyFormat'
import { PublicFeeTermsForm, type PublicFeePlace } from './PublicFeeTermsForm'

interface Props {
  scope: PersonalScope
  vehicleId: number
  places: readonly PublicFeePlace[]
  disabled: boolean
  placesUnavailable: boolean
}

export function SmartChargingPublicFee({ scope, vehicleId, places, disabled, placesUnavailable }: Props) {
  const { t } = useTranslation()
  const { formatDateTime, locale } = useDateFormat()
  const { search, hash, key } = useLocation()
  const section = useRef<HTMLElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState(false)
  const sessionId = new URLSearchParams(search).get('fee_session_id')
  const review = usePublicFeeTerms(scope, vehicleId)
  const reviewState = useDataState(review)
  const terms = reviewState.data?.terms ?? null
  const decision = usePublicFeeDecision(scope, vehicleId, sessionId, reviewState.status === 'ok' && terms != null)
  const decisionState = useDataState(decision)
  const change = useSmartChargingChange(scope, vehicleId)
  const accessDenied = isApiError(review.error) &&
    (review.error.status === 401 || review.error.status === 403 || review.error.code === 'IDENTITY_CHANGED')
  const title = t('smartCharging.publicFee.title', 'Public charging fee reminders')
  const candidate = decisionState.status === 'ok' && reviewState.status === 'ok' && terms && !accessDenied
    ? decisionState.data?.decision : null
  const current = candidate && Date.parse(candidate.expires_at) > Date.now() ? candidate : null
  const canWrite = !disabled && !accessDenied && reviewState.status === 'ok' && !review.isFetching && !change.isPending
  const place = terms && places.find((item) => item.id === terms.place_id)
  const closeForm = () => {
    setEditing(false)
    editButton.current?.focus()
  }
  useEffect(() => {
    if (hash === '#public-fee') section.current?.scrollIntoView?.({ block: 'start' })
  }, [hash, key])

  return (
    <section id="public-fee" ref={section} className="scroll-mt-4 space-y-3" aria-label={title}>
      <PanelTitle>{title}</PanelTitle>
      <Text as="p" variant="bodySm">
        {t('smartCharging.publicFee.privacy', 'Off by default. Review fixed, current terms for one public charging place. TeslaSync does not check station occupancy, contact the operator, or operate the car. An optional push carries only a short-lived token.')}
      </Text>
      {accessDenied || reviewState.fatalError ? (
        <QueryError error={accessDenied ? review.error : reviewState.fatalError} onRetry={() => void review.refetch()} />
      ) : !reviewState.hasData ? <Skeleton lines={2} /> : (
        <>
          <StaleRefreshWarning state={reviewState} label={title} />
          {terms ? (
            <Text as="p" variant="bodySm">{t('smartCharging.publicFee.reviewed', 'Terms for {{place}} were reviewed until {{until}}.', {
              place: place?.name ?? t('smartCharging.publicFee.title', 'Public charging fee reminders'),
              until: formatDateTime(terms.valid_until),
            })}</Text>
          ) : <Text as="p" variant="bodySm">{reviewState.data?.needs_review
            ? t('smartCharging.publicFee.needsReview', 'Review the terms again. The previous review expired or the charging place changed.')
            : t('smartCharging.publicFee.off', 'No active public-site fee review is saved for this vehicle.')}</Text>}
          {decisionState.fatalError ? <QueryError error={decisionState.fatalError} onRetry={() => void decision.refetch()} /> :
            decision.isLoading ? <Skeleton lines={2} /> : current ? (
              <div className="space-y-2" role="status">
                <Text as="p" weight="semibold">{t('smartCharging.publicFee.action', 'Charging finished and the car was still connected')}</Text>
                <Text as="p" variant="bodySm">{t('smartCharging.publicFee.timing', 'The reviewed fee is {{rate}} per minute after the grace period. It could start as early as {{earliest}}. Check the station and move the car if it is safe.', {
                  rate: formatCurrencyValue(current.terms.fee_per_minute_minor / 10 ** currencyFractionDigits(current.terms.currency, locale),
                    current.terms.currency, locale, currencyFractionDigits(current.terms.currency, locale)),
                  earliest: formatDateTime(current.earliest_fee_starts_at),
                })}</Text>
                <Text as="p" variant="bodySm">{t('smartCharging.publicFee.observed', 'Connection evidence observed at {{when}}. This is not a statement that a fee was charged.', {
                  when: formatDateTime(current.observed_at),
                })}</Text>
                <a className="text-theme-accent underline underline-offset-2" href={current.terms.source_url} target="_blank" rel="noreferrer">
                  {t('smartCharging.publicFee.openTerms', 'Read the operator’s terms')}
                </a>
              </div>
            ) : sessionId != null || terms ? (
              <Text as="p" variant="bodySm">
                {t('smartCharging.publicFee.noDecision', 'There is no current fee reminder for this session. It may have expired or the evidence may have changed.')}
              </Text>
            ) : null}
          <div className="flex flex-wrap gap-2">
            <Button ref={editButton} type="button" variant="secondary" disabled={!canWrite || placesUnavailable || places.length === 0}
              onClick={() => setEditing(true)}>
              {t('smartCharging.publicFee.review', 'Review public fee terms')}
            </Button>
            {(terms || reviewState.data?.needs_review) && <Button type="button" variant="ghost" disabled={!canWrite}
              onClick={() => change.mutate({ kind: 'publicFeeTerms', terms: null }, { onSuccess: closeForm })}>
              {t('smartCharging.publicFee.revoke', 'Turn off fee reminders')}
            </Button>}
          </div>
          {editing && <PublicFeeTermsForm scope={scope} vehicleId={vehicleId} places={places} current={terms}
            disabled={!canWrite || placesUnavailable} onCancel={closeForm} onSave={async (input) => {
              await change.mutateAsync({ kind: 'publicFeeTerms', terms: input })
              closeForm()
            }} />}
          {!editing && change.error && <ErrorText role="alert">{t('smartCharging.changeFailed', 'The change was not saved. Refresh and try again.')}</ErrorText>}
        </>
      )}
    </section>
  )
}
