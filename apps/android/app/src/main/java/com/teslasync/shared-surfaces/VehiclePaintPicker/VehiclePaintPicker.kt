// The native Jetpack Compose + Material 3 VehiclePaintPicker shared surface — a parity port of
// web/src/components/vehicles/VehiclePaintPicker.tsx. The web component is a small swatch row that overrides
// the Digital-Twin paint colour for one vehicle: a `radiogroup` (`aria-label` paint.pickerLabel) holding a
// `paint.label` caption, the five fixed Tesla paint swatches (each a `role="radio"` button whose `aria-checked`
// reflects the active paint, whose `aria-label` is the localized paint name, and whose `title` gains a
// `· paint.detected` suffix on the auto-detected swatch and shows a check mark while selected), a live
// (`aria-live="polite"`) label echoing the active paint name, and — only while an override is in effect — a
// `paint.reset` text button that reverts to the auto-detected colour.
//
// This native surface keeps that contract end to end using platform-idiomatic primitives: a
// `selectableGroup()` row of circular `Role.RadioButton` swatches (each with a ≥48 dp touch target, a
// theme-aware selection ring, a contrast-correct check mark and a long-press Tooltip mirroring the web
// `title`), the shared `Caption` / `BodyText` typography, and the shared `Button` (Ghost) for reset. All
// data flows through [VehiclePaintPickerViewModel] (P1/S8); the view performs NO HTTP and owns no business
// logic. Every string resolves through the i18n facade (P1/S10) via `stringResource`; the active-paint label
// is a `LiveRegionMode.Polite` region; and a one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on
// first composition.
//
// The web source has no loading / error / stale / offline lifecycle (its override is read synchronously from
// device-local storage over a fixed five-paint palette), so — like the accepted VisuallyHidden port — those
// network states are intentionally not modelled; the surface's real states (auto-detected vs overridden, and
// each swatch's selected / inferred flags) all render with no hidden region. See VehiclePaintPickerModel.kt.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VehiclePaintPicker) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehiclepaintpicker

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag on the surface root so on-device UI tests can locate the rendered picker in any state. */
const val VEHICLE_PAINT_PICKER_TEST_TAG: String = "vehicle-paint-picker"

/** Test tag on the reset affordance — present only while an override is in effect. */
const val VEHICLE_PAINT_PICKER_RESET_TEST_TAG: String = "vehicle-paint-picker-reset"

/** Builds a per-swatch test tag (`vehicle-paint-swatch-{wireId}`) so a UI test can target each swatch. */
fun vehiclePaintSwatchTestTag(id: PaintPaletteId): String = "vehicle-paint-swatch-${id.wireId}"

/** The web `h-7 w-7` swatch dot (28 px). The interactive target around it is grown to ≥48 dp for touch a11y. */
private val SWATCH_DOT_SIZE = 28.dp

/** Selection-ring width on the active swatch (web `border-2`). */
private val SWATCH_RING_WIDTH = 2.dp

/** Resting border width on an unselected swatch (web `border-2` strong border). */
private val SWATCH_BORDER_WIDTH = 1.dp

/** Luminance threshold above which a swatch is "light" and needs a dark check mark for contrast. */
private const val LIGHT_SWATCH_LUMINANCE = 0.6

/**
 * The localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests / previews pass a deterministic instance), keeping the render branches locale-stable. Every string
 * resolves through the P1/S10 catalog.
 *
 * @property pickerLabel the radiogroup accessible label (web `t('paint.pickerLabel', 'Vehicle paint color')`).
 * @property label the leading caption (web `t('paint.label', 'Paint')`).
 * @property detected the auto-detected suffix (web `t('paint.detected', 'Auto-detected')`).
 * @property reset the reset affordance label (web `t('paint.reset', 'Reset to auto-detected')`).
 * @property paintNames each paint id's localized name (web `t(p.labelKey, p.defaultLabel)`).
 */
data class VehiclePaintPickerStrings(
    val pickerLabel: String,
    val label: String,
    val detected: String,
    val reset: String,
    val paintNames: Map<PaintPaletteId, String>,
)

