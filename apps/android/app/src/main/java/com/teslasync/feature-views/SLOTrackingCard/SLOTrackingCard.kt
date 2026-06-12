// The native Jetpack Compose + Material 3 SLOTrackingCard feature view — a parity port of
// web/src/features/system/components/status/SLOTrackingCard.tsx. The web component reads a raw `useQuery` of
// `GET /status/uptime?window=…` and renders one personal-SLO uptime snapshot: a header (Target glyph +
// "Uptime & SLO" + an inline-editable personal target), a large tone-coloured percentage, a window subtitle
// + "{healthy}/{total} components healthy" line, a 24h/7d/30d/90d/1y window selector, a caveat note when the
// backend only has a current snapshot, and small loading / error lines — auto-refreshing every 60 s.
//
// This surface keeps that contract end to end. The primary entry binds the shared P1/S8-style
// [SLOTrackingCardViewModel] (the cross-platform `useQuery` analogue over the resilient client), collects
// its cache-then-network [UiState] lifecycle-aware, drives the web `refetchInterval` (60 s, paused while the
// screen is not STARTED — the `refetchIntervalInBackground:false` analogue), and renders every lifecycle
// state the layer can carry — loading, content, value-less empty, hard error with retry, and stale/offline
// "last known" + chip — all inside the always-present card chrome the web keeps visible. It performs NO HTTP
// itself. A stateless content renderer gives hosts / tests / previews a fetch-free entry. Every display
// string resolves through the P1/S10 catalog; the `%` / `·` symbols are universal and rendered literally
// like the sibling surfaces' unit symbols.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SLOTrackingCard) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.slotrackingcard

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.coroutines.delay
import java.util.Locale

/** The web `useQuery` `refetchInterval` (60 s). Drives the live-poll re-fetch cadence while STARTED. */
private const val SLO_REFRESH_INTERVAL_MS: Long = 60_000L

private val EDIT_FIELD_GAP = Spacing.sm
private val WINDOW_CHIP_MIN_HEIGHT = 32.dp

/**
 * The already-localized strings the surface renders. The web component hardcodes its copy; these arrive
 * through the P1/S10 i18n facade at the Compose boundary so the rest of the surface carries no English
 * literal. The `*Pattern` fields keep raw `%1$s` templates formatted at render; [windowLabels] maps each
 * window onto its long human label.
 */
data class SloStrings(
    val title: String,
    val targetSetPattern: String,
    val targetInputLabel: String,
    val windowSelectorLabel: String,
    val componentsHealthyPattern: String,
    val caveat: String,
    val loading: String,
    val error: String,
    val empty: String,
    val save: String,
    val cancel: String,
    val edit: String,
    val retry: String,
    val offline: String,
    val windowLabels: Map<StatusWindow, String>,
)

/**
 * Primary entry — the faithful native binding of the web `useQuery`. Records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11), collects the [SLOTrackingCardViewModel] feed lifecycle-aware, and
 * re-fetches every [SLO_REFRESH_INTERVAL_MS] while the screen is STARTED (the web `refetchInterval` +
 * `refetchIntervalInBackground:false`). It performs no HTTP — the view-model + its seam do (ADR-002).
 *
 * @param viewModel the surface state holder, constructed by the host via
 *   [SLOTrackingCardViewModel.factory] over `api.asSLOTrackingCardSource()` + a [SloTargetStore].
 */
@Composable
fun SLOTrackingCard(
    viewModel: SLOTrackingCardViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    val state by viewModel.uptime.collectAsStateWithLifecycle()
    val window by viewModel.window.collectAsStateWithLifecycle()
    val target by viewModel.target.collectAsStateWithLifecycle()

    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(viewModel, lifecycleOwner) {
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                delay(SLO_REFRESH_INTERVAL_MS)
                viewModel.refresh()
            }
        }
    }

    SLOTrackingCardContent(
        state = state,
        window = window,
        target = target,
        onWindowChange = viewModel::setWindow,
        onSaveTarget = viewModel::setTarget,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Always draws the
 * card chrome (header with the editable target, the headline percentage, the window subtitle + healthy
 * count, the window selector) then layers the lifecycle signals the web keeps inline: a value-less empty
 * caption, a loading line, a hard-error line with retry, the historical-source caveat, and a stale/offline
 * freshness chip so cached "last known" data is never presented as live. [nowMillis] feeds the relative
 * freshness label (injectable for deterministic tests/previews).
 */
@Composable
fun SLOTrackingCardContent(
    state: UiState<UptimeWindow>,
    window: StatusWindow,
    target: Double,
    onWindowChange: (StatusWindow) -> Unit,
    onSaveTarget: (Double) -> Unit,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: SloStrings = rememberSloStrings(),
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        SloHeader(target = target, strings = strings, onSaveTarget = onSaveTarget)
        Spacer(Modifier.height(Spacing.md))
        SloMetric(state = state, window = window, target = target, strings = strings, locale = locale)
        Spacer(Modifier.height(Spacing.md))
        SloWindowSelector(selected = window, onSelect = onWindowChange, strings = strings)
        SloCaveat(state = state, strings = strings)
        SloStatusArea(state = state, strings = strings, onRefresh = onRefresh)
    }
}

