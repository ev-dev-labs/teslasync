// Pure, framework-free model + projection for the UserImpersonateButton feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/admin/components/UserImpersonateButton.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// The web component is a per-row action button: it renders a ghost Button + a warning ConfirmDialog and fires
// the `useStartImpersonation` mutation on confirm. Its parent owns the visibility decision, hiding the button
// in open-mode installs (`useImpersonationStatus().data?.mode !== 'open'`). This file owns the parts that are
// pure logic: the impersonation-status projection (web `useImpersonationStatus` modes), the surface-state
// selection that maps the host's cache-then-network feed plus the in-flight start mutation onto one of the
// lifecycle surfaces, and the button's label / enablement / accessibility-label / test-tag derivation. The
// composable is left to render the resolved model.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/UserImpersonateButton — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.userimpersonatebutton

import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object UserImpersonateButtonRegistration {
    /** Stable surface id. */
    const val ID: String = "user-impersonate-button"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "UserImpersonateButton"
}

/**
 * PII-safe diagnostics for the surface (P1/S11). [recordViewOpened] emits the `view.opened` event carrying
 * only the surface slug — never the impersonation subject, which is opaque-but-still-sensitive — so a
 * diagnostics line can never leak who an admin was about to impersonate.
 */
object UserImpersonateButtonDiagnostics {
    /** Emits the one-shot `view.opened` diagnostic with the surface slug and nothing else. */
    fun recordViewOpened(logger: Logger) {
        logger.info("view.opened", mapOf("surface" to UserImpersonateButtonRegistration.SLUG))
    }
}

/**
 * The discriminated impersonation-state mode — the native analogue of the web `useImpersonationStatus`
 * union (`{ mode: 'open' | 'inactive' | 'active', … }`). [Open] is the "feature requires forward-auth"
 * sentinel the backend reports as `AUTH_MODE_OPEN`; the surface treats it as a friendly unavailable state,
 * not an error (web parity).
 */
enum class ImpersonationMode {
    Inactive,
    Active,
    Open,
    ;

    companion object {
        /** Maps a raw wire mode to its [ImpersonationMode]; unknown values fold to [Inactive]. */
        fun fromRaw(mode: String?): ImpersonationMode =
            when (mode) {
                "active" -> Active
                "open" -> Open
                else -> Inactive
            }
    }
}

/**
 * Pure projection of the host's `useImpersonationStatus` / `useImpersonation` payload (P1/S8). The surface
 * binds it as a cache-then-network [UiState]; this view never fetches. [target] / [originalAdmin] are carried
 * for completeness (an active session names them) but the button itself only branches on [mode].
 */
data class ImpersonationView(
    val mode: ImpersonationMode,
    val target: String? = null,
    val originalAdmin: String? = null,
)

/**
 * The mutually-exclusive surface the button renders, derived by [UserImpersonateButtonProjection]. Each maps
 * to a render branch in the composable so no state is ever a blank box:
 *  - [Idle]      — status loaded, a valid subject: the enabled "Impersonate" button (web content branch).
 *  - [Loading]   — status first-load in flight: a disabled, busy button with accessible loading chrome.
 *  - [Empty]     — no actionable subject (blank id, or the feed replayed empty): a friendly empty affordance.
 *  - [OpenMode]  — open-mode install: the "requires forward-auth" affordance (web parent-gated hidden button).
 *  - [Error]     — status hard-failed with nothing cached: an error surface with a retry affordance.
 *  - [Stale]     — cached status past its freshness window but still online: stale chip + auto-refresh.
 *  - [Offline]   — cached status served because the network was unreachable: offline chip, start disabled.
 */
enum class ImpersonateButtonSurface {
    Idle,
    Loading,
    Empty,
    OpenMode,
    Error,
    Stale,
    Offline,
}

/**
 * Localized microcopy the surface renders — every string the web component reads via `t(...)` plus the
 * lifecycle-chrome strings the host's feed implies. The interpolated [ariaLabel] / [confirmMessage] are
 * lambdas so the composable can resolve the `%1$s` argument through `Context.getString`; tests pass a
 * deterministic instance. All keys already exist in the P1/S10 catalog.
 */
