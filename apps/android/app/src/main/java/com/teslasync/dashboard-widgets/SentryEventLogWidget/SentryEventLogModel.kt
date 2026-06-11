// Pure, framework-free model + projection for the Sentry Event Log dashboard widget — the native
// analogue of everything the web component derives (the `deriveEvent` helper and the `feedItems`
// `useMemo`) before it returns JSX (web/src/features/dashboard/widgets/SentryEventLogWidget.tsx). No
// Compose, no Android framework, no HTTP: every type here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer. Security-event fields
// are plain (booleans, opaque timestamps, free-form door strings) — not unit-bearing — so there is no SI
// conversion at this layer; the only formatting is the localized relative-time string the surface folds
// in, exactly as the shared web `WidgetEventFeed` does.
//
// Event titles + subtitles are reproduced as verbatim literals because the web source likewise renders
// them as literals — `deriveEvent` and the `feedItems` map build the title ("Vehicle locked", "Door
// open: …", …) and subtitle ("🔒 Locked · 🛡️ Sentry On", …) with plain template strings and never a
// `t()` call, so no `widget.*` i18n key exists for them. Reproducing the exact strings keeps the
// observable output identical (ADR-004 parity); the only `t()`-backed strings (the title + the empty
// message) are resolved at the Compose boundary from the P1/S10 catalog.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/SentryEventLogWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling GuardMode / MotorHistory widgets
// do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.sentryeventlog

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime

/** Em dash shown for an absent subtitle / unparseable relative time — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

// ── deriveEvent titles (web literals, reproduced verbatim for parity) ───────────────────────────────
private const val TITLE_DOOR_OPEN_PREFIX = "Door open: "
private const val TITLE_SENTRY_ON = "Sentry Mode activated"
private const val TITLE_SENTRY_OFF = "Sentry Mode deactivated"
private const val TITLE_LOCKED = "Vehicle locked"
private const val TITLE_UNLOCKED = "Vehicle unlocked"
private const val TITLE_UPDATED = "Security state updated"

// ── feedItems subtitle fragments (web literals, reproduced verbatim for parity) ─────────────────────
private const val SUBTITLE_LOCKED = "\uD83D\uDD12 Locked"
private const val SUBTITLE_UNLOCKED = "\uD83D\uDD13 Unlocked"
private const val SUBTITLE_SENTRY_ON = "\uD83D\uDEE1\uFE0F Sentry On"
private const val SUBTITLE_SENTRY_OFF = "Sentry Off"
private const val SUBTITLE_SEPARATOR = " \u00b7 "
private const val DOOR_JOIN_SEPARATOR = ", "
private const val OPEN_TOKEN = "open"
private const val A11Y_SEPARATOR = ", "

// ── Wire (`/security`) document field names — snake_case, served verbatim by the Go handler ─────────
private const val FIELD_ID = "id"
private const val FIELD_VEHICLE_ID = "vehicle_id"
private const val FIELD_TS = "ts"
private const val FIELD_CREATED_AT = "created_at"
private const val FIELD_EVENT_TYPE = "event_type"
private const val FIELD_DOOR_STATE = "door_state"
private const val FIELD_LOCKED = "locked"
private const val FIELD_SENTRY_MODE = "sentry_mode"

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isWide = size.cols >= 3` / `isTall = size.rows >= 2` branches in the web source, which together pick
 * the per-footprint `eventLimit` (the feed cap) and whether each row shows its lock/sentry [isWide]
 * subtitle.
 */
