// Pure, framework-free model + projection for the NotificationRow feature view — the native analogue of
// everything the web component derives before returning JSX (web/src/features/notifications/components/
// NotificationRow.tsx). No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in
// the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component is purely presentational — the hosting inbox loads the NotificationLog (plus the optional
// matching AlertRule + Vehicle) and wires the select / activate / mark-read / mark-unread / archive / unarchive
// actions through callbacks. This file owns exactly the parts the web component computes from those props: the
// read guard (web `Boolean(log.read_at)`), the archived guard (web `Boolean(log.archived_at)`), the badge
// severity (web `rule?.severity ?? 'info'`), the vehicle label (web `vehicle.display_name || #${vehicle.id}`),
// the rule label, the timezone mode (web `vehicle ? 'vehicle' : 'user'`), the drill-through availability (web
// `rule ? getAlertDrillthroughHref(...) : null`), and the tolerant timestamp parse + absolute format the web
// `<DateTime>` renders. Severity normalization is delegated to the shared data-display helper at the render
// boundary so the SeverityBadge agrees with the unread accent.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/NotificationRow — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.notificationrow

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import java.time.DateTimeException
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

/** Em dash shown when `created_at` is missing or unparseable — the "no value" timestamp fallback. */
internal const val EM_DASH: String = "\u2014"

/** Default badge severity when no rule is matched — the web `rule?.severity ?? 'info'` fallback. */
internal const val DEFAULT_SEVERITY: String = "info"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object NotificationRowRegistration {
    /** Stable surface id. */
    const val ID: String = "notification-row"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "NotificationRow"
}

/**
 * The host-supplied inputs for one inbox row — the native analogue of the web component's data props. The
 * [log] is the only required input (web `log`); the matching [rule] and [vehicle] are optional context the host
 * resolved from the rules / vehicles feeds, mirroring the web `rule?` / `vehicle?` props.
 */
data class NotificationRowInput(
    val log: NotificationLog,
    val rule: AlertRule? = null,
    val vehicle: Vehicle? = null,
)

/**
 * Which timezone the row's timestamp is shown in — the web `tzMode = vehicle ? 'vehicle' : 'user'`. The shared
 * [Vehicle] model carries no per-vehicle timezone, so both modes currently format in the device zone (the
 * "user" zone on device); the web `<DateTime in="vehicle">` likewise falls back to the local zone when a
 * vehicle timezone is unknown. The field is projected and tested so the contract is mirrored honestly and a
 * future vehicle-zone source can be threaded in without changing the row.
 */
enum class TzMode { Vehicle, User }

/**
 * One fully projected, render-ready inbox row — the native analogue of everything the web component reads off
 * its props. Pure data (no Compose types): the composable resolves [severity] to a token color + SeverityBadge,
 * formats [timestamp] through [NotificationRowProjection.formatTimestamp], and renders the rest verbatim.
 *
 * @property title the notification title (wire data, shown verbatim — web `{log.title}`).
 * @property message the notification body, or `null` when blank (web shows the line only when `log.message`).
 * @property severity the badge severity — web `rule?.severity ?? 'info'`.
 * @property isRead whether `read_at` is present — web `Boolean(log.read_at)`; mutes the title + drops the dot.
 * @property isArchived whether `archived_at` is present — web `Boolean(log.archived_at)`; toggles the action.
 * @property vehicleLabel the vehicle chip text, or `null` when no vehicle — web `vehicle.display_name || #id`.
 * @property ruleName the rule chip text, or `null` when no (named) rule — web `rule?.name`.
 * @property timestamp the parsed `created_at`, or `null` when missing/unparseable (renders [EM_DASH]).
 * @property timezone the vehicle's IANA timezone id when known, else `null` — drives the display zone.
 * @property tzMode the timezone the timestamp is shown in — web `vehicle ? 'vehicle' : 'user'`.
 * @property hasDrillthrough whether a "View context" link is offered — web `rule ? href : null`.
 */
