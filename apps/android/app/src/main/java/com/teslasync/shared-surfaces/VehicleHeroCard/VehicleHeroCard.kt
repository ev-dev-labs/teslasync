// The native Jetpack Compose + Material 3 VehicleHeroCard shared surface — a parity port of
// web/src/components/vehicles/VehicleHeroCard.tsx, together with the shared pieces it composes: the
// `GlassPanel` shell (web `components/ui/GlassPanel`, cyan glow), the four `RadialGauge`s (web
// `components/charts/RadialGauge`), the `StatusBadge` (web `components/data-display/StatusBadge`), the
// eight `StatCard`s (web `components/data-display/StatCard`), the model `Badge` (web
// `components/ui/Badge`), and the quick-action buttons (web `<Link>`s styled as buttons).
//
// [VehicleHeroCard] is the stateful entry: it records the one-shot `view.opened` diagnostic (P1/S11),
// binds the live unit preferences from the shared data layer (web `useUnits` → the S8
// `LocalDataContainer.unitFormatter`), projects its props with the pure [VehicleHeroCardProjection], and
// paints the result through the stateless [VehicleHeroCardContent] (the test / preview entry point). The
// vehicle + its live state + the optional hero photo are caller-supplied props, exactly as the web
// component receives them — the view performs NO HTTP. Every visible string resolves from the shared
// P1/S10 i18n catalog; the gauge/stat numbers are converted SI→display at this render boundary only.
//
// States reproduced from the web source: the optional photo block; the always-present identity row; the
// gauges + stat grid (only when a live state is present, web `{vs && (...)}`); and a friendly "offline"
// empty region in place of the live metrics when no state is available (the car is offline / asleep), so
// a panel never collapses to a blank box. The card never blanks to a hard error and has no fetch-driven
// loading / stale / refresh lifecycle, because — like the web source — it owns no data feed; see the
// model file's header for the full Honesty-Covenant rationale.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VehicleHeroCard) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehicleherocard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.ChipSize
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.datadisplay.StatusBadge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow

/** Gauge diameter — web `RadialGauge size={100}`. */
private val GAUGE_SIZE: Dp = 100.dp

/** Hero photo frame height bounds — web `<img class="max-h-72 ...">` (≈ 288 dp), with a sensible floor. */
private val PHOTO_MIN_HEIGHT: Dp = 132.dp
private val PHOTO_MAX_HEIGHT: Dp = 288.dp

/**
 * Stateful entry point — the faithful port of the web `VehicleHeroCard`. Records the one-shot
 * `view.opened` diagnostic (P1/S11), collects the live unit formatter from the shared data layer (web
 * `useUnits`; the S8 [LocalDataContainer.unitFormatter]), projects the caller's props with the pure
 * [VehicleHeroCardProjection.project], and paints the result. The view performs no work of its own — the
 * [vehicle], its (nullable) [vehicleState], and the optional [photoUrl] are supplied by the host, exactly
 * as the web component receives them.
 *
 * @param vehicle the rendered vehicle (web `vehicle`) — the source of name / model / VIN.
 * @param vehicleState the last-known live state (web `vehicleState`); `null` is the offline card.
 * @param modifier optional layout modifier for the panel.
 * @param photoUrl optional user-uploaded hero photo URL (web `photoUrl`); when present the photo region
 *   renders. Remote decoding is the host's responsibility (no bundled image loader, ADR-002): pass a
 *   decoded [photo] node, else a neutral, accessible frame labeled with the photo's alt text is shown.
 * @param photo optional host-supplied decoded photo node (e.g. a Coil `AsyncImage`).
 * @param onOpenDetails / onOpenCommands / onOpenLiveMap navigation actions (web `<Link to=…>`).
 * @param units the live SI→display unit formatter; defaults to the app's [LocalDataContainer].
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun VehicleHeroCard(
    vehicle: Vehicle,
    vehicleState: VehicleState?,
    modifier: Modifier = Modifier,
    photoUrl: String? = null,
    photo: (@Composable () -> Unit)? = null,
    onOpenDetails: () -> Unit = {},
    onOpenCommands: () -> Unit = {},
    onOpenLiveMap: () -> Unit = {},
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { VehicleHeroCardDiagnostics.recordViewOpened(logger) }
    val formatter by units.collectAsStateWithLifecycle()
    val display =
        remember(vehicle, vehicleState, formatter.prefs) {
            VehicleHeroCardProjection.project(vehicle, vehicleState, formatter.prefs)
        }
    VehicleHeroCardContent(
        display = display,
        modifier = modifier,
        showPhoto = photoUrl != null || photo != null,
        photo = photo,
        onOpenDetails = onOpenDetails,
        onOpenCommands = onOpenCommands,
        onOpenLiveMap = onOpenLiveMap,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the projected card: the optional
 * hero photo, the identity row (name + status + VIN + model), the gauges + stat grid when a live state is
 * present (else the friendly offline empty region), and the quick-action buttons. Every branch renders a
 * non-blank surface so the P3 "every state renders" contract holds.
 */
