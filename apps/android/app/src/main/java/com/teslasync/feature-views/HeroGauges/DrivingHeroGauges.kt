// The native Jetpack Compose + Material 3 drive-detail HeroGauges feature view — a parity port of
// web/src/features/driving/components/drive-detail/HeroGauges.tsx. The web component renders a GlassPanel
// holding a centered, wrapping row (`flex flex-wrap justify-center gap-6 lg:gap-10`) of four RadialGauges
// (Distance, Max Speed, Duration, Consumption) plus a fifth (Efficiency) only when its
// `stats.efficiencyPctPer100` is non-null. This port keeps that contract exactly: the panel is always rendered,
// the four mandatory gauges always show (formatted zeros for an empty drive, never a blank box), and the fifth
// gauge appears only when the efficiency-percent is present.
//
// Every derivation flows through the pure [DrivingHeroGaugesProjection] (see DrivingHeroGaugesModel.kt); this
// composable is a thin render layer that resolves the i18n labels (P1/S10), resolves the live display
// preferences from the shared S8 settings store (the native binding of the web `useSettings` + `useUnits`
// hooks; metric/2-dp defaults apply until settings load, exactly as the web hooks default), maps the web gauge
// colors onto the design tokens (P1/S9), and hands the projection to the shared RadialGauge component. The
// owning drive-detail page threads the computed `drive` + `stats` in as a [DriveGaugesInput] prop, exactly as
// the web component receives them. The one-shot `view.opened` diagnostic (P1/S11) is emitted on first
// composition.
//
// See DrivingHeroGaugesModel.kt's header for the surface-name collision note (three web `HeroGauges` map to one
// native directory; the shipped analytics A-0058 and charging A-0103 surfaces are left untouched and this
// driving port lives in the `.driving` sub-package). `InvalidPackageDeclaration` is suppressed because the
// mandated surface directory (com/teslasync/feature-views/HeroGauges) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.herogauges.driving

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/** Web RadialGauge `size={110}` — the drive-detail gauges are slightly smaller than the shared default. */
private val GAUGE_SIZE: Dp = 110.dp

/**
 * Stateful entry point — the faithful 1:1 port of the web `HeroGauges({ drive, stats })`. Records the one-shot
 * `view.opened` diagnostic on first composition (P1/S11), resolves the localized labels (P1/S10) and the live
 * display preferences from the shared S8 settings store (the native binding of the web `useSettings` +
 * `useUnits` hooks; metric/2-dp defaults apply until settings load, exactly as the web hooks default), projects
 * the prop onto a [DrivingHeroGaugesDisplay] via the pure [DrivingHeroGaugesProjection], and renders.
 *
 * @param input the owning drive-detail page's computed `drive` + `stats`, threaded in as a [DriveGaugesInput]
 *   (the web `{ drive, stats }` props); `null` is rendered defensively as the all-zero gauges so the surface is
 *   never blank.
 * @param modifier layout modifier applied to the surface's GlassPanel.
 * @param settings the shared live `/settings` feed backing the distance + speed units; defaults to the S8 holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DrivingHeroGauges(
    input: DriveGaugesInput?,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DrivingHeroGaugesDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val prefs = remember(settingsResource.cached) { DrivingHeroGaugesDisplayPrefs.from(settingsResource.cached) }
    val strings = drivingHeroGaugesStrings()
    val display = remember(input, prefs, strings) { DrivingHeroGaugesProjection.project(input, prefs, strings) }
    DrivingHeroGaugesContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit-test and preview entry point. Always renders the GlassPanel holding the
 * centered, wrapping row of gauges (web `flex flex-wrap justify-center`). Every gauge is always present and
 * always carries an accessible label + value (absent figures resolve to clamped zeros), so no surface is ever
 * hidden or blank.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DrivingHeroGaugesContent(
    display: DrivingHeroGaugesDisplay,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.lg, Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            display.gauges.forEach { gauge ->
                RadialGauge(
                    value = gauge.value,
                    max = gauge.max,
                    label = gauge.label,
                    unit = gauge.unit.ifBlank { null },
                    color = driveGaugeColor(gauge.accent),
                    size = GAUGE_SIZE,
                    decimals = gauge.decimals,
                )
            }
        }
    }
}

/** Resolves the five localized gauge labels from the i18n catalog (P1/S10) — no English literal in the view. */
@Composable
private fun drivingHeroGaugesStrings(): DrivingHeroGaugesStrings =
    DrivingHeroGaugesStrings(
        distance = stringResource(R.string.translation_driveDetail_distance),
        maxSpeed = stringResource(R.string.translation_driveDetail_maxSpeed),
        duration = stringResource(R.string.translation_driveDetail_duration),
        consumption = stringResource(R.string.translation_driveDetail_consumption),
        efficiency = stringResource(R.string.translation_driveDetail_efficiency),
    )

