// Pure, framework-free model + projection for the ImpersonationBanner shared surface — the native analogue of
// everything the web component derives before returning JSX (web/src/components/feedback/ImpersonationBanner.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is exercised by the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A persistent, non-dismissible amber security bar that renders ONLY while a valid impersonation cookie is
//     active (`isImpersonationActive(data) && data.mode === 'active'`); for every other state it returns `null`.
//   • Active: a UserCheck glyph, "Impersonating {{target}}", a fixed body line, a live per-second countdown
//     ("Expires in {{time}}" while >1s remains, else "Session expired"), and an "End impersonation" / "Ending…"
//     button disabled while the end mutation is pending.
//   • The countdown formats remaining time as "HHh MMm" / "MMm SSs" / "SSs" (verbatim with the web
//     `formatRemaining`).
//
// Because this surface binds a real cache-then-network feed (the shared S8 ImpersonationStore, web
// `useImpersonationStatus`), it also owns the feed-lifecycle states that layer implies — loading, error,
// stale, offline — exactly as the sibling UserImpersonateButton does. The two "nothing to announce" states the
// web renders as `null` (Inactive and Open mode) collapse to an explicit, unit-tested [ImpersonationBannerSurface.Hidden]
// branch (the AiLimitBanner `Hidden` precedent) rather than a blank box behind an untested guard.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ImpersonationBanner — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path — exactly as the sibling UserCell / AiLimitBanner surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.impersonationbanner

import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStatus
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug and the web-parity test tags (`data-testid` on the bar, the End button, and the countdown
 * line) are pinned here so the native and web surfaces stay in lockstep.
 */
object ImpersonationBannerRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ImpersonationBanner"

    /** Test tag on the bar root (web `data-testid="impersonation-banner"`). */
    const val BANNER_TEST_TAG: String = "impersonation-banner"

    /** Test tag on the End button (web `data-testid="impersonation-banner-end"`). */
    const val END_BUTTON_TEST_TAG: String = "impersonation-banner-end"

    /** Test tag on the countdown line (web `data-testid="impersonation-banner-countdown"`). */
    const val COUNTDOWN_TEST_TAG: String = "impersonation-banner-countdown"
}

/**
 * PII-safe diagnostics for the surface (P1/S11). [recordViewOpened] emits the `view.opened` event carrying
 * only the surface slug — never the impersonation target/admin, which are opaque-but-still-sensitive — so a
 * diagnostics line can never leak who an admin is impersonating.
 */
object ImpersonationBannerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = ImpersonationBannerRegistration.SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the one-shot `view.opened` diagnostic with the surface slug and nothing else. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/**
 * The discriminated impersonation-state mode — the native analogue of the web `useImpersonationStatus` union
 * (`{ mode: 'open' | 'inactive' | 'active', … }`). [Open] is the "feature requires forward-auth" sentinel the
 * backend reports as `AUTH_MODE_OPEN`; like the web it is treated as a friendly unavailable state, not an error.
 */
enum class ImpersonationMode {
    Inactive,
    Active,
    Open,
    ;

    companion object {
        /** Maps a raw wire mode to its [ImpersonationMode]; unknown/absent values fold to [Inactive] (web parity). */
        fun fromRaw(mode: String?): ImpersonationMode =
            when (mode) {
                ImpersonationStatus.ACTIVE -> Active
                ImpersonationStatus.OPEN -> Open
                else -> Inactive
            }
    }
}

/**
 * The render-relevant projection of the shared [ImpersonationStatus] (P1/S8). Only an [Active] session carries
 * a [target]/[originalAdmin]/[expiresAt]; the other modes leave them blank. The view branches on [mode] and
 * (for active sessions) renders [target] + the [expiresAt]-derived countdown.
 */
data class ImpersonationBannerView(
    val mode: ImpersonationMode,
    val target: String = "",
    val originalAdmin: String = "",
    val expiresAt: String = "",
) {
    companion object {
        /** Folds the shared discriminated [ImpersonationStatus] onto the surface's render view. */
        fun fromStatus(status: ImpersonationStatus): ImpersonationBannerView =
            when (status) {
                is ImpersonationStatus.Active ->
                    ImpersonationBannerView(
                        mode = ImpersonationMode.Active,
                        target = status.target,
                        originalAdmin = status.originalAdmin,
                        expiresAt = status.expiresAt,
                    )
                ImpersonationStatus.Open -> ImpersonationBannerView(ImpersonationMode.Open)
                ImpersonationStatus.Inactive -> ImpersonationBannerView(ImpersonationMode.Inactive)
            }
    }
}

