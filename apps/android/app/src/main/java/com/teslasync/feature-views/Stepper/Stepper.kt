// The native Jetpack Compose + Material 3 Stepper feature view — a parity port of
// web/src/features/onboarding/components/Stepper.tsx. The web component renders a compact vertical step
// list (an `<ol>`) used by the onboarding page: each step is `done` (✓ green check), `current` (a spinner —
// the first not-done, actionable step), or `pending` (a muted index circle). Completed rows stay visually
// quiet and pending rows hide their CTA so the user follows the flow; only the `current` step shows its CTA.
//
// The surface is purely presentational — the OnboardingPage owns the `useOnboardingStatus` query and threads
// the resolved steps + a `renderCta` render-prop down, so this view performs NO HTTP and binds no data hook
// of its own. As in the sibling TripLegList port, the owning page's feed genuinely carries
// loading/error/stale, so this view renders every lifecycle state the shared [UiState] (P1/S8) can carry — a
// loading skeleton, a hard-error retry surface, a friendly empty state (web's empty `<ol>`), and stale/
// offline cached content with a freshness chip + auto-refresh — without ever fetching. A web-parity overload
// taking the raw `steps` list is provided for hosts that already hold it.
//
// Every derivation flows through the pure [StepperProjection] (the verbatim web `stateOf` state machine);
// the composable is a thin render layer that resolves localized chrome strings (P1/S10), maps the web colors
// onto the P1/S9 tokens (done → `status.success`, current → `status.info`, pending → muted surface), and
// honors the reduced-motion preference (P1/S9) by swapping the `current` spinner for a static ring. The one-
// shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition. The per-step indicator is
// decorative (web `aria-hidden`); the step title/description read as content and only the `current` step's
// CTA is an actionable, labeled node — exactly the web accessibility shape.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/Stepper — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path — exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.stepper

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CollectionInfo
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.collectionInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Indicator geometry (web `h-9 w-9` circle, `h-4 w-4` glyph, `border`) ────────────────────────────
private val INDICATOR_SIZE: Dp = 36.dp
private val BORDER_WIDTH: Dp = 1.dp
private val SPINNER_SIZE: Dp = 16.dp
private val SPINNER_STROKE: Dp = 2.dp

// ── Connector (web `mt-1 w-px flex-1 min-h-[28px]`) ─────────────────────────────────────────────────
private val CONNECTOR_WIDTH: Dp = 1.dp
private val CONNECTOR_MIN_HEIGHT: Dp = 28.dp

// ── The web translucent washes, reproduced exactly (emerald/cyan 500-20 fill, 400-50 border) ────────
private const val INDICATOR_FILL_ALPHA = 0.20f
private const val INDICATOR_BORDER_ALPHA = 0.50f
private const val CONNECTOR_DONE_ALPHA = 0.40f

// Pending description maps web `text-muted`: a quieter step than the secondary done/current copy.
private const val MUTED_ALPHA = 0.65f

// ── Loading skeleton chrome ─────────────────────────────────────────────────────────────────────────
private const val SKELETON_STEP_COUNT = 3
private const val SKELETON_TITLE_FRACTION = 0.5f
private const val SKELETON_DESC_FRACTION = 0.9f
private val SKELETON_TITLE_HEIGHT: Dp = 16.dp
private val SKELETON_DESC_HEIGHT: Dp = 12.dp

// ── Self-authored arrow-right glyph (web default CTA `icon={<ArrowRight />}`) ───────────────────────
// TeslaGlyphs has no ArrowRight; it is authored here in the same 24×24 stroked style as that set so it
// inherits the Button's content color via the Icon tint.
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE_WIDTH = 2f

private val ArrowRightGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "StepperArrowRight",
            defaultWidth = GLYPH_VIEWPORT.dp,
            defaultHeight = GLYPH_VIEWPORT.dp,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ) {
                moveTo(5f, 12f)
                lineTo(19f, 12f)
                moveTo(12f, 5f)
                lineTo(19f, 12f)
                lineTo(12f, 19f)
            }
        }.build()

