// Pure, framework-free model for the `helpers` feature view — the native analogue of the web status
// helpers module (web/src/features/system/components/status/helpers.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable layer (Helpers.kt) a thin render shell.
//
// Unlike the other feature-view surfaces, the web source is NOT a rendered component — it is a pure helpers
// module exporting `getStatusColor` / `statusTextClass` / `getStatusIcon` / `formatUptime` / `formatBytes` /
// `statusToBadgeVariant`. It binds no data hook and makes no `t()` call, so it has none of the
// cache-then-network phases (loading / empty / error / stale / offline) the page template enumerates;
// modelling those would invent behaviour the source does not have (drift), exactly as the sibling
// BatteryPill / StatusHeader / SummaryStatsRow ports avoid. The branches the source actually defines — the
// four status buckets and the two formatter shapes — are the complete state set, and each is reproduced and
// tested here.
//
// A faithful subtlety worth its own pin: the web success set for the COLOR/ICON helpers includes the literal
// `connected`, but the success set for `statusToBadgeVariant` does NOT — there `connected` falls through to
// neutral. So two classifiers exist: [StatusKind.fromStatus] (color + icon) and [StatusKind.forBadge]
// (badge), differing only on `connected`. The asymmetry is reproduced verbatim and pinned by a unit test
// rather than silently "fixed".
//
// The formatters keep the web's literal unit symbols (`d`/`h`/`m`, `B`/`KB`/`MB`/`GB`/`TB`). The web source
// hardcodes these and never routes them through `t()`; they are universal unit abbreviations, not prose, and
// the P1/S10 catalog carries no key for them (and none may be added from this surface), so localizing them
// would be drift. [HelpersFormat.fmtNumber] mirrors the web `fmtNumber(v, 1)`: locale grouping, one fraction
// digit, `safeNumber` (non-finite → 0), and HALF_UP rounding to match `Intl.NumberFormat`'s halfExpand.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/helpers — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.helpers

import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow

/**
 * The semantic status bucket a raw status string maps to — the native analogue of the web `switch` that the
 * status helpers share. The composable maps each bucket onto a P1/S9 design token (color) and a glyph; the
 * badge mapper maps it onto a [io.teslasync.android.components.ui.BadgeVariant].
 *
 * Comparison is lower-cased and locale-invariant (Kotlin `lowercase()` uses Locale.ROOT), matching the web
 * `(status ?? '').toLowerCase()` for the ASCII status tokens the backend emits.
 */
enum class StatusKind {
    /** Web green band — `#22c55e` / `text-green-400` / `CheckCircle` / badge `success`. */
    Success,

    /** Web amber band — `#f59e0b` / `text-amber-400` / `AlertTriangle` / badge `warning`. */
    Warning,

    /** Web red band — `#ef4444` / `text-red-400` / `XCircle` / badge `danger`. */
    Danger,

    /** Web fall-through — `#6b7280` / `text-[var(--text-muted)]` / `AlertTriangle` / badge `neutral`. */
    Neutral,
    ;

    companion object {
        /** Success tokens for the COLOR + ICON helpers (web `getStatusColor` / `getStatusIcon`): includes `connected`. */
        private val SUCCESS_COLOR_TOKENS =
            setOf("healthy", "ok", "online", "connected", "ready", "sent", "completed")

        /** Success tokens for the BADGE helper (web `statusToBadgeVariant`): note `connected` is intentionally absent. */
        private val SUCCESS_BADGE_TOKENS =
            setOf("healthy", "ok", "online", "ready", "sent", "completed")

        /** Warning tokens — identical across every web helper. */
        private val WARNING_TOKENS =
            setOf("degraded", "warning", "pending", "queued", "processing")

        /** Danger tokens — identical across every web helper. */
        private val DANGER_TOKENS =
            setOf("unhealthy", "offline", "error", "down", "failed")

        /**
         * Classify [status] for the color + icon helpers — the web `getStatusColor` / `statusTextClass` /
         * `getStatusIcon` switch (the success set that includes `connected`).
         */
        fun fromStatus(status: String?): StatusKind = classify(status, SUCCESS_COLOR_TOKENS)

        /**
         * Classify [status] for the badge helper — the web `statusToBadgeVariant` switch (the success set
         * that excludes `connected`, so a `connected` status renders a neutral badge while still rendering a
         * green color/icon elsewhere — faithful to the source asymmetry).
         */
        fun forBadge(status: String?): StatusKind = classify(status, SUCCESS_BADGE_TOKENS)

        private fun classify(
            status: String?,
            successTokens: Set<String>,
        ): StatusKind {
            val key = (status ?: "").lowercase()
            return when (key) {
                in successTokens -> Success
                in WARNING_TOKENS -> Warning
                in DANGER_TOKENS -> Danger
                else -> Neutral
            }
        }
    }
}

