// Pure, framework-free model + projection for the Security Event Timeline feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/admin/components/security-access/EventTimeline.tsx + its ./helpers TimelineEvent type).
// No Compose, no Android, no HTTP: every type here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component is purely presentational — its parent (the security-access page) derives the
// `TimelineEvent[]` (via `deriveTimeline`) and passes it down; the component's only hooks are
// `useTranslation` and the local `useTimelineLabels` (an i18n label resolver, not a fetch). This file owns
// the parts the web component computes from that prop: the per-event title/subtitle selection
// (`useTimelineLabels`), the semantic glyph selection (`timelineIcon`), the variant → accent classification
// (the JSX marker color), and the occurred-at timestamp formatting (web `TimeStamp`). An empty list renders
// the friendly empty state (web `timelineEvents.length > 0 ? … : <EmptyState/>`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/EventTimeline — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.eventtimeline

import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash shown when a timestamp is missing or unparseable — the web `TimeStamp` invalid-date fallback. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object EventTimelineRegistration {
    /** Stable surface id. */
    const val ID: String = "event-timeline"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "EventTimeline"
}

// ── i18n key mirrors (P1/S10) ──
// The web `t('admin.security.timeline.*')` keys, flattened to the generated Android catalog names.
// Referencing these in one place keeps the composable and the off-device test in lockstep with the
// catalog and documents the web → native key contract.

/** Panel heading — web `t('admin.security.timeline.title', 'Security Event Timeline')`. */
const val KEY_TITLE: String = "translation_admin_security_timeline_title"

/** Empty-state copy — web `t('admin.security.timeline.noEvents', …)`. */
const val KEY_NO_EVENTS: String = "translation_admin_security_timeline_noEvents"

const val KEY_LOCK_POSITIVE: String = "translation_admin_security_timeline_lock_positive"
const val KEY_LOCK_POSITIVE_DESC: String = "translation_admin_security_timeline_lock_positiveDesc"
const val KEY_LOCK_NEGATIVE: String = "translation_admin_security_timeline_lock_negative"
const val KEY_LOCK_NEGATIVE_DESC: String = "translation_admin_security_timeline_lock_negativeDesc"
const val KEY_SENTRY_POSITIVE: String = "translation_admin_security_timeline_sentry_positive"
const val KEY_SENTRY_POSITIVE_DESC: String = "translation_admin_security_timeline_sentry_positiveDesc"
const val KEY_SENTRY_NEGATIVE: String = "translation_admin_security_timeline_sentry_negative"
const val KEY_SENTRY_NEGATIVE_DESC: String = "translation_admin_security_timeline_sentry_negativeDesc"
const val KEY_DOOR_POSITIVE: String = "translation_admin_security_timeline_door_positive"
const val KEY_DOOR_NEGATIVE: String = "translation_admin_security_timeline_door_negative"

// ── Semantic timeline data (the web `./helpers` TimelineEvent type) ──

/** The kind of state change — web `TimelineEvent['kind']` (`'lock' | 'sentry' | 'door'`). */
enum class TimelineEventKind {
    Lock,
    Sentry,
    Door,
    ;

    companion object {
        /** Maps a raw wire kind to its [TimelineEventKind]; unknown kinds fold to [Lock] (defensive default). */
        fun fromRaw(kind: String): TimelineEventKind =
            when (kind.trim().lowercase(Locale.ROOT)) {
                "lock" -> Lock
                "sentry" -> Sentry
                "door" -> Door
                else -> Lock
            }
    }
}

/** The semantic direction of a change — web `TimelineEvent['variant']` (`'positive' | 'negative' | 'neutral'`). */
enum class TimelineEventVariant {
    Positive,
    Negative,
    Neutral,
    ;

    companion object {
        /** Maps a raw wire variant to its [TimelineEventVariant]; unknown values fold to [Neutral]. */
        fun fromRaw(variant: String): TimelineEventVariant =
            when (variant.trim().lowercase(Locale.ROOT)) {
                "positive" -> Positive
                "negative" -> Negative
                else -> Neutral
            }
    }
}

