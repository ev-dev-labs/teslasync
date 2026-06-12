// Pure, framework-free model + projection for the AlertCard feature view — the native analogue of everything
// the web component derives before returning JSX (web/src/features/notifications/components/AlertCard.tsx). No
// Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component is purely presentational — the hosting AlertsListPage loads the `Alert` and wires the
// mark-read / acknowledge / reopen / open-detail / open-context actions via callbacks. This file owns exactly
// the parts the web component computes from that prop: the alert-type → glyph classification (web `TYPE_ICONS`
// lookup), the relative "time ago" bucket (web `getTimeAgo`), the human type label (web
// `(type ?? 'notification').replace(/_/g, ' ')`), the acknowledged-state guard (web `Boolean(acknowledged_at)`)
// and its actor-vs-anonymous badge text (web `acknowledged_by ? t('ack.ackedBy') : t('ack.ackedByAnonymous')`).
// Severity normalization is delegated to the shared data-display helper so SeverityBadge / StatusDot / the icon
// chip all agree; the render layer resolves the glyph + severity token color at the Compose boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AlertCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.alertcard

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.Alert
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException
import java.util.Locale

/** Em dash shown when `created_at` is missing or unparseable — the "no value" fallback for the age chip. */
internal const val EM_DASH: String = "\u2014"

/** Wire-value fallback for a missing/blank alert type — the web `alert.type ?? 'notification'` literal. */
internal const val FALLBACK_TYPE: String = "notification"

private const val MILLIS_PER_MINUTE: Long = 60_000L
private const val MINUTES_PER_HOUR: Long = 60L
private const val HOURS_PER_DAY: Long = 24L

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AlertCardRegistration {
    /** Stable surface id. */
    const val ID: String = "alert-card"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AlertCard"
}

/**
 * Semantic icon classification of an alert's `type` — the native analogue of the web `TYPE_ICONS` map keys.
 * Each case maps 1:1 to a distinct web Lucide glyph; [Notification] is the catch-all the web `|| Icons.notifications`
 * fallback handles. The render layer resolves each case to a concrete `ImageVector`, so this enum stays free of
 * Compose types and is fully unit-testable.
 */
enum class AlertGlyph {
    /** `geofence_exit` / `geofence_enter` — web `Icons.location` (MapPin). */
    Location,

    /** `low_battery` / `battery_low` / `battery_high` — web `Icons.battery` (Battery). */
    Battery,

    /** `charging_complete` / `charging_cost` — web `Icons.charging` (Zap). */
    Charging,

    /** `sentry_event` — web `Icons.security` (Shield). */
    Security,

    /** `speed_limit` — web `Icons.speed` (Gauge). */
    Speed,

    /** `temperature` — web `Icons.climate` (Thermometer). */
    Climate,

    /** `software_update` — web `Icons.settingsAlt` (Settings2). */
    SoftwareUpdate,

    /** `vampire_drain` — web `Icons.trendDown` (TrendingDown). */
    VampireDrain,

    /** `tire_pressure_low` — web `Icons.droplets` (Droplets). */
    TirePressure,

    /** `idle_unlocked` — web `Icons.locked` (Lock). */
    Locked,

    /** `efficiency_drop` — web `Icons.analytics` (BarChart3). */
    Analytics,

    /** `system_database` — web `Icons.database` (Database). */
    Database,

    /** `system_mqtt` — web `Icons.wifi` (Wifi). */
    Mqtt,

    /** `system_redis` — web `Icons.hardDrive` (HardDrive). */
    Storage,

    /** `system_tesla_api` — web `Icons.radio` (Radio). */
    Radio,

    /** `system_worker` — web `Icons.efficiency` (Activity). */
    Worker,

    /** Any unmapped type — web `|| Icons.notifications` (Bell). */
    Notification,
    ;

    companion object {
        // Static type → glyph table, mirroring the web `TYPE_ICONS` object literal: a flat lookup rather than
        // per-call branching. Enum constants are initialized before the companion object, so referencing them
        // here is safe.
        private val BY_TYPE: Map<String, AlertGlyph> =
            mapOf(
                "geofence_exit" to Location,
                "geofence_enter" to Location,
                "low_battery" to Battery,
                "battery_low" to Battery,
                "battery_high" to Battery,
                "charging_complete" to Charging,
                "charging_cost" to Charging,
                "sentry_event" to Security,
                "speed_limit" to Speed,
                "temperature" to Climate,
                "software_update" to SoftwareUpdate,
                "vampire_drain" to VampireDrain,
                "tire_pressure_low" to TirePressure,
                "idle_unlocked" to Locked,
                "efficiency_drop" to Analytics,
                "system_database" to Database,
                "system_mqtt" to Mqtt,
                "system_redis" to Storage,
                "system_tesla_api" to Radio,
                "system_worker" to Worker,
            )

        /**
         * Classifies a raw alert `type` exactly like the web `TYPE_ICONS[alert.type]` lookup (case/space tolerant;
         * the backend always emits lower snake_case). An unknown / blank type folds to [Notification], mirroring
         * the web `|| Icons.notifications` fallback.
         */
        fun fromType(type: String?): AlertGlyph = BY_TYPE[type?.trim()?.lowercase(Locale.ROOT)] ?: Notification
    }
}

/**
 * The relative age of an alert's `created_at`, bucketed exactly like the web `getTimeAgo`: minutes while under an
 * hour, whole hours while under a day, otherwise whole days. The render layer formats each case through the
 * matching `translation_freshness_*` catalog string (`"%1$sm/h/d ago"`), so no English literal is baked in here.
 */
