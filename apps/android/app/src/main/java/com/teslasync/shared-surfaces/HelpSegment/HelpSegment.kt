// The native Jetpack Compose + Material 3 HelpSegment shared surface — a parity port of
// web/src/components/layout/status-bar/HelpSegment.tsx, the footer status-bar segment that consolidates the
// three "always available" help affordances (keyboard shortcuts, take a tour, report bug).
//
// The web source binds only `useTranslation` and renders three Tooltip-wrapped buttons, each dispatching a
// decoupled event so the rest of the app keeps working unchanged:
//   • Keyboard icon + `?` kbd chip + "for shortcuts" → `window.dispatchEvent('toggle-keyboard-shortcuts')`;
//   • HelpCircle icon + "Take a tour"                 → `dispatchTourLauncherOpen()`;
//   • Bug icon + "Report bug"                          → `window.dispatchEvent('open-feedback-modal')`.
// Its `iconOnly` prop hides the visible labels (and the `?` chip), leaving icon-only affordances whose tooltips
// still carry every label.
//
// This surface is the native equivalent. Every tap flows through the shared [HelpSegmentViewModel] over the
// decoupled [HelpActions] seam — the view performs NO dispatch of its own (ADR-002):
//   • web `useTranslation` `t(key, default)` → the generated i18n catalog (P1/S10), read here via
//     [translate] (catalog value when present, the web fallback when the key is catalog-absent, exactly as
//     i18next renders the inline default for `shortcuts.tooltip` / `shortcuts.openAria`);
//   • web `Tooltip` → the shared Material 3 [Tooltip];
//   • web lucide `Keyboard` / `HelpCircle` / `Bug` → [KeyboardGlyph] / [TeslaGlyphs.Help] / [BugGlyph]
//     (the shared glyph set carries `Help`; the keyboard + bug glyphs are drawn here in the house line style
//     because the repo deliberately avoids the frozen `material-icons-extended` artifact);
//   • web `aria-label` → an explicit `contentDescription` overriding the visible label for assistive tech;
//   • the three decoupled dispatches → [HelpSegmentViewModel.invoke] over [HelpActions]/[ProcessHelpActions].
//
// States reproduced (the honest set for a status-bar chrome segment with no remote read — see
// HelpSegmentModel, covenant #2 / #9): the [HelpDisplayMode] compact (icon-only) and expanded (icon + label)
// modes, both rendered here; the per-action dispatch is a safe no-op when nothing is mounted. There is no
// remote read, so no loading / empty / error / stale / offline lifecycle is invented. The one-shot
// `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/HelpSegment) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless renderer, presentation model, glyphs, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helpsegment

import android.annotation.SuppressLint
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the segment root — the native analogue of the web `data-tour="keyboard-hint"`. */
const val HELP_SEGMENT_TEST_TAG: String = "help-segment"

/** 24×24 icon canvas + stroke width, matching the shared [TeslaGlyphs] line-style set the segment draws beside. */
private const val ICON_CANVAS: Float = 24f
private const val ICON_STROKE: Float = 2f

/**
 * Already-localized copy for one help affordance — the presentation projection the stateless renderer draws,
 * so previews and tests pass literals while production resolves the catalog at the render boundary. [tooltip]
 * is the hover/long-press text, [accessibleName] the screen-reader name (web `aria-label`), and [label] the
 * visible text shown in the expanded mode.
 */
data class HelpActionCopy(
    val action: HelpAction,
    val tooltip: String,
    val accessibleName: String,
    val label: String,
)

