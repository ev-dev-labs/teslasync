// Compose render layer for the KioskSettingsModal modal/dialog surface — the native analogue of the JSX the web
// component returns (web/src/features/dashboard/components/KioskSettingsModal.tsx). It is a thin shell over the pure
// [KioskSettingsModalProjection] derivations (KioskSettingsModalModel.kt): a Material 3 [Modal] hosting the three
// FormSection groups the web renders — Dashboard Rotation (interval [Select] + the conditional dashboard checklist),
// Display (cursor / dim / clock toggles + their conditional sub-controls), and Transparency (the two opacity [Slider]s
// + the live preview swatch) — followed by the kiosk hint and the Cancel + Enter actions. The view performs NO HTTP
// and binds no fetch: the web component's only data dependency is `useTranslation`; the edited config is handed back to
// the owner through [onUpdateConfig] and the lifecycle through [onEnterKiosk] / [onClose], exactly as the web props are.
//
// Web parity + native adaptations (each a documented platform mapping, never silent drift):
//   - `open` -> kept as a parameter with an early `if (!open) return`, mirroring the sibling AddAnnotationPopover /
//     Modal surface ports (the Compose idiom for the web `<Modal open>` render gate).
//   - `<Modal size="lg">` -> the atomic `components/ui/Modal`, whose 560 dp ceiling IS the `lg` width
//     (ModalProjection.MAX_WIDTH_LG_DP), so no size knob is needed.
//   - `onUpdateConfig(Partial<KioskConfig>)` -> `onUpdateConfig(KioskConfig)` via immutable [KioskConfig.copy] — the
//     idiomatic Kotlin analogue of the web partial-merge (same observable effect: the owner receives the next config).
//   - the dashboard `<input type="checkbox">` rows -> native [Checkbox] rows (the proper Material control for the web
//     input hack), each labelled with the dashboard name (web `aria-label={d.name}`) + the "Default" chip.
//   - lucide `Maximize2` (Enter action) -> [TeslaGlyphs.Fullscreen]; lucide `Monitor` (hint) -> [TeslaGlyphs.Info],
//     the closest authored glyph for an informational hint (the icon is decorative; the text carries the meaning).
//   - the preview swatch's `backdrop-filter: blur(...)` has no Compose backdrop-blur primitive, so it is omitted; the
//     opacity-driven fill — the swatch's actual purpose — is reproduced faithfully via dynamic [Color] alpha.
//   - the web hint's desktop-only mechanics ("move the mouse", "Press Esc") are adapted to the Android idiom
//     (touch + the Back gesture) in the P1/S10 catalog copy — the platform analogue, not invented behaviour.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/KioskSettingsModal) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting declarations (the
// localized-strings carrier + the tooling-only previews).
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.kiosksettingsmodal

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.forms.FormSection
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Slider
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.roundToInt

/** Test tags for the nodes the UI test selects. */
object KioskSettingsModalTestTags {
    const val ROOT: String = "kiosk-settings-modal"
    const val PREVIEW: String = "kiosk-settings-modal-preview"
}

/**
 * The already-localized dialog microcopy the composable reads from the i18n catalog (P1/S10). Bundled into one carrier
 * so the stateless [KioskSettingsModalContent] takes plain strings and stays trivially previewable + UI-testable. The
 * per-value duration labels (`'10s'` / `'1 min'`) are resolved separately via [durationOptionLabel] because they
 * interpolate the numeric value (`translation_kiosk_seconds` / `translation_kiosk_minutes`).
 */
