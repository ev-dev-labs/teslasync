// Pure, framework-free model + projection for the Software Update History dashboard widget — the native
// analogue of the data the web component computes via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/SoftwareUpdateHistoryWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a
// thin render layer. The update rows carry no display-unit-bearing values (ids/strings/timestamps), so
// there is no SI conversion at this boundary.
//
// Field-name reconciliation (documented, not silent — Honesty Covenant #9): the web component reads
// `upd.id` / `upd.version` / `upd.status` / `upd.installedAt` / `upd.scheduledAt` / `upd.createdAt` off the
// `camelCaseKeys()`-transformed `/software-updates` document, where every camel alias resolves. The shared
// S7/S8 layer serves that same canonical backend document verbatim (snake_case: `installed_at` /
// `scheduled_at` / `created_at`), so each timestamp field is read web-key-first then falls back to the
// canonical backend key — parity is preserved when a web-named key is present and the surface still renders
// real updates otherwise. The `STATUS_MAP` glyph/accent table, the `DEFAULT_STATUS` fallback, the
// `isCurrent = idx === 0 && status === 'installed'` rule (computed against the RAW list order, then the feed
// is re-sorted newest-first), the `installedAt ?? scheduledAt ?? createdAt ?? epoch` timestamp resolution,
// the version/status em-dash fallbacks, the fifteen-row cap (web `maxItems={15}`), and the compact
// raw-first version+badge pick are reproduced exactly. The web `EventFeedItem.severity` is computed but
// never read by `TimelineItem` (it tints by `color`), so the native row omits that dead field.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/SoftwareUpdateHistoryWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling MediaHistoryWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.softwareupdatehistory

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale

private const val EM_DASH = "\u2014"

// `new Date(0).toISOString()` — the web final-fallback row timestamp when an update carries no
// installed/scheduled/created stamp. Parses to epoch-millis 0 (always older than a day → absolute date).
private const val EPOCH_ISO = "1970-01-01T00:00:00.000Z"

// Wire status values compared case-insensitively, mirroring the web `STATUS_MAP[upd.status]` lookup and the
// `status === 'installed'` current-version test.
private const val STATUS_INSTALLED = "installed"
private const val STATUS_INSTALLING = "installing"
private const val STATUS_DOWNLOADING = "downloading"
private const val STATUS_AVAILABLE = "available"
private const val STATUS_SCHEDULED = "scheduled"

private const val COMMA_SPACE = ", "

// Field keys read from each `/software-updates` row. The first entry in each list is the web component's
// literal (camel) read; the remainder are the canonical snake_case backend keys the shared layer serves.
private val INSTALLED_AT_KEYS = listOf("installedAt", "installed_at")
private val SCHEDULED_AT_KEYS = listOf("scheduledAt", "scheduled_at")
private val CREATED_AT_KEYS = listOf("createdAt", "created_at")

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact`
 * branch in the web source: a single column renders the compact latest-version row, wider footprints render
 * the newest-first update feed. The feed is always capped at [MAX_FEED_ITEMS] (web `maxItems={15}`).
 */
data class SoftwareUpdateHistorySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): show the compact latest-version row. */
    val isCompact: Boolean get() = cols <= 1

    companion object {
        /** Maximum feed rows rendered, independent of footprint (web `WidgetEventFeed maxItems={15}`). */
        const val MAX_FEED_ITEMS = 15
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/vehicle.ts (`software-update-history`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object SoftwareUpdateHistoryRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "software-update-history"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "SoftwareUpdateHistoryWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize = SoftwareUpdateHistorySize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 4 rows. */
    val minSize = SoftwareUpdateHistorySize(cols = 1, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize = SoftwareUpdateHistorySize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: SoftwareUpdateHistorySize): Boolean =
        size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SoftwareUpdateHistorySize): SoftwareUpdateHistorySize =
        SoftwareUpdateHistorySize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/** Semantic accent for an update-row marker; mapped to a concrete token color at the render boundary. */
enum class SoftwareUpdateTone { Installed, Installing, Downloading, Available, Scheduled, Current }

/** Glyph family for an update-row marker; mapped to a concrete `ImageVector` at the render boundary. */
enum class SoftwareUpdateGlyph { Check, ArrowDownCircle, Download, Clock }

/** Badge tone for the compact latest-version chip (web `Badge` variant). */
enum class SoftwareUpdateBadgeTone { Success, Warning, Info }

/**
 * Status → presentation map for one update — the native port of `STATUS_MAP` / `DEFAULT_STATUS` in the web
 * source. Resolves the glyph (approximating the web Lucide icon) and the semantic accent (approximating the
 * web hex color: installed `#22c55e`, installing `#f59e0b`, downloading `#3b82f6`, available `#6b7280`,
 * scheduled `#a78bfa`). Unknown/blank statuses fall back to the download glyph + muted "available" accent
 * (web `DEFAULT_STATUS`).
 */