/**
 * One semantic state-change event — the native analogue of the web `TimelineEvent` interface from
 * `security-access/helpers.ts`. Pure data (no Compose types) so the projection is unit-tested without a UI
 * host. [detail] is the door-state subtitle for `Door` events (web `subtitle: ev.detail`).
 */
data class TimelineEvent(
    val id: String,
    val kind: TimelineEventKind,
    val variant: TimelineEventVariant,
    val detail: String,
    val timestamp: String,
)

// ── Glyph + accent classification (web `timelineIcon` + JSX marker) ──

/**
 * Pure glyph key for a timeline marker — the native analogue of the web `timelineIcon` switch's lucide
 * icons. The composable resolves each key to a concrete `ImageVector`; keeping the selection here makes it
 * unit-testable off-device.
 */
enum class EventTimelineGlyph {
    Lock,
    Unlock,
    ShieldCheck,
    ShieldAlert,
    DoorClosed,
    DoorOpen,
}

/**
 * Semantic accent role for a marker — the native analogue of the web JSX marker color
 * (`positive → green`, `negative → red`, `neutral → muted`). The composable maps each role to a design
 * token (never raw hex), so light/dark/high-contrast all stay correct.
 */
enum class TimelineAccentRole {
    Success,
    Danger,
    Muted,
}

/** Localized title + subtitle for one event — the result of the web `useTimelineLabels` resolver. */
data class EventTimelineLabels(
    val title: String,
    val subtitle: String,
)

/**
 * The localized microcopy the projection folds into the surface — the empty-state [title]/[noEvents]
 * strings plus the per-kind/variant title + description copy the web `useTimelineLabels` reads. The
 * composable builds this from `stringResource`; tests pass a deterministic instance.
 */
data class EventTimelineStrings(
    val title: String,
    val noEvents: String,
    val lockPositive: String,
    val lockPositiveDesc: String,
    val lockNegative: String,
    val lockNegativeDesc: String,
    val sentryPositive: String,
    val sentryPositiveDesc: String,
    val sentryNegative: String,
    val sentryNegativeDesc: String,
    val doorPositive: String,
    val doorNegative: String,
)

/**
 * One fully projected, render-ready timeline row — the native analogue of a single rendered web list item.
 * Pure data (no Compose types); the composable maps [glyph]/[accent] to an `ImageVector`/`Color` and [time]
 * is already formatted by the caller's locale/zone.
 */