/**
 * The two pure formatters the web module exports — `formatUptime(seconds)` and `formatBytes(bytes)` — plus
 * the shared [fmtNumber] they (and the rest of the app) round through. Kept framework-free so the exact
 * bucket cutoffs and rounding are unit-tested off-device.
 */
object HelpersFormat {
    private const val SECONDS_PER_MINUTE = 60L
    private const val SECONDS_PER_HOUR = 3_600L
    private const val SECONDS_PER_DAY = 86_400L

    private const val BYTES_PER_UNIT = 1024.0
    private const val BYTE_FRACTION_DIGITS = 1
    private val BYTE_UNITS = listOf("B", "KB", "MB", "GB", "TB")

    /**
     * Format an uptime in whole seconds the way the web `formatUptime` does: floor into days / hours /
     * minutes and render the largest non-zero tier downwards (`${d}d ${h}h ${m}m`, then `${h}h ${m}m`, then
     * `${m}m`). The unit letters are literal, exactly as the web source renders them.
     *
     * Uptime is a non-negative quantity; a negative input (which the web `number` type permits but the domain
     * never produces) is clamped to zero so the floored tiers never go negative.
     */
    fun formatUptime(seconds: Long): String {
        val total = seconds.coerceAtLeast(0L)
        val days = total / SECONDS_PER_DAY
        val hours = (total % SECONDS_PER_DAY) / SECONDS_PER_HOUR
        val minutes = (total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
        return when {
            days > 0L -> "${days}d ${hours}h ${minutes}m"
            hours > 0L -> "${hours}h ${minutes}m"
            else -> "${minutes}m"
        }
    }

    /**
     * Format a byte count the way the web `formatBytes` does: `0` renders as `0 B`, otherwise the binary
     * exponent picks a unit (`B`/`KB`/`MB`/`GB`/`TB`) and the scaled value renders through [fmtNumber] at one
     * fraction digit with locale grouping (e.g. `1.5 KB`, `1,023.0 B`).
     *
     * Two degenerate edges the web source leaves undefined are hardened here for a byte count (an unsigned
     * quantity): a non-positive input renders `0 B`, and an exponent beyond `TB` is clamped to `TB` (the web
     * would index past its `sizes` array and emit the string `undefined`).
     */
    fun formatBytes(
        bytes: Long,
        locale: Locale = Locale.getDefault(),
    ): String {
        if (bytes <= 0L) return "0 ${BYTE_UNITS.first()}"
        val magnitude = bytes.toDouble() // parity:allow Kotlin stdlib Long to Double, "toDo" substring false positive
        val exponent =
            floor(ln(magnitude) / ln(BYTES_PER_UNIT))
                .toInt()
                .coerceIn(0, BYTE_UNITS.lastIndex)
        val value = magnitude / BYTES_PER_UNIT.pow(exponent)
        return "${fmtNumber(value, BYTE_FRACTION_DIGITS, locale)} ${BYTE_UNITS[exponent]}"
    }

    /**
     * The web `fmtNumber(v, decimals)` (web/src/lib/numberFormat.ts): a non-finite value is coerced to 0
     * (`safeNumber`), then rendered with locale grouping separators and exactly [decimals] fraction digits.
     * HALF_UP matches `Intl.NumberFormat`'s default "halfExpand" rounding so ties round away from zero on
     * both platforms (e.g. `1.25` → `1.3`) rather than diverging on the JVM's default banker's rounding.
     */
    internal fun fmtNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = decimals
                maximumFractionDigits = decimals
                roundingMode = RoundingMode.HALF_UP
            }
        return formatter.format(safe)
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a status
 * string, byte count, or uptime — so a diagnostics line can never leak fleet posture.
 */
object HelpersDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (the P3/0245 surface slug `helpers`). */
    const val SLUG: String = "helpers"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
