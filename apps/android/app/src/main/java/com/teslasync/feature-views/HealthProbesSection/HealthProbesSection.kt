// The native Jetpack Compose + Material 3 Health Probes feature view — a parity port of
// web/src/features/system/components/status/HealthProbesSection.tsx. The web surface is a single polling
// `useQuery(getExtendedHealth, refetchInterval: 30s)` rendered inside an AccordionSection disclosure: a
// loading branch (two skeletons), an error branch (QueryError), and a content branch with two header badges
// (Live / Ready, each tinted by its status) over two cards — "Liveness — /healthz" (Status / Goroutines /
// Uptime) and "Readiness — /readyz" (Database / Latency / Pool Connections), each card carrying a status
// badge in its header.
//
// This surface keeps that contract exactly and renders every state the P3 checklist requires: loading
// (skeletons), content (the two cards), empty (payload not an object ⇒ a friendly empty state, never a blank
// box), hard error (QueryError + retry), and — through the ADR-013 cache-then-network freshness contract —
// stale + offline (cached cards kept visible with a freshness chip in the header + a single auto-refresh).
// The disclosure chrome (a GlassPanel with a clickable icon/title/description/badges/chevron header over a
// faded-in body) is reproduced inline from native primitives + design tokens (P1/S9), never ported Tailwind,
// exactly as the sibling self-contained surfaces do.
//
// All data flows through the shared [HealthProbesSectionViewModel] (P1/S8); the view performs NO HTTP. Every
// string resolves through the i18n facade (P1/S10) via [resolveHealthProbesText] — catalog-backed keys
// (Live, Ready, Status, Goroutines, Uptime, Database, Latency) localize, and the web's natural-key fallbacks
// (Health Probes, the two endpoint titles, Pool Connections, the description) fall back to the key text
// exactly as react-i18next does, so the on-screen text matches the web verbatim. The raw liveness/database
// statuses are data shown verbatim (web `{livenessStatus}` / `{dbStatus}`), not translatable copy. The
// HeartPulse glyph is a local lucide-style vector (the app uses no Material-icons artifact). Every
// interactive element carries a TalkBack label. `view.opened` is emitted once via the redacting logger.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HealthProbesSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.healthprobes

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberMotionDurationMs
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.CardHeader
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/**
 * Stateful entry point. Binds the `/system/health` feed seam via [source] into a
 * [HealthProbesSectionViewModel], records the one-shot `view.opened` diagnostic, collects the live
 * cache-then-network state, and renders the surface. A system-status host supplies [source] (typically
 * `store.let(::healthProbesSource)`); [logger] defaults to the process logger from the data container.
 */
