// Pure, framework-free model + projection + diagnostics for the CookieConsentBanner shared surface — the native
// analogue of web/src/components/feedback/CookieConsentBanner.tsx and its web/src/lib/cookieConsent.ts storage
// helper. No Compose, no Android framework, no HTTP: every declaration here is exercised off-device in the
// :app:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// WHAT THE WEB SOURCE IS (and therefore the COMPLETE branch set this surface reproduces). The banner composes
// two inputs:
//   • the deployment-wide GDPR gate `useVersionInfo().require_cookie_consent` (GET /system/version) — when the
//     server opts into consent collection;
//   • the per-user tri-state decision `getConsent()` read from localStorage `teslasync:consent:v1`
//     (absent ⇒ unknown, else "accepted" / "declined").
// It renders the inline banner ONLY while `requireConsent && consent === 'unknown'` and otherwise returns null;
// "Accept all" / "Decline non-essential" persist the decision (web `setConsent`) and unmount it, while "Manage
// preferences" toggles an inline two-category details disclosure (Strictly necessary / Performance & error
// reporting). Dismissing without choosing is NOT consent — the banner reappears next visit.
//
// HOW THAT MAPS ONTO THE NATIVE WIRED STATE (P1/S8, ADR-002/005/013). The requirement is bound to the shared
// S8 SettingsStore `versionInfo()` cache-then-network feed (the same `useVersionInfo` envelope the dashboard
// VersionInfoWidget reads); the consent decision is bound to a SharedPreferences-backed store (the localStorage
// analogue, the same approach the TourLauncher misc surface takes). The web component hides itself with
// `return null` during loading / when consent is not needed; this surface instead renders EVERY state as a
// non-blank region (the platform "no hidden surfaces" contract, exactly as the sibling ServiceStatus surface
// does for the web `if (!data) return null` guard):
//   • [CookieConsentPhase.Loading] — the requirement is loading with nothing cached (skeleton chrome);
//   • [CookieConsentPhase.Error]   — the requirement fetch hard-failed with no cache (a retry affordance);
//   • [CookieConsentPhase.Prompt]  — requireConsent && consent unknown → the active consent banner (web's only
//     rendered state);
//   • [CookieConsentPhase.Resolved]— requireConsent is off OR the user already decided → a friendly recorded
//     panel (the native materialisation of the web `return null`).
// Two freshness chips ride orthogonally over Prompt/Resolved: [CookieConsentRender.stale] (TTL-stale, a refresh
// in flight over the last-known requirement) and [CookieConsentRender.offline] (the requirement served from
// cache after a failed refresh — "last known + retry").
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/CookieConsentBanner — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment is illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.cookieconsentbanner

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The localStorage key the web helper persists the decision under (web `CONSENT_STORAGE_KEY`). Reused verbatim
 * as the SharedPreferences entry key so the native store mirrors the web storage contract one-to-one.
 */
const val CONSENT_STORAGE_KEY: String = "teslasync:consent:v1"

/**
 * Canonical registry metadata for the CookieConsentBanner surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`CookieConsentBanner`);
 * [ID] is the stable `viewModel` key the host binds the surface with.
 */
object CookieConsentBannerRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the surface with). */
    const val ID: String = "cookie-consent-banner"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "CookieConsentBanner"
}

/**
 * The per-user tri-state consent decision — the native port of the web `ConsentState`
 * (web/src/lib/cookieConsent.ts). [Unknown] is materialised by the ABSENCE of the stored key (a fresh / wiped
 * install), exactly like the web; [Accepted] / [Declined] are explicit decisions.
 */
enum class ConsentDecision {
    Unknown,
    Accepted,
    Declined,
    ;

    /**
     * The persisted form (web localStorage value): `"accepted"` / `"declined"`, or `null` for [Unknown] — the
     * unknown state is the absence of the key, never a stored sentinel.
     */
    val stored: String?
        get() =
            when (this) {
                Accepted -> STORED_ACCEPTED
                Declined -> STORED_DECLINED
                Unknown -> null
            }

    companion object {
        /** Stored value for an explicit accept (web `setConsent('accepted')`). */
        const val STORED_ACCEPTED: String = "accepted"

        /** Stored value for an explicit decline (web `setConsent('declined')`). */
        const val STORED_DECLINED: String = "declined"

        /**
         * Decodes a stored value (web `getConsent`): `"accepted"` / `"declined"` map to the explicit decisions,
         * and any other value — including `null`, a wiped store, or an unrecognised sentinel — collapses to
         * [Unknown], matching the web's defensive read.
         */
        fun fromStored(raw: String?): ConsentDecision =
            when (raw) {
                STORED_ACCEPTED -> Accepted
                STORED_DECLINED -> Declined
                else -> Unknown
            }
    }
}

/**
 * The mutually-exclusive primary region the surface paints. The web renders only [Prompt] (and otherwise
 * `null`); the native surface renders every phase as a non-blank region per the platform contract:
 *  - [Loading] — the requirement is loading with nothing cached (skeleton chrome);
 *  - [Error] — the requirement fetch hard-failed with no cached fallback (retry affordance);
 *  - [Prompt] — requireConsent && the decision is [ConsentDecision.Unknown] (the active web banner);
 *  - [Resolved] — consent is not required, or the user already decided (the native form of the web `return null`).
 */
enum class CookieConsentPhase {
    Loading,
    Error,
    Prompt,
    Resolved,
}

/**
 * Why the surface resolved to [CookieConsentPhase.Resolved] — selects the recorded-state copy:
 *  - [NotRequired] — the deployment does not collect consent (web `require_cookie_consent` falsey);
 *  - [Accepted] / [Declined] — the user already made the matching decision.
 */
