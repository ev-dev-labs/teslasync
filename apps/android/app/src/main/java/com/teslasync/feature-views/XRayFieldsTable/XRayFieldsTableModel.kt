// Pure, framework-free model + projection for the XRayFieldsTable feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/admin/components/ingest-xray/XRayFieldsTable.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the Ingest X-Ray page) loads the
// `IngestXRayFieldStat[]` for one vehicle/window and passes it down with a `loading` flag. This file owns
// the parts the web component computes from those props: the lifecycle projection of (rows, loading) onto
// the shared cache-then-network [UiState] (so the surface renders every state the P1/S8 layer can carry),
// the four-key sort ladder (`useSortToggle` + the component's own comparator), the `value_kind` → label
// map (`formatValueKind`, the `protomodel.ValueKind` mirror), the relative `last_seen_at` bucketing (web
// `<TimeStamp format="relative" />` → `formatRelative`), the grouped sample-count formatting (web
// `fmtInt`), and the PII-safe `view.opened` diagnostic.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/XRayFieldsTable — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.xrayfieldstable

import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
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

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id, field
 * name or sample value, so a diagnostics line can never leak a telemetry subject or what it is publishing.
 */
const val XRAY_FIELDS_TABLE_SLUG: String = "XRayFieldsTable"

/** Em dash shown for an unparseable `last_seen_at` — the web `formatRelative` invalid-date guard ("—"). */
internal const val EM_DASH: String = "\u2014"

// Column / sort keys — the exact `key` strings the web `Column[]` + `useSortToggle` use, so the hoisted
// [SortState] and the comparator below speak the same vocabulary as the rendered table headers.
const val XRAY_COL_FIELD: String = "field"
const val XRAY_COL_SAMPLE_COUNT: String = "sample_count"
const val XRAY_COL_LAST_SEEN: String = "last_seen_at"
const val XRAY_COL_VALUE_KIND: String = "value_kind"

private const val SECONDS_PER_MINUTE: Long = 60
private const val MINUTES_PER_HOUR: Long = 60
private const val HOURS_PER_DAY: Long = 24
private const val DAYS_PER_WEEK: Long = 7
private const val MILLIS_PER_SECOND: Long = 1_000

/**
 * One render-ready per-field statistic — the native projection of the web `IngestXRayFieldStat`
 * (web/src/types/admin-diagnostics.ts), which mirrors `internal/database/ingest_xray_repo.go`. [valueKind]
 * keeps the raw `protomodel.ValueKind` integer because the web classifies it into a label only at render
 * (via [XRayFieldsTableProjection.formatValueKind]) and sorts on the raw number.
 */
data class IngestXRayFieldStat(
    val field: String,
    val sampleCount: Long,
    val lastSeenAt: String,
    val valueKind: Int,
)

/**
 * Coarse, i18n-friendly bucket for a relative `last_seen_at` — the native shape of the web `formatRelative`
 * ladder. The composable maps each bucket to a localized string (`translation_freshness_*`) so this pure
 * logic carries no English microcopy; [Absolute] mirrors the web `>= 7d` fall-through to an absolute date.
 */
sealed interface XRayLastSeen {
    /** Blank or unparseable timestamp — the web `if (isNaN) return '—'` guard. */
    data object Invalid : XRayLastSeen

    /** Younger than 60 seconds — web `seconds < 60 → 'just now'` (also covers future/clock-skew stamps). */
    data object JustNow : XRayLastSeen

    data class Minutes(
        val value: Long,
    ) : XRayLastSeen

    data class Hours(
        val value: Long,
    ) : XRayLastSeen

    data class Days(
        val value: Long,
    ) : XRayLastSeen

    /** 7 days or older — render an absolute date, the web `formatRelative` fall-through to `formatDate`. */
    data class Absolute(
        val epochMillis: Long,
    ) : XRayLastSeen
}

/**
 * Pure projection from the table's inputs to its render state — a 1:1 port of the web component's
 * derivations. Stateless and side-effect-free so it is fully covered by the off-device unit gate; the
 * composable only resolves localized strings, hoists the sort, and draws what these functions return.
 */
object XRayFieldsTableProjection {
    /**
     * Maps the table's `(rows, loading)` props onto the shared cache-then-network [UiState] (P1/S8),
     * reproducing the web component's two visible outcomes (the `<DataTable>` vs. its `emptyMessage`):
     *  - rows present → [UiPhase.Content] (the table; `loading` has no visible effect once rows exist);
     *  - no rows + loading → [UiPhase.Loading] (the table showing "Loading…");
     *  - no rows + not loading → [UiPhase.Empty] (the "No samples in this window" message).
     *
     * A stateful host can additionally carry refreshing/stale/offline/error; the composable renders those
     * too. This parity adapter only produces the states the web `(rows, loading)` props can express.
     */
    fun projectUiState(
        rows: List<IngestXRayFieldStat>,
        loading: Boolean,
    ): UiState<List<IngestXRayFieldStat>> =
        when {
            rows.isNotEmpty() -> UiState(phase = UiPhase.Content, data = rows)
            loading -> UiState.loading()
            else -> UiState(phase = UiPhase.Empty, data = rows)
        }

