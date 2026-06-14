// The native Jetpack Compose + Material 3 Checkbox shared surface — a parity port of
// web/src/components/ui/Checkbox.tsx. The web surface is an accessible checkbox primitive: a visually-hidden
// native `<input type="checkbox">` carries the keyboard / screen-reader / form semantics, layered with a styled
// indicator that shows a Check when checked, a Minus when indeterminate (the "mixed" state a "select all"
// header uses), or an empty box otherwise. It scales with a `size` prop (sm / md / lg), takes an optional
// `label` to its right, dims when `disabled`, and reports the toggled boolean through `onChange`.
//
// This native surface keeps that contract end to end. It reproduces every branch the web source draws — the
// empty / checked / mixed box (selected by the pure [indicatorFor] in CheckboxModel.kt), the three sizes, the
// optional label, the disabled dim, the read-only display path (a null change handler, as the sibling
// TreeSelect leaf rows use), and the React uncontrolled `defaultChecked` path (see [UncontrolledCheckbox]).
// The accessible idiom is the platform-native one shared with the component-library Checkbox atom: the whole
// row is one `Role.Checkbox` target via `triStateToggleable`, so the framework announces checked / unchecked /
// mixed — already localized — without any hand-rolled string, and the label (or a caller-supplied
// `contentDescription`, the web spread `aria-label`) names it. The box is composed from Compose primitives over
// the generated design tokens (P1/S9): the accent border/fill maps the web cyan onto `colorScheme.primary` so
// the tint stays correct across light / dark / high-contrast, and the Check / Minus glyphs come from the shared
// component-library [TeslaGlyphs] + [Icon] (the native analogue of the web lucide icons, ADR-002).
//
// It performs NO HTTP and binds NO data state holder (the web component fetches nothing; it has no hook at all).
// See CheckboxModel.kt for the honesty rationale and why the generic loading/empty/stale/offline states do not
// apply to a presentational control. A one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first
// composition, carrying only the surface slug — never the checked value or the label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Checkbox) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.checkbox

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.triStateToggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the checkbox row — used by the instrumented per-state + a11y UI tests. */
const val CHECKBOX_TEST_TAG: String = "checkbox"

// Box corner — the web `rounded` (≈4px); a hair softer for the larger native touch target.
private val INDICATOR_CORNER: Dp = 5.dp

// Box outline width (web `border`, 1px → crisp 1.5 dp on hi-dpi).
private val BORDER_WIDTH: Dp = 1.5.dp

// Accent fill behind the glyph (web `bg-cyan-500/20`) over the active box.
private const val ACTIVE_FILL_ALPHA: Float = 0.20f

// Faint neutral fill of the empty box (web `bg-white/[0.04]`), theme-aware via onSurface.
private const val INACTIVE_FILL_ALPHA: Float = 0.04f

// Whole-control dim when disabled (web `peer-disabled:opacity-50` / label `opacity-60`).
private const val DISABLED_ALPHA: Float = 0.5f

/**
 * Controlled checkbox — the faithful port of the web `Checkbox`. Renders the [checked] / [indeterminate] box at
 * the chosen [size] with an optional [label] to its right, reports the toggled boolean through
 * [onCheckedChange], and records the one-shot `view.opened` diagnostic on first composition. A null
 * [onCheckedChange] renders a read-only/displayed checkbox (web `onChange` absent), as the sibling TreeSelect
 * leaf rows use when their parent row owns the toggle.
 *
 * @param checked the controlled checked value (web `checked`).
 * @param onCheckedChange reports the new boolean when toggled (web `onChange`); null renders read-only.
 * @param label optional inline label to the right of the box (web `label`).
 * @param indeterminate the mixed state a "select all" header uses (web `indeterminate`); shows a Minus.
 * @param size visual size of the box (web `size`, default md).
 * @param enabled whether the control is interactive (web `disabled` inverted).
 * @param contentDescription accessible name when there is no visible [label] (web spread `aria-label`).
 * @param logger the sanctioned redacting logger; defaults to the app's data container logger.
 */