/**
 * Stateful entry point — the parity port of the web `<HelpSegment />`. Binds the decoupled [actions] seam
 * through [viewModel], records the one-shot `view.opened` diagnostic (P1/S11) on first composition, resolves
 * each affordance's localized copy via the web `t(key, default)` contract, and renders the segment in the
 * compact or expanded [HelpDisplayMode] selected by [iconOnly].
 *
 * @param iconOnly the native mirror of the web `iconOnly` prop — true hides the visible labels (icon-only).
 * @param actions the decoupled help-action seam; defaults to the process-wide [ProcessHelpActions].
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun HelpSegment(
    modifier: Modifier = Modifier,
    iconOnly: Boolean = false,
    actions: HelpActions = ProcessHelpActions,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: HelpSegmentViewModel =
        viewModel(
            key = HelpSegmentRegistration.ID,
            factory = HelpSegmentViewModel.factory(actions, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    val copies =
        listOf(
            helpActionCopy(HelpAction.Shortcuts),
            helpActionCopy(HelpAction.Tour),
            helpActionCopy(HelpAction.Feedback),
        )

    HelpSegmentContent(
        mode = helpDisplayMode(iconOnly),
        actions = copies,
        onInvoke = viewModel::invoke,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the test / preview entry point. Lays the resolved [actions] copy out as a horizontal
 * row of [HelpActionButton]s in the given [mode], drawing visible labels (and the `?` kbd chip) only in
 * [HelpDisplayMode.Expanded].
 */
@Composable
fun HelpSegmentContent(
    mode: HelpDisplayMode,
    actions: List<HelpActionCopy>,
    onInvoke: (HelpAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.testTag(HELP_SEGMENT_TEST_TAG),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (copy in actions) {
            HelpActionButton(copy = copy, mode = mode, onInvoke = onInvoke)
        }
    }
}

/**
 * One tooltip-wrapped help affordance — an icon, optionally followed by the `?` kbd chip and the visible label
 * in the expanded [mode]. The whole row is a single `Role.Button` whose accessible name is [HelpActionCopy.accessibleName]
 * (web `aria-label`, overriding the visible label so assistive tech announces the full action), and activating
 * it dispatches [HelpActionCopy.action] through [onInvoke]. The icon is decorative (no content description) so
 * the row reads once.
 */
@Composable
private fun HelpActionButton(
    copy: HelpActionCopy,
    mode: HelpDisplayMode,
    onInvoke: (HelpAction) -> Unit,
) {
    Tooltip(text = copy.tooltip) {
        Row(
            modifier =
                Modifier
                    .clip(RoundedCornerShape(Radius.sm))
                    .clickable(onClickLabel = copy.accessibleName, role = Role.Button) { onInvoke(copy.action) }
                    .semantics(mergeDescendants = true) { contentDescription = copy.accessibleName }
                    .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = glyphFor(copy.action),
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (labelVisible(mode)) {
                if (shortcutHintVisible(copy.action, mode)) {
                    KbdChip(symbol = SHORTCUT_HINT_GLYPH)
                }
                Caption(text = copy.label)
            }
        }
    }
}

/**
 * The `?` keyboard-key chip the shortcuts affordance shows in the expanded mode — the native mirror of the web
 * `<kbd>`: a small rounded surface carrying the literal key [symbol]. Decorative for assistive tech (the parent
 * row already carries the accessible name).
 */
@Composable
private fun KbdChip(
    symbol: String,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier =
            modifier
                .clip(RoundedCornerShape(Radius.sm))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = Spacing.xs),
        contentAlignment = Alignment.Center,
    ) {
        CodeText(text = symbol)
    }
}

/**
 * Resolves one affordance's already-localized [HelpActionCopy] at the render boundary, reproducing the web
 * `t(key, default)` for the tooltip, accessible name, and visible label.
 */
@Composable
private fun helpActionCopy(action: HelpAction): HelpActionCopy =
    HelpActionCopy(
        action = action,
        tooltip = translate(action.tooltip),
        accessibleName = translate(action.accessibleName),
        label = translate(action.label),
    )

/**
 * The web `t(key, default)` at the render boundary: resolves the [LocalizedText.key] from the generated catalog
 * (P1/S10) by its `translation_<key with dots as underscores>` resource name, returning the catalog string when
 * present or the web [LocalizedText.fallback] (the source's own i18next default) when the key is catalog-absent.
 * `getIdentifier` is the only way to attempt a key that may be absent (a compile-time `R.string` reference would
 * not compile), so `DiscouragedApi` is suppressed; release builds keep resource names (shrinking is off), so the
 * lookup is stable.
 */
@SuppressLint("DiscouragedApi")
@Composable
private fun translate(text: LocalizedText): String {
    val context = LocalContext.current
    val resourceName = "translation_" + text.key.replace('.', '_')
    val id = remember(resourceName) { context.resources.getIdentifier(resourceName, "string", context.packageName) }
    return if (id != 0) stringResource(id) else text.fallback
}

