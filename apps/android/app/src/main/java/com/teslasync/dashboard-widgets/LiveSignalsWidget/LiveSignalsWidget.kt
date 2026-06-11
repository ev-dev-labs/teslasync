// The native Jetpack Compose + Material 3 Live Signals dashboard surface — a parity port of
// web/src/features/dashboard/widgets/LiveSignalsWidget.tsx. It mirrors the web `WidgetShell` chrome (a
// title + Wifi icon header with a motor-feed freshness chip and a refresh affordance — the web does NOT
// pass `loading`/`error` to the shell, so there is no full-surface spinner/error screen) wrapping the body
// the web ternary renders: the friendly empty state when no section has data, otherwise the 2×2 grid of
// Motor / Climate / Tires / Security, each showing its rows or a loading skeleton. All data flows through
// the shared [LiveSignalsWidgetViewModel]; SI values are converted to the user's unit at this render
// boundary via the live [io.teslasync.android.data.UnitFormatter]. The view never performs HTTP. Every
// string resolves through the i18n catalog and the refresh control carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/LiveSignalsWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.livesignals

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow

/** Web `h-12` (3rem) per-section loading skeleton height. */
private val SECTION_SKELETON_HEIGHT = 48.dp

/**
 * Stateful entry point. Binds the shared Vehicles feeds via [source] into a [LiveSignalsWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, collects the live [units] formatter, and renders the
 * surface. A dashboard host supplies [source] (an adapter over the shared S7/S8 Vehicles data layer), an
 * optional [vehicleId] (web `WidgetProps.vehicleId`), and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network Vehicles seam (`VehiclesRepository`/`VehiclesStore` adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param units the live SI→display unit formatter; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LiveSignalsWidget(
    source: LiveSignalsSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    instanceKey: String = LiveSignalsRegistration.ID,
) {
    val viewModel: LiveSignalsWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { LiveSignalsWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    LiveSignalsWidgetContent(
        state = state,
        formatter = formatter,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the header
 * (title + Wifi icon + motor-feed freshness + refresh), then the empty state when no section resolved data
 * or the 2×2 grid otherwise. Stale (non-error) data auto-refreshes, mirroring the web 5s freshness cadence.
 * [formatter] supplies the SI→display unit conversion at the render boundary.
 */
@Composable
fun LiveSignalsWidgetContent(
    state: LiveSignalsState,
    formatter: UnitFormatter,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.isStale, state.isFetching, state.isError) {
        if (state.isStale && !state.isFetching && !state.isError) onRefresh()
    }
    val strings = rememberLiveSignalsStrings()
    val display = remember(state, formatter, strings) { LiveSignalsProjection.project(state, formatter, strings) }

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        LiveSignalsHeader(state = state, title = strings.liveSignals, onRefresh = onRefresh)
        if (display.hasData) {
            LiveSignalsGrid(display = display, strings = strings)
        } else {
            EmptyState(
                message = strings.noSignals,
                icon = DataDisplayGlyphs.Wifi,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun LiveSignalsHeader(
    state: LiveSignalsState,
    title: String,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            DataDisplayGlyphs.Wifi,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        MetricLabel(title, modifier = Modifier.weight(1f))
        DataFreshness(
            updatedAtMillis = state.updatedAtMillis?.takeIf { it > 0 },
            isFetching = state.isFetching,
            isStale = state.isStale,
            isError = state.isError,
            compact = false,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.isFetching,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun LiveSignalsGrid(
    display: LiveSignalsDisplay,
    strings: LiveSignalsStrings,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MotorCell(Modifier.weight(1f), display.motor, strings)
            ClimateCell(Modifier.weight(1f), display.climate, strings)
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            TiresCell(Modifier.weight(1f), display.tires, strings)
            SecurityCell(Modifier.weight(1f), display.security, strings)
        }
    }
}

@Composable
private fun MotorCell(
    modifier: Modifier,
    display: MotorDisplay?,
    strings: LiveSignalsStrings,
) {
    SectionScaffold(
        modifier = modifier,
        title = strings.motor,
        icon = LiveSignalsGlyphs.Cog,
        description = display?.contentDescription ?: strings.motor,
    ) {
        if (display != null) {
            SignalRow(strings.torque, display.torque)
            SignalRow(strings.motorTemp, display.temp)
            SignalRow(strings.gear, display.gear)
        } else {
            SectionSkeleton()
        }
    }
}

@Composable
private fun ClimateCell(
    modifier: Modifier,
    display: ClimateDisplay?,
    strings: LiveSignalsStrings,
) {
    SectionScaffold(
        modifier = modifier,
        title = strings.climate,
        icon = LiveSignalsGlyphs.Thermometer,
        description = display?.contentDescription ?: strings.climate,
    ) {
        if (display != null) {
            SignalRow(strings.cabin, display.cabin)
            SignalRow(strings.outside, display.outside)
            SignalRow(strings.hvac, display.hvac)
        } else {
            SectionSkeleton()
        }
    }
}

@Composable
private fun TiresCell(
    modifier: Modifier,
    display: TiresDisplay?,
    strings: LiveSignalsStrings,
) {
    SectionScaffold(
        modifier = modifier,
        title = strings.tires,
        icon = LiveSignalsGlyphs.CircleDot,
        description = display?.contentDescription ?: strings.tires,
    ) {
        if (display != null) {
            SignalRow(TIRE_LABEL_FL, display.frontLeft)
            SignalRow(TIRE_LABEL_FR, display.frontRight)
            SignalRow(TIRE_LABEL_RL, display.rearLeft)
            SignalRow(TIRE_LABEL_RR, display.rearRight)
        } else {
            SectionSkeleton()
        }
    }
}

@Composable
private fun SecurityCell(
    modifier: Modifier,
    display: SecurityDisplay?,
    strings: LiveSignalsStrings,
) {
    SectionScaffold(
        modifier = modifier,
        title = strings.security,
        icon = DataDisplayGlyphs.Shield,
        description = display?.contentDescription ?: strings.security,
    ) {
        if (display != null) {
            BadgeRow(strings.lock, display.lockText, display.lockTone)
            BadgeRow(strings.sentry, display.sentryText, display.sentryTone)
        } else {
            SectionSkeleton()
        }
    }
}

/** A section column: a small icon + uppercase label header over the section [content], folded for TalkBack. */
@Composable
private fun SectionScaffold(
    modifier: Modifier,
    title: String,
    icon: ImageVector,
    description: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier.clearAndSetSemantics { contentDescription = description },
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                icon,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            MetricLabel(title)
        }
        content()
    }
}