sealed interface RelativeAge {
    /** Under one hour — web `${mins}m ago`. */
    data class Minutes(
        val value: Long,
    ) : RelativeAge

    /** Under one day — web `${hours}h ago`. */
    data class Hours(
        val value: Long,
    ) : RelativeAge

    /** A day or more — web `${days}d ago`. */
    data class Days(
        val value: Long,
    ) : RelativeAge
}

/**
 * Localized microcopy the projection folds into the surface (P1/S10). The actor-interpolated [acknowledgedByActor]
 * is a lambda so the composable can resolve the `%1$s` argument through `Context.getString`; tests pass a
 * deterministic one. Mirrors the web `t('alerts.ack.*')` keys.
 */
data class AlertCardStrings(
    val viewContext: String,
    val unread: String,
    val auditTimeline: String,
    val acknowledge: String,
    val reopened: String,
    val markRead: String,
    val acknowledgedAnonymous: String,
    val acknowledgedByActor: (actor: String) -> String,
)

/**
 * One fully projected, render-ready alert — the native analogue of everything the web component reads off its
 * `alert` prop. Pure data (no Compose types): the composable maps [glyph] to an `ImageVector`, resolves [severity]
 * to a token color, formats [age] through the freshness catalog, and renders the rest verbatim.
 *
 * @property title the alert title (wire data, shown verbatim — web `{alert.title}`).
 * @property message the alert body (wire data — web `{alert.message}`, clamped to two lines at the boundary).
 * @property severity the raw wire severity, passed to SeverityBadge / StatusDot / the icon-chip token color.
 * @property glyph the type → icon classification (web `TYPE_ICONS` lookup).
 * @property typeLabel the human type label — web `(type ?? 'notification').replace(/_/g, ' ')`.
 * @property isRead whether the alert has been read — drives the unread accent + dot + Mark-read action.
 * @property isAcknowledged whether `acknowledged_at` is present — web `Boolean(alert.acknowledged_at)`.
 * @property acknowledgedLabel the already-resolved acknowledged badge text, or `null` when not acknowledged.
 * @property age the relative `created_at` age, or `null` when the timestamp is missing/unparseable.
 */
data class AlertCardRow(
    val title: String,
    val message: String,
    val severity: String,
    val glyph: AlertGlyph,
    val typeLabel: String,
    val isRead: Boolean,
    val isAcknowledged: Boolean,
    val acknowledgedLabel: String?,
    val age: RelativeAge?,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's prop derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object AlertCardProjection {
    /**
     * Projects an [alert] into a render-ready [AlertCardRow]. [now] is injected so the relative-age bucket is
     * deterministic in tests; the composable supplies the real wall clock. [strings] resolve the acknowledged
     * badge text (actor-interpolated or anonymous) at projection time, mirroring the web ternary.
     */
    fun project(
        alert: Alert,
        strings: AlertCardStrings,
        now: Instant,
    ): AlertCardRow =
        AlertCardRow(
            title = alert.title,
            message = alert.message,
            severity = alert.severity,
            glyph = AlertGlyph.fromType(alert.type),
            typeLabel = typeLabel(alert.type),
            isRead = alert.isRead,
            isAcknowledged = isAcknowledged(alert.acknowledgedAt),
            acknowledgedLabel = acknowledgedLabel(alert.acknowledgedAt, alert.acknowledgedBy, strings),
            age = timeAgo(alert.createdAt, now),
        )

    /** Human type label — web `(alert.type ?? 'notification').replace(/_/g, ' ')`, with blank folded to the fallback. */
    fun typeLabel(type: String?): String = (type?.takeIf { it.isNotBlank() } ?: FALLBACK_TYPE).replace('_', ' ')

    /** Web `Boolean(alert.acknowledged_at)` — any non-empty timestamp is acknowledged, null/empty is not. */
    fun isAcknowledged(acknowledgedAt: String?): Boolean = !acknowledgedAt.isNullOrEmpty()

    /**
     * The acknowledged badge text, or `null` when the alert is not acknowledged. Mirrors the web ternary: a
     * present, non-blank actor picks the interpolated `ack.ackedBy` microcopy, otherwise the anonymous
     * `ack.ackedByAnonymous` microcopy.
     */
    fun acknowledgedLabel(
        acknowledgedAt: String?,
        acknowledgedBy: String?,
        strings: AlertCardStrings,
    ): String? {
        if (!isAcknowledged(acknowledgedAt)) return null
        val actor = acknowledgedBy?.takeIf { it.trim().isNotEmpty() }
        return actor?.let(strings.acknowledgedByActor) ?: strings.acknowledgedAnonymous
    }

    /**
     * Buckets the age of [createdAt] relative to [now] exactly like the web `getTimeAgo`: minutes under an hour,
     * hours under a day, otherwise days. Returns `null` for a blank/unparseable timestamp (the composable shows
     * [EM_DASH]) — an improvement on the web helper's `NaN…` output. A future-dated timestamp clamps to zero.
     */
    fun timeAgo(
        createdAt: String,
        now: Instant,
    ): RelativeAge? {
        val created = parseInstant(createdAt) ?: return null
        val minutes = (now.toEpochMilli() - created.toEpochMilli()).coerceAtLeast(0L) / MILLIS_PER_MINUTE
        val hours = minutes / MINUTES_PER_HOUR
        return when {
            minutes < MINUTES_PER_HOUR -> RelativeAge.Minutes(minutes)
            hours < HOURS_PER_DAY -> RelativeAge.Hours(hours)
            else -> RelativeAge.Days(hours / HOURS_PER_DAY)
        }
    }

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields null (the em-dash guard above).
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
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AlertCardRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordAlertCardOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AlertCardRegistration.SLUG))
}
