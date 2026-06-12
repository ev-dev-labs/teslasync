// The native Jetpack Compose + Material 3 AddWidgetButton feature view — a parity port of
// web/src/features/dashboard/components/AddWidgetButton.tsx. The web component is the dashboard's floating
// "+" action: a tooltip-wrapped circular primary `<Button>` (lucide `add` icon, `aria-label` "Add Widget",
// `data-testid="dashboard-add-widget-fab"`) that opens the widget-catalogue dialog from any dashboard view,
// and that hides itself in edit mode because the dashboard header already exposes an "Add Widget" action
// (`if (isEditing) return null`). This port keeps that contract exactly: the FAB shows when not editing and
// renders nothing when editing.
//
// The web button is a `<Button>` styled into a 56px circle (`h-14 w-14 rounded-full`) to emulate — in its
// own words — "the Material FAB convention". On Android that convention is a first-class primitive, so the
// idiomatic, HIG-correct native mapping is a Material 3 [FloatingActionButton] (rather than porting the
// Tailwind sizing onto the shared Button), wrapped in the shared [Tooltip] the web component uses, with the
// authored lucide-`Plus` glyph drawn through the shared [Icon] at the canonical 24dp FAB icon size.
//
// AddWidgetButton is a presentational control — the web component takes its `onClick` / `isEditing` props
// from the Dashboard page, which owns the dashboard query and the edit-mode client state. So, as the sibling
// WeekSelector / StatusHeader / SummaryStatsRow presentational ports document, the
// loading / empty / error / stale / offline states live on the owning page, not here; the two branches the
// web source defines (not-editing vs. editing) are the complete state set this surface renders. The one data
// source the web component binds is `useTranslation`, mapped natively to the generated i18n catalog
// (P1/S10) — the visible label resolves through the `dashboard.addWidget` key, with no English literal in
// this file. Every derivation flows through the pure [AddWidgetButtonProjection]; the composable is a thin
// render layer that records the one-shot `view.opened` diagnostic (P1/S11) when the FAB becomes visible.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AddWidgetButton) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.addwidgetbutton

import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the faithful 1:1 port of the web `AddWidgetButton({ onClick, isEditing })` props.
 * Projects [isEditing] onto an [AddWidgetButtonDisplay] via the pure [AddWidgetButtonProjection] and renders
 * the stateless content. Records the one-shot `view.opened` diagnostic (P1/S11) when the FAB is actually
 * visible — never while it is hidden in edit mode, so the event honestly reflects a shown surface.
 *
 * @param onClick opens the widget-catalogue dialog (web `onClick`).
 * @param isEditing whether the dashboard is in edit mode; hides the FAB (web `isEditing`).
 * @param modifier positioning supplied by the host — the web `fixed bottom-20 right-6` is a page-layout
 *   concern, so on Android the host Scaffold / Box places the FAB.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AddWidgetButton(
    onClick: () -> Unit,
    isEditing: Boolean,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val display = remember(isEditing) { AddWidgetButtonProjection.project(isEditing) }
    LaunchedEffect(display.visible) {
        if (display.visible) AddWidgetButtonDiagnostics.recordViewOpened(logger)
    }
    AddWidgetButtonContent(display = display, onClick = onClick, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test entry point. Reproduces the web content branch: a tooltip-wrapped
 * Material 3 [FloatingActionButton] with the saturated primary fill, the lucide-`Plus` icon, the "Add Widget"
 * accessibility label, and the web-parity test tag. When the surface is hidden (edit mode) it renders
 * nothing, mirroring the web `if (isEditing) return null`.
 */
@Composable
fun AddWidgetButtonContent(
    display: AddWidgetButtonDisplay,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (!display.visible) return
    val label = stringResource(R.string.translation_dashboard_addWidget)
    Tooltip(text = label) {
        FloatingActionButton(
            onClick = onClick,
            modifier =
                modifier
                    .testTag(AddWidgetButtonRegistration.TEST_TAG)
                    .semantics { contentDescription = label },
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
        ) {
            Icon(
                imageVector = AddWidgetButtonGlyphs.Plus,
                contentDescription = null,
                size = IconSize.Xl,
            )
        }
    }
}

// ── Previews (tooling-only; the @Preview entry point exercises the visible render branch) ───────────

@Preview(name = "Add Widget FAB", showBackground = true)
@Composable
private fun AddWidgetButtonVisiblePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AddWidgetButtonContent(
            display = AddWidgetButtonProjection.project(isEditing = false),
            onClick = {},
        )
    }
}
