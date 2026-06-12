// Pure, framework-light model + projection backing the Compose [TeslaAccountSection] feature view — the
// native analogue of everything the web component derives before returning JSX
// (web/src/features/settings/components/TeslaAccountSection.tsx). Every declaration here is exercised
// off-device by the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component composes the Tesla Fleet auth hooks (useAuthStatus / useAuthURL / useRefreshAuth /
// useDisconnectAuth / useSyncVehicles) plus the document-event "token expired / recovered" signal the
// global re-auth banner emits. This file owns the parity-critical derivations that have nothing to do
// with Compose: the connected / not-connected / expired status branch, the "expires within 7 days" soft
// warning math, the token-expiry parse, the render-ready view the panel draws, and the typed toast set.
// The two lucide glyphs Android has no bundle for (`Car`, `XCircle`) are authored locally as stroked
// vectors recolored at render, exactly as the sibling surfaces do.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed: the mandated surface
// directory (com/teslasync/feature-views/TeslaAccountSection — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path, and the file hosts several co-located declarations.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "ktlint:standard:filename")

package io.teslasync.android.featureviews.teslaaccountsection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.AuthStatus
import java.time.Instant

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object TeslaAccountSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "tesla-account-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TeslaAccountSection"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TeslaAccountSectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it
 * from the first composition. It carries no token, expiry, or vehicle data, so a diagnostics line can
 * never leak whether (or when) an account is connected.
 */
fun recordTeslaAccountSectionViewOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to TeslaAccountSectionRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/**
 * The fully projected, render-ready view of the Tesla Fleet connection — the native analogue of what the
 * web component computes before returning JSX. It folds the `/auth/status` read together with the global
 * "token expired" re-auth signal (web `pillDisconnected`) and the current time into the exact branch
 * decisions the panel renders, so the composable stays a thin render layer and the rule has one
 * test-pinned definition.
 *
 * The two row/action branches mirror the web component precisely:
 *  - the STATUS row shows "Connected" only when `authenticated && !reauthNeeded` (web
 *    `auth?.authenticated && !pillDisconnected`); otherwise it shows the not-connected branch, which is
 *    the "Disconnected" + reconnect copy when [showDisconnectedPill] (web `pillDisconnected`) and the
 *    plain "Not connected" otherwise;
 *  - the ACTION row shows only "Connect" when `!authenticated` (web `!auth?.authenticated`); otherwise it
 *    shows the manage set (Refresh Token / Sync Vehicles / Re-authorize / Disconnect) — note this depends
 *    on `authenticated` alone, so an authenticated-but-expired account still shows the manage actions.
 *
 * @property connected the account is connected and the token is not flagged expired (web Connected branch).
 * @property showDisconnectedPill the not-connected branch should read "Disconnected" + reconnect copy
 *   rather than "Not connected" (web `pillDisconnected`).
 * @property showConnectAction the action row is the single "Connect" affordance (web `!authenticated`).
 * @property expiresAtMillis the parsed token expiry as epoch millis, or `null` when absent/unparseable —
 *   the "Token expires …" line renders only in the connected branch when this is present.
 * @property expiringSoonDays the whole-days-until-expiry soft warning (1..7), or `null` when the token is
 *   absent, already expired, or more than 7 days out (web `expiringSoon`).
 */
data class TeslaAccountView(
    val connected: Boolean,
    val showDisconnectedPill: Boolean,
    val showConnectAction: Boolean,
    val expiresAtMillis: Long?,
    val expiringSoonDays: Int?,
) {
    companion object {
        /** The web soft-warning window: a token expiring within 7 days surfaces the "Expires in Nd" pill. */
        const val SEVEN_DAYS_MS: Long = 7L * 24L * 60L * 60L * 1000L

        /** Milliseconds in a day — the divisor for the whole-days-remaining ceiling. */
        const val DAY_MS: Long = 24L * 60L * 60L * 1000L

        /**
         * Projects the `/auth/status` [auth] read, the [reauthNeeded] re-auth signal (web
         * `pillDisconnected`), and the current time [nowMs] onto the render-ready [TeslaAccountView] — the
         * data adapter the composable renders and the unit test drives directly (status → projection).
         * A `null` [auth] is treated as not-authenticated (the web `auth?.authenticated` optional chain).
         */
        fun from(
            auth: AuthStatus?,
            reauthNeeded: Boolean,
            nowMs: Long,
        ): TeslaAccountView {
            val authenticated = auth?.authenticated == true
            val expiresAtMillis = parseExpiry(auth?.expiresAt)
            return TeslaAccountView(
                connected = authenticated && !reauthNeeded,
                showDisconnectedPill = reauthNeeded,
                showConnectAction = !authenticated,
                expiresAtMillis = expiresAtMillis,
                expiringSoonDays = expiringSoonDays(authenticated, expiresAtMillis, nowMs),
            )
        }

        /**
         * The whole days until [expiresAtMillis] when it falls inside the soft-warning window — the native
         * port of the web `expiringSoon` IIFE: `null` unless [authenticated] with a parseable expiry that
         * is still in the future and within [SEVEN_DAYS_MS]; otherwise `ceil(remaining / day)` floored at 1.
         */
        fun expiringSoonDays(
            authenticated: Boolean,
            expiresAtMillis: Long?,
            nowMs: Long,
        ): Int? {
            if (!authenticated || expiresAtMillis == null) return null
            val remaining = expiresAtMillis - nowMs
            return if (remaining <= 0L || remaining > SEVEN_DAYS_MS) {
                null
            } else {
                // Whole days remaining, rounded up (integer ceiling division), floored at 1 (web Math.max(1, ceil)).
                maxOf(1L, (remaining + DAY_MS - 1L) / DAY_MS).toInt()
            }
        }

        /**
         * Parses an ISO-8601 token-expiry [raw] to epoch millis — the native port of the web
         * `new Date(expires_at).getTime()` with its `Number.isNaN` guard: a blank or unparseable value
         * yields `null` (the web `null` branch) so the "expires" affordances are simply not shown.
         */
        fun parseExpiry(raw: String?): Long? =
            if (raw.isNullOrBlank()) {
                null
            } else {
                runCatching { Instant.parse(raw).toEpochMilli() }.getOrNull()
            }
    }
}

