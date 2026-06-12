// Pure, framework-free model + projection for the IncidentsCard feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/status/IncidentsCard.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web component reads the active-incidents feed (web `useIncidents({ activeOnly: true })`) and, for each
// row, computes exactly what this file owns: the severity → glyph/tone classification (web `SEVERITY_TONE`), the
// status → badge variant (web `STATUS_BADGE`), the "Started …" relative-age bucket (web `relativeFrom`), the
// "Affects: …" affected-components join (web `inc.affected_components.join(', ')`), and the "· N updates" suffix
// guard (web `inc.updates.length > 1`). The severity / status LABELS are rendered verbatim from the wire value,
// exactly as the web does (`tone.label` is the raw severity string and `{inc.status}` is the raw status), so the
// render layer resolves only the glyph + token color from the tones below.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/IncidentsCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view + dashboard-widget surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.incidentscard

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.incidents.Incident
import io.teslasync.shared.core.presentation.incidents.IncidentListResponse
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException
import java.util.Locale

private const val MILLIS_PER_SECOND: Long = 1_000L
private const val SECONDS_PER_MINUTE: Long = 60L
private const val SECONDS_PER_HOUR: Long = 3_600L
private const val SECONDS_PER_DAY: Long = 86_400L

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object IncidentsCardRegistration {
    /** Stable surface id. */
    const val ID: String = "incidents-card"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "IncidentsCard"
}

/**
 * Semantic severity tone of an incident — the native analogue of the web `SEVERITY_TONE` map keys. Each case
 * maps 1:1 to a web Lucide glyph + color (`minor` → AlertCircle/amber, `major` → AlertTriangle/orange,
 * `critical` → AlertOctagon/red); the render layer resolves each case to a concrete `ImageVector` + token color,
 * so this enum stays free of Compose types and is fully unit-testable. An unknown / future severity folds to
 * [Minor] — the least-alarming styling — rather than crashing the way the web `SEVERITY_TONE[severity]` lookup
 * would on a missing key.
 */
enum class IncidentSeverityTone {
    /** `minor` — web `AlertCircle` / amber. */
    Minor,

    /** `major` — web `AlertTriangle` / orange. */
    Major,

    /** `critical` — web `AlertOctagon` / red. */
    Critical,
    ;

