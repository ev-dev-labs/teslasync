// Pure, framework-free model + projection for the DLQ-Inspector EntriesTable feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/admin/components/dlq-inspector/EntriesTable.tsx): the `useSortToggle` comparator
// ladder, the per-cell formatting (TimeStamp absolute, fmtInt, formatBytes, the `||`/`??` em-dash
// fallbacks), the page-size configuration, and the PII-safe `view.opened` diagnostic slug. No Compose, no
// Android, no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/EntriesTable — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.entriestable

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor

/** Em dash shown when a value is missing/unparseable — the web `'—'` (`||` / `??`) fallbacks. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object EntriesTableRegistration {
    /** Stable surface id. */
    const val ID: String = "dlq-entries-table"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no row payload. */
    const val SLUG: String = "EntriesTable"
}

/** Default page size — web `pagination={{ defaultPageSize: 25 }}`. */
const val ENTRIES_DEFAULT_PAGE_SIZE: Int = 25

/** Selectable page sizes — web `pagination={{ pageSizeOptions: [25, 50, 100] }}`. */
val ENTRIES_PAGE_SIZE_OPTIONS: List<Int> = listOf(25, 50, 100)

/**
 * Stable column keys — the native mirror of the web `Column.key` values. Shared by the rendered
 * [io.teslasync.android.components.ui.TableColumn] list, the sort comparator, and the tests so a header
 * key can never drift from the comparator it drives. Only [ARRIVED], [REASON], [VIN], and [PAYLOAD_SIZE]
 * are sortable (web `sortable: true`), matching the web `useSortToggle` switch.
 */
object EntriesColumnKey {
    const val ARRIVED: String = "arrived_at"
    const val REASON: String = "parsed_reason"
    const val VIN: String = "parsed_vin"
    const val SOURCE_TOPIC: String = "parsed_source_topic"
    const val REDELIVERIES: String = "parsed_redeliveries"
    const val PAYLOAD_SIZE: String = "raw_payload_size"
    const val REPLAYABLE: String = "replayable"
    const val ACTIONS: String = "actions"
}

/**
 * One DLQ summary row — the native mirror of the web `DLQEntrySummary`
 * (web/src/types/admin-diagnostics.ts), whose source of truth is the Go `DLQEntrySummary` DTO in
 * `internal/api/dlq_handler.go`. `@Serializable` with snake_case [SerialName]s so a host can decode the
 * shared `DlqStore.list()` `JsonElement` feed (P1/S8) straight into this type — values stay verbatim
 * (the DLQ feed is not unit-bearing, so there is no SI conversion to do). Heavy payload blobs are omitted
 * by the list endpoint, exactly as on the web.
 */
@Serializable
data class DLQEntrySummary(
    @SerialName("id") val id: Long,
    @SerialName("arrived_at") val arrivedAt: String,
    @SerialName("dlq_topic") val dlqTopic: String = "",
    @SerialName("parsed_reason") val parsedReason: String = "",
    @SerialName("parsed_vehicle_id") val parsedVehicleId: Long? = null,
    @SerialName("parsed_vin") val parsedVin: String? = null,
    @SerialName("parsed_source_topic") val parsedSourceTopic: String? = null,
    @SerialName("parsed_redeliveries") val parsedRedeliveries: Int? = null,
    @SerialName("parsed_timestamp") val parsedTimestamp: String? = null,
    @SerialName("parse_error") val parseError: String? = null,
    @SerialName("replayable") val replayable: Boolean = false,
    @SerialName("raw_payload_size") val rawPayloadSize: Long = 0L,
    @SerialName("inner_payload_size") val innerPayloadSize: Long = 0L,
)

/**
 * The already-formatted text for one row's text cells — the native analogue of what each web `render`
 * callback produces (TimeStamp absolute, monospace reason/VIN/topic, fmtInt redeliveries, formatBytes
 * payload) with the web em-dash fallbacks applied. Pure strings so the formatting is unit-tested without a
 * UI host; the composable renders these plus the replayable badge and the Inspect button.
 */
data class EntriesCellText(
    val arrived: String,
    val reason: String,
    val vin: String,
    val sourceTopic: String,
    val redeliveries: String,
    val payload: String,
)