object SoftwareUpdateStatusTokens {
    /** Resolve the (glyph, tone) pair for a wire status string (case-insensitive, trimmed). */
    fun of(status: String?): Pair<SoftwareUpdateGlyph, SoftwareUpdateTone> =
        when (status?.trim()?.lowercase(Locale.US)) {
            STATUS_INSTALLED -> SoftwareUpdateGlyph.Check to SoftwareUpdateTone.Installed
            STATUS_INSTALLING -> SoftwareUpdateGlyph.ArrowDownCircle to SoftwareUpdateTone.Installing
            STATUS_DOWNLOADING -> SoftwareUpdateGlyph.ArrowDownCircle to SoftwareUpdateTone.Downloading
            STATUS_AVAILABLE -> SoftwareUpdateGlyph.Download to SoftwareUpdateTone.Available
            STATUS_SCHEDULED -> SoftwareUpdateGlyph.Clock to SoftwareUpdateTone.Scheduled
            else -> SoftwareUpdateGlyph.Download to SoftwareUpdateTone.Available
        }

    /** The compact-chip badge tone (web `installed ? 'success' : installing ? 'warning' : 'info'`). */
    fun badgeToneFor(status: String?): SoftwareUpdateBadgeTone =
        when (status?.trim()?.lowercase(Locale.US)) {
            STATUS_INSTALLED -> SoftwareUpdateBadgeTone.Success
            STATUS_INSTALLING -> SoftwareUpdateBadgeTone.Warning
            else -> SoftwareUpdateBadgeTone.Info
        }

    /** Whether a wire status is "installed" (case-insensitive) — the web current-version test. */
    fun isInstalled(status: String?): Boolean = status?.trim()?.lowercase(Locale.US) == STATUS_INSTALLED
}

/**
 * One software-update row decoded from the `/software-updates` JSON array — the native analogue of the
 * loosely-typed `SoftwareUpdate` the web widget reads. Only the fields the widget renders are projected:
 * the [id] (row key), the [version]/[status] strings, and the raw wire [installedAt]/[scheduledAt]/
 * [createdAt] stamps (resolved on demand to one effective timestamp, exactly as the web `??` chain does).
 * All but [id] are nullable so a partial row never throws; each timestamp is read web-key-first then
 * canonical-backend-key (see file header).
 */
