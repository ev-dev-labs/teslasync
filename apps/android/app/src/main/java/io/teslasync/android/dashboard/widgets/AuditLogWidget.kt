// File hosts the AuditLogWidget composable plus its co-located state holder, data adapter,
// and registry descriptor (one dashboard surface per file).
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboard.widgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.Timeline
import io.teslasync.android.components.datadisplay.TimelineEntry
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.formatFreshnessAge
import io.teslasync.android.components.datadisplay.freshnessAge
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.LiveStaleDataBanner
import io.teslasync.android.components.feedback.OfflineBanner
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset

// ── Registry metadata ────────────────────────────────────────────────────────
// Mirrors web/src/features/dashboard/widgets/registry/system.ts so a future dashboard
// grid host registers this surface with the same id and size constraints.

/** A dashboard grid footprint in (columns × rows), matching the web `WidgetSize`. */
data class WidgetGridSize(
    val cols: Int,
    val rows: Int,
)

/** Canonical registry entry for the Audit Log surface (id, category, grid sizing). */
object AuditLogWidgetDescriptor {
    const val ID: String = "audit-log"
    const val CATEGORY: String = "system"
    const val DESCRIPTION: String = "Security audit trail: user actions, auth events, permission changes"
    val nameResId: Int = R.string.translation_widget_auditLog
    val defaultSize: WidgetGridSize = WidgetGridSize(cols = 2, rows = 4)
    val minSize: WidgetGridSize = WidgetGridSize(cols = 2, rows = 4)
    val maxSize: WidgetGridSize = WidgetGridSize(cols = 4, rows = 40)
}

/** Diagnostics surface slug emitted on open (P1/S11). */
private const val SURFACE_SLUG = "AuditLogWidget"

// ── Domain model ─────────────────────────────────────────────────────────────

/** Severity tier the audit feed maps onto, matching the web `'info' | 'warning' | 'critical'`. */
enum class AuditSeverity { Info, Warning, Critical }

/**
 * A tri-state security flag value. The `/security` payload models `locked`/`sentry_mode`/etc.
 * as `string | boolean | null`, so the adapter keeps the union faithfully (web parity).
 */
sealed interface Flag {
    data class Bool(
        val value: Boolean,
    ) : Flag

    data class Text(
        val value: String,
    ) : Flag

    data object Absent : Flag
}

/** One administrative audit-trail entry (`GET /system/audit`, web `useAuditLogs`). */
data class AuditLogEntry(
    val id: String,
    val action: String?,
    val resource: String?,
    val details: String?,
    val createdAt: String?,
)

/** One per-vehicle security/access event (`GET /security`, web `useSecurityEvents`). */
data class SecurityEvent(
    val id: String,
    val locked: Boolean?,
    val sentryMode: Flag,
    val doorState: Flag,
    val guestMode: Boolean?,
    val valetModeEnabled: Boolean?,
    val createdAt: String?,
)

/** The subtitle of a feed row: a literal (audit) or the localized "Security event" label. */
sealed interface RowSubtitle {
    data class Raw(
        val text: String,
    ) : RowSubtitle

    data object SecurityEvent : RowSubtitle
}

/** A render-ready feed row (icon + color are derived from [severity]/[isSecurity] at draw time). */
data class AuditFeedRow(
    val id: String,
    val severity: AuditSeverity,
    val title: String,
    val subtitle: RowSubtitle,
    val timestampMs: Long,
    val isSecurity: Boolean,
)

/** Everything the surface renders: the capped feed plus the compact 24-hour summary. */
data class AuditLogContent(
    val rows: List<AuditFeedRow>,
    val totalEvents24h: Int,
    val worstSeverity: AuditSeverity,
)

// ── Pure adapter (off-device unit-testable) ──────────────────────────────────

private const val MAX_ITEMS = 15
private const val DAY_MILLIS = 24L * 60L * 60L * 1000L
private const val SECURITY_EVENT_TITLE = "Security event"