@Composable
fun HealthProbesSection(
    source: HealthProbesSectionSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: HealthProbesSectionViewModel =
        viewModel(
            key = HealthProbesSectionRegistration.ID,
            factory = HealthProbesSectionViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberHealthProbesStrings()
    HealthProbesSectionContent(
        state = state,
        strings = strings,
        modifier = modifier,
        onRetry = viewModel::retry,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Draws the web
 * AccordionSection chrome (a [GlassPanel] with no built-in padding so the header click target and the
 * divider span full width) with an always-present header over a body that mounts only while [open].
 * The body switches on the cache-then-network [UiState]: loading ⇒ skeletons, hard error ⇒ [QueryError],
 * empty ⇒ a friendly [EmptyState], otherwise the two probe cards. Stale (non-error) data auto-refreshes
 * exactly once, mirroring the web 30s refetch cadence; offline keeps the cached cards with a freshness chip.
 */
@Composable
fun HealthProbesSectionContent(
    state: UiState<HealthProbesData>,
    strings: HealthProbesStrings,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
    onRefresh: () -> Unit = {},
    defaultOpen: Boolean = true,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    var open by rememberSaveable { mutableStateOf(defaultOpen) }
    val data = state.data ?: HealthProbesData.EMPTY
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.None) {
        HealthProbesHeader(
            strings = strings,
            state = state,
            data = data,
            open = open,
            onToggle = { open = !open },
        )
        if (open) {
            HealthProbesBody(state = state, data = data, strings = strings, onRetry = onRetry)
        }
    }
}

/**
 * The clickable disclosure header — the web `role="button"` row. A single merged button node so TalkBack
 * announces the title + description together; [stateDescription] carries the web `aria-expanded` and the
 * click label carries the expand/collapse action. The leading HeartPulse glyph is tinted with the info
 * accent (web `text-cyan-400`); the trailing chevron rotates with [open] (web `open && 'rotate-180'`),
 * honoring reduced motion via [rememberMotionDurationMs]. The Live / Ready badges (plus a freshness chip
 * when stale/refreshing/offline) appear only while there is content to describe (web success branch).
 */
@Composable
private fun HealthProbesHeader(
    strings: HealthProbesStrings,
    state: UiState<HealthProbesData>,
    data: HealthProbesData,
    open: Boolean,
    onToggle: () -> Unit,
) {
    val durationMs = rememberMotionDurationMs(MotionDurations.normal)
    val rotation by animateFloatAsState(
        targetValue = if (open) CHEVRON_OPEN_DEGREES else CHEVRON_CLOSED_DEGREES,
        animationSpec = tween(durationMs),
        label = "healthProbesChevron",
    )
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClickLabel = strings.actionLabel(open), onClick = onToggle)
                .padding(horizontal = Spacing.xl, vertical = Spacing.lg)
                .semantics(mergeDescendants = true) { stateDescription = strings.stateLabel(open) },
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = HealthProbesGlyphs.HeartPulse,
            contentDescription = null,
            size = IconSize.Lg,
            tint = TeslaTokens.status.info,
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(strings.title)
            Caption(strings.description)
        }
        if (state.isContent) {
            HealthProbesBadges(data = data, state = state, strings = strings)
        }
        Icon(
            imageVector = TeslaGlyphs.ChevronDown,
            contentDescription = null,
            size = IconSize.Md,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.rotate(rotation),
        )
    }
}

/**
 * The header chip cluster — the web `<Badge dot>Live</Badge><Badge dot>Ready</Badge>` pair, each tinted by
 * its own status. A freshness chip is appended only when the cached cards are not perfectly fresh
 * (stale / refreshing / offline), honestly surfacing the ADR-013 freshness state without removing any web
 * parity in the fresh case (where the web shows no chip).
 */
@Composable
private fun HealthProbesBadges(
    data: HealthProbesData,
    state: UiState<HealthProbesData>,
    strings: HealthProbesStrings,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Badge(text = strings.live, variant = HealthProbesProjection.statusBadgeVariant(data.livenessStatus), dot = true)
        Badge(text = strings.ready, variant = HealthProbesProjection.statusBadgeVariant(data.dbStatus), dot = true)
        if (state.stale || state.refreshing || state.hasError) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
            )
        }
    }
}

/**
 * The revealed body — the web `{open && (<FadeIn>…)}`. A hairline top divider precedes the per-state
 * content, faded in (web `FadeIn`). Only called while expanded.
 */
@Composable
private fun HealthProbesBody(
    state: UiState<HealthProbesData>,
    data: HealthProbesData,
    strings: HealthProbesStrings,
    onRetry: () -> Unit,
) {
    FadeIn(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = Spacing.xl, vertical = Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                when {
                    state.isLoading -> HealthProbesLoading(strings = strings)
                    state.isError -> HealthProbesError(state = state, strings = strings, onRetry = onRetry)
                    state.isEmpty -> EmptyState(message = strings.emptyHint, modifier = Modifier.fillMaxWidth())
                    else -> HealthProbesCards(data = data, strings = strings)
                }
            }
        }
    }
}

