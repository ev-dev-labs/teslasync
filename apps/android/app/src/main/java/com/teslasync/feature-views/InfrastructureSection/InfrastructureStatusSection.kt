// The native Jetpack Compose + Material 3 system-status Infrastructure surface — a parity port of
// web/src/features/system/components/status/InfrastructureSection.tsx. The web component wraps an
// AccordionSection (a Globe icon, the "Infrastructure" title, a description, and a Connected/Disconnected
// badge) around two cards: an SSE-connection card (a Wifi/WifiOff action + a four-row KVList) and a
// polling-engine card (an Active/Standby badge + a four-row KVList), followed by an optional three-tile
// database-pool metric row shown only when the health payload carries `database_pool`.
//
// This native port keeps that composition (reusing the shared AccordionSection chrome) and additionally
// surfaces the cache-then-network states the P3 contract mandates by binding the telemetry-status +
// system-health feeds (P1/S8) through an [InfrastructureStatusSectionViewModel]: a first load with no cache
// shows skeleton chrome; a hard failure with no cache shows `QueryError` with retry; a stale/offline cached
// payload keeps the cards visible with a freshness chip and auto-refreshes (the web 2s/30s polls); and a
// resolved-but-blank payload still renders the two cards with the web's undefined-defaults (every value an
// em-dash, Disconnected, Standby) — never a blank box. The view performs no HTTP. Every visible string
// resolves through the i18n facade (P1/S10) via [infraStatusText] — for keys the shared catalog defines this
// returns the localized resource, and for the web's natural-key fallbacks it returns the key text exactly as
// react-i18next does — and every status glyph carries a TalkBack content description.
//
// This is a DIFFERENT surface from the dev-tools `InfrastructureSection` (prompt 0006) already in this
// directory; the two web components share a basename but are distinct surfaces, coexisting here under
// distinct type names and a distinct package, neither bypassing the other.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/InfrastructureSection) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.infrastructurestatus

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.InlineMetric
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.CardHeader
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.accordionsection.AccordionSectionContent
import io.teslasync.android.featureviews.accordionsection.AccordionSectionDefaults
import io.teslasync.android.featureviews.accordionsection.AccordionSectionModel
import io.teslasync.android.featureviews.accordionsection.AccordionSectionStrings
import io.teslasync.android.featureviews.accordionsection.KEY_COLLAPSED_STATE
import io.teslasync.android.featureviews.accordionsection.KEY_COLLAPSE_ACTION
import io.teslasync.android.featureviews.accordionsection.KEY_EMPTY_HINT
import io.teslasync.android.featureviews.accordionsection.KEY_EXPANDED_STATE
import io.teslasync.android.featureviews.accordionsection.KEY_EXPAND_ACTION
import io.teslasync.android.featureviews.accordionsection.resolveOptional
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private val CARD_SKELETON_HEIGHT = 132.dp
private const val SKELETON_TILES = 2

private const val HTTP_NOT_FOUND = 404
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_SERVER_ERROR_MIN = 500
private const val HTTP_SERVER_ERROR_MAX = 599

/**
 * Stateful entry point. Binds the telemetry-status + system-health feeds via [source] into an
 * [InfrastructureStatusSectionViewModel], resolves the localized strings (P1/S10), records the one-shot
 * `view.opened` diagnostic, collects the live [UiState], and renders the surface. A host supplies [source]
 * (typically `api.asInfrastructureStatusSectionSource(cache)`) and a unique [instanceKey] per placement.
 */