/** The web `inferAuditSeverity`: destructive/failed → critical, mutating → warning, else info. */
internal fun inferAuditSeverity(action: String?): AuditSeverity {
    val lower = action?.lowercase().orEmpty()
    return when {
        lower.contains("delete") || lower.contains("revoke") || lower.contains("fail") -> AuditSeverity.Critical
        lower.contains("update") || lower.contains("change") || lower.contains("modify") -> AuditSeverity.Warning
        else -> AuditSeverity.Info
    }
}

/** The web `inferSecuritySeverity`: unlocked → critical, sentry active/on → warning, else info. */
internal fun inferSecuritySeverity(event: SecurityEvent): AuditSeverity =
    when {
        event.locked == false -> AuditSeverity.Critical
        event.sentryMode.isActive() -> AuditSeverity.Warning
        else -> AuditSeverity.Info
    }

/**
 * The web `buildSecurityTitle`: returns the first describable state, else the literal fallback.
 * These fragments are inline (not `t()`-wrapped) in the web source, reproduced verbatim for parity.
 */
internal fun buildSecurityTitle(event: SecurityEvent): String {
    val parts =
        buildList {
            event.locked?.let { add(if (it) "Vehicle locked" else "Vehicle unlocked") }
            if (event.sentryMode.isTruthy()) add("Sentry: ${event.sentryMode.labelOr("On")}")
            if (event.doorState.isTruthy()) add("Door: ${event.doorState.labelOr("Open")}")
            event.guestMode?.let { add(if (it) "Guest mode on" else "Guest mode off") }
            event.valetModeEnabled?.let { add(if (it) "Valet mode on" else "Valet mode off") }
        }
    return parts.firstOrNull() ?: SECURITY_EVENT_TITLE
}

/**
 * Combines audit logs + security events into the render model: every item becomes a row, the
 * 24-hour count + worst severity are computed over ALL items (web parity), then the feed is
 * sorted newest-first and capped at [MAX_ITEMS] for display.
 */
internal fun projectAuditFeed(
    audits: List<AuditLogEntry>,
    events: List<SecurityEvent>,
    nowMs: Long,
): AuditLogContent {
    val all = audits.map(::auditRowOf) + events.map(::securityRowOf)
    val dayAgo = nowMs - DAY_MILLIS
    val recent = all.filter { it.timestampMs >= dayAgo }
    val worst =
        when {
            recent.any { it.severity == AuditSeverity.Critical } -> AuditSeverity.Critical
            recent.any { it.severity == AuditSeverity.Warning } -> AuditSeverity.Warning
            else -> AuditSeverity.Info
        }
    val rows = all.sortedByDescending { it.timestampMs }.take(MAX_ITEMS)
    return AuditLogContent(rows = rows, totalEvents24h = recent.size, worstSeverity = worst)
}

private fun auditRowOf(entry: AuditLogEntry): AuditFeedRow {
    val subtitle = listOfNotNull(entry.resource, entry.details).filter { it.isNotBlank() }.joinToString(" · ")
    return AuditFeedRow(
        id = "audit-${entry.id}",
        severity = inferAuditSeverity(entry.action),
        title = entry.action?.takeIf { it.isNotBlank() } ?: "—",
        subtitle = RowSubtitle.Raw(subtitle.ifBlank { "—" }),
        timestampMs = parseIsoToMillis(entry.createdAt),
        isSecurity = false,
    )
}

private fun securityRowOf(event: SecurityEvent): AuditFeedRow =
    AuditFeedRow(
        id = "sec-${event.id}",
        severity = inferSecuritySeverity(event),
        title = buildSecurityTitle(event),
        subtitle = RowSubtitle.SecurityEvent,
        timestampMs = parseIsoToMillis(event.createdAt),
        isSecurity = true,
    )

private fun Flag.isTruthy(): Boolean =
    when (this) {
        is Flag.Bool -> value
        is Flag.Text -> value.isNotEmpty()
        Flag.Absent -> false
    }

private fun Flag.isActive(): Boolean = (this is Flag.Text && value == "active") || (this is Flag.Bool && value)

private fun Flag.labelOr(default: String): String = if (this is Flag.Text) value else default

// ── JSON decoding (snake_case wire shape, tolerant fallbacks per the Windows port) ───

