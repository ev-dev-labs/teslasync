// Pure, framework-free model + projection for the Safety History dashboard widget — the native analogue
// of the data the web component computes via `classifySnapshot` / `buildSubtitle` / the `feedItems` +
// `stats` `useMemo`s before returning JSX (web/src/features/dashboard/widgets/SafetyHistoryWidget.tsx).
// No Compose, no Android, no HTTP: every type here is unit-tested off-device in the
// :app:testReleaseUnitTest gate, keeping the composable a thin render layer. The event rows carry no
// display-unit-bearing values (ids/strings/timestamps/counts), so there is no SI conversion at this
// boundary — the 30-day window is a wall-clock span, not a measurement.
//
// Faithful-parity reconciliation (documented, not silent — Honesty Covenant #9): the web source routes
// only nine strings through i18n (`widget.safetyHistory`, `widget.safetyEvents`, `widget.noSafetyEvents`,
// `widget.safetyTotal`, `widget.safetyMostCommon`, `widget.safetyTrend`, `widget.trend{Up,Down,Flat}`) —
// all present in the P1/S10 catalog. The event titles ("AEB Activation", "FCW: …", …), the "Most Common"
// type labels ("AEB", "FCW", …), and the subtitle fragments ("Speed Limit: ", "Follow: ", "PIN to Drive")
// are NOT i18n keys in the web source: they are data-derived ADAS classification strings the web hardcodes,
// mirrored here verbatim as constants exactly as the sibling MediaHistory/AutomationHistory surfaces mirror
// their data-derived labels. Adding catalog keys the web lacks would be drift, so they stay verbatim.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/SafetyHistoryWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling MediaHistoryWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.safetyhistory

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale

private const val EM_DASH = "\u2014"
private const val MIDDLE_DOT = "\u00b7"

// Verbatim web content strings (see the file header reconciliation note). The classifier titles:
private const val TITLE_AEB = "AEB Activation"
private const val TITLE_BLIND_SPOT = "Blind Spot Warning"
private const val TITLE_EMERGENCY_LANE = "Emergency Lane Departure Avoidance"
private const val TITLE_GENERAL = "Safety State Update"
private const val PREFIX_FCW = "FCW: "
private const val PREFIX_LANE = "Lane Departure: "

// Verbatim web subtitle fragments (`buildSubtitle`).
private const val LABEL_SPEED_LIMIT = "Speed Limit: "
private const val LABEL_FOLLOW = "Follow: "
private const val LABEL_PIN_TO_DRIVE = "PIN to Drive"

// Verbatim web boolean-enum renderings (`cleanSafetyEnum`).
private const val ON = "On"
private const val OFF = "Off"
private const val NONE = "None"

// The literal "(30d)" window suffix the web appends to the compact event count.
private const val WINDOW_SUFFIX = " (30d)"

private const val MILLIS_PER_MINUTE = 60_000L
private const val MINUTES_PER_HOUR = 60L
private const val HOURS_PER_DAY = 24L
private const val THIRTY_DAYS_MILLIS = 30L * 24 * 60 * 60 * 1000
private const val SIXTY_DAYS_MILLIS = 60L * 24 * 60 * 60 * 1000

// Wire field keys read from each `/safety` history row (snake_case, served verbatim by the shared layer).
private const val KEY_ID = "id"
private const val KEY_CREATED_AT = "created_at"
private const val KEY_AEB_OFF = "automatic_emergency_braking_off"
private const val KEY_FCW = "forward_collision_warning"
private const val KEY_LANE = "lane_departure_avoidance"
private const val KEY_BLIND_SPOT = "blind_spot_collision_warning"
private const val KEY_EMERGENCY_LANE = "emergency_lane_departure_avoidance"
private const val KEY_SPEED_LIMIT = "speed_limit_warning"
private const val KEY_FOLLOW = "cruise_follow_distance"
private const val KEY_PIN_TO_DRIVE = "pin_to_drive_enabled"