/**
 * The render-ready countdown line — the native mirror of the web `countdown` local. [None] when there is no
 * parseable expiry; [Remaining] carries the already-formatted "MMm SSs"-style time (web `formatRemaining`);
 * [Expired] when ≤1s remains (web "Session expired").
 */
sealed interface BannerCountdown {
    /** No parseable `expires_at` → the web renders no countdown line. */
    data object None : BannerCountdown

    /** >1s remains → "Expires in {{time}}" with this pre-formatted [timeText]. */
    data class Remaining(
        val timeText: String,
    ) : BannerCountdown

    /** ≤1s remains → "Session expired". */
    data object Expired : BannerCountdown
}

/**
 * The mutually-exclusive surface the bar renders, derived by [ImpersonationBannerProjection]. Each maps to a
 * render branch so no state is ever a blank box gated behind an untested guard:
 *  - [Hidden]  — not impersonating (web `null`): Inactive, Open mode, or a resolved-but-absent value.
 *  - [Loading] — first status load in flight with nothing cached: a skeleton bar.
 *  - [Active]  — an active session: the web banner (icon + title + body + countdown + End button).
 *  - [Error]   — status hard-failed with nothing cached: an error surface with retry.
 *  - [Stale]   — cached active session past its freshness window but still online: stale chip + auto-refresh.
 *  - [Offline] — cached active session served after a failed refresh: offline chip, no live claim.
 */
enum class ImpersonationBannerSurface {
    Hidden,
    Loading,
    Active,
    Error,
    Stale,
    Offline,
}

/**
 * Localized microcopy the surface renders — every string the web component reads via `t(...)` plus the
 * lifecycle-chrome strings the bound feed implies. [title]/[endsIn] are lambdas so the composable resolves the
 * `%1$s` argument through `Context.getString`; tests pass a deterministic instance. All keys already exist in
 * the P1/S10 catalog (`translation_impersonation_banner_*` + the shared chrome keys).
 */
data class ImpersonationBannerStrings(
    val title: (target: String) -> String,
    val body: String,
    val end: String,
    val ending: String,
    val endsIn: (time: String) -> String,
    val expired: String,
    val loadingLabel: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
    val staleLabel: String,
    val offlineLabel: String,
)

/**
 * The immutable, render-ready model the composable draws — the resolved lifecycle [surface], the impersonated
 * [target], the [countdown] line, and whether the end mutation is in flight ([ending], web `endMut.isPending`).
 * Pure data so [ImpersonationBannerProjection] is unit-tested without a UI host.
 */
data class ImpersonationBannerModel(
    val surface: ImpersonationBannerSurface,
    val target: String,
    val countdown: BannerCountdown,
    val ending: Boolean,
) {
    /** True when a stale/offline freshness chip should be shown over the cached active session. */
    val showFreshnessChip: Boolean
        get() = surface == ImpersonationBannerSurface.Stale || surface == ImpersonationBannerSurface.Offline

    /** True when the bar renders the active-session banner (active, or a stale/offline cached active session). */
    val isActiveBanner: Boolean
        get() = surface == ImpersonationBannerSurface.Active || showFreshnessChip
}

/**
 * Pure surface-state + countdown projection for the ImpersonationBanner — the native port of the web
 * component's render derivation. Stateless and side-effect-free so it is fully covered by the off-device gate.
 */
object ImpersonationBannerProjection {
    private const val MILLIS_PER_SECOND = 1_000L
    private const val SECONDS_PER_MINUTE = 60L
    private const val SECONDS_PER_HOUR = 3_600L

    /** Below this remaining margin the web shows "Session expired" instead of a countdown (web `remaining > 1000`). */
    private const val EXPIRY_THRESHOLD_MS = 1_000L