data class SentryEventLogSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at three or more columns (web `isWide = size.cols >= 3`): rows render the lock/sentry subtitle. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    /** True at two or more rows (web `isTall = size.rows >= 2`): raises the feed cap from 4 to 7. */
    val isTall: Boolean get() = rows >= TALL_MIN_ROWS

    /** Max rows rendered in the feed (web `eventLimit = isWide ? 10 : isTall ? 7 : 4`). */
    val eventLimit: Int
        get() =
            when {
                isWide -> LIMIT_WIDE
                isTall -> LIMIT_TALL
                else -> LIMIT_COMPACT
            }

    companion object {
        private const val WIDE_MIN_COLS = 3
        private const val TALL_MIN_ROWS = 2
        private const val LIMIT_WIDE = 10
        private const val LIMIT_TALL = 7
        private const val LIMIT_COMPACT = 4
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/security.ts (`sentry-event-log`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object SentryEventLogRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "sentry-event-log"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "security"

    /** Display name (matches the web registry). */
    const val NAME: String = "Sentry Event Log"

    /** Registry description copy (registry metadata; not rendered in the widget body). */
    const val DESCRIPTION: String = "Recent sentry events with timestamps"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SentryEventLogWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize: SentryEventLogSize = SentryEventLogSize(cols = 2, rows = 4)

    /** Minimum footprint: 2 columns × 4 rows. */
    val minSize: SentryEventLogSize = SentryEventLogSize(cols = 2, rows = 4)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: SentryEventLogSize = SentryEventLogSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: SentryEventLogSize): Boolean =
        size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SentryEventLogSize): SentryEventLogSize =
        SentryEventLogSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * Semantic tone for a security-event marker; mapped to a concrete token color at the render boundary. The
 * tones mirror the web `deriveEvent` hex accents (amber → [Warning], cyan → [Info], gray → [Muted], green
 * → [Success], red → [Critical], purple → [Accent]).
 */
enum class SecurityEventTone { Warning, Info, Muted, Success, Critical, Accent }

/**
 * Glyph family for a security-event marker; mapped to a concrete `ImageVector` at the render boundary
 * (approximating the web Lucide icon from the shared glyph set — Android has no bundled Lucide).
 */
enum class SecurityEventGlyph { DoorOpen, DoorClosed, Eye, EyeOff, Lock, Unlock }

/**
 * One decoded `/security` row — the native analogue of the web `SecurityEvent`. Only the fields the web
 * `deriveEvent` + `feedItems` map actually read are kept: the lock / sentry booleans (tri-state — `null`
 * means "not reported", which the web distinguishes from `false`), the free-form [doorState] string the
 * web splits on commas, the [eventType], and the identity/timestamp fields. Kept as a plain value so the
 * projection stays a pure, JVM-testable function.
 */
data class SecurityEvent(
    val id: Long?,
    val vehicleId: Long,
    val ts: String,
    val createdAt: String?,
    val eventType: String,
    val doorState: String?,
    val locked: Boolean?,
    val sentryMode: Boolean?,
) {
    /** The timestamp the feed sorts + relative-times by (web `ev.created_at ?? ev.ts`). */
    val timestamp: String get() = createdAt ?: ts

    /** Stable row key (web `ev.id ?? \`${ev.vehicle_id}-${ev.ts}\``). */
    val rowId: String get() = id?.toString() ?: "$vehicleId-$ts"

    companion object {
        /** Decode a single `/security` [JsonObject] into a [SecurityEvent], tolerating missing fields. */
        fun fromJson(obj: JsonObject): SecurityEvent =
            SecurityEvent(
                id = obj.longField(FIELD_ID),
                vehicleId = obj.longField(FIELD_VEHICLE_ID) ?: 0L,
                ts = obj.stringField(FIELD_TS) ?: "",
                createdAt = obj.stringField(FIELD_CREATED_AT),
                eventType = obj.stringField(FIELD_EVENT_TYPE) ?: "",
                doorState = obj.stringField(FIELD_DOOR_STATE),
                locked = obj.booleanField(FIELD_LOCKED),
                sentryMode = obj.booleanField(FIELD_SENTRY_MODE),
            )

        /** Decode a `/security` array (already `safeArray`-guarded by the repository) into rows. */
        fun parseList(element: JsonElement?): List<SecurityEvent> =
            (element as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let(::fromJson) } ?: emptyList()
    }
}

/**
 * The visual descriptor `deriveEvent` resolves for one event — the glyph (approximating the web Lucide
 * icon), the semantic [tone] (mapped from the web hex accent), and the already-built [title].
 */
data class SecurityEventDescriptor(
    val glyph: SecurityEventGlyph,
    val tone: SecurityEventTone,
    val title: String,
)

