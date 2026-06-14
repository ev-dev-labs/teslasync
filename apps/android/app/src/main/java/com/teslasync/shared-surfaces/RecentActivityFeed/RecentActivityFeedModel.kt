// The data layer of the RecentActivityFeed shared surface — a parity port of the web
// `RecentActivityFeed` component (web/src/components/data-display/RecentActivityFeed.tsx) together with the
// two pure libraries it leans on: the per-action visual registry (web/src/lib/activityIcons.ts
// `getActivityVisual`) and the relative-timestamp bucketing (web/src/lib/dateFormat.ts `formatRelative`). The
// Compose view lives in RecentActivityFeed.kt; the marker glyphs in RecentActivityFeedGlyphs.kt.
//
// What the web surface does: it is presentational. Its parent (`MyActivityPage`) owns the audit-log feed and
// passes it down as `entries: UserActivityEntry[]`. The component renders NOTHING but two branches — an
// `<EmptyState>` when the array is empty (`entries.length === 0`), else a `<Timeline>` whose rows it derives:
// each entry maps through `getActivityVisual(action)` to an icon + accent + localized title, an
// entity_type/entity_id + detail subtitle, a `formatRelative(ts)` timestamp, and an optional click-through
// `entityHref(entity_type, entity_id)`. Its only hook is `useTranslation`.
//
// The native port keeps that contract 1:1 and adds the lifecycle states the P3 shared-surface tier mandates:
//   • [UserActivityEntry] is the render-facing port of the web `UserActivityEntry` (web/src/types/admin.ts) —
//     the audit-log fields the feed actually consumes. The web type also carries `ip` / `user_agent`; the
//     component never renders them (PII), so the render shape drops them.
//   • [AuditLogRow] + [toActivityEntry] port the snake_case backend/offline-cache row (`GET /me/activity`)
//     and its projection onto the render shape — the adapter the off-device unit test pins
//     ("cached -> projection"), and the seam that proves `ip` / `user_agent` are dropped at the boundary.
//   • [getActivityVisual] reproduces the web `activityIcons.ts` registry verbatim — the same prefix-walk
//     fallback (`vehicle.command.wake` -> `vehicle.command` -> generic) and the same i18n key + English
//     fallback per action. Colors/icons are carried as the vendor-neutral [ActivityGlyph] / [ActivityAccent]
//     kinds (never an `ImageVector`/`Color` here) so the projection stays Compose-free and unit-testable.
//   • [entityHref] ports the web `entityHref` entity_type -> route map (vehicle/drive/charge/... ), including
//     the `encodeURIComponent` id escaping ([encodeUriComponent]); a null result means "no click-through".
//   • [activityTime] + [parseActivityTimestampMillis] port the web `formatRelative` buckets — "just now",
//     "Nm/Nh/Nd ago" under seven days, and an absolute localized date beyond — reusing the shared
//     [computeAgeSeconds]/[relativeAge] primitives so the cutoffs match the rest of the app.
//   • [RecentActivityRow] + [toRow] are the fully projected render shape the composable consumes.
//   • [RecentActivityFeedState] is the P1/S8 state holder the view binds to: a hot [StateFlow] of a
//     cache-then-network [UiState] feed, with writers that drive every lifecycle the prompt lists (loading /
//     content / empty / hard error / stale-offline "last known" / background refresh). It owns no networking —
//     a host seeds it with already-projected entries or cached rows.
//   • [RecentActivityFeedDiagnostics] emits the one PII-safe `view.opened` event (P1/S11), slug
//     `RecentActivityFeed`.
//
// States — documented, not silently invented (Honesty Covenant #9): the web component itself has only two
// branches (empty / content) because its parent owns the fetch. The native surface reproduces those exactly
// and additionally renders the shared lifecycle states the P3 tier mandates (loading skeleton, hard-error
// retry, stale/offline freshness chip) by binding the host's feed as a [UiState] — exactly as the accepted
// sibling AutomationActivityFeed port does. No decorative panel chrome is added, because the web surface has
// none (its parent supplies the panel); the surface stays a bare feed plus thin lifecycle chrome.
//
// The mandated surface directory (com/teslasync/shared-surfaces/RecentActivityFeed — the P3 prompt's
// allowed-files path) cannot form a valid Kotlin package (a hyphen and a capitalised leaf are illegal in a
// package id), so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.recentactivityfeed

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException

/** The em dash the web `formatRelative` returns for a missing/unparseable timestamp (`'—'`). */
internal const val EM_DASH: String = "\u2014"

/** Seven days in seconds — the web `formatRelative` crossover from "Nd ago" to an absolute date. */
internal const val SEVEN_DAYS_SECONDS: Long = 7L * 24L * 60L * 60L

// ── Vendor-neutral marker classification (web `activityIcons.ts`) ──────────────────────────────────────────

/**
 * Pure marker-glyph key — the native analogue of the lucide icon the web `getActivityVisual` picks. The
 * composable resolves each key to a concrete `ImageVector` (RecentActivityFeedGlyphs.resolve); keeping the
 * selection here makes the registry unit-testable off-device.
 */
enum class ActivityGlyph {
    Gamepad,
    Power,
    NotificationsActive,
    Lock,
    Unlock,
    Climate,
    Bolt,
    Settings,
    NotificationsAdd,
    Notifications,
    NotificationsMuted,
    Workflow,
    LayoutGrid,
    Dashboard,
    Download,
    Key,
    User,
    History,
}

/**
 * Pure marker-accent key — the native analogue of the web Tailwind text color (`text-fuchsia-400`,
 * `text-amber-300`, …). [argb] is the exact 0xAARRGGBB the web class resolves to (a fixed palette, not a
 * theme token, so the dot matches the web in every theme); [Muted] carries `null` and resolves to the theme's
 * muted color at the Compose boundary (web `text-[var(--text-muted)]`).
 */
enum class ActivityAccent(
    val argb: Long?,
) {
    Fuchsia(0xFFE879F9L),
    Amber(0xFFFCD34DL),
    Yellow(0xFFFDE047L),
    Emerald(0xFF6EE7B7L),
    Sky(0xFF7DD3FCL),
    Indigo(0xFFA5B4FCL),
    Rose(0xFFFDA4AFL),
    Cyan(0xFF67E8F9L),
    Violet(0xFFC4B5FDL),
    Teal(0xFF5EEAD4L),
    Muted(null),
}

/**
 * The resolved visual for one action — the native analogue of the web `ActivityVisual`. [labelKey] is the web
 * i18n key (no namespace, e.g. `activity.action.vehicleCommandWake`); the composable maps it to the matching
 * `R.string.translation_activity_action_*`. [fallback] is the English fallback the web passes as the second
 * `t()` argument (used only when the catalog entry is missing).
 */
data class ActivityVisual(
    val glyph: ActivityGlyph,
    val accent: ActivityAccent,
    val labelKey: String,
    val fallback: String,
)

/** Concise constructor alias for the [ACTIVITY_REGISTRY] entries — keeps each line within the style budget. */
private fun vis(
    glyph: ActivityGlyph,
    accent: ActivityAccent,
    labelKey: String,
    fallback: String,
): ActivityVisual = ActivityVisual(glyph, accent, labelKey, fallback)

/**
 * The action -> visual registry — a verbatim port of the web `activityIcons.ts` REGISTRY. Keys are the same
 * `domain.verb` action strings the Go API writes into `audit_logs.action`; [getActivityVisual] walks from the
 * most-specific prefix down, exactly as the web does.
 */
