// Pure, framework-free model + projection for the Command History dashboard widget — the native
// analogue of the data the web component computes via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/CommandHistoryWidget.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The command log rows carry no display-unit-bearing values
// (ids/strings/timestamps), so there is no SI conversion at this boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/CommandHistoryWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.commandhistory

import io.teslasync.android.components.datadisplay.FreshnessAge
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime

private const val EM_DASH = "\u2014"
private const val COMMA_SPACE = ", "
private const val UNDERSCORE = '_'
private const val SPACE = ' '

// Wire status values, matched verbatim (case-sensitive) against the web `STATUS_MAP` keys and the
// `CompactView` `===` comparisons — an unrecognised/cased value falls through to the default exactly
// as the web `STATUS_MAP[cmd.status] ?? DEFAULT_STATUS` / `lastStatus === 'success'` chain does.
private const val STATUS_SUCCESS = "success"
private const val STATUS_FAILED = "failed"
private const val STATUS_PENDING = "pending"

private const val MILLIS_PER_MINUTE = 60_000L
private const val MINUTES_PER_HOUR = 60L
private const val HOURS_PER_DAY = 24L

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact`
 * branch in the web source: a single column renders the compact last-command row, wider footprints
 * render the newest-first command feed. The feed is always capped at [MAX_FEED_ITEMS] (web `maxItems=10`).
 */
data class CommandHistorySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): show the compact last-command row. */
    val isCompact: Boolean get() = cols <= 1

    companion object {
        /** Maximum feed rows rendered, independent of footprint (web `WidgetEventFeed maxItems={10}`). */
        const val MAX_FEED_ITEMS = 10
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/commands.ts (`command-history`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web
 * grids stay in lockstep.
 */
object CommandHistoryRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "command-history"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "commands"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "CommandHistoryWidget"

    /** Page size the web hook requests (`/commands/history?limit=200`). */
    const val DEFAULT_LIMIT = 200

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize = CommandHistorySize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize = CommandHistorySize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize = CommandHistorySize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: CommandHistorySize): Boolean =
        size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: CommandHistorySize): CommandHistorySize =
        CommandHistorySize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/** Semantic tone for a command-row marker / compact badge; mapped to a concrete token color at render. */
enum class CommandStatusTone { Success, Danger, Warning, Muted }

/** Glyph family for a command-row marker; mapped to a concrete `ImageVector` at the render boundary. */
enum class CommandStatusGlyph { Check, Cross, Clock, Terminal }

/** Badge tone for the compact last-command row (web `Badge` variant success/danger/warning). */
enum class CommandBadgeTone { Success, Danger, Warning }

/**
 * Status → presentation map for one command row — the native port of `STATUS_MAP` / `DEFAULT_STATUS` in
 * the web source. Resolves the glyph (approximating the web Lucide icon) and the semantic tone
 * (approximating the web hex accent: #22c55e success, #ef4444 failed, #f59e0b pending, #6b7280 default).
 * The lookup is case-sensitive and exact, matching the web's bare `STATUS_MAP[cmd.status]` index.
 */
object CommandStatusTokens {
    /** Resolve the (glyph, tone) pair for a wire status string (exact match, web `STATUS_MAP`). */
    fun of(status: String?): Pair<CommandStatusGlyph, CommandStatusTone> =
        when (status) {
            STATUS_SUCCESS -> CommandStatusGlyph.Check to CommandStatusTone.Success
            STATUS_FAILED -> CommandStatusGlyph.Cross to CommandStatusTone.Danger
            STATUS_PENDING -> CommandStatusGlyph.Clock to CommandStatusTone.Warning
            else -> CommandStatusGlyph.Terminal to CommandStatusTone.Muted
        }
}

/**
 * One command audit row decoded from the `/vehicles/{id}/commands/history` JSON array — the native
 * analogue of the web `CommandLogEntry`. Only the fields the widget renders are projected: the [id]
 * (row key), the raw [command] name, the [status], and the raw wire [createdAt] timestamp (parsed on
 * demand, exactly as the web keeps the string). All are null-tolerant so a partial row never throws.
 */
data class CommandLogEntry(
    val id: Long,
    val command: String?,
    val status: String?,
    val createdAt: String?,
) {
    companion object {
        /** Project a `/commands/history` JSON array into a tolerant list of [CommandLogEntry] (web `?? []`). */
        fun parseList(element: JsonElement?): List<CommandLogEntry> =
            (element as? JsonArray)
                ?.mapNotNull { item -> (item as? JsonObject)?.toEntry() }
                ?: emptyList()

        private fun JsonObject.toEntry(): CommandLogEntry =
            CommandLogEntry(
                id = longValue("id") ?: 0L,
                command = stringValue("command"),
                status = stringValue("status"),
                createdAt = stringValue("created_at"),
            )

        private fun JsonObject.longValue(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

        private fun JsonObject.stringValue(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    }
}

/**
 * Coarse, i18n-friendly relative-time bucket for a command row — the native port of the web
 * `WidgetEventFeed.formatRelativeTime` cutoffs: under a minute "just now", under an hour minutes,
 * under a day hours, otherwise the absolute timestamp. The composable maps each bucket to a localized
 * string (or a locale/zone-aware absolute date) so the pure projection carries no microcopy.
 */
sealed interface CommandEventTime {
    /** Present-but-unparseable timestamp — rendered as an em dash. */
    data object Unknown : CommandEventTime

    /** Under one minute old (web `diffMin < 1`). */
    data object JustNow : CommandEventTime

    /** Under one hour old (web `diffMin < 60`), carrying whole minutes. */
    data class MinutesAgo(
        val value: Long,
    ) : CommandEventTime

    /** Under one day old (web `diffHrs < 24`), carrying whole hours. */
    data class HoursAgo(
        val value: Long,
    ) : CommandEventTime

    /** One day or older (web `formatDateTime` fallback), carrying the epoch-millis to format absolutely. */
    data class Absolute(
        val epochMillis: Long,
    ) : CommandEventTime
}

/**
 * One projected, render-ready command row consumed by the feed. Pure data (no Compose types): the
 * resolved marker [glyph]/[tone], the formatted-or-fallback [title]/[subtitle], the [relativeTime]
 * label, and a TalkBack [contentDescription] folding all three into one phrase.
 */
data class CommandRow(
    val id: Long,
    val glyph: CommandStatusGlyph,
    val tone: CommandStatusTone,
    val title: String,
    val subtitle: String,
    val relativeTime: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the command history for one footprint — the native analogue
 * of everything the web component computes before returning JSX (the `feedItems` memo, the `lastEntry`
 * pick, and the compact `CompactView` variant/label). Pure data so the projection is unit-tested without
 * a UI host. The compact fields read the RAW first entry (web `list[0]`), while [items] is the
 * newest-first, capped feed (web `WidgetEventFeed`'s own sort).
 */
data class CommandHistoryDisplay(
    val isCompact: Boolean,
    val hasItems: Boolean,
    val items: List<CommandRow>,
    val compactCommandName: String,
    val compactBadgeTone: CommandBadgeTone,
    val compactBadgeLabel: String,
    val compactContentDescription: String,
)

/**
 * Localized labels + the relative-time formatters the surface folds into its output. The pure
 * [CommandHistoryProjection] reads [successLabel] / [failedLabel] / [pendingLabel] / [formatEventTime] /
 * [emDash]; the composable chrome additionally reads [title] / [emptyMessage] / [refreshLabel] /
 * [refreshingLabel] / [offlineLabel] / [formatRelative]. The composable builds this from `stringResource`
 * + an absolute-date formatter; tests pass a deterministic instance. Keeping i18n out of the projection
 * lets the projection stay a pure, locale-stable function.
 */
data class CommandHistoryStrings(
    val title: String,
    val emptyMessage: String,
    val successLabel: String,
    val failedLabel: String,
    val pendingLabel: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatEventTime: (CommandEventTime) -> String,
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = EM_DASH,
)

/**
 * Pure projection from a decoded list of [CommandLogEntry] to the [CommandHistoryDisplay] — the native
 * port of the web component's `feedItems` memo (status→presentation map, command-name formatting,
 * newest-first sort, ten-row cap), its `lastEntry` pick, and the compact `CompactView` variant/label.
 * [nowMillis] is injected so the relative-time tiers are unit-tested deterministically.
 */
object CommandHistoryProjection {
    /** Project [entries] for [size] at [nowMillis] using the localized [strings]. */
    fun project(
        entries: List<CommandLogEntry>,
        size: CommandHistorySize,
        strings: CommandHistoryStrings,
        nowMillis: Long,
    ): CommandHistoryDisplay {
        // Web parity: the feed re-sorts newest-first and caps at ten, independent of the API order.
        val rows =
            entries
                .sortedByDescending { sortKey(it.createdAt) }
                .take(CommandHistorySize.MAX_FEED_ITEMS)
                .map { entry -> entry.toRow(strings, nowMillis) }

        // Web parity: the compact row reads the RAW first item (web `list[0]`), not the sorted feed head.
        val first = entries.firstOrNull()
        val compactName = formatCommandName(first?.command ?: strings.emDash)
        val badgeTone = compactBadgeTone(first?.status)
        val badgeLabel = compactBadgeLabel(first?.status, strings)

        return CommandHistoryDisplay(
            isCompact = size.isCompact,
            hasItems = rows.isNotEmpty(),
            items = rows,
            compactCommandName = compactName,
            compactBadgeTone = badgeTone,
            compactBadgeLabel = badgeLabel,
            compactContentDescription =
                if (first == null) strings.emptyMessage else "$compactName$COMMA_SPACE$badgeLabel",
        )
    }

    /**
     * The compact `Badge` variant for a status (web `lastStatus === 'success' ? 'success' : === 'failed'
     * ? 'danger' : 'warning'`): exact `success`, exact `failed`, everything else (incl. `pending`) warning.
     */
    fun compactBadgeTone(status: String?): CommandBadgeTone =
        when (status) {
            STATUS_SUCCESS -> CommandBadgeTone.Success
            STATUS_FAILED -> CommandBadgeTone.Danger
            else -> CommandBadgeTone.Warning
        }

    /**
     * Format a raw command name as the web `formatCommandName` does: replace underscores with spaces and
     * upper-case the first character of each word (the web `/\b\w/g → toUpperCase` boundary rule, scoped
     * to ASCII word characters so a value like `remote_start_drive` becomes `Remote Start Drive`).
     */
    fun formatCommandName(raw: String): String {
        val builder = StringBuilder(raw.length)
        var previousWasWord = false
        for (original in raw) {
            val char = if (original == UNDERSCORE) SPACE else original
            val isWord = char.isAsciiWord()
            builder.append(if (isWord && !previousWasWord) char.uppercaseChar() else char)
            previousWasWord = isWord
        }
        return builder.toString()
    }

    /**
     * Bucket a row's wire timestamp into a [CommandEventTime] matching the web
     * `WidgetEventFeed.formatRelativeTime`: an absent timestamp is treated as the epoch (web
     * `created_at ?? new Date(0)`), a present-but-unparseable one as [CommandEventTime.Unknown], and a
     * valid one tiered just-now / minutes / hours / absolute exactly as the web floors the deltas.
     */
    fun computeEventTime(
        createdAt: String?,
        nowMillis: Long,
    ): CommandEventTime {
        val epoch = effectiveEpoch(createdAt) ?: return CommandEventTime.Unknown
        val diffMinutes = (nowMillis - epoch).floorDiv(MILLIS_PER_MINUTE)
        return when {
            diffMinutes < 1L -> CommandEventTime.JustNow
            diffMinutes < MINUTES_PER_HOUR -> CommandEventTime.MinutesAgo(diffMinutes)
            else -> {
                val diffHours = diffMinutes / MINUTES_PER_HOUR
                if (diffHours < HOURS_PER_DAY) {
                    CommandEventTime.HoursAgo(diffHours)
                } else {
                    CommandEventTime.Absolute(epoch)
                }
            }
        }
    }

    private fun CommandLogEntry.toRow(
        strings: CommandHistoryStrings,
        nowMillis: Long,
    ): CommandRow {
        val (glyph, tone) = CommandStatusTokens.of(status)
        val title = formatCommandName(command ?: strings.emDash)
        val subtitle = status ?: strings.emDash
        val relative = strings.formatEventTime(computeEventTime(createdAt, nowMillis))
        return CommandRow(
            id = id,
            glyph = glyph,
            tone = tone,
            title = title,
            subtitle = subtitle,
            relativeTime = relative,
            contentDescription = "$title$COMMA_SPACE$subtitle$COMMA_SPACE$relative",
        )
    }

    private fun compactBadgeLabel(
        status: String?,
        strings: CommandHistoryStrings,
    ): String =
        when (status) {
            STATUS_SUCCESS -> strings.successLabel
            STATUS_FAILED -> strings.failedLabel
            else -> strings.pendingLabel
        }

    // Web `[...items].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))` over `created_at ??
    // new Date(0)`: an absent timestamp sorts as the epoch (1970), a present-but-unparseable one sorts last.
    private fun sortKey(createdAt: String?): Long = parseEpochMillis(createdAt) ?: if (createdAt == null) 0L else Long.MIN_VALUE

    // Web `created_at ?? new Date(0)`: null → epoch; present-but-unparseable → null (→ Unknown).
    private fun effectiveEpoch(createdAt: String?): Long? = if (createdAt == null) 0L else parseEpochMillis(createdAt)

    private fun Char.isAsciiWord(): Boolean = this in 'a'..'z' || this in 'A'..'Z' || this in '0'..'9'
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
