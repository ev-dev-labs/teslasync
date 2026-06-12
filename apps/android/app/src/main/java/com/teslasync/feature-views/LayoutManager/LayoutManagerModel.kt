// Pure, framework-free model + projection for the dashboard LayoutManager feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/dashboard/components/LayoutManager.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is the dashboard layout switcher: a horizontally scrollable strip of saved-dashboard
// chips (icon + name + a "default" tag for the protected layout), with the active layout highlighted.
// Tapping a chip switches to it; a per-chip context menu (web right-click) carries Rename / Duplicate /
// Settings / Delete, with Delete disabled for the default layout; chips can be reordered (web HTML5 drag);
// renaming swaps the chip for an inline editor; and a trailing "New Layout" affordance either opens the
// template gallery (when the host supplies `onOpenTemplates`) or reveals an inline create editor. This file
// owns the pure parts: the chip projection (the icon fallback, the blank-name fold, the active flag, and the
// per-position delete/move guards), the list-move semantics the `onReorder(from, to)` contract realizes, the
// context-menu composition, the top-level lifecycle classifier the composable switches on, and the i18n key
// mirrors plus the `t(key, default)` resolver for the labels the catalog does not define.
//
// LayoutManager is a presentational control: the web component takes its `dashboards` / `activeId` and its
// nine callbacks as props from the Dashboard page, which owns the persistence and the active-layout client
// state. So, exactly as the sibling WeekSelector / XRayControls presentational ports document, the
// loading / empty / error / stale / offline lifecycle is fed in through the shared state-holder layer
// (P1/S8) as a [UiState] rather than fetched here; the surface reproduces every state that layer can carry
// plus the web source's own branches (active chip, inline rename, inline create vs. template gallery, the
// context menu with its default-protected Delete, and the empty strip that still offers the create CTA).
//
// Reorder note: the web realizes reorder with HTML5 drag-and-drop, which has no keyboard or screen-reader
// path. The Android-idiomatic, fully accessible realization of the same `onReorder(from, to)` contract is a
// pair of "Move left" / "Move right" context-menu actions (the move semantics are modeled and tested by
// [LayoutManagerProjection.reorder]); the capability is preserved, only the affordance is platform-native.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LayoutManager — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.layoutmanager

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object LayoutManagerRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event. Carries no layout names / PII. */
    const val SLUG: String = "LayoutManager"
}

/**
 * The default chip glyph — the verbatim web `d.icon ?? '📊'` fallback (the bar-chart emoji). Authored as a
 * Unicode escape so the source file stays ASCII.
 */
const val DEFAULT_LAYOUT_ICON: String = "\uD83D\uDCCA"

/** The em-dash fallback shown when a layout name is blank, so a chip is never a blank box. */
private const val EM_DASH: String = "\u2014"

/**
 * The subset of the web `SavedDashboard` the switcher reads — the native mirror of the four fields
 * `LayoutManager` touches (`id`, `name`, `icon`, `isDefault`). A nullable [icon] reproduces the web optional
 * field so the projection can fall back exactly like the source.
 *
 * @property id the stable layout id (web `d.id`); the [onSwitch] / [onRename] / … callback argument.
 * @property name the layout's display name (web `d.name`); a blank value folds to an em dash for display.
 * @property icon the optional emoji/glyph (web `d.icon`); a blank/absent value folds to [DEFAULT_LAYOUT_ICON].
 * @property isDefault whether this is the protected default layout (web `d.isDefault`); its Delete is disabled.
 */
data class LayoutTab(
    val id: String,
    val name: String,
    val icon: String? = null,
    val isDefault: Boolean = false,
)

/**
 * One fully projected, render-ready chip — the native analogue of everything the web component decides per
 * dashboard before returning its `<div>` (the icon fallback, the truncated name, the active highlight, the
 * default tag, and the per-position action guards). Pure data (no Compose types) so the projection is
 * unit-tested without a UI host.
 *
 * @property id the layout id, threaded back into the callbacks.
 * @property name the display name (blank folds to an em dash).
 * @property icon the resolved glyph (web `d.icon ?? '📊'`).
 * @property isActive whether this is the selected layout — web `d.id === activeId` (the highlight).
 * @property isDefault whether the protected default tag renders — web `d.isDefault && <span>default</span>`.
 * @property canDelete whether Delete is enabled — web `disabled={!!ctxDash.isDefault}` inverted.
 * @property canMoveLeft whether a leftward reorder is possible (not the first chip).
 * @property canMoveRight whether a rightward reorder is possible (not the last chip).
 */