data class UserImpersonateButtonStrings(
    val start: String,
    val starting: String,
    val confirmTitle: String,
    val confirmConfirm: String,
    val confirmCancel: String,
    val closeLabel: String,
    val emptyTitle: String,
    val emptyMessage: String,
    val openModeMessage: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
    val loadingLabel: String,
    val offlineLabel: String,
    val ariaLabel: (subject: String) -> String,
    val confirmMessage: (subject: String) -> String,
)

/**
 * The render-ready button model — the native mirror of the props the web component passes to its `<Button>`
 * (label, disabled, loading, aria-label, data-testid) plus the resolved lifecycle [surface]. Pure data (no
 * Compose), so the selection logic is fully covered by the off-device unit gate.
 */
data class UserImpersonateButtonModel(
    val actionLabel: String,
    val ariaLabel: String,
    val testTag: String,
    val enabled: Boolean,
    val loading: Boolean,
    val surface: ImpersonateButtonSurface,
)

/**
 * The pure surface-state + button projection the composable renders. Stateless and side-effect-free so it is
 * fully covered by the off-device unit gate.
 */
object UserImpersonateButtonProjection {
    /** Stable, web-parity test tag (`data-testid="user-impersonate-button-${subject}"`). */
    fun testTagFor(subject: String): String = "user-impersonate-button-$subject"

    /**
     * Selects the [UserImpersonateButtonModel] from the host's status [state] (P1/S8), the in-flight start
     * mutation flag [starting] (web `startMut.isPending`), the parent's [disabled]-row decision, and the
     * target [subject].
     *
     * Precedence mirrors the web behaviour and the ADR-013 freshness contract:
     *  1. [starting] wins the button presentation — label "Starting…", spinner, disabled (web `isPending`).
     *  2. A first-load is [ImpersonateButtonSurface.Loading]; a hard failure is [ImpersonateButtonSurface.Error].
     *  3. Open-mode is surfaced before emptiness so the install-capability message always shows.
     *  4. A blank/empty subject or an empty feed is [ImpersonateButtonSurface.Empty].
     *  5. Cached-after-failure is [ImpersonateButtonSurface.Offline] (start disabled); merely-stale-but-online
     *     is [ImpersonateButtonSurface.Stale] (start stays usable, the chip auto-refreshes).
     *  6. Otherwise the loaded [ImpersonateButtonSurface.Idle] button.
     *
     * The button is enabled only on [ImpersonateButtonSurface.Idle] / [ImpersonateButtonSurface.Stale] with a
     * non-blank subject, not disabled by the parent, and not already starting — exactly the web
     * `disabled || startMut.isPending` guard, extended with the feed gate the parent component owns in the web
     * tree.
     */
    fun project(
        subject: String,
        state: UiState<ImpersonationView>,
        starting: Boolean,
        disabled: Boolean,
        strings: UserImpersonateButtonStrings,
    ): UserImpersonateButtonModel {
        val hasSubject = subject.trim().isNotEmpty()
        val surface = selectSurface(state, starting, hasSubject)
        val interactive =
            surface == ImpersonateButtonSurface.Idle || surface == ImpersonateButtonSurface.Stale
        return UserImpersonateButtonModel(
            actionLabel = if (starting) strings.starting else strings.start,
            ariaLabel = strings.ariaLabel(subject),
            testTag = testTagFor(subject),
            enabled = interactive && hasSubject && !disabled && !starting,
            loading = starting,
            surface = surface,
        )
    }

    private fun selectSurface(
        state: UiState<ImpersonationView>,
        starting: Boolean,
        hasSubject: Boolean,
    ): ImpersonateButtonSurface =
        when {
            starting -> ImpersonateButtonSurface.Idle
            state.isLoading -> ImpersonateButtonSurface.Loading
            state.isError -> ImpersonateButtonSurface.Error
            state.data?.mode == ImpersonationMode.Open -> ImpersonateButtonSurface.OpenMode
            !hasSubject -> ImpersonateButtonSurface.Empty
            state.isEmpty -> ImpersonateButtonSurface.Empty
            state.stale && state.hasError -> ImpersonateButtonSurface.Offline
            state.stale -> ImpersonateButtonSurface.Stale
            else -> ImpersonateButtonSurface.Idle
        }
}