internal fun parseAuditEntries(json: JsonElement?): List<AuditLogEntry> =
    json.asObjects().map { obj ->
        AuditLogEntry(
            id = obj.idOrBlank(),
            action = obj.string("action"),
            resource = obj.string("resource") ?: obj.string("entity_type"),
            details = obj.string("details") ?: obj.string("detail"),
            createdAt = obj.string("created_at") ?: obj.string("createdAt") ?: obj.string("ts"),
        )
    }

internal fun parseSecurityEvents(json: JsonElement?): List<SecurityEvent> =
    json.asObjects().map { obj ->
        SecurityEvent(
            id = obj.idOrBlank(),
            locked = obj.bool("locked"),
            sentryMode = obj.flag("sentry_mode"),
            doorState = obj.flag("door_state"),
            guestMode = obj.bool("guest_mode"),
            valetModeEnabled = obj.bool("valet_mode_enabled"),
            createdAt = obj.string("created_at") ?: obj.string("createdAt"),
        )
    }

private fun JsonElement?.asObjects(): List<JsonObject> = (this as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content

private fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.booleanOrNull

private fun JsonObject.idOrBlank(): String = string("id").orEmpty()

private fun JsonObject.flag(key: String): Flag {
    val primitive = this[key] as? JsonPrimitive ?: return Flag.Absent
    return when {
        primitive is JsonNull -> Flag.Absent
        primitive.isString -> Flag.Text(primitive.content)
        else -> primitive.booleanOrNull?.let { Flag.Bool(it) } ?: Flag.Absent
    }
}

private fun parseIsoToMillis(iso: String?): Long {
    if (iso.isNullOrBlank()) return 0L
    return runCatching { Instant.parse(iso).toEpochMilli() }
        .recoverCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
        .recoverCatching { LocalDateTime.parse(iso).toInstant(ZoneOffset.UTC).toEpochMilli() }
        .getOrDefault(0L)
}

// ── State combination ────────────────────────────────────────────────────────

private fun <T> Resource<JsonElement>.mapPayload(parse: (JsonElement) -> List<T>): Resource<List<T>> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(parse), fetchedAt, stale)
        is Resource.Success -> Resource.Success(parse(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(parse), fetchedAt, stale, error)
    }

/**
 * Folds the two independent feeds into one [UiState] the way the web widget folds its two hooks:
 * loading when either is loading, a hard error only when nothing can be shown, otherwise content
 * (or empty) carrying the OR-combined stale/refresh/error so the chrome stays honest.
 */
internal fun combineAuditUi(
    audit: UiState<List<AuditLogEntry>>,
    security: UiState<List<SecurityEvent>>,
    nowMs: Long,
): UiState<AuditLogContent> {
    val content = projectAuditFeed(audit.data.orEmpty(), security.data.orEmpty(), nowMs)
    val loading = audit.isLoading || security.isLoading
    val hardError = audit.isError || security.isError
    val phase =
        when {
            loading -> UiPhase.Loading
            content.rows.isEmpty() && hardError -> UiPhase.Error
            content.rows.isEmpty() -> UiPhase.Empty
            else -> UiPhase.Content
        }
    return UiState(
        phase = phase,
        data = if (phase == UiPhase.Loading || phase == UiPhase.Error) null else content,
        fetchedAt = maxOfNullable(audit.fetchedAt, security.fetchedAt),
        stale = audit.stale || security.stale,
        refreshing = audit.refreshing || security.refreshing,
        errorKind = audit.errorKind ?: security.errorKind,
        httpStatus = audit.httpStatus ?: security.httpStatus,
    )
}

private fun maxOfNullable(
    a: Long?,
    b: Long?,
): Long? =
    when {
        a == null -> b
        b == null -> a
        else -> maxOf(a, b)
    }

// ── State holder (binds the shared P1/S8 stores; no HTTP in the view) ─────────

