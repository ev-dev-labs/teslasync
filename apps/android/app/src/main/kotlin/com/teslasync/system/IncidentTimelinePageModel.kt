// Pure, framework-free model + projections for the IncidentTimelinePage system surface — the native analogue of
// everything web/src/features/system/pages/IncidentTimelinePage.tsx derives before it composes its post-mortem
// surface. No Compose, no Android framework, no HTTP lives here (only the shared incidents model, the cache-then-
// network Resource envelope, and the diagnostics Logger), so the route identity, the severity/status tone
// classification, the open/closed duration formatting, the newest-first timeline ordering, the keep-previous-data
// merge, and the transient toast vocabulary are all exercised off-device and the composable stays a thin render
// layer.
//
// The web page reads one backend source (web `useIncident`, GET /status/incidents/{id}) plus two writes (web
// `useAppendIncidentUpdate` POST …/updates, `usePatchIncident` PATCH …). It classifies the incident severity to a
// glyph/tone (web `SEVERITY_TONE`), the lifecycle status to a badge variant + label (web `STATUS_BADGE` /
// `STATUS_LABEL`), formats the open/resolved age (web `fmtDuration`), reverses the update list to newest-first (web
// `[...updates].reverse()`), and gates the resolve control + add-update form on `!isResolved`. This file owns those
// derivations; the glyphs, token colors, and localized labels are resolved at the Compose boundary, never here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/system — the
// P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*` namespace
// uses, so the package intentionally diverges from the path — exactly as the sibling system / dashboard page
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located registration + recorder + model types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.incidenttimeline

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.incidents.Incident
import io.teslasync.shared.core.presentation.incidents.IncidentUpdateEntry
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
 * Canonical metadata for the IncidentTimelinePage surface. The web page is a per-incident post-mortem route, so
 * this object carries the cross-cutting concerns the surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host
 * wires (already a metadata-only destination at Destinations.kt
 * `hidden("incidentTimeline", "/system-status/incidents/:id", NavGroup.System, listOf("id"))`), the route [ARG_ID]
 * carrying the incident id (web `useParams().id`), the diagnostics [SLUG] emitted with the one-shot `view.opened`
 * event (P1/S11), and the in-app deep link the Back affordance follows (web `navigate('/system-status')`).
 */
object IncidentTimelinePageRegistration {
    /** The navigation destination id (Destinations.kt `hidden("incidentTimeline", …)`). */
    const val ROUTE_ID: String = "incidentTimeline"

    /** The route argument carrying the incident id (web `useParams().id`). */
    const val ARG_ID: String = "id"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/system-status/incidents/:id"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "IncidentTimelinePage"

    /**
     * The in-app deep link the Back header action + the not-found "Back to System Status" link follow — the native
     * analogue of the web `navigate('/system-status')` / `<Link to="/system-status">`. No `NavController` is
     * exposed to page hosts, so the app's own `teslasync://app/{path}` deep-link scheme (AndroidManifest +
     * TeslaSyncNavHost) is the sanctioned forward-navigation seam, opened via `LocalUriHandler`.
     */
    const val SYSTEM_STATUS_DEEP_LINK: String = "teslasync://app/system-status"
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no incident data. */
internal fun recordIncidentTimelinePageOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to IncidentTimelinePageRegistration.SLUG))
}

/**
 * Parses the raw `id` route argument into a positive incident id, reproducing the web
 * `n = Number(id); Number.isFinite(n) && n > 0 ? n : null` guard. A blank, non-numeric, or non-positive value
 * yields `null`, which the page renders as the not-found surface (web `error || !incident`).
 */
fun parseIncidentId(raw: String?): Long? = raw?.trim()?.toLongOrNull()?.takeIf { it > 0L }

/**
 * Semantic severity tone of an incident — the native analogue of the web `SEVERITY_TONE` map keys. Each case maps
 * 1:1 to a web Lucide glyph + color (`minor` → AlertCircle/amber, `major` → AlertTriangle/orange, `critical` →
 * AlertOctagon/red); the render layer resolves each case to a concrete `ImageVector` + token color, so this enum
 * stays free of Compose types and fully unit-testable. An unknown / future severity folds to [Minor] — the
 * least-alarming styling — rather than crashing the way the web `SEVERITY_TONE[severity]` lookup would.
 */
enum class IncidentSeverityTone {
    /** `minor` — web `AlertCircle` / amber-300. */
    Minor,