data class LayoutTabDisplay(
    val id: String,
    val name: String,
    val icon: String,
    val isActive: Boolean,
    val isDefault: Boolean,
    val canDelete: Boolean,
    val canMoveLeft: Boolean,
    val canMoveRight: Boolean,
)

/** The secondary actions the per-chip context menu exposes — the web menu plus the reorder realization. */
enum class LayoutAction { Rename, Duplicate, Settings, MoveLeft, MoveRight, Delete }

/**
 * One projected context-menu row — the native analogue of a single web `CtxItem` (`label` / `onClick` /
 * `disabled` / `danger`). [enabled] is the inverse of the web `disabled`; [destructive] mirrors the web
 * `danger` flag (Delete). The label is resolved at the Compose boundary so the model carries no English.
 */
data class LayoutMenuItem(
    val action: LayoutAction,
    val enabled: Boolean,
    val destructive: Boolean = false,
)

/**
 * The three mutually-exclusive top-level surfaces the composable renders. The switcher has no feed of its
 * own — its `dashboards` arrive as a prop — so a host normally supplies [Ready]; [Loading] and [Error] are
 * the lifecycle chrome the shared feature-view contract (P1/S8) carries while the layout list is loading or
 * failed, reproduced for full state coverage, never faked from a fetch the view performs itself. The empty
 * list is a [Ready] sub-case (the strip shows only the New Layout CTA, matching the web).
 */
enum class LayoutManagerSurfaceState { Loading, Error, Ready }

/**
 * Classifies the host lifecycle flags into the top-level [LayoutManagerSurfaceState] — the pure mirror of the
 * composable's `when` (loading first, then hard error, otherwise the ready strip). Kept framework-free so
 * each branch is asserted off-device.
 */
fun layoutManagerSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): LayoutManagerSurfaceState =
    when {
        isLoading -> LayoutManagerSurfaceState.Loading
        isError -> LayoutManagerSurfaceState.Error
        else -> LayoutManagerSurfaceState.Ready
    }

/**
 * The pure projection the composable renders — the native mirror of the web component's per-dashboard inline
 * decisions and its menu composition. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate.
 */
object LayoutManagerProjection {
    /**
     * Folds a layout [icon] to its display glyph exactly like the web `d.icon ?? '📊'`: the non-blank icon,
     * else [DEFAULT_LAYOUT_ICON]. A blank string is treated as absent to mirror the empty-string falsiness the
     * web `??` (with a trimmed value) relies on.
     */
    fun iconOrFallback(icon: String?): String = icon?.takeIf { it.isNotBlank() } ?: DEFAULT_LAYOUT_ICON

    /** The display name — rendered verbatim, with a blank value folded to an em dash so a chip is never empty. */
    fun displayName(name: String): String = name.ifBlank { EM_DASH }

    /**
     * Projects a single [dashboard] at [index] of a list of [count] into its render-ready [LayoutTabDisplay]
     * against the current [activeId]. Reproduces the web active-highlight (`d.id === activeId`), the default
     * tag (`d.isDefault`), the Delete guard (`disabled={!!isDefault}`), and the per-position move guards.
     */
    fun tab(
        dashboard: LayoutTab,
        activeId: String,
        index: Int,
        count: Int,
    ): LayoutTabDisplay =
        LayoutTabDisplay(
            id = dashboard.id,
            name = displayName(dashboard.name),
            icon = iconOrFallback(dashboard.icon),
            isActive = dashboard.id == activeId,
            isDefault = dashboard.isDefault,
            canDelete = !dashboard.isDefault,
            canMoveLeft = canMoveLeft(index),
            canMoveRight = canMoveRight(index, count),
        )