// The "disabled" enum tokens (lower-cased) the web treats as an inactive ADAS feature.
private val INACTIVE_ENUM_TOKENS = setOf("off", "none", "disabled", "0")

/**
 * The Tesla raw enum prefixes stripped for old `signal_log` rows — the native port of the web
 * `SAFETY_ENUM_PREFIXES` table (web/src/lib/safetyEnum.ts). Keyed by the wire field so the classifier and
 * subtitle reads strip the right vendor prefix (e.g. `ForwardCollisionSensitivityLate` → `Late`).
 */
enum class SafetyEnumField(
    val prefix: String,
) {
    ForwardCollisionWarning("ForwardCollisionSensitivity"),
    LaneDepartureAvoidance("LaneAssistLevel"),
    SpeedLimitWarning("SpeedAssistLevel"),
    CruiseFollowDistance("FollowDistance"),
}

/**
 * A raw `/safety` enum value whose runtime JSON shape the backend does not constrain — the native port of
 * the web `unknown` the `cleanSafetyEnum` / `isSafetyEnumActive` helpers narrow. The backend serializes raw
 * `signal.SignalValue` directly, so an ADAS field can arrive as a native boolean (a disabled toggle), a
 * native number (legacy `signal_log` rows), or the typed/stripped enum string. Modelling the three shapes
 * explicitly is what lets the helpers avoid the web's forbidden `String(value)` coercion.
 */
sealed interface SafetyValue {
    /** A native JSON boolean (`true`/`false`). */
    data class BoolValue(
        val value: Boolean,
    ) : SafetyValue

    /** A native JSON number (e.g. legacy `cruise_follow_distance = 3.0`). */
    data class NumberValue(
        val value: Double,
    ) : SafetyValue

    /** A JSON string (typed enum `"FollowDistance3"` or codec-stripped suffix `"3"`). */
    data class StringValue(
        val value: String,
    ) : SafetyValue

    /** Absent, JSON null, or a non-primitive value — the web `null`/`undefined` case. */
    data object Absent : SafetyValue
}

/** Glyph family for an event-row / header marker; mapped to a concrete `ImageVector` at the render boundary. */
enum class SafetyEventGlyph { AlertOctagon, ShieldAlert, Navigation, CarFront, AlertTriangle }

/** Semantic tone for an event-row marker; mapped to a concrete token color at the render boundary. */
enum class SafetyEventTone { Critical, Warning, Info, Muted }

/** Event severity (web `'info' | 'warning' | 'critical'`); carried for parity + a11y, not a visual axis. */
enum class SafetyEventSeverity { Info, Warning, Critical }

/**
 * The ADAS event classes the web `classifySnapshot` resolves, each carrying its stable [typeId] (the web
 * `type` string, used for the "Most Common" tally), the [shortLabel] (the web `typeLabels` entry), and the
 * marker [glyph] / [tone] / [severity]. The per-event title is computed by [SafetyHistoryProjection]
 * because the FCW/Lane titles fold in the cleaned enum value.
 */
enum class SafetyEventType(
    val typeId: String,
    val shortLabel: String,
    val glyph: SafetyEventGlyph,
    val tone: SafetyEventTone,
    val severity: SafetyEventSeverity,
) {
    Aeb("aeb", "AEB", SafetyEventGlyph.AlertOctagon, SafetyEventTone.Critical, SafetyEventSeverity.Critical),
    Fcw("fcw", "FCW", SafetyEventGlyph.ShieldAlert, SafetyEventTone.Warning, SafetyEventSeverity.Warning),
    Lane("lane", "Lane Departure", SafetyEventGlyph.Navigation, SafetyEventTone.Info, SafetyEventSeverity.Warning),
    Bsw("bsw", "Blind Spot", SafetyEventGlyph.CarFront, SafetyEventTone.Warning, SafetyEventSeverity.Warning),
    Elda("elda", "Emergency Lane", SafetyEventGlyph.AlertTriangle, SafetyEventTone.Critical, SafetyEventSeverity.Critical),
    General("general", "General", SafetyEventGlyph.AlertOctagon, SafetyEventTone.Muted, SafetyEventSeverity.Info),
}

