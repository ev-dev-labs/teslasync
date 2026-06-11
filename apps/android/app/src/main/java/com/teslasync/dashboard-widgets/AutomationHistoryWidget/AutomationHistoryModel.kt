// Pure, framework-free model + projection for the Automation History dashboard widget — the native
// analogue of the data the web component computes via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/AutomationHistoryWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/AutomationHistoryWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.automationhistory

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.shared.core.presentation.automations.AutomationHistory
import io.teslasync.shared.core.presentation.automations.AutomationHistoryListResponse
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale

private const val EM_DASH = "\u2014"
private const val MIDDLE_DOT = "\u00b7"
private const val MILLIS_PER_SECOND = 1_000.0

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact`
 * branch in the web source: a single column renders the success-rate hero, wider footprints render the
 * success-rate header above the run feed. The feed is always capped at [MAX_FEED_ITEMS] (web `maxItems=10`).
 */
data class AutomationHistorySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): show the compact success-rate hero. */
    val isCompact: Boolean get() = cols <= 1

    companion object {
        /** Maximum feed rows rendered, independent of footprint (web `maxItems={10}`). */
        const val MAX_FEED_ITEMS = 10
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/automations.ts. A dashboard grid host binds this surface
 * with the same [ID] and honours the same min/max footprint, so the native + web grids stay in lockstep.
 */
object AutomationHistoryRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "automation-history"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "automations"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "AutomationHistoryWidget"

    /** Page size the web hook requests (`useAutomationHistory(20)`). */
    const val DEFAULT_LIMIT = 20

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize = AutomationHistorySize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize = AutomationHistorySize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize = AutomationHistorySize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: AutomationHistorySize): Boolean =
        size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: AutomationHistorySize): AutomationHistorySize =
        AutomationHistorySize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/** Semantic tone for a run-row marker; mapped to a concrete token color at the render boundary. */
enum class AutomationRunTone { Success, Danger, Warning, Info, Accent, Muted }

/** Glyph family for a run-row marker; mapped to a concrete `ImageVector` at the render boundary. */
enum class AutomationRunGlyph { Check, Cross, Clock, Play }

/** Badge tone for the success-rate header (web `Badge` variant). */
enum class SuccessRateTone { Success, Warning, Danger }

/**
 * Status → presentation map for one automation run — the native port of `STATUS_MAP` /`DEFAULT_STATUS`
 * in the web source. Resolves the glyph (approximating the web Lucide icon) and the semantic tone
 * (approximating the web hex accent). Unknown statuses fall back to the play glyph + muted tone.
 */
object AutomationRunStatusTokens {
    /** Resolve the (glyph, tone) pair for a wire status string (case-insensitive, trimmed). */
    fun of(status: String?): Pair<AutomationRunGlyph, AutomationRunTone> =
        when (status?.trim()?.lowercase(Locale.US)) {
            "success" -> AutomationRunGlyph.Check to AutomationRunTone.Success
            "failed" -> AutomationRunGlyph.Cross to AutomationRunTone.Danger
            "partial" -> AutomationRunGlyph.Clock to AutomationRunTone.Warning
            "running" -> AutomationRunGlyph.Clock to AutomationRunTone.Info
            "skipped" -> AutomationRunGlyph.Clock to AutomationRunTone.Muted
            "cancelled" -> AutomationRunGlyph.Cross to AutomationRunTone.Muted
            "test" -> AutomationRunGlyph.Play to AutomationRunTone.Accent
            "undo" -> AutomationRunGlyph.Clock to AutomationRunTone.Muted
            else -> AutomationRunGlyph.Play to AutomationRunTone.Muted
        }
}

/**
 * One projected, render-ready run row consumed by the feed. Pure data (no Compose types): the resolved
 * marker [glyph]/[tone], the localized-or-fallback [title]/[subtitle], the [relativeTime] label, and a
 * TalkBack [contentDescription] folding all three into one phrase.
 */
data class AutomationRunRow(
    val id: Long,
    val glyph: AutomationRunGlyph,
    val tone: AutomationRunTone,
    val title: String,
    val subtitle: String,
    val relativeTime: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the run history for one footprint — the native analogue of
 * everything the web component computes before returning JSX. Pure data so the projection is unit-tested
 * without a UI host.
 */
data class AutomationHistoryDisplay(
    val isCompact: Boolean,
    val hasItems: Boolean,
    val items: List<AutomationRunRow>,
    val successRateText: String,
    val compactValueText: String,
    val successRateLabel: String,
    val badgeText: String,
    val successRateTone: SuccessRateTone,
    val totalRunsText: String,
    val lastRunRelative: String,
    val compactContentDescription: String,
)

/**
 * Localized labels + the relative-time formatter the surface folds into its output. The pure
 * [AutomationHistoryProjection] reads [successRateLabel] / [runsWord] / [formatRelative] / [emDash]; the
 * composable chrome additionally reads [title] / [refreshLabel] / [refreshingLabel] / [offlineLabel]. The
 * composable builds this from `stringResource`; tests pass a deterministic instance. Keeping i18n out of
 * the projection lets the projection stay a pure, locale-stable function.
 */
data class AutomationHistoryStrings(
    val title: String,
    val successRateLabel: String,
    val runsWord: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = EM_DASH,
)

/**
 * Pure projection from a decoded [AutomationHistoryListResponse] to the [AutomationHistoryDisplay] — the
 * native port of the `feedItems` / `successRate` `useMemo` work plus the compact branch in the web source.
 * The success rate is dimensionless (no SI conversion); [nowMillis] is injected so relative-time tiers are
 * unit-tested deterministically.
 */
object AutomationHistoryProjection {
    /** Success rate at/above which the badge is success-toned (web `successRate >= 90`). */
    const val HIGH_SUCCESS_THRESHOLD = 90.0

    /** Success rate at/above which the badge is warning-toned (web `successRate >= 50`). */
    const val MID_SUCCESS_THRESHOLD = 50.0

    /** Project [response] for [size] at [nowMillis] using the localized [strings]. */
    fun project(
        response: AutomationHistoryListResponse,
        size: AutomationHistorySize,
        strings: AutomationHistoryStrings,
        nowMillis: Long,
    ): AutomationHistoryDisplay {
        val summary = response.summary
        val successRate = summary.successRate
        val successRateText = formatNumber(successRate, decimals = 1)
        val compactValueText = "$successRateText%"
        val badgeText = "$compactValueText ${strings.successRateLabel}"
        val totalRunsText = "${formatInt(summary.totalExecutions)} ${strings.runsWord}"

        val rows = projectRows(response.items, strings, nowMillis)
        val lastRunRelative = lastRunRelative(response.items, strings, nowMillis)
        val compactContentDescription =
            if (lastRunRelative.isEmpty()) {
                badgeText
            } else {
                "$badgeText, $lastRunRelative"
            }

        return AutomationHistoryDisplay(
            isCompact = size.isCompact,
            hasItems = rows.isNotEmpty(),
            items = rows,
            successRateText = successRateText,
            compactValueText = compactValueText,
            successRateLabel = strings.successRateLabel,
            badgeText = badgeText,
            successRateTone = successRateToneFor(successRate),
            totalRunsText = totalRunsText,
            lastRunRelative = lastRunRelative,
            compactContentDescription = compactContentDescription,
        )
    }

    /** The web badge variant tone for a success rate (success ≥ 90, warning ≥ 50, else danger). */
    fun successRateToneFor(rate: Double): SuccessRateTone =
        when {
            rate >= HIGH_SUCCESS_THRESHOLD -> SuccessRateTone.Success
            rate >= MID_SUCCESS_THRESHOLD -> SuccessRateTone.Warning
            else -> SuccessRateTone.Danger
        }

    /**
     * Format a millisecond duration as the web `formatDurationMs` does: the em-dash for a null value,
     * "{ms}ms" below one second, otherwise "{s}s" with one decimal.
     */
    fun formatDurationMs(ms: Long?): String {
        if (ms == null) return EM_DASH
        return if (ms < MILLIS_PER_SECOND) {
            "${ms}ms"
        } else {
            "${formatNumber(ms / MILLIS_PER_SECOND, decimals = 1)}s"
        }
    }

    /**
     * Locale-stable decimal formatter (web `fmtNumber`): grouped thousands and a fixed number of fraction
     * digits. Uses [Locale.US] grouping/decimal symbols so the output is deterministic and matches the
     * web default (which falls back to en-US when no locale is supplied).
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
    ): String = groupedFormat(decimals).format(value)

    /** Locale-stable integer formatter (web `fmtInt`). */
    fun formatInt(value: Long): String = groupedFormat(decimals = 0).format(value)

    private fun groupedFormat(decimals: Int): DecimalFormat {
        val pattern = if (decimals > 0) "#,##0." + "0".repeat(decimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US))
    }

    private fun projectRows(
        items: List<AutomationHistory>,
        strings: AutomationHistoryStrings,
        nowMillis: Long,
    ): List<AutomationRunRow> =
        items
            .sortedByDescending { parseEpochMillis(it.triggeredAt) ?: Long.MIN_VALUE }
            .take(AutomationHistorySize.MAX_FEED_ITEMS)
            .map { entry -> projectRow(entry, strings, nowMillis) }

    private fun projectRow(
        entry: AutomationHistory,
        strings: AutomationHistoryStrings,
        nowMillis: Long,
    ): AutomationRunRow {
        val (glyph, tone) = AutomationRunStatusTokens.of(entry.status)
        val title = entry.automationName.ifBlank { strings.emDash }
        val statusLabel = entry.status.ifBlank { strings.emDash }
        val duration = formatDurationMs(entry.durationMs)
        val relative = formatRelative(entry.triggeredAt, strings, nowMillis)
        return AutomationRunRow(
            id = entry.id,
            glyph = glyph,
            tone = tone,
            title = title,
            subtitle = "$statusLabel $MIDDLE_DOT $duration",
            relativeTime = relative,
            contentDescription = "$title, $statusLabel, $relative",
        )
    }

    private fun lastRunRelative(
        items: List<AutomationHistory>,
        strings: AutomationHistoryStrings,
        nowMillis: Long,
    ): String {
        // Web parity: the compact hero reads the raw first item (items[0]), not the sorted feed head.
        val first = items.firstOrNull()
        return if (first == null || first.triggeredAt.isBlank()) {
            ""
        } else {
            formatRelative(first.triggeredAt, strings, nowMillis)
        }
    }

    private fun formatRelative(
        triggeredAt: String,
        strings: AutomationHistoryStrings,
        nowMillis: Long,
    ): String {
        val ageSeconds = computeAgeSeconds(parseEpochMillis(triggeredAt), nowMillis)
        return strings.formatRelative(relativeAge(ageSeconds))
    }
}

/**
 * Tolerant ISO-8601 → epoch-millis parse for a wire timestamp (the web keeps the raw string and parses
 * on demand). Returns `null` for a blank/absent or unparseable value so a partial row never throws.
 */
internal fun parseEpochMillis(raw: String?): Long? {
    if (raw.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(raw).toEpochMilli() }
        .getOrNull()
}