enum class ResolvedReason {
    NotRequired,
    Accepted,
    Declined,
}

/**
 * The fully-resolved render state the composable paints — the native mirror of everything the web component
 * decides before returning JSX (or null). Pure data (no Compose types) so the projection is unit-tested without
 * a UI host; the composable only resolves colours + localized strings from it.
 *
 * @property phase the primary region to render.
 * @property consent the current per-user decision (drives the [Resolved] copy + the [resolvedReason]).
 * @property requireConsent the resolved deployment gate (`require_cookie_consent` ?? false); the last-known
 *   value while offline/stale.
 * @property showDetails whether the inline "Manage preferences" disclosure is expanded (web `showDetails`;
 *   meaningful only in [CookieConsentPhase.Prompt]).
 * @property stale whether a refresh is in flight over the last-known requirement (TTL-stale) — a "Stale" chip.
 * @property offline whether the requirement is served from cache after a failed refresh — an "offline / last
 *   known" chip with a retry affordance.
 * @property errorKind the classification of the requirement failure, when any.
 */
data class CookieConsentRender(
    val phase: CookieConsentPhase,
    val consent: ConsentDecision,
    val requireConsent: Boolean,
    val showDetails: Boolean,
    val stale: Boolean,
    val offline: Boolean,
    val errorKind: ErrorKind?,
) {
    /** The active consent prompt (web's only rendered state). */
    val showPrompt: Boolean get() = phase == CookieConsentPhase.Prompt

    /** The resolved recorded-state panel (the native form of the web `return null`). */
    val showResolved: Boolean get() = phase == CookieConsentPhase.Resolved

    /** The cold-start skeleton chrome (requirement loading, nothing cached). */
    val showLoading: Boolean get() = phase == CookieConsentPhase.Loading

    /** The hard-error panel with a retry affordance (requirement failed, nothing cached). */
    val showError: Boolean get() = phase == CookieConsentPhase.Error

    /** Whether the inline two-category details disclosure is shown (expanded AND on the active prompt). */
    val showDetailsBlock: Boolean get() = showDetails && phase == CookieConsentPhase.Prompt

    /** Whether the "Stale" freshness chip should render (TTL-stale, not offline, over a rendered requirement). */
    val showStaleChip: Boolean get() = stale && !offline && (showPrompt || showResolved)

    /** Whether the "offline / last known" chip + retry should render over a rendered requirement. */
    val showOfflineChip: Boolean get() = offline && (showPrompt || showResolved)

    /** Which recorded-state copy the [Resolved] panel shows. */
    val resolvedReason: ResolvedReason
        get() =
            when {
                !requireConsent -> ResolvedReason.NotRequired
                consent == ConsentDecision.Accepted -> ResolvedReason.Accepted
                consent == ConsentDecision.Declined -> ResolvedReason.Declined
                else -> ResolvedReason.NotRequired
            }
}

/**
 * Pure projection from the two decoded inputs to the render-ready [CookieConsentRender] — the native mirror of
 * the branching the web component performs before returning JSX. Framework-free so the whole contract is covered
 * by the JVM unit gate without a Compose host.
 */
object CookieConsentBannerProjection {
    /**
     * Folds the requirement [UiState] (web `useVersionInfo`) + the per-user [consent] (web `getConsent`) +
     * the local [showDetails] disclosure flag into the render. Phase resolution honours both the web's binary
     * show/hide and the requirement feed's lifecycle:
     *  - requirement loading with nothing cached → [CookieConsentPhase.Loading];
     *  - requirement hard-failed with no cache → [CookieConsentPhase.Error];
     *  - requireConsent && consent unknown → [CookieConsentPhase.Prompt] (the active web banner);
     *  - otherwise → [CookieConsentPhase.Resolved] (consent off, or already decided).
     * The freshness chips are derived from the requirement's [UiState.stale] / [UiState.hasError]: a stale flag
     * with no error is TTL-stale (refresh in flight); a stale flag WITH an error is the offline "last known"
     * surface.
     */
    fun render(
        requirement: UiState<Boolean>,
        consent: ConsentDecision,
        showDetails: Boolean,
    ): CookieConsentRender {
        val requireConsent = requirement.data ?: false
        val offline = requirement.hasData && requirement.stale && requirement.hasError
        val stale = requirement.hasData && requirement.stale && !requirement.hasError
        val phase =
            when {
                requirement.isLoading -> CookieConsentPhase.Loading
                requirement.isError -> CookieConsentPhase.Error
                requireConsent && consent == ConsentDecision.Unknown -> CookieConsentPhase.Prompt
                else -> CookieConsentPhase.Resolved
            }
        return CookieConsentRender(
            phase = phase,
            consent = consent,
            requireConsent = requireConsent,
            showDetails = showDetails,
            stale = stale,
            offline = offline,
            errorKind = requirement.errorKind,
        )
    }

    /** The cold-start render before any requirement emission — the loading surface (web hidden during load). */
    fun loading(
        consent: ConsentDecision = ConsentDecision.Unknown,
        showDetails: Boolean = false,
    ): CookieConsentRender = render(UiState.loading(), consent, showDetails)
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [CookieConsentBannerRegistration.SLUG]
 * (P1/S11) — never the user's consent decision nor any deployment detail, so a diagnostics line can never leak
 * the user's privacy posture. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel
 * calls it once per surface open.
 */
fun recordCookieConsentOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to CookieConsentBannerRegistration.SLUG))
}