@Composable
private fun SloHeader(
    target: Double,
    strings: SloStrings,
    onSaveTarget: (Double) -> Unit,
) {
    var editing by remember { mutableStateOf(false) }
    var draft by remember(target) { mutableStateOf(SLOTrackingCardProjection.targetText(target)) }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = SLOTrackingCardGlyphs.Target,
            contentDescription = null,
            size = IconSize.Md,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        PanelTitle(strings.title, modifier = Modifier.weight(1f))
        if (!editing) {
            Caption(strings.targetSetPattern.format(SLOTrackingCardProjection.targetText(target)))
            Button(
                label = strings.edit,
                onClick = { editing = true },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }

    if (editing) {
        Spacer(Modifier.height(Spacing.sm))
        SloTargetEditor(
            draft = draft,
            strings = strings,
            onDraftChange = { draft = it },
            onSave = {
                val parsed = SLOTrackingCardProjection.sanitizeTarget(draft)
                if (parsed != null) onSaveTarget(parsed)
                draft = SLOTrackingCardProjection.targetText(parsed ?: target)
                editing = false
            },
            onCancel = {
                draft = SLOTrackingCardProjection.targetText(target)
                editing = false
            },
        )
    }
}

@Composable
private fun SloTargetEditor(
    draft: String,
    strings: SloStrings,
    onDraftChange: (String) -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(EDIT_FIELD_GAP),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.weight(1f)) {
            Input(
                value = draft,
                onValueChange = onDraftChange,
                label = strings.targetInputLabel,
                keyboardType = KeyboardType.Number,
            )
        }
        Button(label = strings.save, onClick = onSave, variant = ButtonVariant.Primary, size = ButtonSize.Sm)
        Button(label = strings.cancel, onClick = onCancel, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
    }
}

@Composable
private fun SloMetric(
    state: UiState<UptimeWindow>,
    window: StatusWindow,
    target: Double,
    strings: SloStrings,
    locale: Locale,
) {
    val pct = state.data?.uptimePercent
    val tone = remember(pct, target) { UptimeTone.of(pct, target) }
    val headline =
        if (SLOTrackingCardProjection.isEmpty(state.data ?: UptimeWindow())) {
            EM_DASH
        } else {
            SLOTrackingCardProjection.formatPercent(pct, locale)
        }
    val windowLabel = strings.windowLabels[window] ?: window.wire
    val healthy = SLOTrackingCardProjection.countText(state.data?.healthyCount)
    val total = SLOTrackingCardProjection.countText(state.data?.totalCount)
    val subtitle = "$windowLabel \u00b7 ${strings.componentsHealthyPattern.format(healthy, total)}"

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text(
            text = headline,
            style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.SemiBold),
            color = sloToneColor(tone),
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        Caption(subtitle)
    }
}

@Composable
private fun SloWindowSelector(
    selected: StatusWindow,
    onSelect: (StatusWindow) -> Unit,
    strings: SloStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .semantics { contentDescription = strings.windowSelectorLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        StatusWindow.entries.forEach { window ->
            SloWindowChip(label = window.wire, selected = window == selected, onClick = { onSelect(window) })
        }
    }
}

@Composable
private fun SloWindowChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val container =
        if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
    val content =
        if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
    Box(
        modifier =
            Modifier
                .clip(CircleShape)
                .background(container)
                .then(
                    if (selected) {
                        Modifier.border(1.dp, MaterialTheme.colorScheme.primary, CircleShape)
                    } else {
                        Modifier
                    },
                ).selectable(selected = selected, role = Role.Tab, onClick = onClick)
                .heightIn(min = WINDOW_CHIP_MIN_HEIGHT)
                .padding(horizontal = Spacing.md, vertical = Spacing.xs),
        contentAlignment = Alignment.Center,
    ) {
        Text(text = label, style = MaterialTheme.typography.labelMedium, color = content)
    }
}

