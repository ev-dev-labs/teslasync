// Pure, framework-free model + projection for the LayoutSwitcher feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/dashboard/components/LayoutSwitcher.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web component is a compact dropdown for switching between saved dashboard layouts. It receives the
// layouts + active id + dirty/edit flags + callbacks as props and reads three hooks: `useTranslation` (i18n),
// `useSelectedVehicle` (the active vehicle, used to scope the visible layouts + render the pinned badge +
// gate the pin/unpin action), and `useConfirm` (the reset confirmation dialog). This file owns the pure logic:
// the active-layout resolution (web `dashboards.find(id) ?? dashboards[0]`), the per-vehicle visibility filter
// (web `visible`), the pinned-label derivation (web `pinnedLabel`), the pin-toggle enablement/direction (web
// disabled guard + `handlePinToggle`), the save-as suggestion (web `suggestion`), and the empty guard (web
// `visible.length === 0`). The composable is left to render the resolved [LayoutSwitcherModel].
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LayoutSwitcher — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.layoutswitcher

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object LayoutSwitcherRegistration {
    /** Stable surface id. */
    const val ID: String = "layout-switcher"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "LayoutSwitcher"
}

/**
 * PII-safe diagnostics for the surface (P1/S11). [recordViewOpened] emits the `view.opened` event carrying
 * only the surface slug — never a layout name or vehicle id — so a diagnostics line can never leak which
 * dashboards a user has or which vehicle is selected.
 */
object LayoutSwitcherDiagnostics {
    /** Emits the one-shot `view.opened` diagnostic with the surface slug and nothing else. */
    fun recordViewOpened(logger: Logger) {
        logger.info("view.opened", mapOf("surface" to LayoutSwitcherRegistration.SLUG))
    }
}

/** The em-dash fallback used wherever a relative-age value is unknown — the shared "no value" glyph. */
internal const val EM_DASH: String = "\u2014"

/**
 * One saved dashboard layout — the native mirror of the web `SavedDashboard` fields the switcher actually
 * reads (web/src/features/dashboard/widgets/types.ts). [id] and [name] identify the layout; [vehicleId] is the
 * per-vehicle scope (`null` = user-global, applies to ALL vehicles; a value pins the layout to that vehicle
 * and the switcher hides it when a different vehicle is selected); [isDefault] flags the shipped default. The
 * widgets/layouts/timestamps the web type also carries are irrelevant to the switcher and intentionally
 * omitted.
 */
data class SavedDashboardSummary(
    val id: String,
    val name: String,
    val vehicleId: Long? = null,
    val isDefault: Boolean = false,
)

/**
 * The resolved selected-vehicle context — the native analogue of web `useSelectedVehicle()`
 * (`{ vehicleId, vehicle }`). [vehicleId] is the effective selection (host-supplied id, else the first
 * enrolled vehicle), `null` only when the fleet is empty / not yet loaded. [label] is the vehicle's display
 * name (web `vehicle.display_name ?? vehicle.vin`), `null` when unresolved — the composable falls back to
 * `#<id>` for the pinned badge, exactly as the web does.
 */
data class SelectedVehicleContext(
    val vehicleId: Long? = null,
    val label: String? = null,
) {
    /** True once an active vehicle has been resolved (web `vehicle != null`). */
    val hasVehicle: Boolean get() = vehicleId != null

    companion object {
        /** The "no vehicle resolved" context — fleet empty or still loading. */
        val NONE: SelectedVehicleContext = SelectedVehicleContext()
    }
}

/**
 * One render-ready row of the layouts dropdown — the native mirror of a web `visible.map(...)` entry.
 * [isActive] drives the check mark + highlight (web `aria-checked`), [isDefault] the "default" badge, and
 * [isPinned] the inline pin glyph (web `d.vehicleId != null`).
 */
data class LayoutMenuItem(
    val id: String,
    val name: String,
    val isActive: Boolean,
    val isDefault: Boolean,
    val isPinned: Boolean,
)

/**
 * The already-localized microcopy the composable renders — every string the web component reads via `t(...)`
 * from the `dashboard.layout.*` namespace, plus the shared lifecycle-chrome / dialog strings. All keys already
 * exist in the P1/S10 catalog; tests pass a deterministic instance.
 */
data class LayoutSwitcherStrings(
    val label: String,
    val switcherLabel: String,
    val untitled: String,
    val modified: String,
    val menuLabel: String,
    val noneVisible: String,
    val defaultBadge: String,
    val newFromCurrent: String,
    val pin: String,
    val unpin: String,
    val reset: String,
    val menuFooter: String,
    val editEnter: String,
    val editExit: String,
    val editTitle: String,
    val saveAs: String,
    val saveAsShort: String,
    val saveAsPrompt: String,
    val newLayoutDefault: String,
    val resetTitle: String,
    val resetMessage: String,
    val resetConfirm: String,
    val cancel: String,
    val close: String,
    val loadingLabel: String,
    val offlineLabel: String,
    val retry: String,
)

