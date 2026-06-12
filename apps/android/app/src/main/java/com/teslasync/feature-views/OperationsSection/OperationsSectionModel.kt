// Pure, framework-free model + projection for the OperationsSection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/status/OperationsSection.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable
// a thin render layer over these pure functions.
//
// The web component fans three React-Query feeds (notification-stats, the latest notification-logs, and the
// recent audit log) into one accordion section. Its only real derivations are: the delivery success rate
// (`notifStats && total_sent > 0 ? sent / total_sent * 100 : 100`), the header badge variant that buckets
// that rate (success >= 95, warning >= 80, else danger), the gauge color that buckets it the same way, the
// grouped integer / percent labels (web `fmtInt` / `fmtPercent`), the channels ratio label
// (`enabled_channels/total_channels`), and the absolute `created_at` timestamp (web `formatDateTime`). This
// file owns exactly those, plus the projection of the three feeds onto the shared cache-then-network
// [UiState] (P1/S8) so the surface renders every lifecycle the layer can carry, and the PII-safe
// `view.opened` diagnostic (P1/S11).
//
// Faithful nullability: the web renders the notification-logs table whenever the `notifLogs` array is present
// (even if empty, with its own "No recent notifications" empty text) and the friendly "No data available"
// state only when that feed is absent — so [OperationsData.notificationLogs] is nullable to preserve that two
// branch distinction, while [OperationsData.auditLogs] is a plain list because the web only ever renders its
// table when `auditLogs.length > 0`.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/OperationsSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.operationssection

import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object OperationsSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "operations-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "OperationsSection"
}

/** Em dash shown for a blank cell value or an unparseable timestamp — the shared "no value" fallback. */
internal const val EM_DASH: String = "\u2014"

/** One hundred percent — the ratio scale, the gauge maximum, and the default rate when nothing was sent. */
const val PERCENT_MAX: Double = 100.0

/** Success-rate floor (inclusive) for the healthy bucket — the web `successRate >= 95` branch. */
const val SUCCESS_RATE_GOOD: Double = 95.0

/** Success-rate floor (inclusive) for the warning bucket — the web `successRate >= 80` branch. */
const val SUCCESS_RATE_FAIR: Double = 80.0

/** Fraction digits for the percent labels — the web `fmtPercent(successRate, 1)`. */
const val PERCENT_DECIMALS: Int = 1

/** Fraction digits for the grouped integer labels — the web `fmtInt` (zero-decimal). */
private const val INT_DECIMALS: Int = 0

/**
 * Aggregate notification delivery statistics — the native mirror of the web `NotificationStats`
 * (web/src/api/types.ts). All counts are non-negative integers, so `Long`.
 */
data class NotificationStats(
    val totalSent: Long,
    val sent: Long,
    val failed: Long,
    val pending: Long,
    val totalChannels: Long,
    val enabledChannels: Long,
)

/**
 * One render-ready notification delivery-log row — the native projection of the rendered columns of the web
 * `NotificationLog`. Only the columns the table draws are modelled; [status] keeps the raw wire value
 * (`sent` / `failed` / `pending` / `deferred_dnd`) because the render layer classifies its icon + color from
 * it while showing it verbatim.
 */
data class NotificationLogRow(
    val id: Long,
    val status: String,
    val title: String,
    val message: String,
    val createdAt: String,
)

/**
 * One render-ready audit-log row — the native projection of the rendered columns of the web `AuditLog`. Only
 * the columns the table draws are modelled (the web omits `ip`).
 */
data class AuditLogRow(
    val id: Long,
    val createdAt: String,
    val action: String,
    val resource: String,
    val details: String,
)

/**
 * The three feeds the section fans together, as the composable renders them. [stats] gates the entire
 * "Notification Delivery" block (web `{notifStats && (...)}`); [notificationLogs] is nullable so an absent
 * feed renders the friendly "No data available" state while a present-but-empty feed renders the table with
 * its own empty text (web `notifLogs ? <DataTable/> : <EmptyState/>`); [auditLogs] is a plain list because
 * the web only renders its table when it is non-empty (web `auditLogs && auditLogs.length > 0`).
 */
data class OperationsData(
    val stats: NotificationStats?,
    val notificationLogs: List<NotificationLogRow>?,
    val auditLogs: List<AuditLogRow>,
)

/**
 * The delivery-health bucket the success rate falls into — the shared classification behind both the header
 * badge variant (web ternary) and the gauge color (web `successRate >= 95 ? green : >= 80 ? amber : red`).
 * The render layer maps it to a status design token / [BadgeVariant]; the model stays free of Compose color
 * types.
 */
enum class SuccessLevel {
    /** Healthy — the web `>= 95` green band. */
    Good,

    /** Degraded — the web `>= 80` amber band. */
    Fair,

    /** Failing — the web fall-through red band. */
    Poor,
}