@Suppress("LongParameterList") // A resolved-strings DTO: one field per web t() call the surface renders.
data class KioskSettingsModalStrings(
    val title: String,
    val closeDialog: String,
    val rotation: String,
    val rotationInterval: String,
    val dashboardsToRotate: String,
    val default: String,
    val display: String,
    val hideCursor: String,
    val cursorTimeout: String,
    val dimAfter: String,
    val brightness: String,
    val showClock: String,
    val clockPosition: String,
    val clockTopLeft: String,
    val clockTopRight: String,
    val clockBottomLeft: String,
    val clockBottomRight: String,
    val transparency: String,
    val transparencyDesc: String,
    val widgetOpacity: String,
    val backgroundOpacity: String,
    val transparent: String,
    val solid: String,
    val preview: String,
    val hint: String,
    val off: String,
    val never: String,
    val cancel: String,
    val enter: String,
)

/** Resolves every [KioskSettingsModalStrings] entry from the generated i18n catalog keys (P1/S10). */
@Composable
fun rememberKioskSettingsModalStrings(): KioskSettingsModalStrings =
    KioskSettingsModalStrings(
        title = stringResource(R.string.translation_kiosk_settings),
        closeDialog = stringResource(R.string.translation_common_close),
        rotation = stringResource(R.string.translation_kiosk_rotation),
        rotationInterval = stringResource(R.string.translation_kiosk_rotationInterval),
        dashboardsToRotate = stringResource(R.string.translation_kiosk_dashboardsToRotate),
        default = stringResource(R.string.translation_kiosk_default),
        display = stringResource(R.string.translation_kiosk_display),
        hideCursor = stringResource(R.string.translation_kiosk_hideCursor),
        cursorTimeout = stringResource(R.string.translation_kiosk_cursorTimeout),
        dimAfter = stringResource(R.string.translation_kiosk_dimAfter),
        brightness = stringResource(R.string.translation_kiosk_brightness),
        showClock = stringResource(R.string.translation_kiosk_showClock),
        clockPosition = stringResource(R.string.translation_kiosk_clockPosition),
        clockTopLeft = stringResource(R.string.translation_kiosk_clockTopLeft),
        clockTopRight = stringResource(R.string.translation_kiosk_clockTopRight),
        clockBottomLeft = stringResource(R.string.translation_kiosk_clockBottomLeft),
        clockBottomRight = stringResource(R.string.translation_kiosk_clockBottomRight),
        transparency = stringResource(R.string.translation_kiosk_transparency),
        transparencyDesc = stringResource(R.string.translation_kiosk_transparencyDesc),
        widgetOpacity = stringResource(R.string.translation_kiosk_widgetOpacity),
        backgroundOpacity = stringResource(R.string.translation_kiosk_bgOpacity),
        transparent = stringResource(R.string.translation_kiosk_transparent),
        solid = stringResource(R.string.translation_kiosk_solid),
        preview = stringResource(R.string.translation_kiosk_preview),
        hint = stringResource(R.string.translation_kiosk_hint),
        off = stringResource(R.string.translation_common_off),
        never = stringResource(R.string.translation_kiosk_never),
        cancel = stringResource(R.string.translation_common_cancel),
        enter = stringResource(R.string.translation_kiosk_enter),
    )

/**
 * Stateful entry point — the faithful port of the web `KioskSettingsModal({ open, onClose, config, onUpdateConfig,
 * onEnterKiosk, dashboards })`. Renders nothing while [open] is false (the Compose idiom for the web `open` prop),
 * records the one-shot PII-safe `view.opened` diagnostic on open (P1/S11), and hosts the configuration form. No HTTP,
 * no store — the owner supplies [config] and receives every edit through [onUpdateConfig].
 *
 * @param open whether the dialog is shown (web `open`).
 * @param onClose dismiss handler invoked by the close button, a backdrop tap, the system Back gesture, and Cancel
 *   (web `onClose`).
 * @param config the kiosk configuration being edited (web `config`).
 * @param onUpdateConfig receives the next [KioskConfig] on every edit (web `onUpdateConfig`).
 * @param onEnterKiosk fired after the selection is committed when the user confirms (web `onEnterKiosk`).
 * @param dashboards the saved dashboards offered in the rotation checklist (web `dashboards`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer` (P1/S11).
 */