/**
 * The fully projected inputs the composable renders — the native mirror of everything the web component
 * derives from its props + `useSelectedVehicle`. Pure data (no Compose), so the derivation is fully covered by
 * the off-device unit gate.
 *
 * @property activeId the resolved active layout id (web `active?.id`), `null` only when there are no layouts.
 * @property activeName the active layout name, or the localized "Untitled" (web `activeName`).
 * @property activeVehicleId the active layout's own per-vehicle scope — the [LayoutSwitcherModel] toggle target.
 * @property pinnedLabel the selected-vehicle badge text when the active layout is pinned (web `pinnedLabel`).
 * @property items the per-vehicle-visible layouts as render-ready rows (web `visible.map`).
 * @property isEmpty whether no layout is visible for the current vehicle (web `visible.length === 0`).
 * @property canPinToggle whether the pin/unpin action is enabled (web disabled guard inverted).
 * @property pinToggleIsUnpin whether the action unpins vs pins (web `active.vehicleId != null`).
 * @property saveAsSuggestion the pre-filled name for the save-as prompt (web `suggestion`).
 */
data class LayoutSwitcherModel(
    val activeId: String?,
    val activeName: String,
    val activeVehicleId: Long?,
    val pinnedLabel: String?,
    val items: List<LayoutMenuItem>,
    val isEmpty: Boolean,
    val canPinToggle: Boolean,
    val pinToggleIsUnpin: Boolean,
    val saveAsSuggestion: String,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's data derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object LayoutSwitcherProjection {
    /** The active layout: the one matching [activeId], else the first (web `find(id) ?? dashboards[0]`). */
    fun activeLayout(
        dashboards: List<SavedDashboardSummary>,
        activeId: String,
    ): SavedDashboardSummary? = dashboards.firstOrNull { it.id == activeId } ?: dashboards.firstOrNull()

    /**
     * The layouts visible for the current vehicle scope — the web `visible` filter: a user-global layout
     * (`vehicleId == null`) is always shown; a pinned layout is shown only when its scope equals the
     * currently selected vehicle.
     */
    fun visibleLayouts(
        dashboards: List<SavedDashboardSummary>,
        selectedVehicleId: Long?,
    ): List<SavedDashboardSummary> =
        dashboards.filter { layout ->
            val scope = layout.vehicleId
            scope == null || (selectedVehicleId != null && scope == selectedVehicleId)
        }

    /**
     * Projects the [dashboards] + [activeId] + selected-vehicle [context] into the render-ready
     * [LayoutSwitcherModel]. Mirrors the web derivations exactly: active resolution, the per-vehicle visible
     * filter, the pinned-label fallback chain (selected-vehicle label → `#<id>`), the pin-toggle enablement
     * (web `active.vehicleId == null && vehicleId == null` ⇒ disabled) and direction, the save-as suggestion
     * (current layout name, else the localized default), and the empty guard.
     */
    fun project(
        dashboards: List<SavedDashboardSummary>,
        activeId: String,
        context: SelectedVehicleContext,
        strings: LayoutSwitcherStrings,
    ): LayoutSwitcherModel {
        val active = activeLayout(dashboards, activeId)
        val visible = visibleLayouts(dashboards, context.vehicleId)
        val items =
            visible.map { layout ->
                LayoutMenuItem(
                    id = layout.id,
                    name = layout.name,
                    isActive = layout.id == active?.id,
                    isDefault = layout.isDefault,
                    isPinned = layout.vehicleId != null,
                )
            }
        return LayoutSwitcherModel(
            activeId = active?.id,
            activeName = active?.name?.takeIf { it.isNotBlank() } ?: strings.untitled,
            activeVehicleId = active?.vehicleId,
            pinnedLabel = pinnedLabel(active, context),
            items = items,
            isEmpty = visible.isEmpty(),
            canPinToggle = active != null && (active.vehicleId != null || context.vehicleId != null),
            pinToggleIsUnpin = active?.vehicleId != null,
            saveAsSuggestion = active?.name?.takeIf { it.isNotBlank() } ?: strings.newLayoutDefault,
        )
    }

    /**
     * The pinned-vehicle badge text — shown only when the active layout is pinned AND a vehicle is resolved
     * (web `active?.vehicleId != null && vehicle`). Falls back to `#<vehicleId>` when the label is unknown,
     * exactly as the web `vehicle.display_name ?? vehicle.vin ?? '#${active.vehicleId}'` chain does.
     */
    private fun pinnedLabel(
        active: SavedDashboardSummary?,
        context: SelectedVehicleContext,
    ): String? {
        val pinnedTo = active?.vehicleId
        if (pinnedTo == null || !context.hasVehicle) return null
        return context.label?.takeIf { it.isNotBlank() } ?: "#$pinnedTo"
    }
}