internal val ACTIVITY_REGISTRY: Map<String, ActivityVisual> =
    mapOf(
        // Vehicle commands
        "vehicle.command" to
            vis(ActivityGlyph.Gamepad, ActivityAccent.Fuchsia, "activity.action.vehicleCommand", "Vehicle command"),
        "vehicle.command.wake" to
            vis(ActivityGlyph.Power, ActivityAccent.Amber, "activity.action.vehicleCommandWake", "Wake vehicle"),
        "vehicle.command.honk" to
            vis(ActivityGlyph.NotificationsActive, ActivityAccent.Amber, "activity.action.vehicleCommandHonk", "Honk horn"),
        "vehicle.command.flash" to
            vis(ActivityGlyph.Power, ActivityAccent.Yellow, "activity.action.vehicleCommandFlash", "Flash lights"),
        "vehicle.command.lock" to
            vis(ActivityGlyph.Lock, ActivityAccent.Emerald, "activity.action.vehicleCommandLock", "Lock vehicle"),
        "vehicle.command.unlock" to
            vis(ActivityGlyph.Unlock, ActivityAccent.Amber, "activity.action.vehicleCommandUnlock", "Unlock vehicle"),
        "vehicle.command.climate" to
            vis(ActivityGlyph.Climate, ActivityAccent.Sky, "activity.action.vehicleCommandClimate", "Climate command"),
        "vehicle.command.charge" to
            vis(ActivityGlyph.Bolt, ActivityAccent.Emerald, "activity.action.vehicleCommandCharge", "Charging command"),
        // Settings / preferences
        "settings.update" to
            vis(ActivityGlyph.Settings, ActivityAccent.Indigo, "activity.action.settingsUpdate", "Settings updated"),
        "settings" to
            vis(ActivityGlyph.Settings, ActivityAccent.Indigo, "activity.action.settings", "Settings change"),
        // Alerts
        "alert.rule.create" to
            vis(ActivityGlyph.NotificationsAdd, ActivityAccent.Rose, "activity.action.alertRuleCreate", "Alert rule created"),
        "alert.rule.update" to
            vis(ActivityGlyph.Notifications, ActivityAccent.Rose, "activity.action.alertRuleUpdate", "Alert rule updated"),
        "alert.rule.delete" to
            vis(ActivityGlyph.NotificationsMuted, ActivityAccent.Rose, "activity.action.alertRuleDelete", "Alert rule deleted"),
        "alert" to
            vis(ActivityGlyph.Notifications, ActivityAccent.Rose, "activity.action.alert", "Alert change"),
        // Automations
        "automation.create" to
            vis(ActivityGlyph.Workflow, ActivityAccent.Cyan, "activity.action.automationCreate", "Automation created"),
        "automation.update" to
            vis(ActivityGlyph.Workflow, ActivityAccent.Cyan, "activity.action.automationUpdate", "Automation updated"),
        "automation.delete" to
            vis(ActivityGlyph.Workflow, ActivityAccent.Cyan, "activity.action.automationDelete", "Automation deleted"),
        "automation" to
            vis(ActivityGlyph.Workflow, ActivityAccent.Cyan, "activity.action.automation", "Automation change"),
        // Dashboard / layout
        "dashboard.layout.save" to
            vis(ActivityGlyph.LayoutGrid, ActivityAccent.Violet, "activity.action.dashboardLayoutSave", "Dashboard layout saved"),
        "dashboard" to
            vis(ActivityGlyph.Dashboard, ActivityAccent.Violet, "activity.action.dashboard", "Dashboard change"),
        // Data exports
        "data_export.create" to
            vis(ActivityGlyph.Download, ActivityAccent.Teal, "activity.action.dataExportCreate", "Data export requested"),
        "data_export" to
            vis(ActivityGlyph.Download, ActivityAccent.Teal, "activity.action.dataExport", "Data export"),
        // API keys
        "api_key.create" to
            vis(ActivityGlyph.Key, ActivityAccent.Amber, "activity.action.apiKeyCreate", "API key created"),
        "api_key.update" to
            vis(ActivityGlyph.Key, ActivityAccent.Amber, "activity.action.apiKeyUpdate", "API key updated"),
        "api_key.delete" to
            vis(ActivityGlyph.Key, ActivityAccent.Amber, "activity.action.apiKeyDelete", "API key revoked"),
        "api_key" to
            vis(ActivityGlyph.Key, ActivityAccent.Amber, "activity.action.apiKey", "API key change"),
        // Auth
        "auth.login" to
            vis(ActivityGlyph.User, ActivityAccent.Emerald, "activity.action.authLogin", "Signed in"),
        "auth.logout" to
            vis(ActivityGlyph.User, ActivityAccent.Muted, "activity.action.authLogout", "Signed out"),
        "auth" to
            vis(ActivityGlyph.User, ActivityAccent.Muted, "activity.action.auth", "Authentication"),
    )

/** The generic catch-all — the web `activityIcons.ts` FALLBACK (history glyph, muted, `activity.action.unknown`). */
internal val ACTIVITY_FALLBACK: ActivityVisual =
    ActivityVisual(ActivityGlyph.History, ActivityAccent.Muted, "activity.action.unknown", "Activity")