@Composable
private fun SloCaveat(
    state: UiState<UptimeWindow>,
    strings: SloStrings,
) {
    val data = state.data ?: return
    if (!SLOTrackingCardProjection.showsCaveat(data.historicalSource)) return
    Spacer(Modifier.height(Spacing.sm))
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            imageVector = TeslaGlyphs.Info,
            contentDescription = null,
            size = IconSize.Xs,
            tint = TeslaTokens.status.warning,
        )
        Caption(SLOTrackingCardProjection.caveatText(data.note, strings.caveat), modifier = Modifier.weight(1f))
    }
}

@Composable
private fun SloStatusArea(
    state: UiState<UptimeWindow>,
    strings: SloStrings,
    onRefresh: () -> Unit,
) {
    val offlineWithData = state.hasError && state.hasData
    val showFreshness = state.stale || state.refreshing || offlineWithData
    when {
        state.isLoading -> {
            Spacer(Modifier.height(Spacing.sm))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Spinner(size = SpinnerSize.Sm, accessibleLabel = strings.loading)
                BodyText(strings.loading, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        state.isError -> {
            Spacer(Modifier.height(Spacing.sm))
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                ErrorText(strings.error)
                Button(
                    label = strings.retry,
                    onClick = onRefresh,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                )
            }
        }

        state.isEmpty -> {
            Spacer(Modifier.height(Spacing.sm))
            Caption(strings.empty)
        }
    }

    if (showFreshness) {
        Spacer(Modifier.height(Spacing.sm))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_common_loading),
                errorLabel = strings.offline,
                formatAge = rememberSloFreshnessFormatter(),
            )
        }
    }
}