/**
 * Pure port of the web `deriveEvent` helper: resolve the marker glyph + tone + human-readable title for a
 * security snapshot, in the exact branch order the web evaluates (open doors → sentry on → sentry off →
 * locked → unlocked → fallback). The door title folds the comma-split open-door tokens the same way the
 * web does (`Door open: ${openDoors.join(', ')}`).
 */
object SecurityEventTokens {
    /** Resolve the descriptor for [event] (web `deriveEvent`). */
    fun derive(event: SecurityEvent): SecurityEventDescriptor {
        val openDoors = openDoors(event.doorState)
        return when {
            openDoors.isNotEmpty() ->
                SecurityEventDescriptor(
                    glyph = SecurityEventGlyph.DoorOpen,
                    tone = SecurityEventTone.Warning,
                    title = TITLE_DOOR_OPEN_PREFIX + openDoors.joinToString(DOOR_JOIN_SEPARATOR),
                )

            event.sentryMode == true ->
                SecurityEventDescriptor(SecurityEventGlyph.Eye, SecurityEventTone.Info, TITLE_SENTRY_ON)

            event.sentryMode == false ->
                SecurityEventDescriptor(SecurityEventGlyph.EyeOff, SecurityEventTone.Muted, TITLE_SENTRY_OFF)

            event.locked == true ->
                SecurityEventDescriptor(SecurityEventGlyph.Lock, SecurityEventTone.Success, TITLE_LOCKED)

            event.locked == false ->
                SecurityEventDescriptor(SecurityEventGlyph.Unlock, SecurityEventTone.Critical, TITLE_UNLOCKED)

            else ->
                SecurityEventDescriptor(SecurityEventGlyph.DoorClosed, SecurityEventTone.Accent, TITLE_UPDATED)
        }
    }

    /**
     * The web `door open` tokens: split the raw door string on commas, trim each, and keep the ones that
     * mention "open" (case-insensitive) — exactly the web `doorRaw.split(',').map(trim).filter(includes
     * 'open')`. A blank / absent door string yields no tokens.
     */
    fun openDoors(doorState: String?): List<String> =
        (doorState ?: "")
            .split(',')
            .map { it.trim() }
            .filter { it.isNotEmpty() && it.lowercase().contains(OPEN_TOKEN) }

    /**
     * The web `feedItems` subtitle: "🔒 Locked · 🛡️ Sentry On"-style fragments, one per reported lock /
     * sentry boolean (a `null` boolean contributes nothing — the web `!= null` guard), joined with " · ",
     * or the em-dash when neither is reported (web `parts.join(' · ') || '—'`).
     */
    fun subtitle(event: SecurityEvent): String {
        val parts =
            buildList {
                if (event.locked != null) add(if (event.locked) SUBTITLE_LOCKED else SUBTITLE_UNLOCKED)
                if (event.sentryMode != null) add(if (event.sentryMode) SUBTITLE_SENTRY_ON else SUBTITLE_SENTRY_OFF)
            }
        return if (parts.isEmpty()) EM_DASH else parts.joinToString(SUBTITLE_SEPARATOR)
    }
}

/**
 * One projected, render-ready feed row — the native analogue of a web `EventFeedItem`. Pure data (no
 * Compose types): the resolved marker [glyph]/[tone], the (web-parity) [title], the optional lock/sentry
 * [subtitle] (only populated on the wide footprint, web `subtitle: isWide ? … : undefined`), the
 * [relativeTime] label, and a TalkBack [contentDescription] folding the visible fields into one phrase.
 */
data class SecurityEventRow(
    val id: String,
    val glyph: SecurityEventGlyph,
    val tone: SecurityEventTone,
    val title: String,
    val subtitle: String?,
    val relativeTime: String,
    val contentDescription: String,
)

/**
 * The parsed payload backing the widget: the decoded `/security` [events] for the scoped vehicle, kept as
 * typed [SecurityEvent]s. The web reads the same `SecurityEvent[]`; keeping the rows un-projected here
 * lets the deriving + sorting + capping live in the pure [SentryEventLogProjection].
 */
