//
//  PrivacyPageModel.swift
//  TeslaSync — P4-APPLE P7 · page:settings/Privacy (Apple) — View Model
//
//  The `@Observable` state holder the page binds to (ADR-004 — no persistence calls in the view).
//
//  The web `PrivacyPage` (`web/src/features/settings/pages/PrivacyPage.tsx`) is a thin
//  `PageContainer` shell (title + subtitle + `copyLink`) wrapping `<PrivacySection/>`, whose entire
//  surface is browser-local state: the recently-viewed-pages LRU (count + clear, gated behind a
//  silence-aware confirmation), the cookie/analytics consent control (accept / decline / reset),
//  and the deployment `require_cookie_consent` flag that only flips the consent body copy.
//
//  This model mirrors that exactly. It exposes the two web i18n keys the page renders
//  (`account.privacy.title` / `.subtitle`), projects the three local stores through injected seams
//  (`PrivacyDataSources.swift`), and runs every mutation — clear, accept, decline, reset — posting
//  the same toast feedback the web does. No networking lives here.
//

import Observation
import SwiftUI

@MainActor
@Observable
final class PrivacyPageModel {
    /// Web route `/account/privacy` (`web/src/App.tsx`). Kept as a constant so the copy-link share
    /// URL and the navigation registration agree on one canonical path.
    static let routePath = "/account/privacy"

    /// Web `t('account.privacy.title', 'Privacy')` — PARITY string, rendered as the page title.
    let titleKey: LocalizedStringKey = "account.privacy.title"

    /// Web `t('account.privacy.subtitle', …)` — PARITY string, rendered as the page subtitle.
    let subtitleKey: LocalizedStringKey = "account.privacy.subtitle"

    /// Number of stored recently-viewed pages (web `count`, from `getRecentPages().length`).
    private(set) var recentPagesCount: Int

    /// Current cookie/analytics consent state (web `consent`, from `getConsent()`).
    private(set) var consent: AccountPrivacyConsentState

    /// Deployment "consent required" flag (web `requireConsent`); only switches the body copy.
    private(set) var requiresConsent: Bool

    @ObservationIgnored private let recentPages: any PrivacyRecentPagesStoring
    @ObservationIgnored private let consentStore: any PrivacyConsentStoring
    @ObservationIgnored private let silenceStore: any PrivacyConfirmSilenceStoring
    @ObservationIgnored private let requirementProvider: any PrivacyConsentRequirementProviding
    @ObservationIgnored private let toasts: ToastCenter

    init(
        recentPages: any PrivacyRecentPagesStoring = UserDefaultsRecentPagesStore(),
        consentStore: any PrivacyConsentStoring = UserDefaultsConsentStore(),
        silenceStore: any PrivacyConfirmSilenceStoring = AccountPrivacyUserDefaultsConfirmSilenceStore(),
        requirementProvider: any PrivacyConsentRequirementProviding = DefaultConsentRequirementProvider(),
        toasts: ToastCenter = .shared
    ) {
        self.recentPages = recentPages
        self.consentStore = consentStore
        self.silenceStore = silenceStore
        self.requirementProvider = requirementProvider
        self.toasts = toasts
        recentPagesCount = recentPages.count()
        consent = consentStore.current()
        requiresConsent = false
    }

    // MARK: - Derived state

    /// Web `disabled={count === 0}` for the Clear button — whether there is anything to wipe.
    var hasRecentPages: Bool {
        recentPagesCount > 0
    }

    /// The shareable deep link the copy-link affordance copies — the native parity of the web
    /// `copyLink` (`window.location.href`); here the page's canonical route path.
    var shareURL: String {
        Self.routePath
    }

    /// The consent control's current-state label key (web `consentLabel(state)`).
    var consentStateLabelKey: LocalizedStringKey {
        switch consent {
        case .accepted: "translation.consent.state.accepted"
        case .declined: "translation.consent.state.declined"
        case .unknown: "translation.consent.state.unknown"
        }
    }

    /// The consent section's body copy key, switched by the deployment flag (web `bodyOn`/`bodyOff`).
    var consentBodyKey: LocalizedStringKey {
        requiresConsent ? "translation.consent.section.bodyOn" : "translation.consent.section.bodyOff"
    }

    // MARK: - Lifecycle

    /// Re-reads the local stores and the deployment flag (web mount + version query). Safe to call
    /// repeatedly on `.task`/refresh.
    func load() async {
        recentPagesCount = recentPages.count()
        consent = consentStore.current()
        requiresConsent = await requirementProvider.requiresConsent()
    }

    /// Re-runs the load (web refetch).
    func refresh() async {
        await load()
    }

    // MARK: - Recently-viewed pages (web `clearRecentPages` + `<ConfirmDialog silenceKey>`)

    /// Whether pressing Clear should present the confirmation, or run immediately because the user
    /// previously chose "don't ask again" (web `isSilenced(silenceKey)` auto-resolve).
    func shouldConfirmClear() -> Bool {
        !silenceStore.isSilenced()
    }

    /// Wipes the recent-pages list and confirms with a toast (web `handleConfirm`). When
    /// `silencingFutureConfirms` is set, also records the silence so subsequent clears skip the
    /// dialog (web `dontAskAgain` → `silence(silenceKey)`).
    func clearRecentPages(silencingFutureConfirms: Bool = false) {
        recentPages.clear()
        recentPagesCount = recentPages.count()
        if silencingFutureConfirms {
            silenceStore.silence()
        }
        toasts.success(String(localized: "translation.recentPages.cleared"))
    }

    // MARK: - Cookie / analytics consent (web `setConsent` / `clearConsent`)

    /// Web `handleAcceptConsent` — re-grants consent.
    func acceptConsent() {
        consentStore.set(.accepted)
        consent = .accepted
        toasts.success(String(localized: "translation.consent.toast.accepted"))
    }

    /// Web `handleDeclineConsent` — withdraws consent.
    func declineConsent() {
        consentStore.set(.declined)
        consent = .declined
        toasts.success(String(localized: "translation.consent.toast.declined"))
    }

    /// Web `handleResetConsent` — resets to undecided so the banner reappears.
    func resetConsent() {
        consentStore.clear()
        consent = .unknown
        toasts.success(String(localized: "translation.consent.toast.reset"))
    }
}
