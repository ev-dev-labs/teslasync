// Pure, framework-free model + projection for the Alert Detail Timeline feature view — the native analogue
// of everything the web component derives via `useMemo` before returning JSX
// (web/src/features/admin/components/AlertDetailTimeline.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// The web component is purely presentational — its parent (`useAlertDetail` in the alerts list page) loads
// the `AlertEvent[]` and passes it down. This file owns the parts the web `useMemo` computes from that prop:
// the per-event title selection (actor vs. anonymous i18n key, with the web fallbacks), the note subtitle,
// the occurred-at timestamp formatting, and the kind → semantic-accent/glyph classification. The synthetic
// `created` entry is always present server-side; an empty list is only reachable while the parent feed is
// loading, which the composable renders as the friendly empty state (web parity).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AlertDetailTimeline — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling dashboard-widget surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.alertdetailtimeline

import io.teslasync.shared.core.presentation.notifications.AlertEvent
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash shown when a timestamp is missing or unparseable — the web `formatDateTime` `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AlertDetailTimelineRegistration {
    /** Stable surface id. */
    const val ID: String = "alert-detail-timeline"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AlertDetailTimeline"
}

/**
 * Semantic classification of an [AlertEvent.kind] — the native analogue of the web `KIND_COLOR` keys +
 * `kindIcon` switch. [Other] is the catch-all the web `default` branch handles (raw kind title, created
 * color, info icon). The composable maps each case to a design-token accent and a glyph.
 */
enum class AlertTimelineKind {
    Created,
    Acknowledged,
    Reopened,
    Commented,
    Other,
    ;

    companion object {
        /** Maps a raw wire kind to its [AlertTimelineKind]; unknown kinds fold to [Other] (web `default`). */
        fun fromRaw(kind: String): AlertTimelineKind =
            when (kind) {
                "created" -> Created
                "acknowledged" -> Acknowledged
                "reopened" -> Reopened
                "commented" -> Commented
                else -> Other
            }
    }
}

/**
 * One fully projected, render-ready timeline row — the native analogue of a single web `items[]` entry. Pure
 * data (no Compose types) so the projection is unit-tested without a UI host; the composable maps [kind] to
 * the design-token accent + glyph and [time] is already formatted by the caller's locale/zone.
 */
data class AlertTimelineRow(
    val title: String,
    val subtitle: String?,
    val time: String,
    val kind: AlertTimelineKind,
)

/**
 * Per-kind title microcopy — the web `t('alerts.timeline.kind.*')` / `t('alerts.timeline.kindAnonymous.*')`
 * keys. The actor-interpolated variants are lambdas so the composable can resolve the `%1$s` argument through
 * `Context.getString`; tests pass deterministic ones. [created] has no anonymous variant — the web returns
 * "Alert created" whether or not an actor is present, so the single string covers both cases.
 */
data class AlertKindTitles(
    val created: String,
    val acknowledgedAnonymous: String,
    val reopenedAnonymous: String,
    val commentedAnonymous: String,
    val acknowledgedByActor: (actor: String) -> String,
    val reopenedByActor: (actor: String) -> String,
    val commentedByActor: (actor: String) -> String,
)

/**
 * Localized microcopy the projection folds into the surface — the empty-state [title]/[empty] strings plus
 * the per-event [kinds] titles. The composable builds this from `stringResource`/`Context.getString`; tests
 * pass a deterministic instance.
 */
data class AlertDetailTimelineStrings(
    val title: String,
    val empty: String,
    val kinds: AlertKindTitles,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's `useMemo` block.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object AlertDetailTimelineProjection {
    /**
     * Resolves an event's display title, reproducing the web `defaultTitleWithActor` / `defaultTitleAnonymous`
     * selection: a present, non-blank [actor] picks the `kind.*` (interpolated) microcopy, a missing/blank
     * actor picks the `kindAnonymous.*` microcopy, `created` always reads "Alert created", and an unknown
     * [kind] falls back to the raw kind string (web `default: return kind`).
     */
    fun titleFor(
        kind: String,
        actor: String?,
        strings: AlertDetailTimelineStrings,
    ): String {
        val kinds = strings.kinds
        val namedActor = actor?.takeIf { it.trim().isNotEmpty() }
        return when (AlertTimelineKind.fromRaw(kind)) {
            AlertTimelineKind.Created -> kinds.created
            AlertTimelineKind.Acknowledged ->
                namedActor?.let(kinds.acknowledgedByActor) ?: kinds.acknowledgedAnonymous
            AlertTimelineKind.Reopened ->
                namedActor?.let(kinds.reopenedByActor) ?: kinds.reopenedAnonymous
            AlertTimelineKind.Commented ->
                namedActor?.let(kinds.commentedByActor) ?: kinds.commentedAnonymous
            AlertTimelineKind.Other -> kind
        }
    }

    /**
     * Projects the loaded [events] (oldest first, including the synthetic `created`) into render-ready rows.
     * A `null`/empty list yields no rows so the composable shows the empty state — the web
     * `!events || events.length === 0` branch. [formatTime] formats `occurred_at`; injecting it keeps this
     * function locale/zone-deterministic for tests (the composable supplies the real localized formatter).
     */
    fun project(
        events: List<AlertEvent>?,
        strings: AlertDetailTimelineStrings,
        formatTime: (occurredAt: String) -> String,
    ): List<AlertTimelineRow> {
        if (events.isNullOrEmpty()) return emptyList()
        return events.map { event ->
            AlertTimelineRow(
                title = titleFor(event.kind, event.actor, strings),
                subtitle = event.note,
                time = formatTime(event.occurredAt),
                kind = AlertTimelineKind.fromRaw(event.kind),
            )
        }
    }
}

/**
 * Tolerant ISO-8601 → localized "medium date, short time" formatter — the native analogue of the web
 * `formatDateTime` (`toLocaleString` with `{year,month:'short',day,hour,minute}`). Pure (java.time only) so
 * it is unit-tested deterministically with a fixed zone/locale. A blank or unparseable input yields
 * [EM_DASH], exactly like the web helper's invalid-date guard.
 */
object AlertDetailTimeFormatting {
    fun format(
        occurredAt: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(occurredAt) ?: return EM_DASH
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