/**
 * The typed, localized-at-the-boundary toasts the surface raises for its mutations — the native analogue
 * of the web component's `useToast` calls. The two successes mirror the component's `toast.success` for
 * the token refresh and disconnect; the three failures surface the matching error copy already in the
 * P1/S10 catalog so a failed write is never silent. The Sync action raises NO toast on success — the web
 * shows an inline "Synced N vehicle(s)." line instead, modelled by the view-model's synced-count state.
 */
sealed interface TeslaAccountToast {
    /** Token refresh succeeded — web `toast.success(t('toast.tokenRefreshed'))`. */
    data object TokenRefreshed : TeslaAccountToast

    /** Token refresh failed — web `toast.error(t('toast.tokenRefreshFailed'))`. */
    data object TokenRefreshFailed : TeslaAccountToast

    /** Account disconnected — web `toast.success(t('toast.disconnected'))`. */
    data object Disconnected : TeslaAccountToast

    /** Disconnect failed — web `toast.error(t('toast.disconnectFailed'))`. */
    data object DisconnectFailed : TeslaAccountToast

    /** Vehicle sync failed — web `toast.error(t('toast.syncFailed'))`. */
    data object SyncFailed : TeslaAccountToast
}

/**
 * The locally-authored 24×24 stroked icons the surface needs that the shared glyph catalogs don't carry —
 * the Android stand-ins for the web `lucide-react` `Car` (Sync Vehicles) and `XCircle` (Disconnect /
 * not-connected status). Android ships no lucide set and the surface's allowed-files scope forbids editing
 * the shared glyph files, so these are monochrome [ImageVector]s recolored at render time by `Icon`'s
 * `tint`, exactly like the sibling surfaces' glyph sets. Both are decorative (the adjacent text carries the
 * meaning), so each is drawn with a `null` content description at the call site. The other web glyphs
 * (`Shield`, `ExternalLink`, `RefreshCw`, `CheckCircle`, `AlertTriangle`) already exist in the shared
 * `DataDisplayGlyphs` / `FeedbackGlyphs` catalogs and are reused there.
 */
object TeslaAccountGlyphs {
    /** lucide `Car` — a cabin + hood silhouette over a chassis bar with two round wheel marks. */
    val Car: ImageVector =
        glyph("Car") {
            moveTo(6f, 11f)
            lineTo(8f, 6.5f)
            lineTo(16f, 6.5f)
            lineTo(18f, 11f)
            moveTo(3f, 11f)
            lineTo(21f, 11f)
            lineTo(21f, 16f)
            lineTo(3f, 16f)
            close()
            wheel(7.5f, 16f)
            wheel(16.5f, 16f)
        }

    /** lucide `XCircle` — a ring enclosing an X (not-connected status + Disconnect action). */
    val XCircle: ImageVector =
        glyph("XCircle") {
            ring(12f, 12f, 9f)
            moveTo(9f, 9f)
            lineTo(15f, 15f)
            moveTo(15f, 9f)
            lineTo(9f, 15f)
        }
}

/** A round-cap zero-length segment that renders as a wheel/dot at ([x], [y]). */
private fun PathBuilder.wheel(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

/** A full circle of radius [r] centered at ([cx], [cy]), drawn as four cubic-bezier quadrants. */
private fun PathBuilder.ring(
    cx: Float,
    cy: Float,
    r: Float,
) {
    val k = r * CIRCLE_KAPPA
    moveTo(cx, cy - r)
    curveTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
    curveTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
    curveTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
    curveTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
    close()
}

/** Builds a standard 24×24 round-capped stroked [ImageVector] from a single [PathBuilder] program. */
private fun glyph(
    name: String,
    pathBuilder: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = pathBuilder,
            )
        }.build()

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

// Cubic-bezier control-point ratio that approximates a quarter circle (4/3 · tan(π/8)).
private const val CIRCLE_KAPPA = 0.5523f