/** Tone band → semantic status colour — the native mirror of the web `tone` Tailwind classes (P1/S9). */
@Composable
private fun sloToneColor(tone: UptimeTone): Color =
    when (tone) {
        UptimeTone.Healthy -> TeslaTokens.status.success
        UptimeTone.Warning -> TeslaTokens.status.warning
        UptimeTone.Danger -> TeslaTokens.status.danger
        UptimeTone.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Resolves every surface string from the P1/S10 catalog (the `system.slo.*` + reused common keys). */
@Composable
fun rememberSloStrings(): SloStrings {
    val title = stringResource(R.string.translation_system_slo_title)
    val targetSet = stringResource(R.string.translation_system_slo_targetSet)
    val targetInput = stringResource(R.string.translation_system_slo_a11y_targetInput)
    val windowSelector = stringResource(R.string.translation_system_slo_a11y_windowSelector)
    val componentsHealthy = stringResource(R.string.translation_system_slo_componentsHealthy)
    val caveat = stringResource(R.string.translation_system_slo_caveat)
    val loading = stringResource(R.string.translation_system_slo_loading)
    val error = stringResource(R.string.translation_system_slo_error)
    val empty = stringResource(R.string.translation_system_slo_empty)
    val save = stringResource(R.string.translation_common_save)
    val cancel = stringResource(R.string.translation_common_cancel)
    val edit = stringResource(R.string.translation_common_edit)
    val retry = stringResource(R.string.translation_common_retry)
    val offline = stringResource(R.string.translation_common_offline)
    val window24h = stringResource(R.string.translation_system_slo_window24h)
    val window7d = stringResource(R.string.translation_system_slo_window7d)
    val window30d = stringResource(R.string.translation_system_slo_window30d)
    val window90d = stringResource(R.string.translation_system_slo_window90d)
    val window1y = stringResource(R.string.translation_system_slo_window1y)
    val labels =
        mapOf(
            StatusWindow.H24 to window24h,
            StatusWindow.D7 to window7d,
            StatusWindow.D30 to window30d,
            StatusWindow.D90 to window90d,
            StatusWindow.Y1 to window1y,
        )
    return remember(
        title,
        targetSet,
        targetInput,
        windowSelector,
        componentsHealthy,
        caveat,
        loading,
        error,
        empty,
        save,
        cancel,
        edit,
        retry,
        offline,
        labels,
    ) {
        SloStrings(
            title = title,
            targetSetPattern = targetSet,
            targetInputLabel = targetInput,
            windowSelectorLabel = windowSelector,
            componentsHealthyPattern = componentsHealthy,
            caveat = caveat,
            loading = loading,
            error = error,
            empty = empty,
            save = save,
            cancel = cancel,
            edit = edit,
            retry = retry,
            offline = offline,
            windowLabels = labels,
        )
    }
}

/**
 * Localized relative-age formatter for the offline/stale freshness chip (`translation_freshness_*`) — the
 * render-only concern the sibling surfaces resolve the same way, kept out of the pure projection.
 */
@Composable
private fun rememberSloFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

/**
 * The bullseye the web title uses (lucide `Target`). lucide ships no Android glyph and the frozen
 * `material-icons-extended` artifact is banned, so — exactly as the sibling `HelpersGlyphs` / `StatusHeader`
 * surfaces author their lucide ports — it is drawn here as a 24×24 stroked vector: two concentric rings and
 * a centre dot.
 */
private object SLOTrackingCardGlyphs {
    private const val VIEWPORT = 24f
    private const val STROKE_WIDTH = 2f
    private const val CENTER = 12f
    private const val OUTER_RADIUS = 9f
    private const val INNER_RADIUS = 5f

    val Target: ImageVector =
        stroked("Target") {
            circle(CENTER, CENTER, OUTER_RADIUS)
            circle(CENTER, CENTER, INNER_RADIUS)
            moveTo(CENTER, CENTER)
            lineTo(CENTER + 0.1f, CENTER)
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
                viewportWidth = VIEWPORT,
                viewportHeight = VIEWPORT,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = STROKE_WIDTH,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()

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
}

// ── Previews (tooling-only; one @Preview per render branch the surface defines) ─────────────────────────

private const val PREVIEW_NOW: Long = 1_749_643_200_000L

private val PREVIEW_STRINGS =
    SloStrings(
        title = "Uptime & SLO",
        targetSetPattern = "Target %1\$s%%",
        targetInputLabel = "Target uptime percentage",
        windowSelectorLabel = "Uptime window selector",
        componentsHealthyPattern = "%1\$s / %2\$s components healthy",
        caveat =
            "Per-window historical uptime requires the heartbeat history backend (planned). " +
                "This figure reflects the current snapshot.",
        loading = "Loading uptime\u2026",
        error = "Failed to load uptime data.",
        empty = "No uptime data for this window yet.",
        save = "Save",
        cancel = "Cancel",
        edit = "Edit",
        retry = "Retry",
        offline = "Offline",
        windowLabels =
            mapOf(
                StatusWindow.H24 to "Last 24 hours",
                StatusWindow.D7 to "Last 7 days",
                StatusWindow.D30 to "Last 30 days",
                StatusWindow.D90 to "Last 90 days",
                StatusWindow.Y1 to "Last year",
            ),
    )

private val PREVIEW_DATA =
    UptimeWindow(
        window = "30d",
        uptimePercent = 99.95,
        healthyCount = 8,
        totalCount = 8,
        generatedAt = "2026-06-11T12:00:00Z",
        historicalSource = "series",
    )

private val PREVIEW_SNAPSHOT =
    PREVIEW_DATA.copy(historicalSource = "snapshot", uptimePercent = 98.40, healthyCount = 7)

@Composable
private fun previewCard(state: UiState<UptimeWindow>) {
    TeslaSyncTheme(dynamicColor = false) {
        SLOTrackingCardContent(
            state = state,
            window = StatusWindow.D30,
            target = DEFAULT_SLO_TARGET,
            onWindowChange = {},
            onSaveTarget = {},
            onRefresh = {},
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun SloContentPreview() {
    previewCard(UiState(phase = UiPhase.Content, data = PREVIEW_DATA, fetchedAt = PREVIEW_NOW))
}

@Preview(name = "Caveat (snapshot)", showBackground = true)
@Composable
private fun SloCaveatPreview() {
    previewCard(UiState(phase = UiPhase.Content, data = PREVIEW_SNAPSHOT, fetchedAt = PREVIEW_NOW))
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun SloLoadingPreview() {
    previewCard(UiState.loading())
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun SloErrorPreview() {
    previewCard(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network))
}

@Preview(name = "Offline (cached + chip)", showBackground = true)
@Composable
private fun SloOfflinePreview() {
    previewCard(
        UiState(
            phase = UiPhase.Content,
            data = PREVIEW_DATA,
            fetchedAt = PREVIEW_NOW,
            stale = true,
            errorKind = ErrorKind.Network,
        ),
    )
}