@Composable
fun KioskSettingsModal(
    open: Boolean,
    onClose: () -> Unit,
    config: KioskConfig,
    onUpdateConfig: (KioskConfig) -> Unit,
    onEnterKiosk: () -> Unit,
    dashboards: List<SavedDashboard>,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    if (!open) return
    LaunchedEffect(Unit) { KioskSettingsModalDiagnostics.recordViewOpened(logger) }
    val strings = rememberKioskSettingsModalStrings()
    Modal(
        onDismissRequest = onClose,
        modifier = modifier.testTag(KioskSettingsModalTestTags.ROOT),
        title = strings.title,
        accessibleName = strings.title,
        closeLabel = strings.closeDialog,
    ) {
        KioskSettingsModalContent(
            config = config,
            dashboards = dashboards,
            strings = strings,
            onUpdateConfig = onUpdateConfig,
            onEnterKiosk = onEnterKiosk,
            onClose = onClose,
        )
    }
}

/**
 * Stateless renderer + selection-state owner — the unit/UI-test and preview entry point. Owns the ephemeral rotation
 * selection (web `useState`), reproduces the four conditional-render branches the web source defines, and assembles
 * each edit through the pure [KioskSettingsModalProjection]. Every control carries an accessible label.
 */
@Composable
fun KioskSettingsModalContent(
    config: KioskConfig,
    dashboards: List<SavedDashboard>,
    strings: KioskSettingsModalStrings,
    onUpdateConfig: (KioskConfig) -> Unit,
    onEnterKiosk: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var selectedIds by remember {
        mutableStateOf(KioskSettingsModalProjection.initialSelection(config.dashboardIds, dashboards))
    }

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        RotationSection(
            config = config,
            dashboards = dashboards,
            selectedIds = selectedIds,
            strings = strings,
            onUpdateConfig = onUpdateConfig,
            onToggleDashboard = { id ->
                val next = KioskSettingsModalProjection.toggleSelection(selectedIds, id)
                selectedIds = next
                onUpdateConfig(config.copy(dashboardIds = next.toList()))
            },
        )

        DisplaySection(config = config, strings = strings, onUpdateConfig = onUpdateConfig)

        TransparencySection(config = config, strings = strings, onUpdateConfig = onUpdateConfig)

        KioskHint(strings = strings)

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
        ) {
            Button(
                label = strings.cancel,
                onClick = onClose,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
            Button(
                label = strings.enter,
                onClick = {
                    onUpdateConfig(config.copy(dashboardIds = selectedIds.toList()))
                    onClose()
                    onEnterKiosk()
                },
                size = ButtonSize.Sm,
                leadingIcon = TeslaGlyphs.Fullscreen,
            )
        }
    }
}

@Composable
private fun RotationSection(
    config: KioskConfig,
    dashboards: List<SavedDashboard>,
    selectedIds: Set<String>,
    strings: KioskSettingsModalStrings,
    onUpdateConfig: (KioskConfig) -> Unit,
    onToggleDashboard: (String) -> Unit,
) {
    FormSection(title = strings.rotation) {
        Select(
            options = rotationOptions(strings),
            selectedValue = config.rotateInterval.toString(),
            onSelect = { value ->
                onUpdateConfig(config.copy(rotateInterval = value.toIntOrNull() ?: config.rotateInterval))
            },
            label = strings.rotationInterval,
        )
        if (KioskSettingsModalProjection.showDashboardList(config.rotateInterval, dashboards.size)) {
            DashboardChecklist(
                dashboards = dashboards,
                selectedIds = selectedIds,
                strings = strings,
                onToggle = onToggleDashboard,
            )
        }
    }
}