@Composable
fun VehicleHeroCardContent(
    display: VehicleHeroCardDisplay,
    modifier: Modifier = Modifier,
    showPhoto: Boolean = false,
    photo: (@Composable () -> Unit)? = null,
    onOpenDetails: () -> Unit = {},
    onOpenCommands: () -> Unit = {},
    onOpenLiveMap: () -> Unit = {},
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg, accent = PanelAccent.Info) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            if (showPhoto) {
                VehicleHeroPhoto(
                    alt = stringResource(R.string.translation_vehicleHero_photo_alt, display.name),
                    photo = photo,
                )
            }
            VehicleHeroIdentity(display)
            if (display.hasState) {
                VehicleHeroGauges(display)
                VehicleHeroStatGrid(display)
            } else {
                EmptyState(
                    message = stringResource(R.string.translation_common_offline),
                    icon = VehicleHeroCarGlyph,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            VehicleHeroActions(
                onOpenDetails = onOpenDetails,
                onOpenCommands = onOpenCommands,
                onOpenLiveMap = onOpenLiveMap,
            )
        }
    }
}

/**
 * The optional hero photo (web `photoUrl ? <div class="rounded-xl border ..."><img/></div> : null`).
 * Renders the host-supplied decoded [photo] when given, otherwise a neutral accessible frame carrying the
 * photo's alt text — the dependency-free default (no bundled image loader; ADR-002), mirroring the shared
 * `Avatar` / `Lightbox` image-slot pattern.
 */
@Composable
private fun VehicleHeroPhoto(
    alt: String,
    photo: (@Composable () -> Unit)?,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.lg),
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = PHOTO_MIN_HEIGHT, max = PHOTO_MAX_HEIGHT)
                    .semantics { contentDescription = alt },
            contentAlignment = Alignment.Center,
        ) {
            if (photo != null) {
                photo()
            } else {
                Icon(
                    VehicleHeroCarGlyph,
                    contentDescription = null,
                    size = IconSize.Xl,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * The identity row (web `flex items-start justify-between`): the name + `StatusBadge`, the monospace VIN,
 * and the trailing model `Badge`. The model badge is omitted when no model is known so an empty chip never
 * renders.
 */
@Composable
private fun VehicleHeroIdentity(display: VehicleHeroCardDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Heading(
                    display.name,
                    modifier = Modifier.weight(1f, fill = false),
                    level = HeadingLevel.Section,
                    maxLines = 1,
                )
                StatusBadge(status = display.status, size = ChipSize.Sm)
            }
            CodeText(display.vin)
        }
        if (display.model.isNotBlank()) {
            Badge(text = display.model, variant = BadgeVariant.Neutral)
        }
    }
}

/**
 * The four radial gauges (web `flex flex-wrap justify-center gap-6`): battery, range, inside, and outside.
 * Laid out as a 2×2 grid so all four stay legible on a phone (the web flex-wrap collapses to the same two
 * rows on a narrow viewport). Each gauge's localized label comes from the i18n catalog; its value / max /
 * unit / accent come from the locale-pure projection.
 */
@Composable
private fun VehicleHeroGauges(display: VehicleHeroCardDisplay) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            HeroGauge(display.batteryGauge, stringResource(R.string.translation_vehicleHero_gauge_battery))
            HeroGauge(display.rangeGauge, stringResource(R.string.translation_vehicleHero_gauge_range))
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            HeroGauge(display.insideGauge, stringResource(R.string.translation_vehicleHero_gauge_inside))
            HeroGauge(display.outsideGauge, stringResource(R.string.translation_vehicleHero_gauge_outside))
        }
    }
}