data class SoftwareUpdateEntry(
    val id: Long,
    val version: String?,
    val status: String?,
    val installedAt: String?,
    val scheduledAt: String?,
    val createdAt: String?,
) {
    /** The row timestamp the web computes: `installedAt ?? scheduledAt ?? createdAt ?? new Date(0)`. */
    val effectiveTimestamp: String get() = installedAt ?: scheduledAt ?: createdAt ?: EPOCH_ISO

    companion object {
        /** Project a `/software-updates` JSON array into a tolerant list (web `select: safeArray`). */
        fun parseList(element: JsonElement?): List<SoftwareUpdateEntry> =
            (element as? JsonArray)
                ?.mapNotNull { item -> (item as? JsonObject)?.toEntry() }
                ?: emptyList()

        private fun JsonObject.toEntry(): SoftwareUpdateEntry =
            SoftwareUpdateEntry(
                id = longValue("id") ?: 0L,
                version = stringValue("version"),
                status = stringValue("status"),
                installedAt = firstStringOf(INSTALLED_AT_KEYS),
                scheduledAt = firstStringOf(SCHEDULED_AT_KEYS),
                createdAt = firstStringOf(CREATED_AT_KEYS),
            )

        private fun JsonObject.longValue(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

        private fun JsonObject.stringValue(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

        // Reads the first key that yields a JSON string, mirroring the web read with a canonical fallback.
        private fun JsonObject.firstStringOf(keys: List<String>): String? = keys.firstNotNullOfOrNull { stringValue(it) }
    }
}

/**
 * Coarse, i18n-friendly relative-time bucket for an update row — the native port of the web
 * `WidgetEventFeed.formatRelativeTime` cutoffs: under a minute "just now", under an hour minutes, under a
 * day hours, otherwise the absolute timestamp. The composable maps each bucket to a localized string (or a
 * locale/zone-aware absolute date) so the pure projection carries no microcopy.
 */
sealed interface SoftwareUpdateEventTime {
    /** Present-but-unparseable timestamp — rendered as an em dash. */
    data object Unknown : SoftwareUpdateEventTime

    /** Under one minute old (web `diffMin < 1`). */
    data object JustNow : SoftwareUpdateEventTime

    /** Under one hour old (web `diffMin < 60`), carrying whole minutes. */
    data class MinutesAgo(
        val value: Long,
    ) : SoftwareUpdateEventTime

    /** Under one day old (web `diffHrs < 24`), carrying whole hours. */
    data class HoursAgo(
        val value: Long,
    ) : SoftwareUpdateEventTime

    /** One day or older (web `formatDateTime` fallback), carrying the epoch-millis to format absolutely. */
    data class Absolute(
        val epochMillis: Long,
    ) : SoftwareUpdateEventTime
}

/**
 * One projected, render-ready update row consumed by the feed. Pure data (no Compose types): the resolved
 * marker [glyph]/[tone], the visible [title] (the version, web em-dash-defaulted), the [subtitle] (the
 * "Current" label for the current version, otherwise the status), the [relativeTime] label, and a TalkBack
 * [contentDescription] folding version, status/current, and time into one phrase.
 */
data class SoftwareUpdateRow(
    val id: Long,
    val glyph: SoftwareUpdateGlyph,
    val tone: SoftwareUpdateTone,
    val title: String,
    val subtitle: String,
    val relativeTime: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the update history for one footprint — the native analogue of
 * everything the web component computes before returning JSX (the `feedItems` memo and the `latest` /
 * `CompactView` pick). Pure data so the projection is unit-tested without a UI host. The compact fields read
 * the RAW first entry (web `list[0]`), while [items] is the newest-first, capped feed (web `WidgetEventFeed`
 * re-sorts by timestamp).
 */
data class SoftwareUpdateHistoryDisplay(
    val isCompact: Boolean,
    val hasItems: Boolean,
    val items: List<SoftwareUpdateRow>,
    val compactVersion: String,
    val compactBadgeText: String,
    val compactBadgeTone: SoftwareUpdateBadgeTone,
    val compactContentDescription: String,
)

/**
 * Localized labels + the relative-time formatters the surface folds into its output. The pure
 * [SoftwareUpdateHistoryProjection] reads [currentLabel] / [formatStatus] / [formatEventTime] / [emDash];
 * the composable chrome additionally reads [title] / [emptyMessage] / [refreshLabel] / [refreshingLabel] /
 * [offlineLabel] / [formatRelative]. The composable builds this from `stringResource` + an absolute-date
 * formatter; tests pass a deterministic instance. Keeping i18n out of the projection lets the projection
 * stay a pure, locale-stable function.
 */
data class SoftwareUpdateHistoryStrings(
    val title: String,
    val currentLabel: String,
    val emptyMessage: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatStatus: (String) -> String,
    val formatEventTime: (SoftwareUpdateEventTime) -> String,
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = EM_DASH,
)

/**
 * Pure projection from a decoded list of [SoftwareUpdateEntry] to the [SoftwareUpdateHistoryDisplay] — the
 * native port of the web component's `feedItems` memo (version/status/current derivation, the
 * `installedAt ?? scheduledAt ?? createdAt ?? epoch` timestamp, the newest-first sort, the fifteen-row cap)
 * and the compact `CompactView` pick. [nowMillis] is injected so the relative-time tiers are unit-tested
 * deterministically.
 */
object SoftwareUpdateHistoryProjection {
    /** Project [entries] for [size] at [nowMillis] using the localized [strings]. */
    fun project(
        entries: List<SoftwareUpdateEntry>,
        size: SoftwareUpdateHistorySize,
        strings: SoftwareUpdateHistoryStrings,
        nowMillis: Long,
    ): SoftwareUpdateHistoryDisplay {
        // Web parity: `isCurrent = idx === 0 && status === 'installed'` is decided against the RAW list
        // order; the feed is then re-sorted newest-first and capped, independent of the API order.
        val rows =
            entries
                .mapIndexed { index, entry -> entry.toRow(rawIndex = index, strings = strings, nowMillis = nowMillis) }
                .sortedByDescending { it.sortKey }
                .take(SoftwareUpdateHistorySize.MAX_FEED_ITEMS)
                .map { it.row }

        // Web parity: the compact row reads the RAW first item (web `list[0]`), not the sorted feed head.
        val latest = entries.firstOrNull()
        val compactVersion = latest?.version ?: strings.emDash
        val compactStatus = latest?.status
        val installed = SoftwareUpdateStatusTokens.isInstalled(compactStatus)
        val compactBadgeText =
            if (installed) {
                strings.currentLabel
            } else {
                strings.formatStatus(compactStatus ?: strings.emDash)
            }

        return SoftwareUpdateHistoryDisplay(
            isCompact = size.isCompact,
            hasItems = rows.isNotEmpty(),
            items = rows,
            compactVersion = compactVersion,
            compactBadgeText = compactBadgeText,
            compactBadgeTone = SoftwareUpdateStatusTokens.badgeToneFor(compactStatus),
            compactContentDescription = "$compactVersion$COMMA_SPACE$compactBadgeText",
        )
    }

    /**
     * Bucket a row's resolved wire timestamp into a [SoftwareUpdateEventTime] matching the web
     * `WidgetEventFeed.formatRelativeTime`: a present-but-unparseable timestamp is [SoftwareUpdateEventTime.Unknown],
     * and a valid one is tiered just-now / minutes / hours / absolute exactly as the web floors the deltas.
     * The resolved timestamp is never null (the web `?? new Date(0)` final fallback), so an update with no
     * stamps renders the epoch as an absolute date.
     */
    fun computeEventTime(
        timestamp: String,
        nowMillis: Long,
    ): SoftwareUpdateEventTime {
        val epoch = parseEpochMillis(timestamp) ?: return SoftwareUpdateEventTime.Unknown
        val diffMinutes = (nowMillis - epoch).floorDiv(MILLIS_PER_MINUTE)
        return when {
            diffMinutes < 1L -> SoftwareUpdateEventTime.JustNow
            diffMinutes < MINUTES_PER_HOUR -> SoftwareUpdateEventTime.MinutesAgo(diffMinutes)
            else -> {
                val diffHours = diffMinutes / MINUTES_PER_HOUR
                if (diffHours < HOURS_PER_DAY) {
                    SoftwareUpdateEventTime.HoursAgo(diffHours)
                } else {
                    SoftwareUpdateEventTime.Absolute(epoch)
                }
            }
        }
    }

    private fun SoftwareUpdateEntry.toRow(
        rawIndex: Int,
        strings: SoftwareUpdateHistoryStrings,
        nowMillis: Long,
    ): ProjectedRow {
        val isCurrent = rawIndex == 0 && SoftwareUpdateStatusTokens.isInstalled(status)
        val (mappedGlyph, mappedTone) = SoftwareUpdateStatusTokens.of(status)
        val glyph = if (isCurrent) SoftwareUpdateGlyph.Check else mappedGlyph
        val tone = if (isCurrent) SoftwareUpdateTone.Current else mappedTone
        val version = version ?: strings.emDash
        val subtitle = if (isCurrent) strings.currentLabel else (status ?: strings.emDash)
        val relative = strings.formatEventTime(computeEventTime(effectiveTimestamp, nowMillis))
        return ProjectedRow(
            sortKey = parseEpochMillis(effectiveTimestamp) ?: Long.MIN_VALUE,
            row =
                SoftwareUpdateRow(
                    id = id,
                    glyph = glyph,
                    tone = tone,
                    title = version,
                    subtitle = subtitle,
                    relativeTime = relative,
                    contentDescription = listOf(version, subtitle, relative).joinToString(COMMA_SPACE),
                ),
        )
    }

    // Pairs a row with its newest-first sort key so the web `sort` runs once over resolved timestamps.
    private data class ProjectedRow(
        val sortKey: Long,
        val row: SoftwareUpdateRow,
    )

    private const val MILLIS_PER_MINUTE = 60_000L
    private const val MINUTES_PER_HOUR = 60L
    private const val HOURS_PER_DAY = 24L
}

/**
 * Tolerant ISO-8601 → epoch-millis parse for a wire timestamp (the web keeps the raw string and parses on
 * demand). Returns `null` for a blank/absent or unparseable value so a partial row never throws.
 */
internal fun parseEpochMillis(raw: String?): Long? {
    if (raw.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(raw).toEpochMilli() }
        .getOrNull()
}

/**
 * The active vehicle id the widget reads update history for — the native port of the web
 * `vid = vehicleId ?? vehicles?.[0]?.id`. A positive [preferredVehicleId] wins; otherwise the first enrolled
 * vehicle is used; `null` means neither is available (the surface shows its empty state).
 */
fun resolveVehicleId(
    preferredVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = preferredVehicleId?.takeIf { it > 0L } ?: firstVehicleId(vehicles)

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty. */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