/**
 * Resolves an action string to its visual — the verbatim port of the web `getActivityVisual`: an exact hit
 * first, then progressively shorter dot-prefixes (`vehicle.command.wake` -> `vehicle.command` -> …), then the
 * generic [ACTIVITY_FALLBACK]. A blank action resolves to the fallback.
 */
fun getActivityVisual(action: String): ActivityVisual {
    val normalized = action.trim()
    ACTIVITY_REGISTRY[normalized]?.let { return it }
    val parts = normalized.split('.')
    val prefixHit =
        (parts.size - 1 downTo 1).firstNotNullOfOrNull { i ->
            ACTIVITY_REGISTRY[parts.subList(0, i).joinToString(".")]
        }
    return prefixHit ?: ACTIVITY_FALLBACK
}

// ── Entity click-through (web `entityHref`) ────────────────────────────────────────────────────────────────

/** The set of characters `encodeURIComponent` leaves un-escaped (unreserved per RFC 3986 + the JS extras). */
private const val URI_UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"

/**
 * Percent-encodes [value] the way the web `encodeURIComponent` does: every UTF-8 byte outside the unreserved
 * set becomes `%XX`. Used to escape an entity id before splicing it into a route, matching the web exactly for
 * numeric / VIN-style ids and any id with reserved characters.
 */
fun encodeUriComponent(value: String): String {
    val out = StringBuilder(value.length)
    for (byte in value.toByteArray(Charsets.UTF_8)) {
        val ch = (byte.toInt() and 0xFF).toChar()
        if (ch in URI_UNRESERVED) {
            out.append(ch)
        } else {
            out.append('%').append(((byte.toInt() and 0xFF)).toString(16).uppercase().padStart(2, '0'))
        }
    }
    return out.toString()
}

/**
 * Maps an entity_type (+ id) to a frontend route — the verbatim port of the web `entityHref`. A null result
 * means "render the title as plain text" (no click-through); the parameterised routes escape the id with
 * [encodeUriComponent], the fixed routes ignore it (exactly as the web does).
 */
fun entityHref(
    entityType: String?,
    entityId: String?,
): String? {
    if (entityType.isNullOrEmpty() || entityId.isNullOrEmpty()) return null
    return when (entityType) {
        "vehicle" -> "/vehicles/${encodeUriComponent(entityId)}"
        "drive" -> "/drives/${encodeUriComponent(entityId)}"
        "charging_session", "charge" -> "/charging/${encodeUriComponent(entityId)}"
        "alert_rule" -> "/notifications/alerts"
        "automation" -> "/automations"
        "geofence" -> "/geofences"
        "data_export", "export" -> "/data-export"
        "api_key" -> "/api-keys"
        else -> null
    }
}

// ── Relative timestamp (web `formatRelative`) ──────────────────────────────────────────────────────────────

/**
 * The classified timestamp label — the native analogue of the web `formatRelative` result. [Relative] carries
 * a [FreshnessAge] bucket (rendered "just now" / "Nm/Nh/Nd ago") for anything under seven days; [Absolute]
 * carries the epoch millis for an older entry the composable formats as a localized date; [Unknown] is the web
 * `'—'` for a missing/unparseable timestamp.
 */
sealed interface ActivityTime {
    /** No / unparseable timestamp — the web `'—'`. */
    data object Unknown : ActivityTime

    /** Under seven days old — a relative bucket (web "just now" / "Nm/Nh/Nd ago"). */
    data class Relative(
        val age: FreshnessAge,
    ) : ActivityTime

    /** Seven days or older — an absolute localized date (web `formatDate` fall-through). */
    data class Absolute(
        val epochMillis: Long,
    ) : ActivityTime
}

/**
 * Parses an audit-log ISO-8601 timestamp to epoch millis, tolerant of an explicit offset (`…+02:00`), a `Z`
 * suffix, or a bare local date-time (assumed UTC, as the backend writes UTC). Returns null on an unparseable
 * value so the row renders the web `'—'`, never a crash.
 */
fun parseActivityTimestampMillis(iso: String): Long? {
    val trimmed = iso.trim()
    if (trimmed.isEmpty()) return null
    return runCatching { OffsetDateTime.parse(trimmed).toInstant().toEpochMilli() }
        .recoverCatching { error -> if (error is DateTimeParseException) Instant.parse(trimmed).toEpochMilli() else throw error }
        .recoverCatching { error ->
            if (error is DateTimeParseException) {
                LocalDateTime.parse(trimmed).toInstant(ZoneOffset.UTC).toEpochMilli()
            } else {
                throw error
            }
        }.getOrNull()
}