    /** `major` — web `AlertTriangle` / orange-300. */
    Major,

    /** `critical` — web `AlertOctagon` / red-400. */
    Critical,
    ;

    companion object {
        /** Classifies a raw `severity` like the web `SEVERITY_TONE[incident.severity]`; unknown/blank folds to [Minor]. */
        fun fromWire(severity: String?): IncidentSeverityTone =
            when (severity?.trim()?.lowercase(Locale.ROOT)) {
                "critical" -> Critical
                "major" -> Major
                else -> Minor
            }
    }
}

/**
 * Semantic badge tone of an incident's lifecycle status — the native analogue of the web `STATUS_BADGE` map
 * (`investigating` → danger, `identified` → warning, `monitoring` → info, `resolved` → success). An unknown /
 * future status folds to [Neutral] so the surface never bricks on a value the backend adds later. The render layer
 * maps each tone to a shared `BadgeVariant`; the badge label is resolved through [IncidentLifecycleStatus].
 */
enum class IncidentStatusTone {
    Danger,
    Warning,
    Info,
    Success,
    Neutral,
    ;

    companion object {
        /** Classifies a raw `status` like the web `STATUS_BADGE[status]`; unknown/blank folds to [Neutral]. */
        fun fromStatus(status: String?): IncidentStatusTone =
            when (status?.trim()?.lowercase(Locale.ROOT)) {
                "investigating" -> Danger
                "identified" -> Warning
                "monitoring" -> Info
                "resolved" -> Success
                else -> Neutral
            }
    }
}

/**
 * The four known lifecycle states the web `STATUS_LABEL` map names (`Investigating` / `Identified` / `Monitoring`
 * / `Resolved`) and the add-update transition select offers. [wire] is the exact lowercase token; the human label
 * is resolved at the Compose boundary (P1/S10). [fromWire] returns `null` for an unknown token so the render layer
 * can fall back to the raw status string (the web `STATUS_LABEL[status]` would be `undefined` for an unknown key).
 */
enum class IncidentLifecycleStatus(
    val wire: String,
) {
    Investigating("investigating"),
    Identified("identified"),
    Monitoring("monitoring"),
    Resolved("resolved"),
    ;

    companion object {
        /** The wire token of the resolved state, matched by the page to gate the resolve control + add-update form. */
        const val RESOLVED_WIRE: String = "resolved"

        /** Resolves a [wire] token to its known case, or `null` when unknown (render falls back to the raw value). */
        fun fromWire(wire: String?): IncidentLifecycleStatus? =
            entries.firstOrNull { it.wire == wire?.trim()?.lowercase(Locale.ROOT) }
    }
}

/** Whether an incident's [status] is the terminal resolved state — web `incident.status === 'resolved'`. */
fun isIncidentResolved(status: String?): Boolean = status?.trim()?.lowercase(Locale.ROOT) == IncidentLifecycleStatus.RESOLVED_WIRE

/**
 * Formats an ISO-8601 timestamp into the user's medium localized date-time — the native analogue of the web
 * `useDateFormat().formatDateTime` the page applies to `started_at`, `resolved_at`, and each update's `at`. The
 * instant is rendered in the device time zone with [locale]; a value that cannot be parsed (offset, then bare
 * RFC-3339 instant) falls back to the raw string verbatim, exactly as the web formatter degrades.
 */
fun formatTimestamp(
    raw: String,
    locale: Locale,
): String {
    val formatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM).withLocale(locale)
    return runCatching {
        OffsetDateTime.parse(raw).atZoneSameInstant(ZoneId.systemDefault()).format(formatter)
    }.recoverCatching {
        Instant.parse(raw).atZone(ZoneId.systemDefault()).format(formatter)
    }.getOrDefault(raw)
}

/**
 * The newest-first timeline the page renders — the native analogue of the web `[...incident.updates].reverse()`.
 * Updates arrive oldest-first from the backend; reversing yields newest-first without mutating the source list.
 */
fun timelineEntries(incident: Incident): List<IncidentUpdateEntry> = incident.updates.asReversed()

private const val MILLIS_PER_SECOND: Long = 1_000L
private const val SECONDS_PER_MINUTE: Long = 60L
private const val SECONDS_PER_HOUR: Long = 3_600L
private const val SECONDS_PER_DAY: Long = 86_400L