@Composable
fun InfrastructureStatusSection(
    source: InfrastructureStatusSectionSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = InfrastructureStatusSectionRegistration.ID,
) {
    val viewModel: InfrastructureStatusSectionViewModel =
        viewModel(key = instanceKey, factory = InfrastructureStatusSectionViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberInfrastructureStatusStrings()
    val accordionStrings = rememberInfraAccordionStrings()

    InfrastructureStatusSectionContent(
        state = state,
        strings = strings,
        accordionStrings = accordionStrings,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Draws the AccordionSection
 * chrome (icon + title + description + Connected/Disconnected badge) over a body that switches on the
 * [UiState] phase: loading skeletons, a `QueryError` with retry for a hard failure, or the loaded cards (with
 * a freshness chip when a stamp/refresh/failure is present). A stale/offline cached payload auto-refreshes.
 */
@Composable
fun InfrastructureStatusSectionContent(
    state: UiState<InfrastructureStatusData>,
    strings: InfrastructureStatusStrings,
    accordionStrings: AccordionSectionStrings,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    defaultOpen: Boolean = true,
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRefresh()
    }
    var open by rememberSaveable { mutableStateOf(defaultOpen) }
    val display =
        remember(state.data, strings) {
            state.data?.let { InfrastructureStatusSectionProjection.project(it, strings) }
        }
    val connected = display?.sseConnected ?: false

    AccordionSectionContent(
        title = strings.title,
        description = strings.description,
        open = open,
        onToggle = { open = AccordionSectionModel.toggle(open) },
        strings = accordionStrings,
        modifier = modifier,
        icon = { Icon(InfraStatusGlyphs.Globe, contentDescription = null, size = IconSize.Lg) },
        badges = {
            Badge(
                text = if (connected) strings.connected else strings.disconnected,
                variant = if (connected) BadgeVariant.Success else BadgeVariant.Warning,
                dot = true,
            )
        },
        content = {
            InfrastructureStatusBody(state = state, display = display, strings = strings, onRefresh = onRefresh)
        },
    )
}

@Composable
private fun ColumnScope.InfrastructureStatusBody(
    state: UiState<InfrastructureStatusData>,
    display: InfrastructureStatusDisplay?,
    strings: InfrastructureStatusStrings,
    onRefresh: () -> Unit,
) {
    when {
        state.isLoading -> InfrastructureStatusLoading()

        state.isError && !state.hasData ->
            QueryError(
                kind = queryErrorKindOf(state),
                resourceName = strings.title,
                onRetry = onRefresh,
                modifier = Modifier.fillMaxWidth(),
            )

        display != null -> {
            if (state.fetchedAt != null || state.refreshing || state.hasError) {
                FreshnessRow(state)
            }
            SseConnectionCard(display = display, strings = strings)
            PollingEngineCard(display = display, strings = strings)
            display.pool?.let { pool -> PoolMetricsRow(pool = pool, strings = strings) }
        }

        else -> EmptyState(message = strings.description, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun FreshnessRow(state: UiState<InfrastructureStatusData>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
        )
    }
}

@Composable
private fun SseConnectionCard(
    display: InfrastructureStatusDisplay,
    strings: InfrastructureStatusStrings,
) {
    val label = "${strings.sseConnection}, ${display.connectionLabel}"
    Card(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = label },
    ) {
        CardHeader(
            title = strings.sseConnection,
            action = {
                Icon(
                    imageVector = if (display.sseConnected) DataDisplayGlyphs.Wifi else DataDisplayGlyphs.WifiOff,
                    contentDescription = display.connectionLabel,
                    size = IconSize.Md,
                    tint = if (display.sseConnected) TeslaTokens.status.success else TeslaTokens.status.danger,
                )
            },
        )
        KVList(items = display.sseRows.map { KVItem(it.label, it.value) })
    }
}

@Composable
private fun PollingEngineCard(
    display: InfrastructureStatusDisplay,
    strings: InfrastructureStatusStrings,
) {
    val label = "${strings.pollingEngine}, ${display.pollingLabel}"
    Card(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = label },
    ) {
        CardHeader(
            title = strings.pollingEngine,
            action = {
                Badge(
                    text = display.pollingLabel,
                    variant = if (display.pollingActive) BadgeVariant.Success else BadgeVariant.Neutral,
                )
            },
        )
        KVList(items = display.pollingRows.map { KVItem(it.label, it.value) })
    }
}

@Composable
private fun PoolMetricsRow(
    pool: PoolDisplay,
    strings: InfrastructureStatusStrings,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        InlineMetric(
            icon = InfraStatusGlyphs.Database,
            value = pool.totalText,
            label = strings.totalConns,
            iconContentDescription = strings.totalConns,
            modifier = Modifier.weight(1f),
        )
        InlineMetric(
            icon = InfraStatusGlyphs.Activity,
            value = pool.acquiredText,
            label = strings.acquired,
            iconContentDescription = strings.acquired,
            modifier = Modifier.weight(1f),
        )
        InlineMetric(
            icon = DataDisplayGlyphs.Clock,
            value = pool.idleText,
            label = strings.idle,
            iconContentDescription = strings.idle,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun ColumnScope.InfrastructureStatusLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(SKELETON_TILES) {
            Skeleton(modifier = Modifier.fillMaxWidth(), height = CARD_SKELETON_HEIGHT, rounded = true)
        }
    }
}

/** Maps the failure state onto a [QueryErrorKind] — the native analogue of the web error-status branching. */
private fun queryErrorKindOf(state: UiState<*>): QueryErrorKind =
    when (state.httpStatus) {
        HTTP_NOT_FOUND -> QueryErrorKind.NotFound
        HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
        in HTTP_SERVER_ERROR_MIN..HTTP_SERVER_ERROR_MAX -> QueryErrorKind.ServerError
        else ->
            when (state.errorKind) {
                ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
                ErrorKind.Decode -> QueryErrorKind.ServerError
                else -> QueryErrorKind.Network
            }
    }

// ─── i18n facade (P1/S10) ───────────────────────────────────────────────────

/**
 * Resolves an i18n [key] through the Android resource facade, reproducing react-i18next's natural-key
 * fallback: a key present in the shared catalog returns its localized string; a key the web leaves
 * untranslated returns the key text, exactly as the web `t(key)` does. Recomputed on locale change.
 */
@Composable
private fun infraStatusText(key: String): String {
    val context = LocalContext.current
    return remember(key, context) { resolveInfraStatusText(context, key) }
}

/** Pure resolver (no Compose) — looks up `translation_<sanitized-key>`, falling back to [key] when absent. */
@SuppressLint("DiscouragedApi")
internal fun resolveInfraStatusText(
    context: Context,
    key: String,
): String {
    val resourceName = "translation_" + key.replace(NON_RESOURCE_CHARS, "_")
    val id = context.resources.getIdentifier(resourceName, "string", context.packageName)
    return if (id != 0) context.getString(id) else key
}

private val NON_RESOURCE_CHARS = Regex("[^A-Za-z0-9_]")

/** Resolves the surface's localized labels once at the render boundary (P1/S10). */
@Composable
private fun rememberInfrastructureStatusStrings(): InfrastructureStatusStrings =
    InfrastructureStatusStrings(
        title = infraStatusText(InfraStatusKeys.TITLE),
        description = infraStatusText(InfraStatusKeys.DESCRIPTION),
        connected = infraStatusText(InfraStatusKeys.CONNECTED),
        disconnected = infraStatusText(InfraStatusKeys.DISCONNECTED),
        sseConnection = infraStatusText(InfraStatusKeys.SSE_CONNECTION),
        connectionState = infraStatusText(InfraStatusKeys.CONNECTION_STATE),
        endpoint = infraStatusText(InfraStatusKeys.ENDPOINT),
        protocol = infraStatusText(InfraStatusKeys.PROTOCOL),
        fallbackMode = infraStatusText(InfraStatusKeys.FALLBACK_MODE),
        yesPolling = infraStatusText(InfraStatusKeys.YES_POLLING),
        no = infraStatusText(InfraStatusKeys.NO),
        pollingEngine = infraStatusText(InfraStatusKeys.POLLING_ENGINE),
        active = infraStatusText(InfraStatusKeys.ACTIVE),
        standby = infraStatusText(InfraStatusKeys.STANDBY),
        mode = infraStatusText(InfraStatusKeys.MODE),
        speedComparison = infraStatusText(InfraStatusKeys.SPEED_COMPARISON),
        fleetTelemetryLatency = infraStatusText(InfraStatusKeys.FLEET_TELEMETRY_LATENCY),
        fleetApiPolling = infraStatusText(InfraStatusKeys.FLEET_API_POLLING),
        totalConns = infraStatusText(InfraStatusKeys.TOTAL_CONNS),
        acquired = infraStatusText(InfraStatusKeys.ACQUIRED),
        idle = infraStatusText(InfraStatusKeys.IDLE),
    )

/** Resolves the reused AccordionSection affordance labels (by-name with the surface's English defaults). */
@Composable
private fun rememberInfraAccordionStrings(): AccordionSectionStrings {
    val context = LocalContext.current
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    return AccordionSectionStrings(
        expandAction = resolveOptional(lookup, KEY_EXPAND_ACTION, AccordionSectionDefaults.EXPAND_ACTION),
        collapseAction = resolveOptional(lookup, KEY_COLLAPSE_ACTION, AccordionSectionDefaults.COLLAPSE_ACTION),
        expandedState = resolveOptional(lookup, KEY_EXPANDED_STATE, AccordionSectionDefaults.EXPANDED_STATE),
        collapsedState = resolveOptional(lookup, KEY_COLLAPSED_STATE, AccordionSectionDefaults.COLLAPSED_STATE),
        emptyHint = resolveOptional(lookup, KEY_EMPTY_HINT, AccordionSectionDefaults.EMPTY_HINT),
    )
}

@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ─── glyphs (local lucide-style vectors; the app uses no Material-icons artifact) ───

/**
 * The surface glyphs not already in the shared sets, mirroring the web lucide icons `Globe` (accordion
 * header), `Database` (total connections), and `Activity` (acquired connections). `Wifi` / `WifiOff` / `Clock`
 * are reused from the shared [DataDisplayGlyphs]. Built with the same 24dp stroked-path convention.
 */
internal object InfraStatusGlyphs {
    val Globe: ImageVector =
        stroked("Globe") {
            circle(12f, 12f, 9f)
            moveTo(3f, 12f)
            lineTo(21f, 12f)
            moveTo(12f, 3f)
            arcTo(5f, 9f, 0f, false, true, 12f, 21f)
            arcTo(5f, 9f, 0f, false, true, 12f, 3f)
            close()
        }

    val Database: ImageVector =
        stroked("Database") {
            moveTo(4f, 6f)
            arcTo(8f, 3f, 0f, false, true, 20f, 6f)
            arcTo(8f, 3f, 0f, false, true, 4f, 6f)
            close()
            moveTo(4f, 6f)
            lineTo(4f, 18f)
            arcTo(8f, 3f, 0f, false, false, 20f, 18f)
            lineTo(20f, 6f)
            moveTo(4f, 12f)
            arcTo(8f, 3f, 0f, false, false, 20f, 12f)
        }

    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(3f, 12f)
            lineTo(8f, 12f)
            lineTo(11f, 5f)
            lineTo(14f, 19f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }

    private fun stroked(
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
}

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

// ─── previews (tooling only) ───────────────────────────────────────────────

private fun previewStrings(): InfrastructureStatusStrings =
    InfrastructureStatusStrings(
        title = InfraStatusKeys.TITLE,
        description = InfraStatusKeys.DESCRIPTION,
        connected = InfraStatusKeys.CONNECTED,
        disconnected = InfraStatusKeys.DISCONNECTED,
        sseConnection = InfraStatusKeys.SSE_CONNECTION,
        connectionState = InfraStatusKeys.CONNECTION_STATE,
        endpoint = InfraStatusKeys.ENDPOINT,
        protocol = InfraStatusKeys.PROTOCOL,
        fallbackMode = InfraStatusKeys.FALLBACK_MODE,
        yesPolling = InfraStatusKeys.YES_POLLING,
        no = InfraStatusKeys.NO,
        pollingEngine = InfraStatusKeys.POLLING_ENGINE,
        active = InfraStatusKeys.ACTIVE,
        standby = InfraStatusKeys.STANDBY,
        mode = InfraStatusKeys.MODE,
        speedComparison = InfraStatusKeys.SPEED_COMPARISON,
        fleetTelemetryLatency = InfraStatusKeys.FLEET_TELEMETRY_LATENCY,
        fleetApiPolling = InfraStatusKeys.FLEET_API_POLLING,
        totalConns = InfraStatusKeys.TOTAL_CONNS,
        acquired = InfraStatusKeys.ACQUIRED,
        idle = InfraStatusKeys.IDLE,
    )

private fun previewAccordionStrings(): AccordionSectionStrings =
    AccordionSectionStrings(
        expandAction = AccordionSectionDefaults.EXPAND_ACTION,
        collapseAction = AccordionSectionDefaults.COLLAPSE_ACTION,
        expandedState = AccordionSectionDefaults.EXPANDED_STATE,
        collapsedState = AccordionSectionDefaults.COLLAPSED_STATE,
        emptyHint = AccordionSectionDefaults.EMPTY_HINT,
    )

private fun previewLiveData(): InfrastructureStatusData {
    val telemetry: JsonElement =
        buildJsonObject {
            put("enabled", true)
            put("mode", "fleet_telemetry")
            put("endpoint", "telemetry.tesla.com:443")
            put("protocol", "mqtt")
            put(
                "speed_comparison",
                buildJsonObject {
                    put("speedup", "12x faster")
                    put("fleet_telemetry_latency", "180 ms")
                    put("fleet_api_polling", "2.2 s")
                },
            )
        }
    val health: JsonElement =
        buildJsonObject {
            put(
                "database_pool",
                buildJsonObject {
                    put("total_conns", 25)
                    put("acquired_conns", 4)
                    put("idle_conns", 21)
                },
            )
        }
    return InfrastructureStatusData(telemetry, health)
}

@Preview(name = "Infrastructure status — live", showBackground = true)
@Composable
private fun PreviewInfrastructureStatusLive() {
    TeslaSyncTheme(dynamicColor = false) {
        InfrastructureStatusSectionContent(
            state = UiState(phase = UiPhase.Content, data = previewLiveData(), fetchedAt = 1L),
            strings = previewStrings(),
            accordionStrings = previewAccordionStrings(),
        )
    }
}

@Preview(name = "Infrastructure status — disconnected", showBackground = true)
@Composable
private fun PreviewInfrastructureStatusDisconnected() {
    TeslaSyncTheme(dynamicColor = false) {
        InfrastructureStatusSectionContent(
            state = UiState(phase = UiPhase.Empty, data = InfrastructureStatusData(JsonNull, JsonNull), fetchedAt = 1L),
            strings = previewStrings(),
            accordionStrings = previewAccordionStrings(),
        )
    }
}