/**
 * Lifecycle-aware state holder for the Audit Log surface. Binds the shared [AdminStore] audit-trail
 * and per-vehicle security feeds (resolving `vehicleId ?? vehicles[0].id` like the web) and the
 * [VehiclesStore] list, projecting both onto a single [UiState] the stateless composable renders.
 *
 * It owns no networking — the shared stores do (ADR-002). [refresh] recomputes the projection
 * against the latest store snapshot and current time and logs the intent; [onOpened] emits the
 * `view.opened` diagnostics event (P1/S11).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AuditLogWidgetViewModel(
    private val adminStore: AdminStore,
    vehiclesStore: VehiclesStore,
    logger: Logger,
    private val vehicleId: Long? = null,
    private val now: () -> Long = { System.currentTimeMillis() },
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshEpoch = MutableStateFlow(0)

    private val auditUi: Flow<UiState<List<AuditLogEntry>>> =
        adminStore.auditLogs().map { it.mapPayload(::parseAuditEntries).toUiState { list -> list.isEmpty() } }

    private val securityUi: Flow<UiState<List<SecurityEvent>>> =
        if (vehicleId != null) {
            securityFeed(vehicleId)
        } else {
            vehiclesStore.vehicles().flatMapLatest { resource ->
                resource.cached
                    ?.firstOrNull()
                    ?.id
                    ?.let(::securityFeed) ?: flowOf(EMPTY_SECURITY)
            }
        }

    /** The single surface state, re-shared while observed (web cache-then-network + merge contract). */
    val state: StateFlow<UiState<AuditLogContent>> =
        combine(auditUi, securityUi, refreshEpoch) { audit, security, _ -> combineAuditUi(audit, security, now()) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), UiState.loading())

    private fun securityFeed(id: Long): Flow<UiState<List<SecurityEvent>>> =
        adminStore.securityEvents(id.toString()).map {
            it.mapPayload(::parseSecurityEvents).toUiState { list -> list.isEmpty() }
        }

    /** Recomputes the surface against the latest snapshot + current time (retry/auto-refresh affordance). */
    fun refresh() {
        logger.info("audit-log.refresh")
        refreshEpoch.update { it + 1 }
    }

    /** Emits the `view.opened` diagnostics event for this surface (P1/S11). */
    fun onOpened() {
        logger.info("view.opened", mapOf("surface" to SURFACE_SLUG))
    }

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val EMPTY_SECURITY: UiState<List<SecurityEvent>> = UiState(UiPhase.Empty, data = emptyList())
    }
}

// ── Composable surface ───────────────────────────────────────────────────────

/**
 * Stateful entry point: collects [AuditLogWidgetViewModel.state] lifecycle-aware, emits the
 * open diagnostics event once, and wires refresh. Host code constructs the view model via the
 * data-layer factory and passes it here.
 */
@Composable
fun AuditLogWidget(
    viewModel: AuditLogWidgetViewModel,
    modifier: Modifier = Modifier,
    size: WidgetGridSize = AuditLogWidgetDescriptor.defaultSize,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onOpened() }
    AuditLogWidgetContent(
        state = state,
        onRefresh = viewModel::refresh,
        modifier = modifier,
        size = size,
    )
}

/**
 * Stateless surface. Renders every state from the web source: loading skeleton, hard error
 * (retry), offline/stale (cached + banner + retry), the compact 24-hour summary at a single
 * column, and the newest-first event feed (with its own empty state) otherwise.
 */
@Composable
fun AuditLogWidgetContent(
    state: UiState<AuditLogContent>,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    size: WidgetGridSize = AuditLogWidgetDescriptor.defaultSize,
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        AuditHeader(state = state, onRefresh = onRefresh)
        Column(
            modifier = Modifier.padding(top = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            when (state.phase) {
                UiPhase.Loading -> LoadingBody()
                UiPhase.Error -> QueryError(kind = queryErrorKindOf(state.errorKind), onRetry = onRefresh)
                else -> ResolvedBody(content = state.data ?: EMPTY_CONTENT, state = state, size = size, onRefresh = onRefresh)
            }
        }
    }
}

@Composable
private fun AuditHeader(
    state: UiState<AuditLogContent>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(FileSearchGlyph, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.info)
            PanelTitle(stringResource(R.string.translation_widget_auditLog))
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            FreshnessLabel(fetchedAt = state.fetchedAt)
            IconButton(
                imageVector = RefreshGlyph,
                contentDescription = stringResource(R.string.translation_common_refresh),
                onClick = onRefresh,
                size = IconSize.Sm,
            )
        }
    }
}