data class NotificationRowData(
    val title: String,
    val message: String?,
    val severity: String,
    val isRead: Boolean,
    val isArchived: Boolean,
    val vehicleLabel: String?,
    val ruleName: String?,
    val timestamp: Instant?,
    val timezone: String?,
    val tzMode: TzMode,
    val hasDrillthrough: Boolean,
)

/**
 * Localized microcopy the row folds in (P1/S10) — the web `t('notifications.inbox.row.*')` keys plus
 * `t('alerts.viewContext')`. Resolved once at the Compose boundary and handed to the stateless body so the
 * pure tests can supply deterministic values.
 */
data class NotificationRowStrings(
    val select: String,
    val markRead: String,
    val markUnread: String,
    val archive: String,
    val unarchive: String,
    val viewContext: String,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's prop derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object NotificationRowProjection {
    private val TIMESTAMP_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("MMM d, HH:mm")

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields null (the em-dash guard).
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    /**
     * Projects an [input] into a render-ready [NotificationRowData], mirroring the web component's prop
     * derivations 1:1. Pure — the display clock lives in [formatTimestamp], not here.
     */
    fun project(input: NotificationRowInput): NotificationRowData {
        val log = input.log
        return NotificationRowData(
            title = log.title,
            message = log.message.takeIf { it.isNotBlank() },
            severity = input.rule?.severity ?: DEFAULT_SEVERITY,
            isRead = isPresent(log.readAt),
            isArchived = isPresent(log.archivedAt),
            vehicleLabel = vehicleLabel(input.vehicle),
            ruleName = input.rule?.name?.takeIf { it.isNotBlank() },
            timestamp = parseTimestamp(log.createdAt),
            timezone = input.vehicle?.timezone,
            tzMode = if (input.vehicle != null) TzMode.Vehicle else TzMode.User,
            hasDrillthrough = input.rule != null,
        )
    }

    /** Web `Boolean(log.read_at)` / `Boolean(log.archived_at)` — any non-empty timestamp is "present". */
    fun isPresent(value: String?): Boolean = !value.isNullOrEmpty()

    /** The vehicle chip text — web `vehicle.display_name || #${vehicle.id}`, or `null` when no vehicle. */
    fun vehicleLabel(vehicle: Vehicle?): String? = vehicle?.let { it.displayName.takeIf(String::isNotBlank) ?: "#${it.id}" }

    /**
     * Resolves the display zone the timestamp is shown in — the web `<DateTime in="vehicle">` semantics. A known,
     * valid vehicle [timezone] wins; a blank/unknown/invalid id falls back to [fallback] (the device "user" zone),
     * exactly as the web `<DateTime>` degrades when a vehicle timezone is unavailable.
     */
    fun resolveZone(
        timezone: String?,
        fallback: ZoneId,
    ): ZoneId = timezone?.takeIf { it.isNotBlank() }?.let(::tryZone) ?: fallback

    /**
     * Parses a `created_at` string into an [Instant], tolerating an RFC-3339 instant, an offset date-time, or a
     * zoneless local date-time (treated as UTC). Returns `null` for a blank/unparseable value — the composable
     * then renders [EM_DASH], an improvement on the web helper's empty output.
     */
    fun parseTimestamp(raw: String): Instant? = if (raw.isBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }

    /**
     * Formats a parsed [instant] for display in [zone] using [locale] — the absolute timestamp the web
     * `<DateTime>` renders. A `null` instant (missing / unparseable `created_at`) renders the [EM_DASH] fallback.
     */
    fun formatTimestamp(
        instant: Instant?,
        zone: ZoneId,
        locale: Locale,
    ): String = instant?.let { TIMESTAMP_FORMAT.withLocale(locale).withZone(zone).format(it) } ?: EM_DASH

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }

    private fun tryZone(id: String): ZoneId? =
        try {
            ZoneId.of(id)
        } catch (_: DateTimeException) {
            null
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [NotificationRowRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordNotificationRowOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to NotificationRowRegistration.SLUG))
}