/**
 * Open/closed duration formatting — the native port of the web `fmtDuration(startIso, endIso?)`. The unit
 * abbreviations (`s` / `m` / `h` / `d`) are language-neutral and reproduced verbatim from the web template
 * literals (the web page hard-codes them, mirroring the CommandsPage `"15s"` cadence-label precedent), so they
 * carry no translation key. A blank/unparseable bound yields an empty string (web `return ''`).
 */
object IncidentTimelineDuration {
    /**
     * Formats the elapsed time between [startIso] and [endIso] (or [nowMs] when [endIso] is `null`, i.e. an open
     * incident) exactly like the web `fmtDuration`: under a minute → `${s}s`; under an hour → `${m}m`; under a day
     * → `${h}h ${m}m`; otherwise `${d}d ${h}h`. Returns an empty string when either bound fails to parse.
     */
    fun format(
        startIso: String,
        endIso: String?,
        nowMs: Long,
    ): String {
        val startMs = parseEpochMillis(startIso) ?: return ""
        val endMs = if (endIso == null) nowMs else parseEpochMillis(endIso) ?: return ""
        val seconds = ((endMs - startMs) / MILLIS_PER_SECOND).coerceAtLeast(0L)
        return when {
            seconds < SECONDS_PER_MINUTE -> "${seconds}s"
            seconds < SECONDS_PER_HOUR -> "${seconds / SECONDS_PER_MINUTE}m"
            seconds < SECONDS_PER_DAY -> "${seconds / SECONDS_PER_HOUR}h ${(seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE}m"
            else -> "${seconds / SECONDS_PER_DAY}d ${(seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR}h"
        }
    }

    // Tolerant decode chain (the same strategy as the IncidentsCard age parser): an RFC-3339 instant ("…Z"), then
    // an offset date-time, then a zoneless local date-time treated as UTC. The first that parses wins.
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseEpochMillis(raw: String): Long? =
        if (raw.isBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }?.toEpochMilli()

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Keep-previous-data merge for the detail feed — reproduces the web React-Query behaviour where a background
 * refetch (after an append/resolve invalidates the query) keeps the previously-loaded incident on screen rather
 * than blanking to a spinner: `isLoading` is true only on the very first load with no data. After a mutation the
 * S7 repository evicts the cache, so the next read emits `Loading(cached = null)`; this merge carries [prev]'s
 * cached incident into that slot (flagged refreshing by [toUiState]). A first-load failure with no carried value
 * stays a hard error (the not-found surface). Pure, so the contract is unit-testable without a network or cache.
 */
fun mergeKeepingIncidentData(
    prev: Resource<Incident>,
    cur: Resource<Incident>,
): Resource<Incident> {
    val carried = cur.cached ?: prev.cached
    return when (cur) {
        is Resource.Success -> cur
        is Resource.Loading ->
            if (cur.cached == null && carried != null) Resource.Loading(carried, cur.fetchedAt, cur.stale) else cur
        is Resource.Error ->
            if (cur.cached == null && carried != null) {
                Resource.Error(carried, cur.fetchedAt, cur.stale, cur.error)
            } else {
                cur
            }
    }
}

/** Raised when the route id is missing/non-positive — surfaces as the not-found view (web invalid-id branch). */
class IncidentNotFoundException : RuntimeException("incident id missing or not positive")

/**
 * The transient toasts the surface raises (web `useToast`), localized + toned at the Compose boundary (P1/S10).
 * Carries no pre-localized sentence and no PII (ADR-016) — the `*Failed` cases hold the server-supplied error text
 * the web shows verbatim (`err.message`), which the boundary falls back to a localized message for when blank.
 */
sealed interface IncidentTimelineToast {
    /** Web `toast.error('Update message is required.')` — the empty-message guard before any request. */
    data object UpdateRequired : IncidentTimelineToast

    /** Web `toast.success('Update added.')`. */
    data object UpdateAdded : IncidentTimelineToast

    /** Web `toast.error(err.message ?? 'Failed to append update')`. */
    data class AppendFailed(
        val detail: String?,
    ) : IncidentTimelineToast

    /** Web `toast.success('Incident resolved.')`. */
    data object Resolved : IncidentTimelineToast

    /** Web `toast.error(err.message ?? 'Failed to resolve')`. */
    data class ResolveFailed(
        val detail: String?,
    ) : IncidentTimelineToast
}