/**
 * The 30-vs-60-day trend of recent safety events — the native port of the web `trend` string. [symbol]
 * is the exact arrow/em-dash the web renders as the "Trend" stat value; the composable maps the variant to
 * the localized "Increasing"/"Decreasing"/"Stable" sublabel.
 */
enum class SafetyTrend(
    val symbol: String,
) {
    /** More events in the last 30 days than the prior 30 (web `'↑'`). */
    Up("\u2191"),

    /** Fewer events in the last 30 days than the prior 30 (web `'↓'`). */
    Down("\u2193"),

    /** Equal counts across both windows (web `'→'`). */
    Flat("\u2192"),

    /** No prior-window baseline to compare against (web default `'—'`). */
    Unknown(EM_DASH),
}

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact`
 * branch in the web source: a single column renders the compact 30-day count, wider footprints render the
 * three-stat header above the event feed. The feed is always capped at [MAX_FEED_ITEMS] (web `maxItems=10`).
 */
data class SafetyHistorySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): show the compact 30-day count. */
    val isCompact: Boolean get() = cols <= 1

    companion object {
        /** Maximum feed rows rendered, independent of footprint (web `WidgetEventFeed maxItems={10}`). */
        const val MAX_FEED_ITEMS = 10
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/security.ts (`safety-history`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay in
 * lockstep.
 */
object SafetyHistoryRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "safety-history"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "security"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "SafetyHistoryWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize = SafetyHistorySize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows. */
    val minSize = SafetyHistorySize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize = SafetyHistorySize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: SafetyHistorySize): Boolean =
        size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SafetyHistorySize): SafetyHistorySize =
        SafetyHistorySize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * One `/safety` history row decoded from the JSON array — the native analogue of the loosely-typed
 * `SafetyEvent` snapshot the web widget reads. The five classifier fields and the three subtitle fields are
 * carried as [SafetyValue]/`Boolean?` so the web's runtime-shape semantics (strict `=== true`, enum
 * narrowing) are reproduced without coercion; [id] keys the row and [createdAt] is the raw wire stamp,
 * parsed on demand exactly as the web keeps the string.
 */
data class SafetyEntry(
    val id: Long,
    val createdAt: String?,
    val automaticEmergencyBrakingOff: Boolean?,
    val forwardCollisionWarning: SafetyValue,
    val laneDepartureAvoidance: SafetyValue,
    val blindSpotCollisionWarning: Boolean?,
    val emergencyLaneDepartureAvoidance: Boolean?,
    val speedLimitWarning: SafetyValue,
    val cruiseFollowDistance: SafetyValue,
    val pinToDriveEnabled: SafetyValue,
) {
    companion object {
        /** Project a `/safety` JSON array into a tolerant list of [SafetyEntry] (web `select: safeArray`). */
        fun parseList(element: JsonElement?): List<SafetyEntry> =
            (element as? JsonArray)
                ?.mapNotNull { item -> (item as? JsonObject)?.toEntry() }
                ?: emptyList()

        private fun JsonObject.toEntry(): SafetyEntry =
            SafetyEntry(
                id = (this[KEY_ID] as? JsonPrimitive)?.longOrNull ?: 0L,
                createdAt = stringValue(KEY_CREATED_AT),
                automaticEmergencyBrakingOff = strictBool(KEY_AEB_OFF),
                forwardCollisionWarning = safetyValueOf(this[KEY_FCW]),
                laneDepartureAvoidance = safetyValueOf(this[KEY_LANE]),
                blindSpotCollisionWarning = strictBool(KEY_BLIND_SPOT),
                emergencyLaneDepartureAvoidance = strictBool(KEY_EMERGENCY_LANE),
                speedLimitWarning = safetyValueOf(this[KEY_SPEED_LIMIT]),
                cruiseFollowDistance = safetyValueOf(this[KEY_FOLLOW]),
                pinToDriveEnabled = safetyValueOf(this[KEY_PIN_TO_DRIVE]),
            )

        private fun JsonObject.stringValue(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

        // Web `snap.x === true`: only a genuine JSON boolean yields a Boolean; a string/number/null → null,
        // so the downstream `== true` test can never be satisfied by a coerced value.
        private fun JsonObject.strictBool(key: String): Boolean? {
            val primitive = this[key] as? JsonPrimitive ?: return null
            return if (primitive.isString) null else primitive.booleanOrNull
        }
    }
}

/**
 * Coarse, i18n-friendly relative-time bucket for an event row — the native port of the web
 * `WidgetEventFeed.formatRelativeTime` cutoffs: under a minute "just now", under an hour minutes, under a
 * day hours, otherwise the absolute timestamp. The composable maps each bucket to a localized string (or a
 * locale/zone-aware absolute date) so the pure projection carries no microcopy.
 */
sealed interface SafetyEventTime {
    /** Present-but-unparseable timestamp — rendered as an em dash. */
    data object Unknown : SafetyEventTime

    /** Under one minute old (web `diffMin < 1`). */
    data object JustNow : SafetyEventTime

    /** Under one hour old (web `diffMin < 60`), carrying whole minutes. */
    data class MinutesAgo(
        val value: Long,
    ) : SafetyEventTime

    /** Under one day old (web `diffHrs < 24`), carrying whole hours. */
    data class HoursAgo(
        val value: Long,
    ) : SafetyEventTime

    /** One day or older (web `formatDateTime` fallback), carrying the epoch-millis to format absolutely. */
    data class Absolute(
        val epochMillis: Long,
    ) : SafetyEventTime
}

/**
 * One projected, render-ready event row consumed by the feed. Pure data (no Compose types): the resolved
 * marker [glyph]/[tone] (+ [severity] for parity/a11y), the verbatim classifier [title], the
 * [subtitle] (`buildSubtitle`, possibly an em dash), the [relativeTime] label, and a TalkBack
 * [contentDescription] folding the meaningful parts into one phrase.
 */
data class SafetyEventRow(
    val id: Long,
    val glyph: SafetyEventGlyph,
    val tone: SafetyEventTone,
    val severity: SafetyEventSeverity,
    val title: String,
    val subtitle: String,
    val relativeTime: String,
    val contentDescription: String,
)

/**
 * The 30-day rollup the web `stats` `useMemo` computes: the recent-window event [totalEvents] count, the
 * [mostCommon] type label (or an em dash), and the [trend] versus the prior 30-day window.
 */
data class SafetyStats(
    val totalEvents: Int,
    val mostCommon: String,
    val trend: SafetyTrend,
)

/**
 * The fully projected, render-ready view of the safety history for one footprint — the native analogue of
 * everything the web component computes before returning JSX (the `feedItems` + `stats` memos and the
 * compact-branch text). Pure data so the projection is unit-tested without a UI host. [hasEvents] gates the
 * compact branch (web `list.length > 0`); the wide branch always shows the three stats above the feed.
 */
data class SafetyHistoryDisplay(
    val isCompact: Boolean,
    val hasEvents: Boolean,
    val stats: SafetyStats,
    val totalEventsText: String,
    val compactPrimaryText: String,
    val compactSecondaryText: String?,
    val compactContentDescription: String,
    val items: List<SafetyEventRow>,
)

/**
 * Localized labels + the relative-time formatters the surface folds into its output. The pure
 * [SafetyHistoryProjection] reads [eventsWord] / [noEventsMessage] / [formatEventTime] / [emDash]; the
 * composable chrome additionally reads [title] / [totalLabel] / [mostCommonLabel] / [trendLabel] /
 * [refreshLabel] / [refreshingLabel] / [offlineLabel] / [formatRelative]. The composable builds this from
 * `stringResource` + an absolute-date formatter; tests pass a deterministic instance. Keeping i18n out of
 * the projection lets the projection stay a pure, locale-stable function.
 */
data class SafetyHistoryStrings(
    val title: String,
    val eventsWord: String,
    val noEventsMessage: String,
    val totalLabel: String,
    val mostCommonLabel: String,
    val trendLabel: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatEventTime: (SafetyEventTime) -> String,
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = EM_DASH,
)

/**
 * Pure projection from a decoded list of [SafetyEntry] to the [SafetyHistoryDisplay] — the native port of
 * the web component's `classifySnapshot` / `buildSubtitle` classifiers, its `feedItems` memo (newest-first
 * sort, ten-row cap), and its `stats` memo (30-day count, most-common type, 30-vs-60-day trend) plus the
 * compact `CompactView` text. [nowMillis] is injected so the relative-time tiers + day windows are
 * unit-tested deterministically.
 */
object SafetyHistoryProjection {
    /** Project [entries] for [size] at [nowMillis] using the localized [strings]. */
    fun project(
        entries: List<SafetyEntry>,
        size: SafetyHistorySize,
        strings: SafetyHistoryStrings,
        nowMillis: Long,
    ): SafetyHistoryDisplay {
        val stats = computeStats(entries, nowMillis)
        val rows = projectRows(entries, strings, nowMillis)
        val compactPrimary =
            if (stats.totalEvents > 0) {
                "${formatInt(stats.totalEvents)} ${strings.eventsWord}$WINDOW_SUFFIX"
            } else {
                strings.noEventsMessage
            }
        val compactSecondary = if (stats.totalEvents > 0) "${stats.mostCommon} ${stats.trend.symbol}" else null
        return SafetyHistoryDisplay(
            isCompact = size.isCompact,
            hasEvents = entries.isNotEmpty(),
            stats = stats,
            totalEventsText = formatInt(stats.totalEvents),
            compactPrimaryText = compactPrimary,
            compactSecondaryText = compactSecondary,
            compactContentDescription = listOfNotNull(compactPrimary, compactSecondary).joinToString(", "),
            items = rows,
        )
    }

    /**
     * The 30-day rollup — the native port of the web `stats` memo: events in the last 30 days, the most
     * common type across that window (an em dash when none), and the trend versus the prior 30-day window.
     */
    fun computeStats(
        entries: List<SafetyEntry>,
        nowMillis: Long,
    ): SafetyStats {
        val thirtyDaysAgo = nowMillis - THIRTY_DAYS_MILLIS
        val sixtyDaysAgo = nowMillis - SIXTY_DAYS_MILLIS
        val recent = entries.filter { withinWindow(it.createdAt, lower = thirtyDaysAgo, upper = null) }
        val prior = entries.filter { withinWindow(it.createdAt, lower = sixtyDaysAgo, upper = thirtyDaysAgo) }
        return SafetyStats(
            totalEvents = recent.size,
            mostCommon = mostCommonLabel(recent),
            trend = trendOf(recentCount = recent.size, priorCount = prior.size),
        )
    }

    /** Classify one snapshot — the native port of the web `classifySnapshot` priority ladder. */
    fun classify(entry: SafetyEntry): SafetyEventType =
        when {
            entry.automaticEmergencyBrakingOff == true -> SafetyEventType.Aeb
            isSafetyEnumActive(entry.forwardCollisionWarning, SafetyEnumField.ForwardCollisionWarning) -> SafetyEventType.Fcw
            isSafetyEnumActive(entry.laneDepartureAvoidance, SafetyEnumField.LaneDepartureAvoidance) -> SafetyEventType.Lane
            entry.blindSpotCollisionWarning == true -> SafetyEventType.Bsw
            entry.emergencyLaneDepartureAvoidance == true -> SafetyEventType.Elda
            else -> SafetyEventType.General
        }

    /** The event-row title for [entry] — verbatim web `classifySnapshot` titles (FCW/Lane fold in the value). */
    fun titleFor(entry: SafetyEntry): String =
        when (classify(entry)) {
            SafetyEventType.Aeb -> TITLE_AEB
            SafetyEventType.Fcw -> PREFIX_FCW + cleanSafetyEnum(entry.forwardCollisionWarning, SafetyEnumField.ForwardCollisionWarning)
            SafetyEventType.Lane -> PREFIX_LANE + cleanSafetyEnum(entry.laneDepartureAvoidance, SafetyEnumField.LaneDepartureAvoidance)
            SafetyEventType.Bsw -> TITLE_BLIND_SPOT
            SafetyEventType.Elda -> TITLE_EMERGENCY_LANE
            SafetyEventType.General -> TITLE_GENERAL
        }

    /**
     * The event-row subtitle — the native port of the web `buildSubtitle`: the speed-limit, follow-distance,
     * and PIN-to-drive fragments joined by " · ", or an em dash when none are present.
     */
    fun buildSubtitle(entry: SafetyEntry): String {
        val parts =
            buildList {
                labeledFragment(entry.speedLimitWarning, LABEL_SPEED_LIMIT)?.let { add(it) }
                labeledFragment(entry.cruiseFollowDistance, LABEL_FOLLOW)?.let { add(it) }
                pinFragment(entry.pinToDriveEnabled)?.let { add(it) }
            }
        return parts.joinToString(" $MIDDLE_DOT ").ifEmpty { EM_DASH }
    }

    /**
     * Convert a raw safety-enum [value] into a human-renderable, prefix-stripped string — the native port of
     * the web `cleanSafetyEnum`. Booleans render "On"/"Off", numbers render their JS decimal form, strings
     * are prefix-stripped (with the speed-assist `None` → "Off" special case); an absent/empty value is
     * [fallback].
     */
    fun cleanSafetyEnum(
        value: SafetyValue,
        field: SafetyEnumField,
        fallback: String = EM_DASH,
    ): String =
        when (value) {
            is SafetyValue.BoolValue -> if (value.value) ON else OFF
            is SafetyValue.NumberValue -> jsNumberToString(value.value)
            is SafetyValue.StringValue -> cleanStringEnum(value.value, field, fallback)
            SafetyValue.Absent -> fallback
        }

    /**
     * Whether a raw safety-enum [value] represents an ENABLED feature — the native port of the web
     * `isSafetyEnumActive`: a boolean is itself, an absent value is inactive, and a string/number is active
     * unless it cleans to "off"/"none"/"disabled"/"0".
     */
    fun isSafetyEnumActive(
        value: SafetyValue,
        field: SafetyEnumField,
    ): Boolean =
        when (value) {
            SafetyValue.Absent -> false
            is SafetyValue.BoolValue -> value.value
            else -> {
                val cleaned = cleanSafetyEnum(value, field, fallback = "")
                cleaned.isNotEmpty() && cleaned.lowercase(Locale.US) !in INACTIVE_ENUM_TOKENS
            }
        }

    /**
     * Bucket a row's wire timestamp into a [SafetyEventTime] matching the web
     * `WidgetEventFeed.formatRelativeTime`: an absent timestamp is treated as the epoch (web
     * `item.timestamp ?? new Date(0)`), a present-but-unparseable one as [SafetyEventTime.Unknown], and a
     * valid one tiered just-now / minutes / hours / absolute exactly as the web floors the deltas.
     */
    fun computeEventTime(
        timestamp: String?,
        nowMillis: Long,
    ): SafetyEventTime {
        val epoch = effectiveEpoch(timestamp) ?: return SafetyEventTime.Unknown
        val diffMinutes = (nowMillis - epoch).floorDiv(MILLIS_PER_MINUTE)
        return when {
            diffMinutes < 1L -> SafetyEventTime.JustNow
            diffMinutes < MINUTES_PER_HOUR -> SafetyEventTime.MinutesAgo(diffMinutes)
            diffMinutes / MINUTES_PER_HOUR < HOURS_PER_DAY -> SafetyEventTime.HoursAgo(diffMinutes / MINUTES_PER_HOUR)
            else -> SafetyEventTime.Absolute(epoch)
        }
    }

    /** Locale-stable integer formatter (web `fmtInt`): grouped thousands, no fraction digits. */
    fun formatInt(value: Int): String = DecimalFormat("#,##0", DecimalFormatSymbols(Locale.US)).format(value.toLong())

    private fun projectRows(
        entries: List<SafetyEntry>,
        strings: SafetyHistoryStrings,
        nowMillis: Long,
    ): List<SafetyEventRow> =
        entries
            .sortedByDescending { sortKey(it.createdAt) }
            .take(SafetyHistorySize.MAX_FEED_ITEMS)
            .map { entry -> entry.toRow(strings, nowMillis) }

    private fun SafetyEntry.toRow(
        strings: SafetyHistoryStrings,
        nowMillis: Long,
    ): SafetyEventRow {
        val type = classify(this)
        val title = titleFor(this)
        val subtitle = buildSubtitle(this)
        val relative = strings.formatEventTime(computeEventTime(createdAt, nowMillis))
        val description =
            listOfNotNull(
                title,
                subtitle.takeIf { it != strings.emDash },
                relative.takeIf { it != strings.emDash },
            ).joinToString(", ")
        return SafetyEventRow(
            id = id,
            glyph = type.glyph,
            tone = type.tone,
            severity = type.severity,
            title = title,
            subtitle = subtitle,
            relativeTime = relative,
            contentDescription = description,
        )
    }

    // The web `typeLabels[mostCommonType] ?? '—'` over the recent window's stable-sorted type tally.
    private fun mostCommonLabel(recent: List<SafetyEntry>): String {
        if (recent.isEmpty()) return EM_DASH
        val counts = LinkedHashMap<SafetyEventType, Int>()
        for (entry in recent) {
            val type = classify(entry)
            counts[type] = (counts[type] ?: 0) + 1
        }
        // maxByOrNull returns the first entry holding the max count in LinkedHashMap insertion order —
        // identical to the web stable descending sort + `[0]` tie-break (first-occurring type wins).
        val top = counts.entries.maxByOrNull { it.value }
        return top?.key?.shortLabel ?: EM_DASH
    }

    // Web trend: only meaningful with a prior-window baseline; otherwise the em-dash Unknown.
    private fun trendOf(
        recentCount: Int,
        priorCount: Int,
    ): SafetyTrend =
        when {
            priorCount <= 0 -> SafetyTrend.Unknown
            recentCount > priorCount -> SafetyTrend.Up
            recentCount < priorCount -> SafetyTrend.Down
            else -> SafetyTrend.Flat
        }

    // Web `new Date(created_at ?? '').getTime() >= lower (&& < upper)`: an absent/unparseable stamp is NaN,
    // which fails every comparison, so it is excluded from both windows.
    private fun withinWindow(
        createdAt: String?,
        lower: Long,
        upper: Long?,
    ): Boolean {
        val ts = parseEpochMillis(createdAt) ?: return false
        return ts >= lower && (upper == null || ts < upper)
    }

    // The "Speed Limit: " / "Follow: " fragments — the raw web `String(value)` rendering, or null when absent.
    private fun labeledFragment(
        value: SafetyValue,
        label: String,
    ): String? = if (value is SafetyValue.Absent) null else label + jsString(value)

    // Web pushes 'PIN to Drive' only when present AND truthy; a present-but-falsy value pushes '' which the
    // subsequent `.filter(Boolean)` drops — reproduced here by returning null in both the absent + falsy cases.
    private fun pinFragment(value: SafetyValue): String? = if (pinPresent(value)) LABEL_PIN_TO_DRIVE else null

    private fun pinPresent(value: SafetyValue): Boolean = value !is SafetyValue.Absent && isTruthy(value)

    private fun cleanStringEnum(
        raw: String,
        field: SafetyEnumField,
        fallback: String,
    ): String {
        if (raw.isEmpty()) return fallback
        val stripped = if (raw.startsWith(field.prefix)) raw.substring(field.prefix.length) else null
        return when {
            stripped == null -> raw
            field == SafetyEnumField.SpeedLimitWarning && stripped == NONE -> OFF
            else -> stripped.ifEmpty { raw }
        }
    }

    // The web `String(value)`: a boolean renders "true"/"false", a number its JS decimal, a string itself.
    private fun jsString(value: SafetyValue): String =
        when (value) {
            is SafetyValue.BoolValue -> value.value.toString()
            is SafetyValue.NumberValue -> jsNumberToString(value.value)
            is SafetyValue.StringValue -> value.value
            SafetyValue.Absent -> ""
        }

    // JS truthiness: false / 0 / NaN / "" are falsy; everything else is truthy.
    private fun isTruthy(value: SafetyValue): Boolean =
        when (value) {
            is SafetyValue.BoolValue -> value.value
            is SafetyValue.NumberValue -> value.value != 0.0 && !value.value.isNaN()
            is SafetyValue.StringValue -> value.value.isNotEmpty()
            SafetyValue.Absent -> false
        }

    // JS `String(num)`: an integer-valued double drops its fraction ("3", not "3.0").
    private fun jsNumberToString(value: Double): String =
        if (value.isFinite() && value % 1.0 == 0.0) value.toLong().toString() else value.toString()

    // Web sort over `created_at ?? new Date(0)`: absent sorts as the epoch (1970), unparseable sorts last.
    private fun sortKey(createdAt: String?): Long = parseEpochMillis(createdAt) ?: if (createdAt == null) 0L else Long.MIN_VALUE

    // Web `item.timestamp ?? new Date(0)`: null → epoch; present-but-unparseable → null (→ Unknown).
    private fun effectiveEpoch(timestamp: String?): Long? = if (timestamp == null) 0L else parseEpochMillis(timestamp)
}

/**
 * Narrow a raw `/safety` field [element] into a [SafetyValue] — the native port of the web `typeGuards`
 * (`asBoolean` / `asFiniteNumber` / `asNonEmptyString`) feeding `cleanSafetyEnum`. A JSON string wins first
 * (so `"true"` stays a string, not a boolean), then a native boolean, then a finite number; anything else
 * (JSON null, object, array, absent) is [SafetyValue.Absent].
 */
fun safetyValueOf(element: JsonElement?): SafetyValue {
    val primitive = (element as? JsonPrimitive)?.takeUnless { it is JsonNull } ?: return SafetyValue.Absent
    val boolean = primitive.booleanOrNull
    val number = primitive.doubleOrNull
    return when {
        primitive.isString -> SafetyValue.StringValue(primitive.content)
        boolean != null -> SafetyValue.BoolValue(boolean)
        number != null && number.isFinite() -> SafetyValue.NumberValue(number)
        else -> SafetyValue.Absent
    }
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
 * The active vehicle id the widget reads safety history for — the native port of the web
 * `vid = vehicleId ?? vehicles?.[0]?.id`. A positive [preferredVehicleId] wins; otherwise the first enrolled
 * vehicle is used; `null` means neither is available (the surface shows its empty state).
 */
fun resolveVehicleId(
    preferredVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = preferredVehicleId?.takeIf { it > 0L } ?: firstVehicleId(vehicles)

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty. */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