    companion object {
        /** Classifies a raw `severity` like the web `SEVERITY_TONE[inc.severity]`; unknown/blank folds to [Minor]. */
        fun fromSeverity(severity: String?): IncidentSeverityTone =
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
 * future status folds to [Neutral] so the feed never bricks on a value the backend adds later. The render layer
 * maps each tone to a shared `BadgeVariant`; the badge LABEL is the raw status string (web `{inc.status}`).
 */
enum class IncidentStatusTone {
    Danger,
    Warning,
    Info,
    Success,
    Neutral,
    ;

    companion object {
        /** Classifies a raw `status` like the web `STATUS_BADGE[inc.status]`; unknown/blank folds to [Neutral]. */
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
 * The relative age of an incident's `started_at`, bucketed exactly like the web `relativeFrom`: "just now" under
 * a minute, whole minutes under an hour, whole hours under a day, otherwise whole days. The render layer formats
 * each case through the matching `translation_freshness_*` catalog string, so no English literal is baked in
 * here. A blank/unparseable timestamp projects to `null` (the web `relativeFrom` returns an empty string).
 */
sealed interface IncidentAge {
    /** Under one minute — web `just now`. */
    data object JustNow : IncidentAge

    /** Under one hour — web `${mins}m ago`. */
    data class Minutes(
        val value: Long,
    ) : IncidentAge

    /** Under one day — web `${hours}h ago`. */
    data class Hours(
        val value: Long,
    ) : IncidentAge

    /** A day or more — web `${days}d ago`. */
    data class Days(
        val value: Long,
    ) : IncidentAge
}

/**
 * One fully projected, render-ready incident row — the native analogue of everything the web component reads off
 * one `inc` inside its `incidents.map(...)`. Pure data (no Compose types): the composable maps [severityTone] to
 * an `ImageVector` + token color, [statusTone] to a `BadgeVariant`, formats [startedAge] through the freshness
 * catalog, and renders [severity] / [status] / [title] / [affectedJoined] verbatim.
 *
 * @property id the incident id — the web `to={/system-status/incidents/${inc.id}}` drill-through target.
 * @property title the incident title, shown verbatim (web `{inc.title}`).
 * @property severity the raw wire severity, rendered as the tone label (web `tone.label`).
 * @property severityTone the severity → glyph/color classification (web `SEVERITY_TONE` lookup).
 * @property status the raw wire status, rendered as the badge label (web `{inc.status}`).
 * @property statusTone the status → badge-variant classification (web `STATUS_BADGE` lookup).
 * @property affectedJoined the comma-joined affected components, or `null` when none (web guard `length > 0`).
 * @property startedAge the relative `started_at` age, or `null` when the timestamp is missing/unparseable.
 * @property updatesCount the number of timeline updates (web `inc.updates.length`).
 * @property showUpdates whether the "· N updates" suffix shows — web `inc.updates.length > 1`.
 */
data class IncidentRow(
    val id: Long,
    val title: String,
    val severity: String,
    val severityTone: IncidentSeverityTone,
    val status: String,
    val statusTone: IncidentStatusTone,
    val affectedJoined: String?,
    val startedAge: IncidentAge?,
    val updatesCount: Int,
    val showUpdates: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's per-row derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object IncidentsCardProjection {
    /**
     * Projects the active-incidents [response] into render-ready rows in feed order (web `incidents.map`). A
     * `null` response (a feed that has not loaded) yields an empty list, so the composable shows its empty state.
     * [now] is injected so the relative-age bucket is deterministic in tests; the composable supplies the wall
     * clock.
     */
    fun project(
        response: IncidentListResponse?,
        now: Instant,
    ): List<IncidentRow> = (response?.incidents ?: emptyList()).map { project(it, now) }

    /** Projects a single [incident] into a render-ready [IncidentRow]. */
    fun project(
        incident: Incident,
        now: Instant,
    ): IncidentRow =
        IncidentRow(
            id = incident.id,
            title = incident.title,
            severity = incident.severity,
            severityTone = IncidentSeverityTone.fromSeverity(incident.severity),
            status = incident.status,
            statusTone = IncidentStatusTone.fromStatus(incident.status),
            affectedJoined = incident.affectedComponents.takeIf { it.isNotEmpty() }?.joinToString(", "),
            startedAge = relativeFrom(now, incident.startedAt),
            updatesCount = incident.updates.size,
            showUpdates = incident.updates.size > 1,
        )

    /** The active-incident count for the header badge — web `incidents.length`. */
    fun activeCount(response: IncidentListResponse?): Int = response?.incidents?.size ?: 0

    /**
     * Buckets the age of [startedAt] relative to [now] exactly like the web `relativeFrom`: "just now" under a
     * minute, minutes under an hour, hours under a day, otherwise days. Returns `null` for a blank/unparseable
     * timestamp (the web returns an empty string). A future-dated timestamp clamps to zero → [IncidentAge.JustNow].
     */
    fun relativeFrom(
        now: Instant,
        startedAt: String,
    ): IncidentAge? {
        val started = parseInstant(startedAt) ?: return null
        val seconds = ((now.toEpochMilli() - started.toEpochMilli()) / MILLIS_PER_SECOND).coerceAtLeast(0L)
        return when {
            seconds < SECONDS_PER_MINUTE -> IncidentAge.JustNow
            seconds < SECONDS_PER_HOUR -> IncidentAge.Minutes(seconds / SECONDS_PER_MINUTE)
            seconds < SECONDS_PER_DAY -> IncidentAge.Hours(seconds / SECONDS_PER_HOUR)
            else -> IncidentAge.Days(seconds / SECONDS_PER_DAY)
        }
    }

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields null (the empty-age guard above).
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
 * The web microcopy the surface folds in. The web component hardcodes these English literals (it does not call
 * `useTranslation`), so no `translation.status.incidents.*` key exists in the drift-checked i18n catalog and one
 * must not be added from a surface prompt (ADR-014). These defaults reproduce the web literals verbatim and are
 * routed through [resolveOptional] so the catalog overrides them the moment a key is added. [EMPTY] is the
 * native-only friendly empty message shown where the web collapses the card entirely (`return null`).
 */
object IncidentsCardDefaults {
    /** Web header `Active incidents`. */
    const val TITLE: String = "Active incidents"

    /** Web CTA `Log incident`. */
    const val LOG: String = "Log incident"

    /** Web label prefix `Affects` (rendered `Affects: …`). */
    const val AFFECTS: String = "Affects"

    /** Web suffix noun `updates` (rendered `· N updates`). */
    const val UPDATES: String = "updates"

    /** Web prefix `Started` (rendered `Started …`). */
    const val STARTED: String = "Started"

    /** Native-only friendly empty message — the always-visible counterpart to the web `return null`. */
    const val EMPTY: String = "No active incidents"

    /** Native-only TalkBack click label for a row that opens the post-mortem timeline. */
    const val OPEN: String = "View incident"
}

/** Resource name for the header title (by-name; absent ⇒ [IncidentsCardDefaults.TITLE]). */
const val KEY_TITLE: String = "translation_status_incidents_title"

/** Resource name for the log CTA (by-name; absent ⇒ [IncidentsCardDefaults.LOG]). */
const val KEY_LOG: String = "translation_status_incidents_log"

/** Resource name for the affects prefix (by-name; absent ⇒ [IncidentsCardDefaults.AFFECTS]). */
const val KEY_AFFECTS: String = "translation_status_incidents_affects"

/** Resource name for the updates noun (by-name; absent ⇒ [IncidentsCardDefaults.UPDATES]). */
const val KEY_UPDATES: String = "translation_status_incidents_updates"

/** Resource name for the started prefix (by-name; absent ⇒ [IncidentsCardDefaults.STARTED]). */
const val KEY_STARTED: String = "translation_status_incidents_started"

/** Resource name for the empty message (by-name; absent ⇒ [IncidentsCardDefaults.EMPTY]). */
const val KEY_EMPTY: String = "translation_status_incidents_empty"

/** Resource name for the row open label (by-name; absent ⇒ [IncidentsCardDefaults.OPEN]). */
const val KEY_OPEN: String = "translation_status_incidents_open"

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests, so
 * the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Localized microcopy folded into the surface (P1/S10). The composable builds this from the i18n facade; tests
 * pass a deterministic instance.
 */
data class IncidentsCardStrings(
    val title: String,
    val log: String,
    val affects: String,
    val updates: String,
    val started: String,
    val empty: String,
    val open: String,
)

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [IncidentsCardRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordIncidentsCardOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to IncidentsCardRegistration.SLUG))
}