/**
 * Stateful entry point — the parity port of the web `<VehiclePaintPicker />`. Binds the per-vehicle paint
 * override seam via [source] into a [VehiclePaintPickerViewModel] keyed by [vehicleId], records the one-shot
 * `view.opened` diagnostic (P1/S11) on first composition, collects the projected state, and renders the
 * picker.
 *
 * [source] defaults to the shared P1/S8 process store (so the picker is a true drop-in like the web
 * component); a host or test may inject a different seam. [logger] defaults to the process logger.
 *
 * @param vehicleId the vehicle whose paint override this picker edits; `<= 0` disables persistence.
 * @param exteriorColor the Tesla `exterior_color` code used to compute the auto-detected paint.
 */
@Composable
fun VehiclePaintPicker(
    vehicleId: Long,
    modifier: Modifier = Modifier,
    exteriorColor: String? = null,
    source: VehiclePaintSource = ProcessVehiclePaintSource,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: VehiclePaintPickerViewModel =
        viewModel(
            key = "${VehiclePaintPickerRegistration.ID}:$vehicleId",
            factory = VehiclePaintPickerViewModel.factory(source, vehicleId, exteriorColor, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    VehiclePaintPickerContent(
        state = state,
        strings = rememberVehiclePaintPickerStrings(),
        modifier = modifier,
        onSelect = viewModel::setPaint,
        onReset = viewModel::reset,
    )
}

/**
 * Stateless renderer for every surface state — the UI-test and preview entry point. Draws the radiogroup
 * caption + swatch row, the live active-paint label, and (only when [VehiclePaintPickerData.isOverridden]) the
 * reset affordance. The whole cluster wraps (web `flex flex-wrap`) so it never clips on a narrow screen.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun VehiclePaintPickerContent(
    state: VehiclePaintPickerData,
    strings: VehiclePaintPickerStrings,
    modifier: Modifier = Modifier,
    onSelect: (PaintPaletteId) -> Unit = {},
    onReset: () -> Unit = {},
) {
    FlowRow(
        modifier = modifier.fillMaxWidth().testTag(VEHICLE_PAINT_PICKER_TEST_TAG),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(strings.label, modifier = Modifier.align(Alignment.CenterVertically))
        PaintSwatchRow(
            swatches = state.swatches,
            strings = strings,
            modifier = Modifier.align(Alignment.CenterVertically),
            onSelect = onSelect,
        )
        BodyText(
            text = strings.paintNames[state.activeId] ?: state.activeDefaultLabel,
            modifier =
                Modifier
                    .align(Alignment.CenterVertically)
                    .semantics { liveRegion = LiveRegionMode.Polite },
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (state.isOverridden) {
            Button(
                label = strings.reset,
                onClick = onReset,
                modifier =
                    Modifier
                        .align(Alignment.CenterVertically)
                        .testTag(VEHICLE_PAINT_PICKER_RESET_TEST_TAG),
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/**
 * The radiogroup itself — a `selectableGroup()` row carrying the group accessible name (web radiogroup
 * `aria-label`) and the five swatches. Kept a non-merging parent so each swatch stays an individually
 * focusable `Role.RadioButton` for TalkBack / D-pad traversal.
 */
@Composable
private fun PaintSwatchRow(
    swatches: List<PaintSwatch>,
    strings: VehiclePaintPickerStrings,
    modifier: Modifier = Modifier,
    onSelect: (PaintPaletteId) -> Unit,
) {
    Row(
        modifier =
            modifier
                .selectableGroup()
                .semantics { contentDescription = strings.pickerLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        swatches.forEach { swatch ->
            PaintSwatchButton(
                swatch = swatch,
                label = strings.paintNames[swatch.id] ?: swatch.defaultLabel,
                detectedWord = strings.detected,
                onSelect = onSelect,
            )
        }
    }
}

/**
 * One paint swatch — a circular [Role.RadioButton] target (≥48 dp for touch a11y) wrapping the visible dot.
 * Selected swatches gain a primary selection ring and a contrast-correct check mark (web `border-white` +
 * the inline check `<svg>`); every swatch carries its localized name as its accessible description and a
 * long-press Tooltip (web `title`), with the auto-detected swatch appending `· {detected}` in both.
 */
@Composable
private fun PaintSwatchButton(
    swatch: PaintSwatch,
    label: String,
    detectedWord: String,
    onSelect: (PaintPaletteId) -> Unit,
) {
    val accessibilityLabel = paintSwatchAccessibilityLabel(label, swatch.inferred, detectedWord)
    Tooltip(text = accessibilityLabel) {
        Box(
            modifier =
                Modifier
                    .testTag(vehiclePaintSwatchTestTag(swatch.id))
                    .minimumInteractiveComponentSize()
                    .selectable(selected = swatch.selected, role = Role.RadioButton, onClick = { onSelect(swatch.id) })
                    .semantics { contentDescription = accessibilityLabel },
            contentAlignment = Alignment.Center,
        ) {
            PaintDot(swatch = swatch)
        }
    }
}

/** The visible swatch dot — the paint colour, the selection ring (selected) or resting border, and the check. */
@Composable
private fun PaintDot(swatch: PaintSwatch) {
    val ringColor = if (swatch.selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
    val ringWidth = if (swatch.selected) SWATCH_RING_WIDTH else SWATCH_BORDER_WIDTH
    Box(
        modifier =
            Modifier
                .size(SWATCH_DOT_SIZE)
                .background(Color(swatch.swatchArgb), CircleShape)
                .border(ringWidth, ringColor, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (swatch.selected) {
            Icon(
                imageVector = TeslaGlyphs.Check,
                contentDescription = null,
                size = IconSize.Sm,
                tint = checkTintFor(swatch.swatchArgb),
            )
        }
    }
}

/** Builds the localized labels from the P1/S10 catalog; tests / previews pass a deterministic instance. */
@Composable
private fun rememberVehiclePaintPickerStrings(): VehiclePaintPickerStrings =
    VehiclePaintPickerStrings(
        pickerLabel = stringResource(R.string.translation_paint_pickerLabel),
        label = stringResource(R.string.translation_paint_label),
        detected = stringResource(R.string.translation_paint_detected),
        reset = stringResource(R.string.translation_paint_reset),
        paintNames =
            mapOf(
                PaintPaletteId.PearlWhite to stringResource(R.string.translation_paint_pearlWhite),
                PaintPaletteId.MidnightSilver to stringResource(R.string.translation_paint_midnightSilver),
                PaintPaletteId.DeepBlue to stringResource(R.string.translation_paint_deepBlue),
                PaintPaletteId.SolidBlack to stringResource(R.string.translation_paint_solidBlack),
                PaintPaletteId.RedMulticoat to stringResource(R.string.translation_paint_redMulticoat),
            ),
    )

/**
 * The check-mark tint for a swatch of colour [argb]: a dark mark on a light paint (e.g. Pearl White) and a
 * white mark on a dark paint, so the selection check stays legible on every swatch (better contrast than the
 * web's single white-with-shadow check). Pure perceived-luminance, kept off the Compose `Color.luminance`
 * API so the threshold is explicit.
 */
private fun checkTintFor(argb: Long): Color {
    val r = ((argb shr 16) and 0xFF).toInt()
    val g = ((argb shr 8) and 0xFF).toInt()
    val b = (argb and 0xFF).toInt()
    val luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    return if (luminance > LIGHT_SWATCH_LUMINANCE) Color(0xFF0F172A) else Color.White
}

// ── Previews (tooling-only; sample strings are never shipped UI) ──────────────────────────────────────

/** Deterministic strings for previews / tests, built from the English defaults (no resource lookup). */
private fun previewStrings(): VehiclePaintPickerStrings =
    VehiclePaintPickerStrings(
        pickerLabel = VehiclePaintPickerDefaults.PICKER_LABEL,
        label = VehiclePaintPickerDefaults.LABEL,
        detected = VehiclePaintPickerDefaults.DETECTED,
        reset = VehiclePaintPickerDefaults.RESET,
        paintNames = PAINT_PALETTE_LIST.associate { it.id to it.defaultLabel },
    )

@Preview(name = "Auto-detected (no override)", showBackground = true)
@Composable
private fun VehiclePaintPickerAutoDetectedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePaintPickerContent(
            state = projectVehiclePaintPicker(overrideId = null, exteriorColor = "MidnightSilverMetallic"),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Overridden (reset shown)", showBackground = true)
@Composable
private fun VehiclePaintPickerOverriddenPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehiclePaintPickerContent(
            state = projectVehiclePaintPicker(overrideId = PaintPaletteId.RedMulticoat, exteriorColor = "PearlWhite"),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "Overridden (dark)", showBackground = true)
@Composable
private fun VehiclePaintPickerDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        VehiclePaintPickerContent(
            state = projectVehiclePaintPicker(overrideId = PaintPaletteId.DeepBlue, exteriorColor = "SolidBlack"),
            strings = previewStrings(),
        )
    }
}
