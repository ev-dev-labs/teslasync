import { isReportingAllowed } from './cookieConsent'

let requireCookieConsent = false

export function setVitalsConsentRequirement(required: boolean): void {
  requireCookieConsent = Boolean(required)
}

export function isVitalsReportingAllowed(): boolean {
  return isReportingAllowed(requireCookieConsent)
}

export function resetVitalsConsentRequirementForTests(): void {
  requireCookieConsent = false
}