/** The web `isLoading` branch — two stacked skeleton cards (web `<Skeleton className="h-36"/>` ×2). */
@Composable
private fun HealthProbesLoading(strings: HealthProbesStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = SKELETON_CARD_HEIGHT)
        Skeleton(height = SKELETON_CARD_HEIGHT)
    }
}

/** The web `error` branch — a recovery-oriented [QueryError] with retry, classified from the failure. */
@Composable
private fun HealthProbesError(
    state: UiState<HealthProbesData>,
    strings: HealthProbesStrings,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = healthProbesErrorKind(state.errorKind, state.httpStatus),
        resourceName = strings.title,
        onRetry = onRetry,
    )
}

/** The web success branch — the Liveness and Readiness probe cards (stacked single-column on phones). */
@Composable
private fun HealthProbesCards(
    data: HealthProbesData,
    strings: HealthProbesStrings,
) {
    val locale = Locale.getDefault()
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        HealthProbesProbeCard(
            title = strings.liveness,
            status = data.livenessStatus,
            items =
                listOf(
                    KVItem(strings.statusLabel, data.livenessStatus),
                    KVItem(strings.goroutines, HealthProbesProjection.formatCount(data.goroutines, locale)),
                    KVItem(strings.uptime, HealthProbesProjection.formatUptime(data.uptimeSeconds)),
                ),
        )
        HealthProbesProbeCard(
            title = strings.readiness,
            status = data.dbStatus,
            items =
                listOf(
                    KVItem(strings.database, data.dbStatus),
                    KVItem(strings.latency, HealthProbesProjection.formatLatency(data.dbLatencyMs, locale)),
                    KVItem(strings.poolConnections, HealthProbesProjection.formatCount(data.poolTotalConns, locale)),
                ),
        )
    }
}

/** One probe card — the web `<Card><CardHeader action={<Badge>{status}</Badge>}/><KVList/></Card>`. */
@Composable
private fun HealthProbesProbeCard(
    title: String,
    status: String,
    items: List<KVItem>,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        CardHeader(
            title = title,
            action = { Badge(text = status, variant = HealthProbesProjection.statusBadgeVariant(status)) },
        )
        KVList(items = items)
    }
}

/**
 * The localized strings the composable renders — resolved once at the render boundary (all by-name with the
 * web `t(key, default)` fallback) and handed to the stateless content as a framework-free bundle so the view
 * stays a thin render layer. [actionLabel] / [stateLabel] pick the open/closed variant so the header's
 * accessibility affordances track the toggle.
 */
data class HealthProbesStrings(
    val title: String,
    val description: String,
    val live: String,
    val ready: String,
    val liveness: String,
    val readiness: String,
    val statusLabel: String,
    val goroutines: String,
    val uptime: String,
    val database: String,
    val latency: String,
    val poolConnections: String,
    val emptyHint: String,
    val loading: String,
    val expandAction: String,
    val collapseAction: String,
    val expandedState: String,
    val collapsedState: String,
) {
    /** The TalkBack action label for the toggle in its current [open] state (web `role="button"` intent). */
    fun actionLabel(open: Boolean): String = if (open) collapseAction else expandAction

    /** The TalkBack state description for the current [open] state (web `aria-expanded`). */
    fun stateLabel(open: Boolean): String = if (open) expandedState else collapsedState
}

/** The English-fallback bundle (every key text), used by previews + UI tests and as the catalog-miss path. */
fun healthProbesFallbackStrings(): HealthProbesStrings =
    HealthProbesStrings(
        title = HealthProbesKeys.TITLE,
        description = HealthProbesKeys.DESCRIPTION,
        live = HealthProbesKeys.LIVE,
        ready = HealthProbesKeys.READY,
        liveness = HealthProbesKeys.LIVENESS,
        readiness = HealthProbesKeys.READINESS,
        statusLabel = HealthProbesKeys.STATUS,
        goroutines = HealthProbesKeys.GOROUTINES,
        uptime = HealthProbesKeys.UPTIME,
        database = HealthProbesKeys.DATABASE,
        latency = HealthProbesKeys.LATENCY,
        poolConnections = HealthProbesKeys.POOL_CONNECTIONS,
        emptyHint = HealthProbesKeys.EMPTY_HINT,
        loading = HealthProbesKeys.LOADING,
        expandAction = HealthProbesKeys.EXPAND_ACTION,
        collapseAction = HealthProbesKeys.COLLAPSE_ACTION,
        expandedState = HealthProbesKeys.EXPANDED_STATE,
        collapsedState = HealthProbesKeys.COLLAPSED_STATE,
    )