@Composable
private fun DisplaySection(
    config: KioskConfig,
    strings: KioskSettingsModalStrings,
    onUpdateConfig: (KioskConfig) -> Unit,
) {
    FormSection(title = strings.display) {
        Toggle(
            checked = config.hideCursor,
            onCheckedChange = { onUpdateConfig(config.copy(hideCursor = it)) },
            label = strings.hideCursor,
        )
        if (KioskSettingsModalProjection.showCursorTimeout(config.hideCursor)) {
            Select(
                options = cursorOptions(strings),
                selectedValue = config.cursorTimeout.toString(),
                onSelect = { value ->
                    onUpdateConfig(config.copy(cursorTimeout = value.toIntOrNull() ?: config.cursorTimeout))
                },
                label = strings.cursorTimeout,
            )
        }

        Select(
            options = dimOptions(strings),
            selectedValue = config.dimAfter.toString(),
            onSelect = { value ->
                onUpdateConfig(config.copy(dimAfter = value.toIntOrNull() ?: config.dimAfter))
            },
            label = strings.dimAfter,
        )
        if (KioskSettingsModalProjection.showBrightness(config.dimAfter)) {
            val percent = KioskSettingsModalProjection.toPercent(config.dimLevel)
            Slider(
                value =
                    sliderValue(
                        percent,
                        KioskSettingsModalProjection.BRIGHTNESS_MIN_PERCENT,
                        KioskSettingsModalProjection.BRIGHTNESS_MAX_PERCENT,
                    ),
                onValueChange = { onUpdateConfig(config.copy(dimLevel = KioskSettingsModalProjection.toFraction(it.roundToInt()))) },
                label = strings.brightness,
                valueText = percentText(percent),
                valueRange =
                    rangeFloat(
                        KioskSettingsModalProjection.BRIGHTNESS_MIN_PERCENT,
                        KioskSettingsModalProjection.BRIGHTNESS_MAX_PERCENT,
                    ),
            )
        }

        Toggle(
            checked = config.showClock,
            onCheckedChange = { onUpdateConfig(config.copy(showClock = it)) },
            label = strings.showClock,
        )
        if (KioskSettingsModalProjection.showClockPosition(config.showClock)) {
            Select(
                options = clockOptions(strings),
                selectedValue = config.clockPosition.wire,
                onSelect = { onUpdateConfig(config.copy(clockPosition = ClockPosition.fromWire(it))) },
                label = strings.clockPosition,
            )
        }
    }
}

@Composable
private fun TransparencySection(
    config: KioskConfig,
    strings: KioskSettingsModalStrings,
    onUpdateConfig: (KioskConfig) -> Unit,
) {
    FormSection(title = strings.transparency, description = strings.transparencyDesc) {
        OpacitySlider(
            label = strings.widgetOpacity,
            fraction = config.widgetOpacity,
            minPercent = KioskSettingsModalProjection.WIDGET_OPACITY_MIN_PERCENT,
            strings = strings,
            onFraction = { onUpdateConfig(config.copy(widgetOpacity = it)) },
        )
        OpacitySlider(
            label = strings.backgroundOpacity,
            fraction = config.backgroundOpacity,
            minPercent = KioskSettingsModalProjection.BACKGROUND_OPACITY_MIN_PERCENT,
            strings = strings,
            onFraction = { onUpdateConfig(config.copy(backgroundOpacity = it)) },
        )
        PreviewSwatch(config = config, strings = strings)
    }
}

@Composable
private fun OpacitySlider(
    label: String,
    fraction: Double,
    minPercent: Int,
    strings: KioskSettingsModalStrings,
    onFraction: (Double) -> Unit,
) {
    val percent = KioskSettingsModalProjection.toPercent(fraction)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Slider(
            value = sliderValue(percent, minPercent, KioskSettingsModalProjection.OPACITY_MAX_PERCENT),
            onValueChange = { onFraction(KioskSettingsModalProjection.toFraction(it.roundToInt())) },
            label = label,
            valueText = percentText(percent),
            valueRange = rangeFloat(minPercent, KioskSettingsModalProjection.OPACITY_MAX_PERCENT),
            steps =
                KioskSettingsModalProjection.sliderSteps(
                    minPercent,
                    KioskSettingsModalProjection.OPACITY_MAX_PERCENT,
                    KioskSettingsModalProjection.OPACITY_STEP_PERCENT,
                ),
        )
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Caption(strings.transparent)
            Caption(strings.solid)
        }
    }
}