/** A single "label … value" line (web `Row`): muted label on the left, bold value on the right. */
@Composable
private fun SignalRow(
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MetricLabel(label, modifier = Modifier.padding(end = Spacing.xs))
        Heading(value, level = HeadingLevel.Sub, maxLines = 1)
    }
}

/** A "label … chip" line for the security section (web `Badge`). */
@Composable
private fun BadgeRow(
    label: String,
    text: String,
    tone: SignalBadge,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MetricLabel(label, modifier = Modifier.padding(end = Spacing.xs))
        Badge(text = text, variant = tone.toBadgeVariant())
    }
}

/** Per-section loading skeleton (web `<Skeleton className="h-12" />`). */
@Composable
private fun SectionSkeleton() {
    Skeleton(height = SECTION_SKELETON_HEIGHT)
}

private fun SignalBadge.toBadgeVariant(): BadgeVariant =
    when (this) {
        SignalBadge.Success -> BadgeVariant.Success
        SignalBadge.Danger -> BadgeVariant.Danger
        SignalBadge.Neutral -> BadgeVariant.Neutral
    }

/**
 * Resolves the localized [LiveSignalsStrings] from the i18n catalog (P1/S10) — the eighteen `widget.*` keys
 * the web component reads via `t('widget.…')`. Remembered against the resolved strings so a locale change
 * re-projects the surface.
 */
@Composable
private fun rememberLiveSignalsStrings(): LiveSignalsStrings {
    val liveSignals = stringResource(R.string.translation_widget_liveSignals)
    val noSignals = stringResource(R.string.translation_widget_noSignals)
    val motor = stringResource(R.string.translation_widget_motor)
    val torque = stringResource(R.string.translation_widget_torque)
    val motorTemp = stringResource(R.string.translation_widget_motorTemp)
    val gear = stringResource(R.string.translation_widget_gear)
    val climate = stringResource(R.string.translation_widget_climate)
    val cabin = stringResource(R.string.translation_widget_cabin)
    val outside = stringResource(R.string.translation_widget_outside)
    val hvac = stringResource(R.string.translation_widget_hvac)
    val tires = stringResource(R.string.translation_widget_tires)
    val security = stringResource(R.string.translation_widget_security)
    val lock = stringResource(R.string.translation_widget_lock)
    val locked = stringResource(R.string.translation_widget_locked)
    val unlocked = stringResource(R.string.translation_widget_unlocked)
    val sentry = stringResource(R.string.translation_widget_sentry)
    val active = stringResource(R.string.translation_widget_active)
    val off = stringResource(R.string.translation_widget_off)
    return remember(
        liveSignals,
        noSignals,
        motor,
        torque,
        motorTemp,
        gear,
        climate,
        cabin,
        outside,
        hvac,
        tires,
        security,
        lock,
        locked,
        unlocked,
        sentry,
        active,
        off,
    ) {
        LiveSignalsStrings(
            liveSignals = liveSignals,
            noSignals = noSignals,
            motor = motor,
            torque = torque,
            motorTemp = motorTemp,
            gear = gear,
            climate = climate,
            cabin = cabin,
            outside = outside,
            hvac = hvac,
            tires = tires,
            security = security,
            lock = lock,
            locked = locked,
            unlocked = unlocked,
            sentry = sentry,
            active = active,
            off = off,
        )
    }
}

/**
 * Line-style section glyphs authored as 24×24 stroked [ImageVector]s, mirroring the approach in
 * `components/datadisplay/DataDisplayGlyphs` (Android has no bundled `lucide-react` equivalent). These are
 * the web icons the LiveSignalsWidget uses that the shared set does not already expose: the drivetrain
 * `Cog`, the climate `Thermometer`, and the tire `CircleDot`. The title `Wifi` and security `Shield` reuse
 * the shared `DataDisplayGlyphs`. Each is monochrome and recolored at render time by `Icon`'s `tint`.
 */
private object LiveSignalsGlyphs {
    val Cog: ImageVector =
        stroked("Cog") {
            circle(12f, 12f, 3f)
            moveTo(12f, 5f)
            lineTo(12f, 8f)
            moveTo(12f, 16f)
            lineTo(12f, 19f)
            moveTo(5f, 12f)
            lineTo(8f, 12f)
            moveTo(16f, 12f)
            lineTo(19f, 12f)
        }

    val Thermometer: ImageVector =
        stroked("Thermometer") {
            moveTo(12f, 4f)
            lineTo(12f, 14f)
            circle(12f, 17f, 2.5f)
        }

    val CircleDot: ImageVector =
        stroked("CircleDot") {
            circle(12f, 12f, 8f)
            dot(12f, 12f)
        }
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

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
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