/** Resolves the localized bundle once at the render boundary; remembered against [Context] (locale change). */
@Composable
private fun rememberHealthProbesStrings(): HealthProbesStrings {
    val context = LocalContext.current
    return remember(context) { resolveHealthProbesStrings(context) }
}

/** Pure resolver — maps every key through [resolveHealthProbesText] (catalog ⇒ localized, else key text). */
internal fun resolveHealthProbesStrings(context: Context): HealthProbesStrings =
    HealthProbesStrings(
        title = resolveHealthProbesText(context, HealthProbesKeys.TITLE),
        description = resolveHealthProbesText(context, HealthProbesKeys.DESCRIPTION),
        live = resolveHealthProbesText(context, HealthProbesKeys.LIVE),
        ready = resolveHealthProbesText(context, HealthProbesKeys.READY),
        liveness = resolveHealthProbesText(context, HealthProbesKeys.LIVENESS),
        readiness = resolveHealthProbesText(context, HealthProbesKeys.READINESS),
        statusLabel = resolveHealthProbesText(context, HealthProbesKeys.STATUS),
        goroutines = resolveHealthProbesText(context, HealthProbesKeys.GOROUTINES),
        uptime = resolveHealthProbesText(context, HealthProbesKeys.UPTIME),
        database = resolveHealthProbesText(context, HealthProbesKeys.DATABASE),
        latency = resolveHealthProbesText(context, HealthProbesKeys.LATENCY),
        poolConnections = resolveHealthProbesText(context, HealthProbesKeys.POOL_CONNECTIONS),
        emptyHint = resolveHealthProbesText(context, HealthProbesKeys.EMPTY_HINT),
        loading = resolveHealthProbesText(context, HealthProbesKeys.LOADING),
        expandAction = resolveHealthProbesText(context, HealthProbesKeys.EXPAND_ACTION),
        collapseAction = resolveHealthProbesText(context, HealthProbesKeys.COLLAPSE_ACTION),
        expandedState = resolveHealthProbesText(context, HealthProbesKeys.EXPANDED_STATE),
        collapsedState = resolveHealthProbesText(context, HealthProbesKeys.COLLAPSED_STATE),
    )