@Composable
private fun DashboardChecklist(
    dashboards: List<SavedDashboard>,
    selectedIds: Set<String>,
    strings: KioskSettingsModalStrings,
    onToggle: (String) -> Unit,
) {
    val rowShape = RoundedCornerShape(Radius.sm)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        FieldLabelText(strings.dashboardsToRotate)
        Column(
            modifier =
                Modifier
                    .heightIn(max = CHECKLIST_MAX_HEIGHT)
                    .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            dashboards.forEach { dashboard ->
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(rowShape)
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .padding(horizontal = Spacing.md, vertical = Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(
                        checked = selectedIds.contains(dashboard.id),
                        onCheckedChange = { onToggle(dashboard.id) },
                        modifier = Modifier.weight(1f),
                        label = dashboard.name,
                    )
                    if (dashboard.isDefault) {
                        Caption(strings.default)
                    }
                }
            }
        }
    }
}

@Composable
private fun PreviewSwatch(
    config: KioskConfig,
    strings: KioskSettingsModalStrings,
) {
    val shape = RoundedCornerShape(Radius.sm)
    Box(
        modifier =
            Modifier
                .testTag(KioskSettingsModalTestTags.PREVIEW)
                .fillMaxWidth()
                .clip(shape)
                .border(BorderStroke(PREVIEW_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant), shape),
    ) {
        Box(
            modifier =
                Modifier
                    .matchParentSize()
                    .background(PREVIEW_BACKDROP_COLOR.copy(alpha = clampAlpha(config.backgroundOpacity))),
        )
        BodyText(
            text = strings.preview,
            modifier =
                Modifier
                    .padding(Spacing.md)
                    .clip(shape)
                    .background(Color.White.copy(alpha = clampAlpha(KioskSettingsModalProjection.previewWidgetAlpha(config.widgetOpacity))))
                    .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            color = PREVIEW_TEXT_COLOR,
        )
    }
}

@Composable
private fun KioskHint(strings: KioskSettingsModalStrings) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.sm))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            imageVector = TeslaGlyphs.Info,
            contentDescription = null,
            size = IconSize.Md,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        HelperText(strings.hint)
    }
}

// ── Option builders + small render helpers ──────────────────────────────────────────────────────────────────────

@Composable
private fun rotationOptions(strings: KioskSettingsModalStrings): List<SelectOption> =
    KioskSettingsModalProjection.ROTATION_SECONDS.map { seconds ->
        SelectOption(
            value = seconds.toString(),
            label = durationOptionLabel(KioskSettingsModalProjection.classifyRotation(seconds), strings),
        )
    }

@Composable
private fun cursorOptions(strings: KioskSettingsModalStrings): List<SelectOption> =
    KioskSettingsModalProjection.CURSOR_SECONDS.map { seconds ->
        SelectOption(
            value = seconds.toString(),
            label = durationOptionLabel(KioskSettingsModalProjection.classifyCursor(seconds), strings),
        )
    }

@Composable
private fun dimOptions(strings: KioskSettingsModalStrings): List<SelectOption> =
    KioskSettingsModalProjection.DIM_MINUTES.map { minutes ->
        SelectOption(
            value = minutes.toString(),
            label = durationOptionLabel(KioskSettingsModalProjection.classifyDim(minutes), strings),
        )
    }