/**
 * Buckets a timestamp into an [ActivityTime] — the web `formatRelative` cutoffs: under seven days uses the
 * shared [relativeAge] buckets (whose <60s/<60m/<24h/<7d boundaries match the web exactly), seven days or more
 * becomes an [ActivityTime.Absolute]. A null [timestampMillis] is [ActivityTime.Unknown].
 */
fun activityTime(
    timestampMillis: Long?,
    nowMillis: Long,
): ActivityTime {
    if (timestampMillis == null) return ActivityTime.Unknown
    val ageSeconds = computeAgeSeconds(timestampMillis, nowMillis)
    return when {
        ageSeconds == null -> ActivityTime.Unknown
        ageSeconds >= SEVEN_DAYS_SECONDS -> ActivityTime.Absolute(timestampMillis)
        else -> ActivityTime.Relative(relativeAge(ageSeconds))
    }
}

// ── Render shapes + projection (web component derivations) ───────────────────────────────────────────────

/**
 * The render-facing port of the web `UserActivityEntry` (web/src/types/admin.ts) — the audit-log fields the
 * feed consumes. The web type also carries `ip` / `user_agent`; the component never renders them, so they are
 * intentionally absent here (PII never reaches the render layer).
 */
data class UserActivityEntry(
    val id: Long,
    val ts: String,
    val action: String,
    val entityType: String?,
    val entityId: String?,
    val detail: String?,
)

/**
 * A raw backend / offline-cache audit-log row — the snake_case `GET /api/v1/me/activity` shape, including the
 * `ip` / `user_agent` columns the API returns. [toActivityEntry] projects it onto the render shape, dropping
 * the PII fields — the adapter the off-device unit test pins.
 */
data class AuditLogRow(
    val id: Long,
    val ts: String,
    val action: String,
    val entityType: String?,
    val entityId: String?,
    val detail: String?,
    val ip: String? = null,
    val userAgent: String? = null,
)

/** Projects a cached [AuditLogRow] onto the render-facing [UserActivityEntry], dropping `ip` / `user_agent`. */
fun AuditLogRow.toActivityEntry(): UserActivityEntry =
    UserActivityEntry(
        id = id,
        ts = ts,
        action = action,
        entityType = entityType,
        entityId = entityId,
        detail = detail,
    )

/**
 * One fully-projected, render-ready row — the native analogue of a single web `Timeline` item. Pure data (the
 * composable maps [glyph]/[accent] to an `ImageVector`/`Color`, [titleKey] to a string resource, and [time] to
 * a formatted label): [id] is the stable key, [subtitle] the entity/detail line (null when empty), and [href]
 * the click-through route (null = plain, non-tappable title).
 */
data class RecentActivityRow(
    val id: String,
    val glyph: ActivityGlyph,
    val accent: ActivityAccent,
    val titleKey: String,
    val titleFallback: String,
    val subtitle: String?,
    val time: ActivityTime,
    val href: String?,
)

/**
 * Projects one [UserActivityEntry] onto a [RecentActivityRow] — the web component's per-entry derivation: the
 * visual via [getActivityVisual], the subtitle from `entity_type · entity_id` joined to `detail` with ` — `
 * (web `subtitleParts.join(' — ')`, empty -> null), the [activityTime] label, and the [entityHref] route.
 * [nowMillis] anchors the relative time so the projection is deterministic and unit-testable.
 */
fun UserActivityEntry.toRow(nowMillis: Long): RecentActivityRow {
    val visual = getActivityVisual(action)
    val subtitleParts =
        buildList {
            if (!entityType.isNullOrEmpty()) {
                add(if (!entityId.isNullOrEmpty()) "$entityType \u00B7 $entityId" else entityType)
            }
            if (!detail.isNullOrEmpty()) add(detail)
        }
    return RecentActivityRow(
        id = id.toString(),
        glyph = visual.glyph,
        accent = visual.accent,
        titleKey = visual.labelKey,
        titleFallback = visual.fallback,
        subtitle = subtitleParts.joinToString(" \u2014 ").ifEmpty { null },
        time = activityTime(parseActivityTimestampMillis(ts), nowMillis),
        href = entityHref(entityType, entityId),
    )
}