@Composable
private fun FreshnessLabel(fetchedAt: Long?) {
    if (fetchedAt == null) return
    val ageSeconds = remember(fetchedAt) { computeAgeSeconds(fetchedAt, System.currentTimeMillis()) }
    Caption(formatFreshnessAge(relativeAge(ageSeconds)))
}

@Composable
private fun LoadingBody() {
    Column(
        modifier = Modifier.semantics { contentDescription = "Loading" },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = 0.5f, height = 18.dp)
        SkeletonLines(lines = 4)
    }
}

@Composable
private fun ResolvedBody(
    content: AuditLogContent,
    state: UiState<AuditLogContent>,
    size: WidgetGridSize,
    onRefresh: () -> Unit,
) {
    if (state.isOffline) {
        OfflineBanner(onRetry = onRefresh)
    } else if (state.stale) {
        LiveStaleDataBanner(onReconnect = onRefresh)
    }
    if (size.cols <= 1) {
        if (content.rows.isNotEmpty()) CompactView(content) else AuditEmptyState()
    } else {
        FeedView(content)
    }
}

@Composable
private fun CompactView(content: AuditLogContent) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        AnimatedNumber(value = content.totalEvents24h * 1.0)
        MetricLabel(stringResource(R.string.translation_widget_auditEvents24h))
        Badge(text = severityLabel(content.worstSeverity), variant = badgeVariant(content.worstSeverity))
    }
}

@Composable
private fun FeedView(content: AuditLogContent) {
    if (content.rows.isEmpty()) {
        AuditEmptyState()
        return
    }
    val entries =
        content.rows.map { row ->
            TimelineEntry(
                title = row.title,
                time = relativeTimeLabel(row.timestampMs),
                subtitle = subtitleText(row.subtitle),
                icon = rowGlyph(row),
                accent = severityColor(row.severity),
            )
        }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(max = FEED_MAX_HEIGHT)
                .verticalScroll(rememberScrollState()),
    ) {
        Timeline(items = entries)
    }
}

@Composable
private fun AuditEmptyState() {
    EmptyState(
        message = stringResource(R.string.translation_widget_noAuditEvents),
        icon = FileSearchGlyph,
    )
}

@Composable
private fun subtitleText(subtitle: RowSubtitle): String =
    when (subtitle) {
        is RowSubtitle.Raw -> subtitle.text
        RowSubtitle.SecurityEvent -> stringResource(R.string.translation_widget_auditSecurityEvent)
    }

@Composable
private fun severityLabel(severity: AuditSeverity): String =
    when (severity) {
        AuditSeverity.Critical -> stringResource(R.string.translation_widget_auditCritical)
        AuditSeverity.Warning -> stringResource(R.string.translation_widget_auditWarning)
        AuditSeverity.Info -> stringResource(R.string.translation_widget_auditInfo)
    }

@Composable
private fun severityColor(severity: AuditSeverity): Color =
    when (severity) {
        AuditSeverity.Critical -> TeslaTokens.status.danger
        AuditSeverity.Warning -> TeslaTokens.status.warning
        AuditSeverity.Info -> TeslaTokens.status.info
    }

private fun badgeVariant(severity: AuditSeverity): BadgeVariant =
    when (severity) {
        AuditSeverity.Critical -> BadgeVariant.Danger
        AuditSeverity.Warning -> BadgeVariant.Warning
        AuditSeverity.Info -> BadgeVariant.Neutral
    }

private fun rowGlyph(row: AuditFeedRow): ImageVector =
    when {
        row.isSecurity -> ShieldGlyph
        row.severity == AuditSeverity.Critical -> TeslaGlyphs.Octagon
        row.severity == AuditSeverity.Warning -> TeslaGlyphs.Warning
        else -> TeslaGlyphs.Info
    }

private fun queryErrorKindOf(errorKind: ErrorKind?): QueryErrorKind =
    when (errorKind) {
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        else -> QueryErrorKind.ServerError
    }