/** Maps an affordance to its glyph — web lucide `Keyboard` / `HelpCircle` / `Bug`. */
private fun glyphFor(action: HelpAction): ImageVector =
    when (action) {
        HelpAction.Shortcuts -> KeyboardGlyph
        HelpAction.Tour -> TeslaGlyphs.Help
        HelpAction.Feedback -> BugGlyph
    }

/**
 * A keyboard glyph mirroring the web `Keyboard` (lucide) shortcuts icon — a body outline with key dots and a
 * spacebar, authored as a 24×24 stroked vector in the [TeslaGlyphs] house style (opaque black, recolored at
 * render by the [Icon] tint).
 */
private val KeyboardGlyph: ImageVector =
    strokedGlyph("HelpSegmentKeyboard") {
        rect(2.5f, 7f, 21.5f, 17f)
        dot(6f, 10.5f)
        dot(9.5f, 10.5f)
        dot(13f, 10.5f)
        dot(16.5f, 10.5f)
        dot(6f, 13.5f)
        dot(16.5f, 13.5f)
        moveTo(9f, 13.5f)
        lineTo(15f, 13.5f)
    }

/**
 * A bug glyph mirroring the web `Bug` (lucide) feedback icon — a body with a centre divider, two antennae, and
 * three legs per side, authored as a 24×24 stroked vector in the [TeslaGlyphs] house style.
 */
private val BugGlyph: ImageVector =
    strokedGlyph("HelpSegmentBug") {
        rect(8.5f, 8f, 15.5f, 18f)
        moveTo(8.5f, 13f)
        lineTo(15.5f, 13f)
        moveTo(10f, 8f)
        lineTo(8.5f, 5.5f)
        moveTo(14f, 8f)
        lineTo(15.5f, 5.5f)
        moveTo(8.5f, 11f)
        lineTo(5.5f, 9.5f)
        moveTo(8.5f, 13.5f)
        lineTo(5f, 13.5f)
        moveTo(8.5f, 16f)
        lineTo(5.5f, 17.5f)
        moveTo(15.5f, 11f)
        lineTo(18.5f, 9.5f)
        moveTo(15.5f, 13.5f)
        lineTo(19f, 13.5f)
        moveTo(15.5f, 16f)
        lineTo(18.5f, 17.5f)
    }

/** Builds a 24×24 stroked [ImageVector] in the [TeslaGlyphs] house style (round cap/join, recolored by tint). */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = ICON_CANVAS,
            viewportHeight = ICON_CANVAS,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = ICON_STROKE,
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

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.rect(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
) {
    moveTo(left, top)
    lineTo(right, top)
    lineTo(right, bottom)
    lineTo(left, bottom)
    close()
}

// ── Previews — both density modes the web `iconOnly` prop selects, in light and dark. Sample copy reuses the
// model's own web fallbacks (no new literals), and is tooling-only, never shipped UI. ─────────────────────────

private fun previewCopies(): List<HelpActionCopy> =
    HelpAction.entries.map { action ->
        HelpActionCopy(
            action = action,
            tooltip = action.tooltip.fallback,
            accessibleName = action.accessibleName.fallback,
            label = action.label.fallback,
        )
    }

@Preview(name = "HelpSegment — expanded", showBackground = true)
@Composable
private fun HelpSegmentExpandedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HelpSegmentContent(
            mode = HelpDisplayMode.Expanded,
            actions = previewCopies(),
            onInvoke = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}

@Preview(name = "HelpSegment — expanded (dark)", showBackground = true)
@Composable
private fun HelpSegmentExpandedDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        HelpSegmentContent(
            mode = HelpDisplayMode.Expanded,
            actions = previewCopies(),
            onInvoke = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}

@Preview(name = "HelpSegment — compact (icon only)", showBackground = true)
@Composable
private fun HelpSegmentCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HelpSegmentContent(
            mode = HelpDisplayMode.Compact,
            actions = previewCopies(),
            onInvoke = {},
            modifier = Modifier.padding(Spacing.md),
        )
    }
}
