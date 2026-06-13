// The native Jetpack Compose + Material 3 GotoIndicator shared surface — a parity port of
// web/src/components/feedback/GotoIndicator.tsx. The web component is a tiny presentational overlay driven by a
// single `visible` prop: when false it renders `null`; when true it renders a fixed, bottom-centre translucent
// pill — a muted `t('shortcuts.goto', 'Go to...')` label followed by two `<kbd>` key caps ("g" and "?") joined
// by a "+", entering with a fade + slide-up. This surface keeps that contract end to end while staying
// Android-idiomatic.
//
// It performs NO HTTP and binds no async feed — its only inputs are the render-boundary `visible` flag and the
// i18n catalog (P1/S10). Its data layer (the pure phase + key-cap projection + the PII-safe `view.opened`
// diagnostic) lives in GotoIndicatorModel.kt; this composable is a thin render layer that resolves the label +
// design tokens (P1/S9) and draws what the projection returns. Because the surface has no async lifecycle, it
// reproduces exactly the web's two states — Hidden (nothing) and Visible (the pill) — and no fabricated
// loading / error / stale / offline chrome; see the model header's parity-with-honesty note.
//
// Token mapping (P1/S9 tokens, no ported Tailwind): the web pill `rounded-xl bg-[var(--surface-overlay)]
// backdrop-blur border-[var(--border-subtle)] shadow-2xl` maps to a Material 3 [Surface] with the `Radius.md`
// (rounded-xl) shape, the tonal `surface` colour at `Elevation.overlay`, a `shadowElevation` drop shadow, and a
// hairline `outlineVariant` border; `animate-in fade-in slide-in-from-bottom-4` maps to the shared [FadeIn]
// (which already honours reduced motion). The muted `text-[var(--text-muted)]` label maps to [Caption]; each
// `<kbd>` (`rounded bg-[var(--surface-2)] font-mono text-[var(--text-secondary)]`) maps to a `surfaceVariant`-
// filled, `outline`-bordered, `Radius.sm` box hosting a monospaced [CodeText]; the `+` joiner maps to a
// [Caption] — the same mapping the sibling KeyboardShortcutsModal key-combo uses, so the key caps stay visually
// consistent app-wide.
//
// Accessibility: the surface is a passive hint (the web `<div>` has no role and nothing to focus or tap), so it
// exposes NO interactive node. The pill merges its descendants under one [contentDescription] ("Go to …  g + ?")
// so TalkBack voices a single coherent phrase; font scaling rides the shared typography, and reduce-motion is
// honoured by [FadeIn]. Diagnostics: a single PII-safe `view.opened` (P1/S11) fires the first time the hint
// becomes visible (the web mounts the pill only while `visible`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/GotoIndicator) cannot form a valid Kotlin package, so the package diverges from
// the path, exactly as the sibling surfaces do. `MatchingDeclarationName` is suppressed for the co-located
// stateless content + key chip + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.gotoindicator

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag for the pill the UI test selects (present only while the hint is visible). */
const val GOTO_INDICATOR_TEST_TAG: String = "goto-indicator-pill"

private val HAIRLINE_BORDER = 1.dp

/**
 * The GotoIndicator surface — the parity port of the web `GotoIndicator({ visible })`. Projects the
 * render-boundary [visible] flag through the pure [GotoIndicatorProjection], records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11) the first time the hint becomes visible, and renders the translucent
 * "Go to …  g + ?" pill (or nothing while dismissed, the web `return null`).
 *
 * @param visible whether the hint is shown (web `visible` prop); the owner toggles it.
 * @param logger the sanctioned redacting logger the diagnostic is emitted through; defaults to the app's
 *   [LocalDataContainer]. Tests pass a recording instance.
 */
@Composable
fun GotoIndicator(
    visible: Boolean,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    var opened by remember { mutableStateOf(false) }
    LaunchedEffect(visible) {
        if (visible && !opened) {
            opened = true
            GotoIndicatorDiagnostics.recordViewOpened(logger)
        }
    }
    val display = remember(visible) { GotoIndicatorProjection.project(visible) }
    GotoIndicatorContent(display = display, strings = rememberGotoIndicatorStrings(), modifier = modifier)
}

/**
 * Stateless renderer — the preview + UI-test entry point. Draws the pill for [GotoIndicatorPhase.Visible] and
 * nothing for [GotoIndicatorPhase.Hidden] (the web `if (!visible) return null`: a designed absence — a deliberate
 * visibility toggle, not a nulled data region — so reproducing it faithfully means emitting no node).
 */
@Composable
fun GotoIndicatorContent(
    display: GotoIndicatorDisplay,
    strings: GotoIndicatorStrings,
    modifier: Modifier = Modifier,
) {
    if (!display.isVisible) return
    FadeIn(modifier = modifier) {
        GotoIndicatorPill(strings = strings, keys = display.keys)
    }
}

/** The translucent overlay pill: the muted "Go to …" label and the key-cap chips, under one TalkBack label. */
@Composable
private fun GotoIndicatorPill(
    strings: GotoIndicatorStrings,
    keys: List<String>,
) {
    val description = GotoIndicatorProjection.contentDescription(strings.gotoLabel, keys)
    Surface(
        modifier =
            Modifier
                .testTag(GOTO_INDICATOR_TEST_TAG)
                .semantics(mergeDescendants = true) { contentDescription = description },
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = Elevation.overlay,
        shadowElevation = Elevation.overlay,
        border = BorderStroke(HAIRLINE_BORDER, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.lg, vertical = Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Caption(text = strings.gotoLabel, modifier = Modifier.padding(end = Spacing.xs))
            keys.forEachIndexed { index, key ->
                if (index > 0) Caption(text = GotoIndicatorProjection.KEY_SEPARATOR)
                GotoKeyChip(key = key)
            }
        }
    }
}

/** A single `<kbd>` chip: rounded, outlined, surface-variant filled, monospaced — the web `<kbd>` token map. */
@Composable
private fun GotoKeyChip(key: String) {
    val shape = RoundedCornerShape(Radius.sm)
    Box(
        modifier =
            Modifier
                .clip(shape)
                .border(BorderStroke(HAIRLINE_BORDER, MaterialTheme.colorScheme.outline), shape)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        contentAlignment = Alignment.Center,
    ) {
        CodeText(text = key)
    }
}

/** Resolves the localized "Go to …" label from the shared P1/S10 catalog key (see the model header). */
@Composable
private fun rememberGotoIndicatorStrings(): GotoIndicatorStrings =
    GotoIndicatorStrings(
        gotoLabel =
            stringResource(
                R.string.translation_shortcuts_goto,
                GotoIndicatorProjection.GOTO_LABEL_ELLIPSIS,
            ),
    )

// ── Previews — one per render branch (visible pill / dismissed, draws nothing). ─────────────────────────────

private fun previewStrings(): GotoIndicatorStrings = GotoIndicatorStrings(gotoLabel = "Go to \u2026")

@Preview(name = "GotoIndicator · visible", showBackground = true)
@Composable
private fun GotoIndicatorVisiblePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GotoIndicatorContent(
            display = GotoIndicatorProjection.project(visible = true),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "GotoIndicator · hidden (renders nothing)", showBackground = true)
@Composable
private fun GotoIndicatorHiddenPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        GotoIndicatorContent(
            display = GotoIndicatorProjection.project(visible = false),
            strings = previewStrings(),
        )
    }
}