/**
 * Stateful entry point — the faithful port of the web `Stepper` props with the shared cache-then-network
 * lifecycle the owning onboarding page's feed carries. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) on first composition, then renders every [state]. This view never performs HTTP; the
 * host owns the feed (P1/S8) and supplies [onRetry] (its `refetch`) and [onStepCtaClick] (the step action).
 *
 * @param state the cache-then-network projection of the onboarding steps.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param onStepCtaClick invoked with the step key when the current step's default CTA is tapped.
 * @param renderCta optional render-prop (web `renderCta`) so the host can wrap the current CTA in a link.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun Stepper(
    state: UiState<List<OnboardingStepData>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onStepCtaClick: (String) -> Unit = {},
    renderCta: (@Composable (StepperRow) -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { StepperDiagnostics.recordViewOpened(logger) }
    StepperContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        onStepCtaClick = onStepCtaClick,
        renderCta = renderCta,
    )
}

/**
 * Web-parity overload mirroring the web component's `({ steps, renderCta })` props, for hosts that already
 * hold the resolved steps. An empty [steps] list projects onto the empty [UiState] (web's empty `<ol>`).
 * There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun Stepper(
    steps: List<OnboardingStepData>,
    modifier: Modifier = Modifier,
    onStepCtaClick: (String) -> Unit = {},
    renderCta: (@Composable (StepperRow) -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(steps) { StepperProjection.projectUiState(steps, isLoading = false) }
    Stepper(
        state = state,
        onRetry = {},
        modifier = modifier,
        onStepCtaClick = onStepCtaClick,
        renderCta = renderCta,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. A freshness chip
 * appears above the list when content is stale/refreshing/offline, and stale (non-error) data auto-refreshes,
 * mirroring the shared cache-then-network freshness contract. Inside it switches between a loading skeleton,
 * a hard-error retry surface, a friendly empty state, and the resolved step list.
 */
@Composable
fun StepperContent(
    state: UiState<List<OnboardingStepData>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onStepCtaClick: (String) -> Unit = {},
    renderCta: (@Composable (StepperRow) -> Unit)? = null,
    strings: StepperStrings = rememberStepperStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    val degraded = snapshot != null && (state.stale || state.refreshing || state.hasError)
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (degraded) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                StepperFreshness(state = state, strings = strings)
            }
        }
        when {
            state.isLoading -> StepperSkeleton(strings = strings)
            state.isError -> StepperError(onRetry = onRetry, strings = strings)
            snapshot.isNullOrEmpty() ->
                EmptyState(
                    message = strings.empty,
                    icon = TeslaGlyphs.Info,
                    modifier = Modifier.fillMaxWidth(),
                )
            else ->
                StepperList(
                    steps = snapshot,
                    onStepCtaClick = onStepCtaClick,
                    renderCta = renderCta,
                )
        }
    }
}

/**
 * The content branch: the ordered step list (web `<ol className="flex flex-col gap-6">`). Derives the
 * render-ready rows once via the pure [StepperProjection.rows] and exposes list-collection semantics so
 * TalkBack announces the step count (the native analogue of the web `aria-label` on the `<ol>`).
 */
@Composable
private fun StepperList(
    steps: List<OnboardingStepData>,
    onStepCtaClick: (String) -> Unit,
    renderCta: (@Composable (StepperRow) -> Unit)?,
) {
    val rows = remember(steps) { StepperProjection.rows(steps) }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { collectionInfo = CollectionInfo(rowCount = rows.size, columnCount = 1) },
        verticalArrangement = Arrangement.spacedBy(Spacing.xl2),
    ) {
        rows.forEach { row ->
            StepperItem(row = row, onStepCtaClick = onStepCtaClick, renderCta = renderCta)
        }
    }
}

/**
 * One step row (web `<li className="flex gap-4">`): a left rail (indicator + trailing connector) beside the
 * body (title, description, and — only while current — the CTA). The row is laid out at its minimum
 * intrinsic height so the connector can stretch (web `flex-1`) to fill the body's height.
 */
@Composable
private fun StepperItem(
    row: StepperRow,
    onStepCtaClick: (String) -> Unit,
    renderCta: (@Composable (StepperRow) -> Unit)?,
) {
    Row(
        modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min),
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        StepperRail(row = row, modifier = Modifier.fillMaxHeight())
        StepperBody(
            row = row,
            onStepCtaClick = onStepCtaClick,
            renderCta = renderCta,
            modifier = Modifier.weight(1f),
        )
    }
}

/**
 * The left rail: the state indicator with, for every row but the last, the trailing connector line that
 * stretches to fill the row height (web `flex-1 min-h-[28px]`) and turns green once the step is done.
 */
@Composable
private fun StepperRail(
    row: StepperRow,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        StepIndicator(row)
        if (row.showConnector) {
            Spacer(Modifier.height(Spacing.xs))
            Box(
                modifier =
                    Modifier
                        .width(CONNECTOR_WIDTH)
                        .weight(1f)
                        .heightIn(min = CONNECTOR_MIN_HEIGHT)
                        .background(connectorColor(row.state)),
            )
        }
    }
}

/**
 * The circular state indicator. Done shows a check, current a spinner (a static ring under reduced motion),
 * and pending the 1-based step number. The whole indicator is cleared from the accessibility tree to match
 * the web `aria-hidden="true"` — the step is announced through its title/description and (when current) CTA.
 */
@Composable
private fun StepIndicator(row: StepperRow) {
    val palette = indicatorPalette(row.state)
    Box(
        modifier =
            Modifier
                .size(INDICATOR_SIZE)
                .clip(CircleShape)
                .background(palette.background)
                .border(BORDER_WIDTH, palette.border, CircleShape)
                .clearAndSetSemantics {},
        contentAlignment = Alignment.Center,
    ) {
        when (row.state) {
            StepState.Done ->
                Icon(
                    imageVector = TeslaGlyphs.Check,
                    contentDescription = null,
                    size = IconSize.Md,
                    tint = palette.content,
                )
            StepState.Current -> CurrentIndicator(color = palette.content)
            StepState.Pending ->
                Text(
                    text = row.number.toString(),
                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                    color = palette.content,
                )
        }
    }
}

/**
 * The current-step glyph: an indeterminate spinner (web `Loader2 animate-spin`) that falls back to a static
 * ring when the active reduced-motion preference (P1/S9) asks for no animation.
 */
@Composable
private fun CurrentIndicator(color: Color) {
    if (rememberReducedMotion()) {
        Box(modifier = Modifier.size(SPINNER_SIZE).border(SPINNER_STROKE, color, CircleShape))
    } else {
        CircularProgressIndicator(
            modifier = Modifier.size(SPINNER_SIZE),
            color = color,
            strokeWidth = SPINNER_STROKE,
        )
    }
}

/**
 * The row body (web `flex-1 pb-1`): the title, the description, and — only while the step is current — its
 * CTA (web `state === 'current' && step.cta`). The host's [renderCta] wraps the CTA when supplied, otherwise
 * the default primary button is shown.
 */
@Composable
private fun StepperBody(
    row: StepperRow,
    onStepCtaClick: (String) -> Unit,
    renderCta: (@Composable (StepperRow) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.padding(bottom = Spacing.xs)) {
        Heading(text = row.title, level = HeadingLevel.Panel, color = titleColor(row.state))
        Spacer(Modifier.height(Spacing.xs))
        BodyText(text = row.description, color = descriptionColor(row.state))
        if (row.showCta) {
            Spacer(Modifier.height(Spacing.md))
            if (renderCta != null) {
                renderCta(row)
            } else {
                DefaultStepCta(row = row, onStepCtaClick = onStepCtaClick)
            }
        }
    }
}

/** The default CTA (web primary button + ArrowRight icon): label + disabled from the step, click by key. */
@Composable
private fun DefaultStepCta(
    row: StepperRow,
    onStepCtaClick: (String) -> Unit,
) {
    val cta = row.cta ?: return
    Button(
        label = cta.label,
        onClick = { onStepCtaClick(row.key) },
        variant = ButtonVariant.Primary,
        size = ButtonSize.Sm,
        enabled = !cta.disabled,
        leadingIcon = ArrowRightGlyph,
    )
}

/**
 * A freshness chip reflecting refreshing/stale/offline over still-shown content, the native expression of
 * the shared `DataFreshness` contract (the web onboarding page's 30s poll / `refetch`).
 */
@Composable
private fun StepperFreshness(
    state: UiState<List<OnboardingStepData>>,
    strings: StepperStrings,
) {
    val formatAge = rememberStepperFreshnessFormatter()
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        fetchingLabel = strings.loading,
        errorLabel = strings.offline,
        formatAge = formatAge,
    )
}

/** The loading branch: muted indicator + text-bar skeletons in the step shape, announced as "Loading". */
@Composable
private fun StepperSkeleton(strings: StepperStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = strings.loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.xl2),
    ) {
        repeat(SKELETON_STEP_COUNT) { StepperSkeletonRow() }
    }
}

/** A single loading row — a circular indicator disc beside a title + description bar. */
@Composable
private fun StepperSkeletonRow() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Box(
            modifier =
                Modifier
                    .size(INDICATOR_SIZE)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
            Skeleton(widthFraction = SKELETON_DESC_FRACTION, height = SKELETON_DESC_HEIGHT)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun StepperError(
    onRetry: () -> Unit,
    strings: StepperStrings,
) {
    ErrorDisplay(
        message = strings.errorMessage,
        title = strings.errorTitle,
        onRetry = onRetry,
        retryLabel = strings.retry,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Indicator fill/border/content colors per state — the web emerald (done) / cyan (current) / muted map. */
private class IndicatorPalette(
    val background: Color,
    val border: Color,
    val content: Color,
)

@Composable
private fun indicatorPalette(state: StepState): IndicatorPalette =
    when (state) {
        StepState.Done ->
            IndicatorPalette(
                background = TeslaTokens.status.success.copy(alpha = INDICATOR_FILL_ALPHA),
                border = TeslaTokens.status.success.copy(alpha = INDICATOR_BORDER_ALPHA),
                content = TeslaTokens.status.success,
            )
        StepState.Current ->
            IndicatorPalette(
                background = TeslaTokens.status.info.copy(alpha = INDICATOR_FILL_ALPHA),
                border = TeslaTokens.status.info.copy(alpha = INDICATOR_BORDER_ALPHA),
                content = TeslaTokens.status.info,
            )
        StepState.Pending ->
            IndicatorPalette(
                background = MaterialTheme.colorScheme.surfaceVariant,
                border = MaterialTheme.colorScheme.outlineVariant,
                content = MaterialTheme.colorScheme.onSurfaceVariant,
            )
    }

/** Title color: web done/current both render at full emphasis; pending steps are dimmed to secondary. */
@Composable
private fun titleColor(state: StepState): Color =
    if (state == StepState.Pending) {
        MaterialTheme.colorScheme.onSurfaceVariant
    } else {
        MaterialTheme.colorScheme.onSurface
    }

/** Description color: web done/current use secondary copy, pending uses the quieter muted copy. */
@Composable
private fun descriptionColor(state: StepState): Color {
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant
    return if (state == StepState.Pending) secondary.copy(alpha = MUTED_ALPHA) else secondary
}

/** Connector color: web green once the step above is done, else a subtle hairline. */
@Composable
private fun connectorColor(state: StepState): Color =
    if (state == StepState.Done) {
        TeslaTokens.status.success.copy(alpha = CONNECTOR_DONE_ALPHA)
    } else {
        MaterialTheme.colorScheme.outlineVariant
    }

/**
 * Resolves the localized chrome strings once at the Compose boundary (P1/S10) so the rest of the surface
 * carries no English literal: the empty-state copy, the hard-error title/message + retry label, and the
 * freshness chip's "loading"/"offline" labels.
 */
@Composable
private fun rememberStepperStrings(): StepperStrings {
    val empty = stringResource(R.string.translation_checklist_empty)
    val errorTitle = stringResource(R.string.translation_error_serverError_title)
    val errorMessage = stringResource(R.string.translation_error_serverError_message)
    val retry = stringResource(R.string.translation_common_retry)
    val loading = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    return remember(empty, errorTitle, errorMessage, retry, loading, offline) {
        StepperStrings(
            empty = empty,
            errorTitle = errorTitle,
            errorMessage = errorMessage,
            retry = retry,
            loading = loading,
            offline = offline,
        )
    }
}

/** Localized relative-age formatter for the freshness chip (`translation_freshness_*`), kept render-only. */
@Composable
private fun rememberStepperFreshnessFormatter(): (FreshnessAge) -> String {
    val emDash = "\u2014"
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> emDash
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STEPS =
    listOf(
        OnboardingStepData(
            key = "tesla",
            title = "Connect your Tesla account",
            description = "Sign in with your Tesla account to authorize the Fleet API connection.",
            done = true,
        ),
        OnboardingStepData(
            key = "vehicle",
            title = "Wait for vehicles to appear",
            description = "Vehicles linked to your Tesla account will sync automatically.",
            done = false,
            cta = OnboardingStepCta(label = "Refresh"),
        ),
        OnboardingStepData(
            key = "telemetry",
            title = "Wait for telemetry data",
            description = "Live data appears once your vehicle uploads its first signal batch.",
            done = false,
            cta = OnboardingStepCta(label = "Setup guide", href = "/docs/fleet-telemetry-setup"),
        ),
    )

@Preview(name = "Content — mixed states", showBackground = true)
@Composable
private fun StepperContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StepperContent(state = StepperProjection.projectUiState(PREVIEW_STEPS, isLoading = false), onRetry = {})
    }
}

@Preview(name = "All done", showBackground = true)
@Composable
private fun StepperAllDonePreview() {
    val steps = PREVIEW_STEPS.map { it.copy(done = true) }
    TeslaSyncTheme(dynamicColor = false) {
        StepperContent(state = StepperProjection.projectUiState(steps, isLoading = false), onRetry = {})
    }
}

@Preview(name = "Current — reduced motion", showBackground = true)
@Composable
private fun StepperReducedMotionPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            StepperContent(state = StepperProjection.projectUiState(PREVIEW_STEPS, isLoading = false), onRetry = {})
        }
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun StepperLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StepperContent(state = UiState.loading(), onRetry = {})
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun StepperEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StepperContent(state = UiState(phase = UiPhase.Empty, data = emptyList()), onRetry = {})
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun StepperErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StepperContent(state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRetry = {})
    }
}

@Preview(name = "Offline — last known", showBackground = true)
@Composable
private fun StepperOfflinePreview() {
    val offline =
        UiState(
            phase = UiPhase.Content,
            data = PREVIEW_STEPS,
            fetchedAt = System.currentTimeMillis(),
            stale = true,
            errorKind = ErrorKind.Network,
        )
    TeslaSyncTheme(dynamicColor = false) {
        StepperContent(state = offline, onRetry = {})
    }
}
