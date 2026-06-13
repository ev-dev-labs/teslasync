// The native Jetpack Compose + Material 3 PlaybackSpeedMenu shared surface — a parity port of the web compact
// scrub-speed control web/src/components/data-display/PlaybackSpeedMenu.tsx. The web component is a single ghost
// `<Button size="sm">` that shows the current `{speed}x` plus a faint ChevronDown; a left-click cycles to the next
// (wrapping) speed via `nextSpeed`, a right-click (`onContextMenu`) steps one slot BACKWARD (clamped) via
// `shiftSpeed(-1)`, and its `aria-label` is `t('replay.controls.speed')`. All of that logic lives in
// PlaybackSpeedMenuModel.kt and is unit-tested off-device; this file is the thin render layer that draws the label
// + glyph, wires the two gestures, resolves the localized label, and fires the one-shot diagnostic.
//
// Parity choices:
//   • Two gestures, one control: web tap (`onClick`) → [nextSpeed]; web right-click (`onContextMenu`) →
//     `shiftSpeed(-1)`. Android has no right-click, so the right-click idiom maps to a LONG-PRESS, expressed with
//     `Modifier.combinedClickable(onClick, onLongClick)` — the same primitive the shared `ContextMenuArea` and the
//     SessionList / LayoutManager surfaces use for "tap = primary, long-press = secondary". The shared `Button`'s
//     single-`onClick` API cannot carry this dual gesture, so the control is drawn as a ghost-styled clickable Row
//     that REUSES the shared Button's Ghost tokens (transparent container, `primary` content color, the Sm
//     content padding `Spacing.md` × `Spacing.xs`) rather than the Button composable itself.
//   • ChevronDown: the web lucide glyph is decorative (`opacity-50`, no a11y); reproduced as a locally-authored
//     stroked vector ([ChevronDownGlyph]) drawn through the shared `components/ui/Icon` facade (web `Icon` parity)
//     with `contentDescription = null` and a half-alpha tint, since Android ships no lucide / material-icons-
//     extended artifact (the same approach as `DataDisplayGlyphs`).
//   • i18n: the surface's single web `t()` key, `replay.controls.speed`, resolves through the generated P1/S10
//     string resource `R.string.translation_replay_controls_speed` ("Playback speed").
//   • Accessibility: the row collapses into ONE `Role.Button` node whose spoken label is "Playback speed, {speed}x"
//     (the localized name + the live value) — an improvement over the web `aria-label`, which omits the value —
//     while the visible `{speed}x` text is cleared from the a11y tree so it is not announced twice.
//   • Diagnostics: records the one-shot PII-safe `view.opened` event (P1/S11) on first composition.
//
// The web source has no async feed (the parent owns `speed` and `onChange`), so — like the accepted Speed /
// AnimatedNumber / VisuallyHidden presentational ports — it has NO loading / empty / error / stale / offline
// lifecycle; its reproduced states are the discrete speed selections, exercised by the per-speed previews below
// and the off-device model test.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/PlaybackSpeedMenu — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, glyph, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.playbackspeedmenu

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The signed slot delta the backward (long-press) gesture applies — web `shiftSpeed(speed, -1)`. */
private const val BACKWARD_STEP: Int = -1

/** Gap between the `{speed}x` label and the chevron — web `gap-0.5` (2px). */
private val LABEL_GLYPH_GAP: Dp = 2.dp

/** Chevron opacity — web `opacity-50`; the glyph is a faint "this cycles" affordance, not a focal element. */
private const val CHEVRON_ALPHA: Float = 0.5f

/**
 * The faint downward chevron the web renders with lucide `ChevronDown`. Authored locally as a 24×24 stroked vector
 * (Android ships no lucide / material-icons-extended artifact) and recolored at render time by the [Icon] tint.
 */
private val ChevronDownGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "PlaybackSpeedMenuChevronDown",
            defaultWidth = 16.dp,
            defaultHeight = 16.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ) {
                moveTo(6f, 9f)
                lineTo(12f, 15f)
                lineTo(18f, 9f)
            }
        }.build()

/**
 * Compact playback-speed control — the faithful Android port of the web `PlaybackSpeedMenu`. Shows the current
 * [speed] as `{speed}x` with a faint chevron; a TAP cycles to the next (wrapping) speed (web `onClick` →
 * [nextSpeed]) and a LONG-PRESS steps one slot backward, clamped (web `onContextMenu` → `shiftSpeed(-1)`), each
 * routed through [onChange]. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and performs no HTTP.
 *
 * @param speed the current replay multiplier (web `speed` prop); one of [REPLAY_SPEEDS].
 * @param onChange invoked with the newly-selected multiplier (web `onChange` prop).
 * @param modifier layout modifier (the web `className` analogue).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun PlaybackSpeedMenu(
    speed: Int,
    onChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { PlaybackSpeedMenuDiagnostics.recordViewOpened(logger) }
    val accessibleName = stringResource(R.string.translation_replay_controls_speed)
    PlaybackSpeedMenuContent(
        speed = speed,
        onChange = onChange,
        accessibleName = accessibleName,
        modifier = modifier,
    )
}

/**
 * The stateless renderer — the preview / UI-test entry point. Draws the ghost-styled, single-node control for
 * [speed] and wires both gestures, taking the already-resolved localized [accessibleName] so it renders without a
 * [LocalDataContainer] or diagnostics. The whole row is one [Role.Button] node labelled
 * "[accessibleName], {speed}x"; the visible label is cleared from the a11y tree so it is announced once.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PlaybackSpeedMenuContent(
    speed: Int,
    onChange: (Int) -> Unit,
    accessibleName: String,
    modifier: Modifier = Modifier,
) {
    val description = PlaybackSpeedMenuProjection.accessibleLabel(accessibleName, speed)
    val contentColor = MaterialTheme.colorScheme.primary
    Row(
        modifier =
            modifier
                .clip(MaterialTheme.shapes.small)
                .combinedClickable(
                    role = Role.Button,
                    onClick = { onChange(nextSpeed(speed)) },
                    onLongClick = { onChange(shiftSpeed(speed, BACKWARD_STEP)) },
                ).semantics { contentDescription = description }
                .padding(horizontal = Spacing.md, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(LABEL_GLYPH_GAP),
    ) {
        Text(
            text = PlaybackSpeedMenuProjection.speedLabel(speed),
            modifier = Modifier.clearAndSetSemantics { },
            style = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace),
            color = contentColor,
        )
        Icon(
            imageVector = ChevronDownGlyph,
            contentDescription = null,
            size = IconSize.Xs,
            tint = contentColor.copy(alpha = CHEVRON_ALPHA),
        )
    }
}

// ── Previews (tooling-only; render the ghost control for each speed, never shipped UI) ──────────────────────────

/** Every selectable speed in the cycle order, light theme — the per-state snapshot surface. */
@Preview(name = "All speeds (light)", showBackground = true)
@Composable
private fun PlaybackSpeedMenuStatesPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        val name = stringResource(R.string.translation_replay_controls_speed)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            REPLAY_SPEEDS.forEach { speed ->
                PlaybackSpeedMenuContent(speed = speed, onChange = {}, accessibleName = name)
            }
        }
    }
}

/** A single selection in the dark theme so the ghost contrast is verifiable. */
@Preview(name = "Selected (dark)", showBackground = true)
@Composable
private fun PlaybackSpeedMenuDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        PlaybackSpeedMenuContent(
            speed = 25,
            onChange = {},
            accessibleName = stringResource(R.string.translation_replay_controls_speed),
        )
    }
}