/** Relative-time label reusing the shared freshness formatter (just-now / Xs / Xm / Xh). */
private fun relativeTimeLabel(timestampMs: Long): String =
    formatFreshnessAge(freshnessAge(computeAgeSeconds(timestampMs, System.currentTimeMillis())))

private val EMPTY_CONTENT = AuditLogContent(rows = emptyList(), totalEvents24h = 0, worstSeverity = AuditSeverity.Info)
private val FEED_MAX_HEIGHT = 320.dp

// ── Local glyphs (the lucide FileSearch + ShieldAlert the web uses) ───────────

private fun auditGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private val FileSearchGlyph: ImageVector =
    auditGlyph("FileSearch") {
        moveTo(13f, 3f)
        lineTo(6f, 3f)
        lineTo(6f, 21f)
        lineTo(12f, 21f)
        moveTo(13f, 3f)
        lineTo(18f, 8f)
        lineTo(18f, 12f)
        moveTo(13f, 3f)
        lineTo(13f, 8f)
        lineTo(18f, 8f)
        moveTo(12.5f, 15f)
        arcTo(2.5f, 2.5f, 0f, false, true, 17.5f, 15f)
        arcTo(2.5f, 2.5f, 0f, false, true, 12.5f, 15f)
        close()
        moveTo(17f, 16.5f)
        lineTo(20f, 19.5f)
    }

private val ShieldGlyph: ImageVector =
    auditGlyph("ShieldAlert") {
        moveTo(12f, 3f)
        lineTo(19f, 6f)
        lineTo(19f, 11f)
        curveTo(19f, 16f, 16f, 19f, 12f, 21f)
        curveTo(8f, 19f, 5f, 16f, 5f, 11f)
        lineTo(5f, 6f)
        close()
        moveTo(12f, 8.5f)
        lineTo(12f, 13f)
        moveTo(12f, 16f)
        lineTo(12.1f, 16f)
    }

private val RefreshGlyph: ImageVector =
    auditGlyph("Refresh") {
        moveTo(20f, 12f)
        curveTo(20f, 16.4f, 16.4f, 20f, 12f, 20f)
        curveTo(8f, 20f, 5f, 18f, 4f, 15f)
        moveTo(4f, 12f)
        curveTo(4f, 7.6f, 7.6f, 4f, 12f, 4f)
        curveTo(16f, 4f, 19f, 6f, 20f, 9f)
        moveTo(20f, 4f)
        lineTo(20f, 9f)
        lineTo(15f, 9f)
        moveTo(4f, 20f)
        lineTo(4f, 15f)
        lineTo(9f, 15f)
    }

// ── Previews (tooling-only; render every state) ──────────────────────────────

private fun previewContent(): AuditLogContent =
    AuditLogContent(
        rows =
            listOf(
                AuditFeedRow("a1", AuditSeverity.Critical, "user.delete", RowSubtitle.Raw("users · admin@site"), 1_000L, false),
                AuditFeedRow("s1", AuditSeverity.Warning, "Vehicle locked", RowSubtitle.SecurityEvent, 900L, true),
                AuditFeedRow("a2", AuditSeverity.Info, "user.login", RowSubtitle.Raw("auth"), 800L, false),
            ),
        totalEvents24h = 3,
        worstSeverity = AuditSeverity.Critical,
    )

@Preview
@Composable
private fun AuditLogContentPreview() {
    TeslaSyncTheme {
        AuditLogWidgetContent(
            state = UiState(UiPhase.Content, data = previewContent(), fetchedAt = 0L),
            onRefresh = {},
        )
    }
}

@Preview
@Composable
private fun AuditLogEmptyPreview() {
    TeslaSyncTheme {
        AuditLogWidgetContent(
            state = UiState(UiPhase.Empty, data = EMPTY_CONTENT, fetchedAt = 0L),
            onRefresh = {},
        )
    }
}

@Preview
@Composable
private fun AuditLogLoadingPreview() {
    TeslaSyncTheme {
        AuditLogWidgetContent(state = UiState.loading(), onRefresh = {})
    }
}

@Preview
@Composable
private fun AuditLogErrorPreview() {
    TeslaSyncTheme {
        AuditLogWidgetContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = {},
        )
    }
}