/**
 * Reproduces react-i18next's `t(key)` against the Android catalog: looks up `translation_<sanitized-key>`,
 * returning the localized resource when present and falling back to [key] when absent (the web behaviour).
 * `getIdentifier` is the only way to attempt a key that may be absent, so `DiscouragedApi` is suppressed;
 * release builds keep resource names (shrinking is off) so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
internal fun resolveHealthProbesText(
    context: Context,
    key: String,
): String {
    val resourceName = "translation_" + key.replace(NON_RESOURCE_CHARS, "_")
    val id = context.resources.getIdentifier(resourceName, "string", context.packageName)
    return if (id != 0) context.getString(id) else key
}

private val NON_RESOURCE_CHARS = Regex("[^A-Za-z0-9_]")

private const val CHEVRON_OPEN_DEGREES = 180f
private const val CHEVRON_CLOSED_DEGREES = 0f
private val SKELETON_CARD_HEIGHT = 144.dp
private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

// ── Local glyph — the web `HeartPulse` (lucide). Authored as a 24×24 stroked vector because the shared
// component layer carries no HeartPulse glyph (mirrors SystemHealthWidget's local Server glyph). ──

private object HealthProbesGlyphs {
    /** A heart outline with an ECG pulse line through it (lucide `heart-pulse`) — the header icon. */
    val HeartPulse: ImageVector =
        healthProbesStroked("HealthProbesHeartPulse") {
            moveTo(19f, 14f)
            curveTo(20.49f, 12.54f, 22f, 10.79f, 22f, 8.5f)
            curveTo(22f, 5.42f, 19.58f, 3f, 16.5f, 3f)
            curveTo(14.74f, 3f, 13.5f, 3.5f, 12f, 5f)
            curveTo(10.5f, 3.5f, 9.26f, 3f, 7.5f, 3f)
            curveTo(4.42f, 3f, 2f, 5.42f, 2f, 8.5f)
            curveTo(2f, 10.79f, 3.5f, 12.54f, 5f, 14f)
            lineTo(12f, 21f)
            close()
            moveTo(3.22f, 12f)
            lineTo(9.5f, 12f)
            lineTo(10f, 11f)
            lineTo(12f, 15.5f)
            lineTo(14f, 8.5f)
            lineTo(15.5f, 12f)
            lineTo(20.78f, 12f)
        }

    private fun healthProbesStroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = GLYPH_SIZE,
                defaultHeight = GLYPH_SIZE,
                viewportWidth = GLYPH_VIEWPORT,
                viewportHeight = GLYPH_VIEWPORT,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = GLYPH_STROKE,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews — one per rendered state (content / stale-offline / empty / loading / error) ──

private const val PREVIEW_NOW = 1_700_000_000_000L

private fun previewData(): HealthProbesData =
    HealthProbesData(
        livenessStatus = "ok",
        dbStatus = "healthy",
        goroutines = 148L,
        uptimeSeconds = 93_784L,
        dbLatencyMs = 2.4,
        poolTotalConns = 12L,
        resolved = true,
    )

private fun previewContent(stale: Boolean = false): UiState<HealthProbesData> =
    UiState(
        phase = UiPhase.Content,
        data = previewData(),
        fetchedAt = PREVIEW_NOW,
        stale = stale,
        errorKind = if (stale) ErrorKind.Network else null,
    )

@Preview(name = "HealthProbes · content", showBackground = true)
@Composable
private fun HealthProbesContentPreview() {
    TeslaSyncTheme {
        HealthProbesSectionContent(state = previewContent(), strings = healthProbesFallbackStrings())
    }
}

@Preview(name = "HealthProbes · offline", showBackground = true)
@Composable
private fun HealthProbesOfflinePreview() {
    TeslaSyncTheme {
        HealthProbesSectionContent(state = previewContent(stale = true), strings = healthProbesFallbackStrings())
    }
}

@Preview(name = "HealthProbes · empty", showBackground = true)
@Composable
private fun HealthProbesEmptyPreview() {
    TeslaSyncTheme {
        HealthProbesSectionContent(
            state = UiState(phase = UiPhase.Empty, data = HealthProbesData.EMPTY, fetchedAt = 1L),
            strings = healthProbesFallbackStrings(),
        )
    }
}

@Preview(name = "HealthProbes · loading", showBackground = true)
@Composable
private fun HealthProbesLoadingPreview() {
    TeslaSyncTheme {
        HealthProbesSectionContent(
            state = UiState(phase = UiPhase.Loading),
            strings = healthProbesFallbackStrings(),
        )
    }
}

@Preview(name = "HealthProbes · error", showBackground = true)
@Composable
private fun HealthProbesErrorPreview() {
    TeslaSyncTheme {
        HealthProbesSectionContent(
            state =
                UiState(
                    phase = UiPhase.Error,
                    errorKind = ErrorKind.Http,
                    httpStatus = 500,
                ),
            strings = healthProbesFallbackStrings(),
        )
    }
}