    /**
     * Sorts [rows] by [sortState] — the native mirror of the web component's own `[...rows].sort(...)`
     * (not the generic `sortFn`): `field` compares as text, `sample_count`/`value_kind` numerically, and
     * `last_seen_at` by parsed instant; the direction flips for [SortDirection.Desc]. An unknown/`null`
     * key returns the rows unchanged (the web `default: return 0`). The sort is stable.
     */
    fun sortRows(
        rows: List<IngestXRayFieldStat>,
        sortState: SortState,
    ): List<IngestXRayFieldStat> {
        val base: Comparator<IngestXRayFieldStat> =
            when (sortState.key) {
                XRAY_COL_FIELD -> compareBy { it.field }
                XRAY_COL_SAMPLE_COUNT -> compareBy { it.sampleCount }
                XRAY_COL_LAST_SEEN -> compareBy { parseEpochMillisOrNull(it.lastSeenAt) ?: Long.MIN_VALUE }
                XRAY_COL_VALUE_KIND -> compareBy { it.valueKind }
                else -> return rows
            }
        val directed = if (sortState.direction == SortDirection.Asc) base else base.reversed()
        return rows.sortedWith(directed)
    }

    /**
     * Human-readable label for a `value_kind` integer — a verbatim port of the web `formatValueKind`,
     * which mirrors `protomodel.ValueKind` in the Go ingest path. Unknown values (outside this map) render
     * as `kind {n}` so an operator can still cross-reference the raw enum without a UI patch. These are
     * technical wire tokens shown as-is (like the web), not localized UI copy.
     */
    fun formatValueKind(kind: Int): String =
        when (kind) {
            0 -> "unknown"
            1 -> "string"
            2 -> "bool"
            3 -> "int32"
            4 -> "int64"
            5 -> "float32"
            6 -> "float64"
            7 -> "enum"
            8 -> "invalid"
            9 -> "time"
            10 -> "location"
            else -> "kind $kind"
        }

    /**
     * Buckets a `last_seen_at` instant relative to [nowMillis] — the native port of the web `formatRelative`
     * cutoffs: `< 60s` just-now, `< 60m` minutes, `< 24h` hours, `< 7d` days, else an absolute date. A blank
     * or unparseable stamp yields [XRayLastSeen.Invalid] (the web "—"). Floors like the web `Math.floor`;
     * a future/clock-skewed stamp folds to [XRayLastSeen.JustNow], exactly as the web negative-diff path.
     */
    fun lastSeenRelative(
        lastSeenAt: String,
        nowMillis: Long,
    ): XRayLastSeen {
        val epochMillis = parseEpochMillisOrNull(lastSeenAt) ?: return XRayLastSeen.Invalid
        val seconds = Math.floorDiv(nowMillis - epochMillis, MILLIS_PER_SECOND)
        val minutes = seconds / SECONDS_PER_MINUTE
        val hours = minutes / MINUTES_PER_HOUR
        val days = hours / HOURS_PER_DAY
        return when {
            seconds < SECONDS_PER_MINUTE -> XRayLastSeen.JustNow
            minutes < MINUTES_PER_HOUR -> XRayLastSeen.Minutes(minutes)
            hours < HOURS_PER_DAY -> XRayLastSeen.Hours(hours)
            days < DAYS_PER_WEEK -> XRayLastSeen.Days(days)
            else -> XRayLastSeen.Absolute(epochMillis)
        }
    }

    /**
     * Groups a sample count for display — the native mirror of the web `fmtInt` (a locale-aware
     * `Intl.NumberFormat` with 0 fraction digits, e.g. `12_345` → "12,345" in en-US). Negative inputs are
     * clamped to 0 to match the web `safeNumber` guard, since a count is never negative.
     */
    fun formatSampleCount(
        count: Long,
        locale: Locale,
    ): String = NumberFormat.getIntegerInstance(locale).format(count.coerceAtLeast(0))

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields null (the web NaN guard).
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseEpochMillisOrNull(raw: String): Long? =
        if (raw.isBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }?.toEpochMilli()

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Tolerant ISO-8601 → localized "medium date" formatter for the rare `>= 7d` [XRayLastSeen.Absolute] case —
 * the native analogue of the web `formatRelative` fall-through to `formatDate`. Pure (java.time only) so it
 * is unit-tested deterministically with a fixed zone/locale. An [epochMillis] always formats; the parse
 * guard already happened upstream in [XRayFieldsTableProjection.lastSeenRelative].
 */
object XRayLastSeenFormatting {
    fun absolute(
        epochMillis: Long,
        zone: ZoneId,
        locale: Locale,
    ): String =
        DateTimeFormatter
            .ofLocalizedDate(FormatStyle.MEDIUM)
            .withLocale(locale)
            .withZone(zone)
            .format(Instant.ofEpochMilli(epochMillis))
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [XRAY_FIELDS_TABLE_SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordXRayFieldsTableOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to XRAY_FIELDS_TABLE_SLUG))
}