    /**
     * Projects the full strip — web `dashboards.map((d, i) => …)`. Each chip is mapped through [tab] with its
     * index/count so the move guards are correct, preserving the source order.
     */
    fun tabs(
        dashboards: List<LayoutTab>,
        activeId: String,
    ): List<LayoutTabDisplay> = dashboards.mapIndexed { index, dashboard -> tab(dashboard, activeId, index, dashboards.size) }

    /** Whether the strip has at least one chip (drives the empty-but-create-able branch). */
    fun hasTabs(dashboards: List<LayoutTab>): Boolean = dashboards.isNotEmpty()

    /** Whether a leftward reorder is possible — any chip but the first. */
    fun canMoveLeft(index: Int): Boolean = index > 0

    /** Whether a rightward reorder is possible — any chip but the last (and a valid, in-range index). */
    fun canMoveRight(
        index: Int,
        count: Int,
    ): Boolean = index in 0 until (count - 1)

    /**
     * The pure list-move the `onReorder(from, to)` contract realizes — moves the element at [from] to [to],
     * matching the web parent's reorder. Out-of-range or no-op (`from == to`) inputs return an unchanged copy,
     * so a stray callback can never corrupt the list.
     */
    fun <T> reorder(
        items: List<T>,
        from: Int,
        to: Int,
    ): List<T> {
        if (from !in items.indices || to !in items.indices || from == to) return items.toList()
        return items.toMutableList().also { it.add(to, it.removeAt(from)) }
    }

    /**
     * The context-menu composition for a chip — web `Rename / Duplicate / Settings / (divider) / Delete`,
     * plus the two reorder actions that realize the web drag. Delete is destructive and disabled for the
     * default layout (`disabled={!!ctxDash.isDefault}`); the move actions are enabled per the chip's position.
     */
    fun menuItems(display: LayoutTabDisplay): List<LayoutMenuItem> =
        listOf(
            LayoutMenuItem(LayoutAction.Rename, enabled = true),
            LayoutMenuItem(LayoutAction.Duplicate, enabled = true),
            LayoutMenuItem(LayoutAction.Settings, enabled = true),
            LayoutMenuItem(LayoutAction.MoveLeft, enabled = display.canMoveLeft),
            LayoutMenuItem(LayoutAction.MoveRight, enabled = display.canMoveRight),
            LayoutMenuItem(LayoutAction.Delete, enabled = display.canDelete, destructive = true),
        )

    /**
     * The rename-commit decision — web `if (editingId && editName.trim()) onRename(editingId, editName.trim())`.
     * Returns the trimmed name to commit, or `null` when the draft is blank (the editor closes without saving).
     */
    fun renameCommit(draft: String): String? = draft.trim().takeIf { it.isNotEmpty() }

    /**
     * The create-commit decision — web `if (newName.trim()) onCreate(newName.trim())`. Returns the trimmed
     * name to create, or `null` when the draft is blank.
     */
    fun createCommit(draft: String): String? = draft.trim().takeIf { it.isNotEmpty() }

    /**
     * Whether tapping "New Layout" opens the template gallery instead of the inline create editor — web
     * `if (onOpenTemplates) { onOpenTemplates(); return; }`. True exactly when the host supplied the callback.
     */
    fun startCreateOpensTemplates(hasOpenTemplates: Boolean): Boolean = hasOpenTemplates
}

// ── i18n key mirrors (P1/S10) ─────────────────────────────────────────────────────────────────────────────
// The web component reads these via `useTranslation('dashboard')` + `t('dashboard.<k>', '<default>')`. The
// `dashboard.<k>` keys all exist in the generated catalog and resolve at compile time through `R.string`.

/** `dashboard.rename` — Rename menu action. */
const val KEY_RENAME: String = "translation_dashboard_rename"

/** `dashboard.duplicate` — Duplicate menu action. */
const val KEY_DUPLICATE: String = "translation_dashboard_duplicate"

/** `dashboard.settings` — Settings menu action. */
const val KEY_SETTINGS: String = "translation_dashboard_settings"

/** `dashboard.delete` — Delete menu action (destructive). */
const val KEY_DELETE: String = "translation_dashboard_delete"