/** A render-ready row: the raw [entry] (for the key + Inspect callback) plus its formatted [cells]. */
data class EntriesRow(
    val entry: DLQEntrySummary,
    val cells: EntriesCellText,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's `sorted` memo and
 * per-cell `render` formatting. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate.
 */
object EntriesTableProjection {
    /**
     * Stable-sorts [rows] by [sortKey] — a 1:1 port of the web component's `[...rows].sort` switch:
     * `arrived_at` by parsed epoch millis, `parsed_reason`/`parsed_vin` lexicographically (a null VIN
     * compares as `""`, web `?? ''`), `raw_payload_size` numerically. An unknown/`null` key (the web
     * `default: return 0`) preserves order. [descending] flips the comparison (web `dir = asc ? 1 : -1`)
     * while keeping ties in their original order, exactly like the web `cmp * dir` on a stable sort.
     */
    fun sortRows(
        rows: List<DLQEntrySummary>,
        sortKey: String?,
        descending: Boolean,
    ): List<DLQEntrySummary> {
        val comparator: Comparator<DLQEntrySummary> =
            when (sortKey) {
                EntriesColumnKey.ARRIVED -> compareBy { EntriesTableTimeFormatting.epochMillis(it.arrivedAt) ?: 0L }
                EntriesColumnKey.REASON -> compareBy { it.parsedReason }
                EntriesColumnKey.VIN -> compareBy { it.parsedVin ?: "" }
                EntriesColumnKey.PAYLOAD_SIZE -> compareBy { it.rawPayloadSize }
                else -> return rows.toList()
            }
        return rows.sortedWith(if (descending) comparator.reversed() else comparator)
    }

    /**
     * Projects one [row] into its [EntriesCellText], reproducing each web `render` callback: the arrived
     * timestamp via the injected [formatArrived] (the web `<TimeStamp format="absolute" />`), the reason
     * with the web `||` empty-string fallback, the VIN/source-topic with the web `??` null fallback, the
     * redeliveries via [fmtInt] when present (web `!= null ? fmtInt : '—'`), and the payload via
     * [formatBytes]. Injecting [formatArrived] keeps this locale/zone-deterministic for tests.
     */
    fun cellTextOf(
        row: DLQEntrySummary,
        formatArrived: (String) -> String,
    ): EntriesCellText =
        EntriesCellText(
            arrived = formatArrived(row.arrivedAt),
            reason = row.parsedReason.ifEmpty { EM_DASH },
            vin = row.parsedVin ?: EM_DASH,
            sourceTopic = row.parsedSourceTopic ?: EM_DASH,
            redeliveries = row.parsedRedeliveries?.let(::fmtInt) ?: EM_DASH,
            payload = formatBytes(row.rawPayloadSize),
        )

    /**
     * Human-readable byte size — a 1:1 port of the web `formatBytes`: a negative/non-finite size yields the
     * em-dash, `< 1 KiB` is shown verbatim as bytes, otherwise KiB/MiB to one decimal (web `toFixed(1)`).
     */
    fun formatBytes(bytes: Long): String =
        when {
            bytes < 0L -> EM_DASH
            bytes < BYTES_PER_KIB -> "$bytes B"
            bytes < BYTES_PER_MIB -> "${oneDecimal(bytes / BYTES_PER_KIB_DOUBLE)} KB"
            else -> "${oneDecimal(bytes / BYTES_PER_MIB_DOUBLE)} MB"
        }

    /**
     * Grouped integer — the native analogue of the web `fmtInt` (`Intl.NumberFormat`, 0 fraction digits)
     * with the default en-US thousands grouping, so a redeliveries count renders `1,234`.
     */
    fun fmtInt(value: Int): String {
        val digits = abs(value.toLong()).toString()
        val grouped =
            buildString {
                val len = digits.length
                for (i in 0 until len) {
                    if (i > 0 && (len - i) % GROUP_SIZE == 0) append(',')
                    append(digits[i])
                }
            }
        return if (value < 0) "-$grouped" else grouped
    }

    // Round half-up to one decimal, locale-neutral ("1.5"), matching JS `Number.toFixed(1)`.
    private fun oneDecimal(value: Double): String {
        val tenths = floor(value * TENTHS + HALF).toLong()
        return "${tenths / TENTHS}.${tenths % TENTHS}"
    }

    private const val BYTES_PER_KIB = 1024L
    private const val BYTES_PER_MIB = 1024L * 1024L
    private const val BYTES_PER_KIB_DOUBLE = 1024.0
    private const val BYTES_PER_MIB_DOUBLE = 1024.0 * 1024.0
    private const val GROUP_SIZE = 3
    private const val TENTHS = 10L
    private const val HALF = 0.5
}

/**
 * Tolerant ISO-8601 timestamp helpers for the arrived column — the native analogue of the web `<TimeStamp
 * format="absolute" />` (a localized medium-date/short-time render) plus the `Date.parse` the sort uses.
 * Pure (java.time only) so it is unit-tested deterministically with a fixed zone/locale; a blank or
 * unparseable input formats to [EM_DASH], mirroring the web TimeStamp's null/invalid `'—'` rendering.
 */
object EntriesTableTimeFormatting {
    /** Absolute "medium date, short time" render in [zone]/[locale]; [EM_DASH] when blank/unparseable. */
    fun format(
        arrivedAt: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(arrivedAt) ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    /** Epoch milliseconds for the sort comparator (web `Date.parse`); `null` when blank/unparseable. */
    fun epochMillis(arrivedAt: String): Long? = parseInstant(arrivedAt)?.toEpochMilli()

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields null (em-dash / 0 sort key).
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
 * Emits the one PII-safe `view.opened` diagnostic with the surface [EntriesTableRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordEntriesTableOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to EntriesTableRegistration.SLUG))
}