@Composable
fun Checkbox(
    checked: Boolean,
    onCheckedChange: ((Boolean) -> Unit)?,
    modifier: Modifier = Modifier,
    label: String? = null,
    indeterminate: Boolean = false,
    size: CheckboxSize = CheckboxSize.Md,
    enabled: Boolean = true,
    contentDescription: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { CheckboxDiagnostics.recordViewOpened(logger) }
    CheckboxField(
        checked = checked,
        onCheckedChange = onCheckedChange,
        modifier = modifier,
        label = label,
        indeterminate = indeterminate,
        size = size,
        enabled = enabled,
        contentDescription = contentDescription,
    )
}

/**
 * Uncontrolled checkbox — the native mirror of the React `defaultChecked` input (a checkbox with no `checked`
 * prop). It remembers its own checked state across recomposition + configuration change, toggles on tap, and
 * still forwards the new value to an optional [onCheckedChange] so a parent can observe it. Records the same
 * one-shot `view.opened` diagnostic via the controlled [Checkbox] it delegates to.
 *
 * @param defaultChecked the initial checked value (web `defaultChecked`).
 */
@Composable
fun UncontrolledCheckbox(
    modifier: Modifier = Modifier,
    label: String? = null,
    defaultChecked: Boolean = false,
    indeterminate: Boolean = false,
    size: CheckboxSize = CheckboxSize.Md,
    enabled: Boolean = true,
    contentDescription: String? = null,
    onCheckedChange: ((Boolean) -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    var checkedState by rememberSaveable { mutableStateOf(defaultChecked) }
    Checkbox(
        checked = checkedState,
        onCheckedChange = { next ->
            checkedState = next
            onCheckedChange?.invoke(next)
        },
        modifier = modifier,
        label = label,
        indeterminate = indeterminate,
        size = size,
        enabled = enabled,
        contentDescription = contentDescription,
        logger = logger,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point (no diagnostics, no data container). Lays out the
 * indicator box and the optional [label] as one `Role.Checkbox` target: when [onCheckedChange] is non-null the
 * whole row is `triStateToggleable` (≥48 dp touch target, framework-localized checked/unchecked/mixed
 * announcement, clicking reports the toggled boolean); when null the row is a read-only display whose name
 * comes from the [label] or the [contentDescription]. Dims to [DISABLED_ALPHA] when not [enabled].
 */
@Composable
fun CheckboxField(
    checked: Boolean,
    modifier: Modifier = Modifier,
    onCheckedChange: ((Boolean) -> Unit)? = null,
    label: String? = null,
    indeterminate: Boolean = false,
    size: CheckboxSize = CheckboxSize.Md,
    enabled: Boolean = true,
    contentDescription: String? = null,
) {
    val indicator = indicatorFor(checked = checked, indeterminate = indeterminate)
    val toggleState = indicator.toToggleableState()

    val interactionModifier =
        onCheckedChange?.let { change ->
            Modifier
                .minimumInteractiveComponentSize()
                .triStateToggleable(
                    state = toggleState,
                    enabled = enabled,
                    role = Role.Checkbox,
                    onClick = { change(!checked) },
                )
        } ?: Modifier

    val description = contentDescription
    val nameModifier =
        if (label == null && description != null) {
            Modifier.semantics { this.contentDescription = description }
        } else {
            Modifier
        }

    Row(
        modifier =
            modifier
                .then(interactionModifier)
                .then(nameModifier)
                .alpha(if (enabled) 1f else DISABLED_ALPHA)
                .testTag(CHECKBOX_TEST_TAG),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        CheckboxIndicatorBox(indicator = indicator, size = size)
        if (label != null) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

/**
 * The token-driven indicator box — the native mirror of the web styled `<span>` indicator. An [isActive] box
 * (checked or mixed) wears the accent border + translucent accent fill and shows its glyph; the empty box stays
 * neutral. The Check / Minus glyph and the accent tint come from the shared component library + the generated
 * `colorScheme.primary` (the web cyan), so the box is correct in every theme.
 */
@Composable
private fun CheckboxIndicatorBox(
    indicator: CheckboxIndicator,
    size: CheckboxSize,
    modifier: Modifier = Modifier,
) {
    val colors = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(INDICATOR_CORNER)
    val active = indicator.isActive
    val borderColor = if (active) colors.primary else colors.outline
    val fillColor =
        if (active) {
            colors.primary.copy(alpha = ACTIVE_FILL_ALPHA)
        } else {
            colors.onSurface.copy(alpha = INACTIVE_FILL_ALPHA)
        }
    val glyph =
        when (indicator) {
            CheckboxIndicator.Checked -> TeslaGlyphs.Check
            CheckboxIndicator.Mixed -> TeslaGlyphs.Minus
            CheckboxIndicator.Empty -> null
        }

    Box(
        modifier =
            modifier
                .size(size.boxSize())
                .clip(shape)
                .background(fillColor)
                .border(BORDER_WIDTH, borderColor, shape),
        contentAlignment = Alignment.Center,
    ) {
        if (glyph != null) {
            Icon(
                imageVector = glyph,
                contentDescription = null,
                size = size.glyphSize(),
                tint = colors.primary,
            )
        }
    }
}

// ── Pure size + state lookups (kept private to the render layer; their three-way logic is covered by the
// CheckboxModel unit test via indicatorFor, and on-device by the UI test's ToggleableState assertions). ──────

/** The dp footprint of the box per [CheckboxSize] (web sm 14 / md 16 / lg 20, scaled for the native target). */
private fun CheckboxSize.boxSize(): Dp =
    when (this) {
        CheckboxSize.Sm -> 18.dp
        CheckboxSize.Md -> 20.dp
        CheckboxSize.Lg -> 24.dp
    }

/** The glyph size per [CheckboxSize] (web sm 10 / md 12 / lg 14), mapped to the shared [IconSize] scale. */
private fun CheckboxSize.glyphSize(): IconSize =
    when (this) {
        CheckboxSize.Sm -> IconSize.Xs
        CheckboxSize.Md -> IconSize.Sm
        CheckboxSize.Lg -> IconSize.Md
    }

/** Map the painted [CheckboxIndicator] to the platform tri-state for the `Role.Checkbox` a11y announcement. */
private fun CheckboxIndicator.toToggleableState(): ToggleableState =
    when (this) {
        CheckboxIndicator.Checked -> ToggleableState.On
        CheckboxIndicator.Mixed -> ToggleableState.Indeterminate
        CheckboxIndicator.Empty -> ToggleableState.Off
    }

// ── Previews (tooling-only; the sample labels are never shipped UI) ───────────────────────────────────────

private const val PREVIEW_LABEL = "Enable notifications"

@Preview(name = "Checkbox · unchecked / checked / mixed", showBackground = true)
@Composable
private fun CheckboxStatesPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.lg)) {
            CheckboxField(checked = false, onCheckedChange = {})
            CheckboxField(checked = true, onCheckedChange = {})
            CheckboxField(checked = false, indeterminate = true, onCheckedChange = {})
        }
    }
}

@Preview(name = "Checkbox · sizes sm / md / lg (checked)", showBackground = true)
@Composable
private fun CheckboxSizesPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CheckboxField(checked = true, size = CheckboxSize.Sm, onCheckedChange = {})
            CheckboxField(checked = true, size = CheckboxSize.Md, onCheckedChange = {})
            CheckboxField(checked = true, size = CheckboxSize.Lg, onCheckedChange = {})
        }
    }
}

@Preview(name = "Checkbox · with label", showBackground = true)
@Composable
private fun CheckboxLabelPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CheckboxField(checked = true, label = PREVIEW_LABEL, onCheckedChange = {})
    }
}

@Preview(name = "Checkbox · disabled (checked + label)", showBackground = true)
@Composable
private fun CheckboxDisabledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CheckboxField(checked = true, label = PREVIEW_LABEL, enabled = false, onCheckedChange = {})
    }
}