/** `dashboard.default` — the protected-layout tag. */
const val KEY_DEFAULT: String = "translation_dashboard_default"

/** `dashboard.newLayout` — the trailing create affordance label. */
const val KEY_NEW_LAYOUT: String = "translation_dashboard_newLayout"

/** `dashboard.newName` — the inline create field prompt ("Layout name..."). */
const val KEY_NEW_NAME: String = "translation_dashboard_newName"

/** `dashboard.confirmRename` — the rename confirm (check) accessible label. */
const val KEY_CONFIRM_RENAME: String = "translation_dashboard_confirmRename"

/** `dashboard.cancelRename` — the rename cancel (x) accessible label. */
const val KEY_CANCEL_RENAME: String = "translation_dashboard_cancelRename"

/** `dashboard.confirmCreate` — the create confirm (check) accessible label. */
const val KEY_CONFIRM_CREATE: String = "translation_dashboard_confirmCreate"

/** `dashboard.cancelCreate` — the create cancel (x) accessible label. */
const val KEY_CANCEL_CREATE: String = "translation_dashboard_cancelCreate"

/** Resource name (by-name; absent ⇒ [LayoutManagerDefaults.MOVE_LEFT]) for the reorder-left action. */
const val KEY_MOVE_LEFT: String = "translation_dashboard_moveLeft"

/** Resource name (by-name; absent ⇒ [LayoutManagerDefaults.MOVE_RIGHT]) for the reorder-right action. */
const val KEY_MOVE_RIGHT: String = "translation_dashboard_moveRight"

/** Resource name (by-name; absent ⇒ [LayoutManagerDefaults.OPTIONS]) for the chip long-press discoverability hint. */
const val KEY_OPTIONS: String = "translation_dashboard_options"

/**
 * Native fallback microcopy. The web component's eleven `dashboard.*` strings exist in the catalog (P1/S10)
 * and resolve at compile time; these defaults back the labels the platform-native affordances need that the
 * web source — being HTML5 drag + right-click, neither of which is labeled — never names: the two reorder
 * actions and the long-press discoverability hint. They are resolved through the same `t(key, default)`
 * by-name path the web uses everywhere (and the sibling XRayControls port uses for its no-vehicles hint), so
 * a translator can add the keys later without a code change.
 */
object LayoutManagerDefaults {
    /** Reorder-left action label fallback. */
    const val MOVE_LEFT: String = "Move left"

    /** Reorder-right action label fallback. */
    const val MOVE_RIGHT: String = "Move right"

    /** Chip long-press hint fallback (TalkBack reads it as the long-press action name). */
    const val OPTIONS: String = "Options"
}

/**
 * The already-localized strings the surface renders, resolved through the i18n facade (P1/S10) at the Compose
 * boundary and passed in so the surface itself carries no English literal. The eleven `dashboard.*` strings
 * resolve through compile-time `R.string`; [moveLeft] / [moveRight] / [options] resolve by-name with the
 * [LayoutManagerDefaults] fallbacks (web `t(key, default)` semantics).
 */
data class LayoutManagerStrings(
    val rename: String,
    val duplicate: String,
    val settings: String,
    val delete: String,
    val default: String,
    val newLayout: String,
    val newName: String,
    val confirmRename: String,
    val cancelRename: String,
    val confirmCreate: String,
    val cancelCreate: String,
    val moveLeft: String,
    val moveRight: String,
    val options: String,
) {
    /** Resolves the localized label for a context-menu [action]. */
    fun labelFor(action: LayoutAction): String =
        when (action) {
            LayoutAction.Rename -> rename
            LayoutAction.Duplicate -> duplicate
            LayoutAction.Settings -> settings
            LayoutAction.MoveLeft -> moveLeft
            LayoutAction.MoveRight -> moveRight
            LayoutAction.Delete -> delete
        }
}

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests,
 * so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a layout
 * name or id, which can encode how an operator organizes their fleet — so a diagnostics line can never leak
 * which layouts exist or which one was opened.
 */
object LayoutManagerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = LayoutManagerRegistration.SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