private fun clockOptions(strings: KioskSettingsModalStrings): List<SelectOption> =
    KioskSettingsModalProjection.CLOCK_POSITIONS.map { position ->
        SelectOption(value = position.wire, label = clockPositionLabel(position, strings))
    }

@Composable
private fun durationOptionLabel(
    duration: KioskDuration,
    strings: KioskSettingsModalStrings,
): String =
    when (duration) {
        KioskDuration.Off -> strings.off
        KioskDuration.Never -> strings.never
        is KioskDuration.Seconds -> stringResource(R.string.translation_kiosk_seconds, duration.value)
        is KioskDuration.Minutes -> stringResource(R.string.translation_kiosk_minutes, duration.value)
    }

private fun clockPositionLabel(
    position: ClockPosition,
    strings: KioskSettingsModalStrings,
): String =
    when (position) {
        ClockPosition.TopLeft -> strings.clockTopLeft
        ClockPosition.TopRight -> strings.clockTopRight
        ClockPosition.BottomLeft -> strings.clockBottomLeft
        ClockPosition.BottomRight -> strings.clockBottomRight
    }

/** Renders the slider value as a whole-percent chip (web `${Math.round(n)}%`). */
private fun percentText(percent: Int): String = "$percent%"

/** Clamps a slider value into its track range so an out-of-band stored fraction never throws (Material requires it). */
private fun sliderValue(
    percent: Int,
    minPercent: Int,
    maxPercent: Int,
): Float = percent.toFloat().coerceIn(minPercent.toFloat(), maxPercent.toFloat())

private fun rangeFloat(
    minPercent: Int,
    maxPercent: Int,
): ClosedFloatingPointRange<Float> = minPercent.toFloat()..maxPercent.toFloat()

private fun clampAlpha(value: Double): Float = value.toFloat().coerceIn(0f, 1f)

private val CHECKLIST_MAX_HEIGHT = 160.dp
private val PREVIEW_BORDER_WIDTH = 1.dp

// The preview swatch reproduces the web kiosk look — a fixed dark backdrop (rgba(10,10,20)) behind a translucent white
// widget panel — so its colours are intentionally fixed preview content (the alpha is the dynamic, opacity-driven part),
// not theme chrome.
private val PREVIEW_BACKDROP_COLOR = Color(0xFF0A0A14)
private val PREVIEW_TEXT_COLOR = Color.White.copy(alpha = 0.72f)

// ── Previews (tooling-only; the entry points exercise the render branches the web source defines) ───────────────────

/** A no-op logger so the previews render without an ambient `LocalDataContainer` provider. */
private val PreviewLogger: Logger =
    object : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

private val PreviewDashboards: List<SavedDashboard> =
    listOf(
        SavedDashboard(id = "main", name = "Main", isDefault = true),
        SavedDashboard(id = "energy", name = "Energy"),
        SavedDashboard(id = "trips", name = "Trips"),
    )

@Preview(name = "Kiosk settings — all branches", showBackground = true, widthDp = 420, heightDp = 900)
@Composable
private fun KioskSettingsModalExpandedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        var config by remember { mutableStateOf(KioskConfig(dimAfter = 10)) }
        KioskSettingsModal(
            open = true,
            onClose = {},
            config = config,
            onUpdateConfig = { config = it },
            onEnterKiosk = {},
            dashboards = PreviewDashboards,
            logger = PreviewLogger,
        )
    }
}

@Preview(name = "Kiosk settings — collapsed branches", showBackground = true, widthDp = 420, heightDp = 720)
@Composable
private fun KioskSettingsModalCollapsedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        var config by remember {
            mutableStateOf(
                KioskConfig(rotateInterval = 0, hideCursor = false, dimAfter = 0, showClock = false),
            )
        }
        KioskSettingsModal(
            open = true,
            onClose = {},
            config = config,
            onUpdateConfig = { config = it },
            onEnterKiosk = {},
            dashboards = PreviewDashboards,
            logger = PreviewLogger,
        )
    }
}