/**
 * Maps a [DriveGaugeAccent] to a design-token color (P1/S9). The web RadialGauge hex colors map to the brand
 * palette: cyan `#00F0FF` -> the info token (exact match), purple `#A855F7` -> the chart power hue (exact
 * match), amber `#F59E0B` -> the warning token (exact match), red `#EF4444` -> the danger token, and green
 * `#10B981` -> the success token (exact match) — so no Tailwind class or raw hex survives into the view.
 */
@Composable
private fun driveGaugeColor(accent: DriveGaugeAccent): Color =
    when (accent) {
        DriveGaugeAccent.Distance -> TeslaTokens.status.info
        DriveGaugeAccent.MaxSpeed -> TeslaTokens.chart.power
        DriveGaugeAccent.Duration -> TeslaTokens.status.warning
        DriveGaugeAccent.Consumption -> TeslaTokens.status.danger
        DriveGaugeAccent.Efficiency -> TeslaTokens.status.success
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val previewStrings =
    DrivingHeroGaugesStrings(
        distance = "Distance",
        maxSpeed = "Max Speed",
        duration = "Duration",
        consumption = "Consumption",
        efficiency = "Efficiency",
    )

private val previewInput =
    DriveGaugesInput(
        distanceM = 84_500.0,
        durationS = 4_320.0,
        maxSpeedDisplay = 118.0,
        consumptionWhKm = 168.0,
        efficiencyPctPer100 = 14.3,
    )

private val previewImperialPrefs =
    DrivingHeroGaugesDisplayPrefs(
        distanceUnit = DistanceUnitPref.MI,
        speedUnit = SpeedUnitPref.MPH,
        precision = 2,
    )

@Preview(name = "Resolved — metric (km)", showBackground = true)
@Composable
private fun DrivingHeroGaugesMetricPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingHeroGaugesContent(
            DrivingHeroGaugesProjection.project(previewInput, DrivingHeroGaugesDisplayPrefs.DEFAULT, previewStrings),
        )
    }
}

@Preview(name = "Resolved — imperial (mi)", showBackground = true)
@Composable
private fun DrivingHeroGaugesImperialPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingHeroGaugesContent(
            DrivingHeroGaugesProjection.project(previewInput, previewImperialPrefs, previewStrings),
        )
    }
}

@Preview(name = "Resolved — no efficiency (four gauges)", showBackground = true)
@Composable
private fun DrivingHeroGaugesNoEfficiencyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingHeroGaugesContent(
            DrivingHeroGaugesProjection.project(
                previewInput.copy(efficiencyPctPer100 = null),
                DrivingHeroGaugesDisplayPrefs.DEFAULT,
                previewStrings,
            ),
        )
    }
}

@Preview(name = "Empty — all zeros", showBackground = true)
@Composable
private fun DrivingHeroGaugesEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingHeroGaugesContent(
            DrivingHeroGaugesProjection.project(null, DrivingHeroGaugesDisplayPrefs.DEFAULT, previewStrings),
        )
    }
}