/**
 * The pure projection the composable renders — the native mirror of the web component's data derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object OperationsSectionProjection {
    /**
     * The delivery success rate, as a percentage — the web
     * `notifStats && notifStats.total_sent > 0 ? (notifStats.sent / notifStats.total_sent) * 100 : 100`.
     * With no stats or nothing sent the rate is a full [PERCENT_MAX] (the optimistic web default), so the
     * gauge and badge read healthy rather than empty.
     */
    fun successRate(stats: NotificationStats?): Double =
        if (stats != null && stats.totalSent > 0L) {
            PERCENT_MAX * stats.sent / stats.totalSent
        } else {
            PERCENT_MAX
        }

    /**
     * Buckets a success [rate] into its [SuccessLevel] — the web `>= 95` / `>= 80` / else ternary shared by
     * the header badge and the gauge color.
     */
    fun successLevel(rate: Double): SuccessLevel =
        when {
            rate >= SUCCESS_RATE_GOOD -> SuccessLevel.Good
            rate >= SUCCESS_RATE_FAIR -> SuccessLevel.Fair
            else -> SuccessLevel.Poor
        }

    /** The header badge variant for a [level] — the web `success` / `warning` / `danger` ternary. */
    fun badgeVariant(level: SuccessLevel): BadgeVariant =
        when (level) {
            SuccessLevel.Good -> BadgeVariant.Success
            SuccessLevel.Fair -> BadgeVariant.Warning
            SuccessLevel.Poor -> BadgeVariant.Danger
        }

    /** Locale-grouped integer formatting — the web `fmtInt` (grouped, zero-decimal, half-up rounding). */
    fun formatInt(
        value: Long,
        locale: Locale = Locale.getDefault(),
    ): String = numberFormat(INT_DECIMALS, locale).format(value)

    /** Locale-grouped percent formatting — the web `fmtPercent(value, 1)` (`fmtNumber(value, 1)` + `%`). */
    fun formatPercent(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        return numberFormat(PERCENT_DECIMALS, locale).format(safe) + "%"
    }

    /** The "enabled/total" channels label — the web `${enabled_channels}/${total_channels}` (raw, ungrouped). */
    fun channelsLabel(stats: NotificationStats): String = "${stats.enabledChannels}/${stats.totalChannels}"

    /**
     * Whether the section has anything to render — the stats block (web `{notifStats && (...)}`) or at least
     * one audit row (web `auditLogs.length > 0`). The notification-logs feed is only ever shown inside the
     * stats block, so it does not affect emptiness on its own.
     */
    fun hasContent(data: OperationsData): Boolean = data.stats != null || data.auditLogs.isNotEmpty()

    /**
     * Maps the three feeds + a combined `loading` flag onto the shared cache-then-network [UiState] (P1/S8):
     *  - anything to show -> [UiPhase.Content];
     *  - nothing yet + still loading -> [UiPhase.Loading] (the web `isLoading` skeletons);
     *  - nothing + settled -> [UiPhase.Empty] (rendered as the audit log's friendly empty state).
     *
     * The host's stateful binding can additionally carry refreshing/stale/offline/error; the composable
     * renders those too. This parity adapter only produces the states the web `(data, isLoading)` express.
     */
    fun projectUiState(
        data: OperationsData,
        loading: Boolean,
    ): UiState<OperationsData> =
        when {
            hasContent(data) -> UiState(phase = UiPhase.Content, data = data)
            loading -> UiState.loading()
            else -> UiState(phase = UiPhase.Empty, data = data)
        }

    private fun numberFormat(
        decimals: Int,
        locale: Locale,
    ): NumberFormat =
        NumberFormat
            .getNumberInstance(locale)
            .apply {
                minimumFractionDigits = decimals
                maximumFractionDigits = decimals
                roundingMode = RoundingMode.HALF_UP
            }
}

/**
 * Tolerant ISO-8601 -> localized "medium date, short time" formatter — the native analogue of the web
 * `formatDateTime` (`toLocaleString` with `{year, month:'short', day, hour:'2-digit', minute:'2-digit'}`,
 * e.g. "Apr 4, 2026, 2:30 AM"). Pure (java.time only) so it is unit-tested deterministically with a fixed
 * zone/locale. A blank or unparseable input yields [EM_DASH], exactly like the web helper's invalid-date
 * guard.
 */
object OperationsTimeFormatting {
    fun format(
        createdAt: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(createdAt) ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    // Tolerant decode chain: an RFC-3339 instant ("...Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields the em-dash guard above.
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseInstant(raw: String): Instant? = if (raw.isBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [OperationsSectionRegistration.SLUG]
 * (P1/S11). Carries no titles, messages, actors, or resources, so a diagnostics line can never leak fleet
 * posture. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect.
 */
fun recordOperationsSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to OperationsSectionRegistration.SLUG))
}