data class EventTimelineRow(
    val id: String,
    val title: String,
    val subtitle: String?,
    val time: String,
    val glyph: EventTimelineGlyph,
    val accent: TimelineAccentRole,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's render-time
 * derivations (`useTimelineLabels`, `timelineIcon`, the marker color, and `TimeStamp`). Stateless and
 * side-effect-free so it is fully covered by the off-device unit gate.
 */
object EventTimelineProjection {
    /**
     * Resolves an event's title + subtitle, reproducing the web `useTimelineLabels` switch exactly. For
     * `lock`/`sentry` both the title and subtitle are picked by `variant === 'positive'`; for `door` the
     * title is picked by `variant === 'positive'` and the subtitle is always the event's [TimelineEvent.detail].
     * Non-positive variants (including `neutral`) take the negative branch, matching the web ternaries.
     */
    fun labelsFor(
        event: TimelineEvent,
        strings: EventTimelineStrings,
    ): EventTimelineLabels {
        val positive = event.variant == TimelineEventVariant.Positive
        return when (event.kind) {
            TimelineEventKind.Lock ->
                EventTimelineLabels(
                    title = if (positive) strings.lockPositive else strings.lockNegative,
                    subtitle = if (positive) strings.lockPositiveDesc else strings.lockNegativeDesc,
                )
            TimelineEventKind.Sentry ->
                EventTimelineLabels(
                    title = if (positive) strings.sentryPositive else strings.sentryNegative,
                    subtitle = if (positive) strings.sentryPositiveDesc else strings.sentryNegativeDesc,
                )
            TimelineEventKind.Door ->
                EventTimelineLabels(
                    title = if (positive) strings.doorPositive else strings.doorNegative,
                    subtitle = event.detail,
                )
        }
    }

    /**
     * Selects the marker glyph for an event — the web `timelineIcon` switch. `positive` picks the
     * affirmative glyph, every other variant (negative or neutral) picks the cautionary one, mirroring the
     * web `ev.variant === 'positive' ? … : …` ternaries.
     */
    fun glyphFor(
        kind: TimelineEventKind,
        variant: TimelineEventVariant,
    ): EventTimelineGlyph {
        val positive = variant == TimelineEventVariant.Positive
        return when (kind) {
            TimelineEventKind.Lock -> if (positive) EventTimelineGlyph.Lock else EventTimelineGlyph.Unlock
            TimelineEventKind.Sentry -> if (positive) EventTimelineGlyph.ShieldCheck else EventTimelineGlyph.ShieldAlert
            TimelineEventKind.Door -> if (positive) EventTimelineGlyph.DoorClosed else EventTimelineGlyph.DoorOpen
        }
    }

    /**
     * Maps a [TimelineEventVariant] to its marker accent role — the web JSX three-way marker color
     * (`positive → green`, `negative → red`, `neutral → muted`).
     */
    fun accentFor(variant: TimelineEventVariant): TimelineAccentRole =
        when (variant) {
            TimelineEventVariant.Positive -> TimelineAccentRole.Success
            TimelineEventVariant.Negative -> TimelineAccentRole.Danger
            TimelineEventVariant.Neutral -> TimelineAccentRole.Muted
        }

    /**
     * Projects the supplied [events] into render-ready rows, preserving order. A `null`/empty list yields no
     * rows so the composable shows the empty state — the web `timelineEvents.length > 0 ? … : <EmptyState/>`
     * branch. [formatTime] formats each `timestamp`; injecting it keeps this function locale/zone-deterministic
     * for tests (the composable supplies the real localized formatter).
     */
    fun project(
        events: List<TimelineEvent>?,
        strings: EventTimelineStrings,
        formatTime: (timestamp: String) -> String,
    ): List<EventTimelineRow> {
        if (events.isNullOrEmpty()) return emptyList()
        return events.map { event ->
            val labels = labelsFor(event, strings)
            EventTimelineRow(
                id = event.id,
                title = labels.title,
                subtitle = labels.subtitle.ifBlank { null },
                time = formatTime(event.timestamp),
                glyph = glyphFor(event.kind, event.variant),
                accent = accentFor(event.variant),
            )
        }
    }
}

// ── Lifecycle classifier (per-state coverage) ──

/**
 * The mutually-exclusive top-level surface the composable switches on — the native lifecycle chrome the
 * host's cache-then-network feed implies around the web component's content/empty branches. [Ready] then
 * internally renders the timeline or the empty state from the projected rows; [Loading]/[Error] render the
 * first-load skeleton and the retry surface.
 */
enum class EventTimelineSurface {
    Loading,
    Error,
    Ready,
}

/**
 * Classifies the lifecycle flags of a `UiState` into the surface to render. A first load with nothing cached
 * shows [Loading]; a hard error with no cached fallback shows [Error]; everything else (content, empty, and
 * stale/offline "last known") is [Ready] and lets the projected rows decide timeline-vs-empty. Loading takes
 * precedence over error so a refresh-with-skeleton never flashes the error surface.
 */
fun eventTimelineSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): EventTimelineSurface =
    when {
        isLoading -> EventTimelineSurface.Loading
        isError -> EventTimelineSurface.Error
        else -> EventTimelineSurface.Ready
    }

// ── Timestamp formatting (web `TimeStamp`) ──

/**
 * Tolerant ISO-8601 → localized "medium date, short time" formatter — the native analogue of the web
 * `TimeStamp` / `toLocaleString` rendering. Pure (java.time only) so it is unit-tested deterministically with
 * a fixed zone/locale. A blank or unparseable input yields [EM_DASH], like the web invalid-date guard.
 */
object EventTimeFormatting {
    fun format(
        timestamp: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(timestamp) ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
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