data class SentryEventLogSnapshot(
    val events: List<SecurityEvent>,
) {
    /** True when the response carried at least one event (drives the loading/empty/content fold). */
    val hasRows: Boolean get() = events.isNotEmpty()

    companion object {
        /** The empty payload (no vehicle / no events resolved) — drives the empty state. */
        val EMPTY: SentryEventLogSnapshot = SentryEventLogSnapshot(emptyList())

        /** Decode a `/security` array [element] into a snapshot, tolerating nulls / non-array bodies. */
        fun fromJson(element: JsonElement?): SentryEventLogSnapshot = SentryEventLogSnapshot(SecurityEvent.parseList(element))
    }
}

/**
 * Localized strings the projection folds into its output. Only [formatRelative] is needed by the pure
 * projection (the relative-time label); the composable chrome resolves the title + empty message directly
 * from the catalog. Keeping i18n out of the projection lets it stay a pure, locale-stable function.
 *
 * Relative time reuses the shared `relativeAge` buckets (the same the freshness chip uses): identical to
 * the web `WidgetEventFeed` for events under a day ("just now" / "Xm ago" / "Xh ago"); for older events
 * the shared bucket renders "Xd ago" / "Xw ago" where the web shows an absolute date — the same minor,
 * documented deviation the sibling GuardMode feed widget already ships.
 */
data class SentryEventLogStrings(
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = EM_DASH,
)

/**
 * The fully projected, render-ready view of one `/security` payload for one footprint — the native
 * analogue of everything the web component computes before returning JSX (the `feedItems` map plus the
 * shared `WidgetEventFeed` sort + cap). Pure data so the projection is unit-tested without a Compose host.
 */
data class SentryEventLogDisplay(
    val isWide: Boolean,
    val eventLimit: Int,
    val items: List<SecurityEventRow>,
    val hasItems: Boolean,
)

/**
 * Pure projection from a parsed [SentryEventLogSnapshot] to the [SentryEventLogDisplay] — the native port
 * of the web component's `feedItems` `useMemo` (deriving each row's glyph/tone/title + the lock/sentry
 * subtitle) and the shared `WidgetEventFeed` newest-first sort + `maxItems` cap. Nothing here is
 * unit-bearing; [nowMillis] is injected so relative-time tiers are unit-tested deterministically.
 */
object SentryEventLogProjection {
    /** Project [snapshot] for [size] at [nowMillis] using the localized [strings]. */
    fun project(
        snapshot: SentryEventLogSnapshot,
        size: SentryEventLogSize,
        strings: SentryEventLogStrings,
        nowMillis: Long,
    ): SentryEventLogDisplay {
        val rows =
            snapshot.events
                .sortedByDescending { parseEpochMillis(it.timestamp) ?: Long.MIN_VALUE }
                .take(size.eventLimit)
                .map { event -> projectRow(event, size.isWide, strings, nowMillis) }
        return SentryEventLogDisplay(
            isWide = size.isWide,
            eventLimit = size.eventLimit,
            items = rows,
            hasItems = rows.isNotEmpty(),
        )
    }

    private fun projectRow(
        event: SecurityEvent,
        isWide: Boolean,
        strings: SentryEventLogStrings,
        nowMillis: Long,
    ): SecurityEventRow {
        val descriptor = SecurityEventTokens.derive(event)
        val subtitle = if (isWide) SecurityEventTokens.subtitle(event) else null
        val relative = formatRelative(event.timestamp, strings, nowMillis)
        val description = listOfNotNull(descriptor.title, subtitle, relative).joinToString(A11Y_SEPARATOR)
        return SecurityEventRow(
            id = event.rowId,
            glyph = descriptor.glyph,
            tone = descriptor.tone,
            title = descriptor.title,
            subtitle = subtitle,
            relativeTime = relative,
            contentDescription = description,
        )
    }

    private fun formatRelative(
        timestamp: String,
        strings: SentryEventLogStrings,
        nowMillis: Long,
    ): String = strings.formatRelative(relativeAge(computeAgeSeconds(parseEpochMillis(timestamp), nowMillis)))
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

/** Read a JSON string field, or `null` when absent / JSON `null` / not a quoted string. */
private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }

/** Read a JSON integer field, or `null` when absent / JSON `null` / not a JSON number. */
private fun JsonObject.longField(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

/** Read a JSON boolean field, or `null` when absent / JSON `null` / not a JSON boolean (web tri-state). */
private fun JsonObject.booleanField(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull
