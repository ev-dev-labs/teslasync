// The native Jetpack Compose + Material 3 PedalUsage feature view — a parity port of
// web/src/features/driving/components/driving-dynamics/PedalUsage.tsx. The web component renders a GlassPanel
// titled "Pedal Usage" and, when at least one pedal reading is present (web `hasAny`), a responsive grid that
// reflows 1 → 3 columns at the web `sm` breakpoint: a Throttle RadialGauge (cyan), a Brake RadialGauge (red),
// and a brake-status cell (a Footprints glyph, a danger/success Badge, and a caption). When no reading is
// present it falls back to a friendly EmptyState ("No pedal telemetry received yet"). This port keeps that
// contract: the panel + title always render, the grid reflows at the web `sm` (640dp) breakpoint, each gauge
// carries the web's semantic accent via the design tokens (P1/S9), the Badge flips danger ↔ success with the
// brake state, and the empty branch never collapses to a blank box. A skeleton branch (opt-in `loading` flag
// the owning page threads) preserves the loading affordance the page's `/drive-dynamics/latest` query
// implies; its default (`false`) is the web's exact contract.
//
// Every derivation flows through the pure [PedalUsageProjection]; the composable is a thin render layer that
// binds the two web data sources — `useTranslation` (the generated i18n catalog, P1/S10) and `useUnits` (the
// live decimal precision from the data container, P1/S8) — and records the one-shot `view.opened` diagnostic
// (P1/S11) on first composition. The title, every label, and the empty / loading messages resolve through
// the catalog (`dynamics.*` + `a11y.loading` keys); the only non-key string is the em-dash unit the web
// itself renders for an absent reading, so there is no English UI copy literal in this file.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/PedalUsage) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.pedalusage

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `<FadeIn delay={0.1}>` → 100ms entry delay. */
private const val PEDAL_FADE_DELAY_MS: Int = 100

/** Tailwind `sm` (640px) breakpoint — the web `sm:grid-cols-3` reflow (single column below it). */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp

/** Web RadialGauge `size={140}` — the pedal gauges are larger than the shared default. */
private val GAUGE_SIZE: Dp = 140.dp

/** Loading chrome: one gauge-height bar per cell so the skeleton mirrors the three-up layout. */
private val SKELETON_CELL_HEIGHT: Dp = 140.dp
private const val SKELETON_CELL_COUNT: Int = 3

/**
 * Stateful entry point — the faithful 1:1 port of the web `PedalUsage({ vehicleId })`. Records the one-shot
 * `view.opened` diagnostic on first composition (P1/S11), reads the live decimal precision from the data
 * container (web `useUnits` / `getGlobalPrecision`, P1/S8), projects the [dynamics] snapshot onto a
 * [PedalUsageDisplay] via the pure [PedalUsageProjection], and renders.
 *
 * @param dynamics the latest drive-dynamics snapshot the owning Driving Dynamics page decodes from its
 *   `/drive-dynamics/latest` query (web `useDriveDynamicsLatest(vehicleId).data`), or `null` when none is
 *   cached — which, together with an all-null snapshot, selects the empty state.
 * @param loading whether the owning query is still in flight; threads the skeleton branch. Defaults to the
 *   web's no-loading contract.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun PedalUsage(
    dynamics: DriveDynamicsLive?,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { PedalUsageDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val precision = resolveDisplayPrecision(formatter.prefs.precision)
    val display =
        remember(dynamics, loading, precision) {
            PedalUsageProjection.project(dynamics = dynamics, loading = loading, precision = precision)
        }
    PedalUsageContent(display = display, strings = pedalUsageStrings(), modifier = modifier)
}

/**
 * Resolves the surface's localized labels from the generated catalog (P1/S10). Exposed so the stateful entry,
 * the previews, and any host can share one source of strings without re-listing resource ids.
 */
@Composable
fun pedalUsageStrings(): PedalUsageStrings =
    PedalUsageStrings(
        title = stringResource(R.string.translation_dynamics_pedalUsage),
        throttle = stringResource(R.string.translation_dynamics_throttle),
        throttlePosition = stringResource(R.string.translation_dynamics_throttlePosition),
        brake = stringResource(R.string.translation_dynamics_brake),
        brakePedalPosition = stringResource(R.string.translation_dynamics_brakePedalPosition),
        brakeActive = stringResource(R.string.translation_dynamics_brakeActive),
        brakeInactive = stringResource(R.string.translation_dynamics_brakeInactive),
        brakePedal = stringResource(R.string.translation_dynamics_brakePedal),
        noData = stringResource(R.string.translation_dynamics_pedalNoData),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
    )

/**
 * Stateless renderer — the UI-test and preview entry point. Always renders the `GlassPanel` + title; then the
 * skeleton chrome while [PedalUsageDisplay.loading] is true (the page-implied loading), the three-up gauge
 * row when a reading exists (web `hasAny`), or the empty state otherwise. No surface is ever hidden or blank.
 */
@Composable
fun PedalUsageContent(
    display: PedalUsageDisplay,
    strings: PedalUsageStrings,
    modifier: Modifier = Modifier,
) {
    FadeIn(modifier = modifier, delayMs = PEDAL_FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            SectionTitle(strings.title, modifier = Modifier.semantics { heading() })
            Spacer(modifier = Modifier.height(Spacing.lg))
            when {
                display.loading -> LoadingChrome(loadingLabel = strings.loadingLabel)
                display.hasData -> PedalGrid(display = display, strings = strings)
                else -> EmptyState(message = strings.noData)
            }
        }
    }
}

/**
 * The three-up pedal grid — the web `Grid cols={{ default: 1, sm: 3 }}`. Lays the throttle gauge, the brake
 * gauge, and the brake-status cell across a single row at or above the `sm` breakpoint (each cell weighted to
 * a uniform width), else stacks them in one column — the web responsive reflow.
 */
@Composable
private fun PedalGrid(
    display: PedalUsageDisplay,
    strings: PedalUsageStrings,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        if (maxWidth >= GRID_SM_MIN_WIDTH) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xl2),
            ) {
                GaugeCell(display.throttle, strings.throttle, strings.throttlePosition, Modifier.weight(1f))
                GaugeCell(display.brake, strings.brake, strings.brakePedalPosition, Modifier.weight(1f))
                BrakeStatusCell(active = display.brakeActive, strings = strings, modifier = Modifier.weight(1f))
            }
        } else {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(Spacing.xl2),
            ) {
                GaugeCell(display.throttle, strings.throttle, strings.throttlePosition, Modifier.fillMaxWidth())
                GaugeCell(display.brake, strings.brake, strings.brakePedalPosition, Modifier.fillMaxWidth())
                BrakeStatusCell(active = display.brakeActive, strings = strings, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/**
 * One gauge cell — the web `flex flex-col items-center gap-2`: a shared [RadialGauge] (which renders the value
 * and its [gaugeLabel]) above a [caption] describing the reading. The gauge unit is `'%'` or the em-dash and
 * its arc color is the per-gauge accent, both resolved by the projection.
 */
@Composable
private fun GaugeCell(
    gauge: PedalGauge,
    gaugeLabel: String,
    caption: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        RadialGauge(
            value = gauge.value,
            max = gauge.max,
            label = gaugeLabel,
            unit = gauge.unit,
            color = pedalGaugeColor(gauge.accent),
            size = GAUGE_SIZE,
            decimals = gauge.decimals,
        )
        Caption(caption)
    }
}

/**
 * The brake-status cell — the web `flex flex-col items-center justify-center gap-3`: the muted Footprints
 * glyph, a Badge that flips danger ↔ success with the brake state (web `brakeActive ? 'danger' : 'success'`),
 * and a caption. The Badge text carries the localized "Brake Active" / "Brake Inactive" copy, so TalkBack
 * announces the current state.
 */
@Composable
private fun BrakeStatusCell(
    active: Boolean,
    strings: PedalUsageStrings,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Icon(
            imageVector = PedalUsageGlyphs.Footprints,
            contentDescription = null,
            size = IconSize.Xl,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Badge(
            text = if (active) strings.brakeActive else strings.brakeInactive,
            variant = if (active) BadgeVariant.Danger else BadgeVariant.Success,
        )
        Caption(strings.brakePedal)
    }
}

/**
 * The loading branch — a column of gauge-height skeleton bars carrying a single TalkBack "Loading" content
 * description, so the loading state is announced rather than read as a stack of empty boxes.
 */
@Composable
private fun LoadingChrome(
    loadingLabel: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(SKELETON_CELL_COUNT) { Skeleton(height = SKELETON_CELL_HEIGHT, rounded = true) }
    }
}

/** Resolves a [PedalAccent] to its design-token color so no hex literal leaks into the view. */
@Composable
private fun pedalGaugeColor(accent: PedalAccent): Color =
    when (accent) {
        PedalAccent.Cyan -> TeslaTokens.status.info
        PedalAccent.Red -> TeslaTokens.status.danger
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    PedalUsageStrings(
        title = "Pedal Usage",
        throttle = "Throttle",
        throttlePosition = "Throttle Position",
        brake = "Brake",
        brakePedalPosition = "Brake Pedal Position",
        brakeActive = "Brake Active",
        brakeInactive = "Brake Inactive",
        brakePedal = "Brake Pedal Status",
        noData = "No pedal telemetry received yet",
        loadingLabel = "Loading",
    )

@Preview(name = "Data — gauges (narrow)", showBackground = true)
@Composable
private fun PedalUsageDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PedalUsageContent(
            display =
                PedalUsageProjection.project(
                    DriveDynamicsLive(pedalPosition = 42.0, brakePedalPosition = 0.0, brakePedalActive = false),
                    loading = false,
                    precision = DEFAULT_DECIMAL_PRECISION,
                ),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Data — brake active (wide 3-col)", showBackground = true, widthDp = 760)
@Composable
private fun PedalUsageBrakeActiveWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PedalUsageContent(
            display =
                PedalUsageProjection.project(
                    DriveDynamicsLive(pedalPosition = 12.5, brakePedalPosition = 65.0, brakePedalActive = true),
                    loading = false,
                    precision = DEFAULT_DECIMAL_PRECISION,
                ),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading — skeleton", showBackground = true)
@Composable
private fun PedalUsageLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PedalUsageContent(
            display = PedalUsageProjection.project(null, loading = true, precision = DEFAULT_DECIMAL_PRECISION),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty — no telemetry", showBackground = true)
@Composable
private fun PedalUsageEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PedalUsageContent(
            display = PedalUsageProjection.project(null, loading = false, precision = DEFAULT_DECIMAL_PRECISION),
            strings = PREVIEW_STRINGS,
        )
    }
}