/** Projects a whole feed to render rows, anchored at [nowMillis] (defaults to the wall clock). */
fun List<UserActivityEntry>.toRows(nowMillis: Long = System.currentTimeMillis()): List<RecentActivityRow> = map { it.toRow(nowMillis) }

// ── P1/S8 state holder ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The P1/S8 state holder the [io.teslasync.android.sharedsurfaces.recentactivityfeed] view binds to — the
 * native analogue of the web parent's `entries` state plus the load lifecycle that parent's data hook carries.
 * It exposes a hot [StateFlow] of a cache-then-network [UiState] feed and the imperative writers a host drives
 * it with. It performs no networking; a host feeds it already-projected [UserActivityEntry]s or cached
 * [AuditLogRow]s and flips the lifecycle as its own fetch progresses.
 *
 * @param initial the state the holder starts in (a first load by default).
 */
class RecentActivityFeedState(
    initial: UiState<List<UserActivityEntry>> = UiState.loading(),
) {
    private val mutableState = MutableStateFlow(initial)

    /** The current feed lifecycle — the web parent's `entries` + loading/error status, as one [UiState]. */
    val state: StateFlow<UiState<List<UserActivityEntry>>> = mutableState.asStateFlow()

    /** Marks a first load in flight with nothing cached — the web `isLoading` with no data yet. */
    fun loading() {
        mutableState.value = UiState.loading()
    }

    /** Publishes a loaded feed; an empty list resolves to [UiPhase.Empty] (web `entries.length === 0`). */
    fun submit(
        entries: List<UserActivityEntry>,
        fetchedAtMillis: Long? = null,
    ) {
        mutableState.value =
            UiState(
                phase = if (entries.isEmpty()) UiPhase.Empty else UiPhase.Content,
                data = entries,
                fetchedAt = fetchedAtMillis,
            )
    }

    /** Publishes cached [rows], projecting each through [toActivityEntry]. */
    fun submitRows(
        rows: List<AuditLogRow>,
        fetchedAtMillis: Long? = null,
    ) {
        submit(rows.map { it.toActivityEntry() }, fetchedAtMillis)
    }

    /** Marks a background refresh in flight over the existing [current] feed (web `isFetching` with data). */
    fun refreshing(
        current: List<UserActivityEntry>,
        fetchedAtMillis: Long? = null,
    ) {
        mutableState.value =
            UiState(
                phase = if (current.isEmpty()) UiPhase.Empty else UiPhase.Content,
                data = current,
                refreshing = true,
                fetchedAt = fetchedAtMillis,
            )
    }

    /** Surfaces [entries] whose freshness window has lapsed but the network is healthy — stale, auto-refreshing. */
    fun stale(
        entries: List<UserActivityEntry>,
        fetchedAtMillis: Long? = null,
    ) {
        mutableState.value =
            UiState(
                phase = if (entries.isEmpty()) UiPhase.Empty else UiPhase.Content,
                data = entries,
                stale = true,
                fetchedAt = fetchedAtMillis,
            )
    }

    /** Surfaces cached [entries] kept visible after a failed refresh — the offline "last known" state. */
    fun offline(
        entries: List<UserActivityEntry>,
        errorKind: ErrorKind = ErrorKind.Network,
        fetchedAtMillis: Long? = null,
    ) {
        mutableState.value =
            UiState(
                phase = if (entries.isEmpty()) UiPhase.Empty else UiPhase.Content,
                data = entries,
                stale = true,
                errorKind = errorKind,
                fetchedAt = fetchedAtMillis,
            )
    }

    /** Marks a hard failure with nothing cached to show — the surface renders the error+retry state. */
    fun error(
        errorKind: ErrorKind = ErrorKind.Unknown,
        httpStatus: Int? = null,
    ) {
        mutableState.value = UiState(phase = UiPhase.Error, errorKind = errorKind, httpStatus = httpStatus)
    }
}

// ── P1/S11 diagnostics ─────────────────────────────────────────────────────────────────────────────────────

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened` event
 * tagged with the surface [SLUG] — never an action, entity id, detail, or timestamp, any of which can carry
 * user data.
 */
object RecentActivityFeedDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "RecentActivityFeed"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the view's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