@Composable
private fun HeroGauge(
    gauge: VehicleHeroGauge,
    label: String,
) {
    RadialGauge(
        value = gauge.value,
        max = gauge.max,
        label = label,
        unit = gauge.unit,
        color = heroAccentColor(gauge.accent),
        size = GAUGE_SIZE,
    )
}

/**
 * The eight-cell stat grid (web `<Grid cols={{ default: 2, md: 4 }}>`), laid out two-per-row (the web
 * `default` breakpoint, the phone footprint): inside / outside temperature, odometer, range, lock status,
 * sentry, firmware, and drivetrain power. The lock / sentry values resolve to localized text here; the
 * numeric stat strings come pre-formatted from the projection.
 */
@Composable
private fun VehicleHeroStatGrid(display: VehicleHeroCardDisplay) {
    val statusValue =
        if (display.isLocked) {
            stringResource(R.string.translation_vehicleHero_locked)
        } else {
            stringResource(R.string.translation_vehicleHero_unlocked)
        }
    val sentryValue =
        if (display.sentryOn) {
            stringResource(R.string.translation_common_on)
        } else {
            stringResource(R.string.translation_common_off)
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        StatRow(
            left = { StatCell(R.string.translation_vehicleHero_stat_insideTemp, display.insideTempText, display.temperatureUnit) },
            right = { StatCell(R.string.translation_vehicleHero_stat_outsideTemp, display.outsideTempText, display.temperatureUnit) },
        )
        StatRow(
            left = { StatCell(R.string.translation_vehicleHero_stat_odometer, display.odometerText, display.distanceUnit) },
            right = { StatCell(R.string.translation_vehicleHero_stat_range, display.rangeText, display.distanceUnit) },
        )
        StatRow(
            left = { StatCell(R.string.translation_vehicleHero_stat_status, statusValue, null) },
            right = { StatCell(R.string.translation_vehicleHero_stat_sentry, sentryValue, null) },
        )
        StatRow(
            left = { StatCell(R.string.translation_vehicleHero_stat_firmware, display.firmware, null) },
            right = { StatCell(R.string.translation_vehicleHero_stat_power, display.powerText, VEHICLE_HERO_KW) },
        )
    }
}

@Composable
private fun StatRow(
    left: @Composable () -> Unit,
    right: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Box(modifier = Modifier.weight(1f)) { left() }
        Box(modifier = Modifier.weight(1f)) { right() }
    }
}

@Composable
private fun StatCell(
    labelRes: Int,
    value: String,
    unit: String?,
) {
    StatCard(
        label = stringResource(labelRes),
        value = value,
        modifier = Modifier.fillMaxWidth(),
        unit = unit,
    )
}

/**
 * The navigation actions (web `flex items-center gap-3 pt-2 border-t`): Details (primary), Commands, and
 * Live Map (secondary). Each button carries its localized label as its accessible name; the host wires
 * the supplied callbacks to navigation.
 */
@Composable
private fun VehicleHeroActions(
    onOpenDetails: () -> Unit,
    onOpenCommands: () -> Unit,
    onOpenLiveMap: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        HorizontalDivider()
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Button(
                label = stringResource(R.string.translation_vehicleHero_action_details),
                onClick = onOpenDetails,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
            )
            Button(
                label = stringResource(R.string.translation_vehicleHero_action_commands),
                onClick = onOpenCommands,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
            )
            Button(
                label = stringResource(R.string.translation_vehicleHero_action_liveMap),
                onClick = onOpenLiveMap,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
            )
        }
    }
}

/**
 * Resolves a gauge [accent] (web hard-coded hex) to a theme token — never a raw hex, so every theme stays
 * correct. Cyan / red / green / amber map onto the semantic status palette (the web neon hues); purple
 * maps onto the chart power series, the closest brand hue to the web `#a78bfa`.
 */
