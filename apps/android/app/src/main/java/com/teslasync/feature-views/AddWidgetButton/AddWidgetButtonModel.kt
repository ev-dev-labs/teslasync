// Pure, framework-free model + projection for the AddWidgetButton feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/components/AddWidgetButton.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// AddWidgetButton is the dashboard's floating "+" action: the web component takes an `onClick` callback and
// an `isEditing` flag as props from the Dashboard page, and renders a tooltip-wrapped circular primary FAB
// that opens the widget-catalogue dialog — except in edit mode, where it returns null because the dashboard
// header already exposes an "Add Widget" action. So the two branches the web source defines — not-editing
// (show the FAB) and editing (render nothing) — are the complete state set this surface renders. Exactly as
// the sibling WeekSelector / StatusHeader / SummaryStatsRow presentational ports document, the
// loading / empty / error / stale / offline states live on the owning page (which owns the dashboard query
// and the edit-mode client state), not here; the only data source the web component itself binds is
// `useTranslation`, mapped natively to the generated i18n catalog (P1/S10).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AddWidgetButton — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.addwidgetbutton

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The mutually-exclusive surface the button renders, derived by [AddWidgetButtonProjection]. Each maps to a
 * render branch in the composable so the control is never ambiguous:
 *  - [Visible] — the dashboard is not in edit mode: the tooltip-wrapped "+" FAB (web content branch).
 *  - [Hidden]  — the dashboard is in edit mode: the surface renders nothing, because the dashboard header
 *    already exposes an "Add Widget" action (web `if (isEditing) return null`).
 */
enum class AddWidgetButtonSurface {
    Visible,
    Hidden,
}

/**
 * The render-ready view — the native analogue of the single decision the web component makes before
 * returning JSX (`isEditing ? null : <Fab/>`). Pure data (no Compose types) so the projection is fully
 * covered by the off-device unit gate.
 *
 * @property surface which of the two branches to render.
 */
data class AddWidgetButtonDisplay(
    val surface: AddWidgetButtonSurface,
) {
    /** True when the FAB should be drawn (the web not-editing branch). */
    val visible: Boolean get() = surface == AddWidgetButtonSurface.Visible
}

/**
 * Pure projection from the surface's `isEditing` input to its render-ready [AddWidgetButtonDisplay] — a 1:1
 * port of the web component's only decision: it returns null (renders nothing) in edit mode and the FAB
 * otherwise. Side-effect-free, so it is fully covered by the off-device unit gate.
 */
object AddWidgetButtonProjection {
    /**
     * Select the render-ready view for [isEditing]. In edit mode the surface is
     * [AddWidgetButtonSurface.Hidden] (web `return null`); otherwise it is [AddWidgetButtonSurface.Visible].
     */
    fun project(isEditing: Boolean): AddWidgetButtonDisplay =
        AddWidgetButtonDisplay(
            surface = if (isEditing) AddWidgetButtonSurface.Hidden else AddWidgetButtonSurface.Visible,
        )
}

/** Stable identifiers for the surface (P1/S11 diagnostics + the web-parity UI test tag). */
object AddWidgetButtonRegistration {
    /** Stable surface id. */
    const val ID: String = "add-widget-button"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AddWidgetButton"

    /** Web-parity test tag — the web `data-testid="dashboard-add-widget-fab"`. */
    const val TEST_TAG: String = "dashboard-add-widget-fab"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface slug — never the click
 * handler or any dashboard state — so a diagnostics line can never leak what the operator was viewing.
 */
object AddWidgetButtonDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-visible effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to AddWidgetButtonRegistration.SLUG))
    }
}