    /**
     * Selects the [ImpersonationBannerModel] from the bound status [state] (P1/S8), the live [nowMillis] tick,
     * and the in-flight end mutation flag [ending].
     *
     * Surface precedence mirrors the web behaviour + the ADR-013 freshness contract: a first load is
     * [ImpersonationBannerSurface.Loading]; a hard failure is [ImpersonationBannerSurface.Error]; anything that
     * is not an active session collapses to [ImpersonationBannerSurface.Hidden] (web `null`); a cached active
     * session past its TTL after a failed refresh is [ImpersonationBannerSurface.Offline] and merely-stale-but-
     * online is [ImpersonationBannerSurface.Stale]; otherwise the live [ImpersonationBannerSurface.Active] bar.
     * The countdown is computed only for the active-banner surfaces.
     */
    fun project(
        state: UiState<ImpersonationBannerView>,
        nowMillis: Long,
        ending: Boolean,
    ): ImpersonationBannerModel {
        val data = state.data
        val surface = selectSurface(state, data)
        val countdown =
            if (isActiveBannerSurface(surface)) {
                countdownFor(data?.expiresAt?.let(::parseExpiryMillis), nowMillis)
            } else {
                BannerCountdown.None
            }
        return ImpersonationBannerModel(
            surface = surface,
            target = data?.target.orEmpty(),
            countdown = countdown,
            ending = ending,
        )
    }

    private fun selectSurface(
        state: UiState<ImpersonationBannerView>,
        data: ImpersonationBannerView?,
    ): ImpersonationBannerSurface =
        when {
            state.isLoading -> ImpersonationBannerSurface.Loading
            state.isError -> ImpersonationBannerSurface.Error
            data == null || data.mode != ImpersonationMode.Active -> ImpersonationBannerSurface.Hidden
            state.stale && state.hasError -> ImpersonationBannerSurface.Offline
            state.stale -> ImpersonationBannerSurface.Stale
            else -> ImpersonationBannerSurface.Active
        }

    private fun isActiveBannerSurface(surface: ImpersonationBannerSurface): Boolean =
        surface == ImpersonationBannerSurface.Active ||
            surface == ImpersonationBannerSurface.Stale ||
            surface == ImpersonationBannerSurface.Offline

    /**
     * Parses the RFC3339 `expires_at` into epoch millis — the native port of the web `Date.parse(expiresAt)`
     * (`Number.isFinite` guard). A blank or unparseable value yields `null` (no countdown), exactly as the web
     * `expiresMs === null` branch suppresses the countdown.
     */
    fun parseExpiryMillis(expiresAt: String): Long? {
        if (expiresAt.isBlank()) return null
        return try {
            OffsetDateTime.parse(expiresAt).toInstant().toEpochMilli()
        } catch (_: DateTimeParseException) {
            null
        }
    }

    /**
     * Resolves the [BannerCountdown] for an [expiryMillis] at the current [nowMillis] — the native port of the
     * web `remaining = expiresMs - now; remaining > 1000 ? endsIn : expired`. A `null` expiry yields
     * [BannerCountdown.None] (no countdown line).
     */
    fun countdownFor(
        expiryMillis: Long?,
        nowMillis: Long,
    ): BannerCountdown {
        if (expiryMillis == null) return BannerCountdown.None
        val remaining = expiryMillis - nowMillis
        return if (remaining > EXPIRY_THRESHOLD_MS) {
            BannerCountdown.Remaining(formatRemaining(remaining))
        } else {
            BannerCountdown.Expired
        }
    }

    /**
     * Formats a remaining duration as "HHh MMm" / "MMm SSs" / "SSs" — a verbatim port of the web
     * `formatRemaining`, including the zero-padded trailing unit and the `Math.max(0, …)` floor.
     */
    fun formatRemaining(ms: Long): String {
        val total = (ms / MILLIS_PER_SECOND).coerceAtLeast(0)
        val hours = total / SECONDS_PER_HOUR
        val minutes = (total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
        val seconds = total % SECONDS_PER_MINUTE
        return when {
            hours > 0 -> "${hours}h ${pad(minutes)}m"
            minutes > 0 -> "${minutes}m ${pad(seconds)}s"
            else -> "${seconds}s"
        }
    }

    private fun pad(value: Long): String = value.toString().padStart(2, '0')

    /**
     * Builds the merged TalkBack announcement for the active bar from already-localized parts — kept pure so
     * the a11y label is unit-tested without a Compose host. [countdown] is `null` when no countdown line shows.
     */
    fun accessibilityLabel(
        title: String,
        body: String,
        countdown: String?,
    ): String =
        buildString {
            append(title)
            append(". ")
            append(body)
            if (!countdown.isNullOrBlank()) {
                append(" ")
                append(countdown)
            }
        }
}