@Composable
@ReadOnlyComposable
private fun heroAccentColor(accent: VehicleHeroAccent): Color =
    when (accent) {
        VehicleHeroAccent.Cyan -> TeslaTokens.status.info
        VehicleHeroAccent.Red -> TeslaTokens.status.danger
        VehicleHeroAccent.Green -> TeslaTokens.status.success
        VehicleHeroAccent.Amber -> TeslaTokens.status.warning
        VehicleHeroAccent.Purple -> TeslaTokens.chart.power
    }

// ── Locally-authored glyph ───────────────────────────────────────────────────────────────────────────
// The web photo block falls back to no art; the native dependency-free photo frame needs a neutral mark.
// Android has no bundled vehicle glyph without the frozen material-icons-extended artifact, so — exactly
// as `components/datadisplay/DataDisplayGlyphs` and the sibling VehicleHeroCardWidget do — this car
// silhouette is authored here as a 24×24 stroked vector, recolored at render time by `Icon`'s `tint`. It
// is decorative (contentDescription = null); the photo region's TalkBack phrase is the alt text.

private const val GLYPH_DIMENSION: Float = 24f
private const val GLYPH_STROKE_WIDTH: Float = 2f

private val VehicleHeroCarGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "VehicleHeroCar",
            defaultWidth = GLYPH_DIMENSION.dp,
            defaultHeight = GLYPH_DIMENSION.dp,
            viewportWidth = GLYPH_DIMENSION,
            viewportHeight = GLYPH_DIMENSION,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = carPath(),
            )
        }.build()

private fun carPath(): PathBuilder.() -> Unit =
    {
        moveTo(4f, 13f)
        lineTo(6.5f, 8f)
        lineTo(15f, 8f)
        lineTo(18.5f, 12f)
        moveTo(3f, 13f)
        lineTo(21f, 13f)
        lineTo(21f, 16f)
        lineTo(3f, 16f)
        close()
        moveTo(7.5f, 16f)
        lineTo(7.6f, 16f)
        moveTo(16.5f, 16f)
        lineTo(16.6f, 16f)
    }

// ── Previews (tooling-only; sample values are never shipped UI) ───────────────────────────────────────

@Preview(name = "VehicleHeroCard — live state", showBackground = true)
@Composable
private fun VehicleHeroCardLivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleHeroCardContent(display = sampleDisplay(hasState = true), showPhoto = true)
    }
}

@Preview(name = "VehicleHeroCard — offline (no live state)", showBackground = true)
@Composable
private fun VehicleHeroCardOfflinePreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        VehicleHeroCardContent(display = sampleDisplay(hasState = false))
    }
}

private fun sampleDisplay(hasState: Boolean): VehicleHeroCardDisplay =
    VehicleHeroCardDisplay(
        name = "Model 3",
        vin = "5YJ3E1EA7KF000000",
        model = "Model 3",
        status = if (hasState) "driving" else VEHICLE_HERO_OFFLINE,
        hasState = hasState,
        batteryGauge = VehicleHeroGauge(73.0, VEHICLE_HERO_BATTERY_MAX, VEHICLE_HERO_PERCENT, VehicleHeroAccent.Cyan),
        rangeGauge = VehicleHeroGauge(402.0, VEHICLE_HERO_RANGE_MAX_KM, "km", VehicleHeroAccent.Green),
        insideGauge = VehicleHeroGauge(21.0, VEHICLE_HERO_TEMP_MAX_C, "\u00B0C", VehicleHeroAccent.Amber),
        outsideGauge = VehicleHeroGauge(9.0, VEHICLE_HERO_TEMP_MAX_C, "\u00B0C", VehicleHeroAccent.Purple),
        distanceUnit = "km",
        temperatureUnit = "\u00B0C",
        insideTempText = if (hasState) "21" else VEHICLE_HERO_EM_DASH,
        outsideTempText = if (hasState) "9" else VEHICLE_HERO_EM_DASH,
        odometerText = if (hasState) "12,345" else VEHICLE_HERO_EM_DASH,
        rangeText = if (hasState) "402" else VEHICLE_HERO_EM_DASH,
        isLocked = true,
        sentryOn = false,
        firmware = if (hasState) "2025.1.0" else VEHICLE_HERO_EM_DASH,
        powerText = if (hasState) "0.00" else VEHICLE_HERO_EM_DASH,
    )
