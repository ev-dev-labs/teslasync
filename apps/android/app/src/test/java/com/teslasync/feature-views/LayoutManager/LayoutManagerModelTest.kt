// Off-device unit coverage for the dashboard LayoutManager feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the chip projection (the web per-dashboard inline decisions), the
// icon / blank-name folds, the per-position delete + move guards, the list-move semantics the onReorder
// contract realizes, the context-menu composition (Delete destructive + default-protected; move actions gated
// by position), the rename/create commit decisions, the New-Layout-opens-templates branch, the top-level
// lifecycle classifier the composable switches on (per-state coverage), the i18n key mirrors (a11y label
// coverage), and the `t(key, default)` resolver. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.layoutmanager

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LayoutManagerModelTest {
    private val sample =
        listOf(
            LayoutTab(id = "overview", name = "Overview", icon = "\uD83D\uDCCA", isDefault = true),
            LayoutTab(id = "charging", name = "Charging", icon = "\u26A1"),
            LayoutTab(id = "trips", name = "Road Trips", icon = null),
        )

    @Test
    fun iconFallsBackToDefaultGlyphWhenBlankOrAbsent() {
        assertEquals("\u26A1", LayoutManagerProjection.iconOrFallback("\u26A1"))
        assertEquals(DEFAULT_LAYOUT_ICON, LayoutManagerProjection.iconOrFallback(null))
        assertEquals(DEFAULT_LAYOUT_ICON, LayoutManagerProjection.iconOrFallback(""))
        assertEquals(DEFAULT_LAYOUT_ICON, LayoutManagerProjection.iconOrFallback("   "))
    }

    @Test
    fun displayNameFoldsBlankToEmDash() {
        assertEquals("Overview", LayoutManagerProjection.displayName("Overview"))
        assertEquals("\u2014", LayoutManagerProjection.displayName(""))
        assertEquals("\u2014", LayoutManagerProjection.displayName("   "))
    }

    @Test
    fun tabProjectsActiveDefaultAndPositionGuards() {
        val first = LayoutManagerProjection.tab(sample[0], activeId = "overview", index = 0, count = sample.size)
        assertEquals("overview", first.id)
        assertEquals("Overview", first.name)
        assertEquals("\uD83D\uDCCA", first.icon)
        assertTrue(first.isActive)
        assertTrue(first.isDefault)
        assertFalse("default layout cannot be deleted", first.canDelete)
        assertFalse("first chip cannot move left", first.canMoveLeft)
        assertTrue(first.canMoveRight)

        val last = LayoutManagerProjection.tab(sample[2], activeId = "overview", index = 2, count = sample.size)
        assertFalse(last.isActive)
        assertFalse(last.isDefault)
        assertTrue("non-default layout can be deleted", last.canDelete)
        assertTrue(last.canMoveLeft)
        assertFalse("last chip cannot move right", last.canMoveRight)
        assertEquals("Road Trips", last.name)
        assertEquals(DEFAULT_LAYOUT_ICON, last.icon)
    }

    @Test
    fun tabsPreserveOrderAndMarkOnlyTheActiveChip() {
        val tabs = LayoutManagerProjection.tabs(sample, activeId = "charging")
        assertEquals(listOf("overview", "charging", "trips"), tabs.map { it.id })
        assertEquals(listOf(false, true, false), tabs.map { it.isActive })
        assertEquals(listOf(false, true, true), tabs.map { it.canMoveLeft })
        assertEquals(listOf(true, true, false), tabs.map { it.canMoveRight })
    }

    @Test
    fun hasTabsReflectsTheList() {
        assertFalse(LayoutManagerProjection.hasTabs(emptyList()))
        assertTrue(LayoutManagerProjection.hasTabs(sample))
    }

    @Test
    fun moveGuardsRespectBounds() {
        assertFalse(LayoutManagerProjection.canMoveLeft(0))
        assertTrue(LayoutManagerProjection.canMoveLeft(1))
        assertTrue(LayoutManagerProjection.canMoveRight(0, 3))
        assertFalse(LayoutManagerProjection.canMoveRight(2, 3))
        assertFalse("single chip cannot move right", LayoutManagerProjection.canMoveRight(0, 1))
    }

    @Test
    fun reorderMovesElementAndIsNoOpSafe() {
        val ids = sample.map { it.id }
        assertEquals(listOf("charging", "overview", "trips"), LayoutManagerProjection.reorder(ids, 0, 1))
        assertEquals(listOf("trips", "overview", "charging"), LayoutManagerProjection.reorder(ids, 2, 0))
        // No-op and out-of-range inputs return an unchanged copy rather than corrupting the list.
        assertEquals(ids, LayoutManagerProjection.reorder(ids, 1, 1))
        assertEquals(ids, LayoutManagerProjection.reorder(ids, -1, 0))
        assertEquals(ids, LayoutManagerProjection.reorder(ids, 0, 5))
    }

    @Test
    fun menuItemsMirrorTheWebMenuPlusReorderRealization() {
        val defaultChip = LayoutManagerProjection.tab(sample[0], activeId = "overview", index = 0, count = 3)
        val items = LayoutManagerProjection.menuItems(defaultChip)
        assertEquals(
            listOf(
                LayoutAction.Rename,
                LayoutAction.Duplicate,
                LayoutAction.Settings,
                LayoutAction.MoveLeft,
                LayoutAction.MoveRight,
                LayoutAction.Delete,
            ),
            items.map { it.action },
        )
        // Delete is destructive and disabled for the default layout (web `disabled={!!isDefault}`).
        val delete = items.single { it.action == LayoutAction.Delete }
        assertTrue(delete.destructive)
        assertFalse(delete.enabled)
        // First chip: move-left disabled, move-right enabled.
        assertFalse(items.single { it.action == LayoutAction.MoveLeft }.enabled)
        assertTrue(items.single { it.action == LayoutAction.MoveRight }.enabled)
        // Only Delete is destructive.
        assertEquals(1, items.count { it.destructive })
    }

    @Test
    fun menuItemsEnableDeleteForNonDefaultLayouts() {
        val middle = LayoutManagerProjection.tab(sample[1], activeId = "overview", index = 1, count = 3)
        val items = LayoutManagerProjection.menuItems(middle)
        assertTrue(items.single { it.action == LayoutAction.Delete }.enabled)
        assertTrue(items.single { it.action == LayoutAction.MoveLeft }.enabled)
        assertTrue(items.single { it.action == LayoutAction.MoveRight }.enabled)
    }

    @Test
    fun renameCommitTrimsAndRejectsBlank() {
        assertEquals("Trips", LayoutManagerProjection.renameCommit("  Trips  "))
        assertNull(LayoutManagerProjection.renameCommit(""))
        assertNull(LayoutManagerProjection.renameCommit("   "))
    }

    @Test
    fun createCommitTrimsAndRejectsBlank() {
        assertEquals("Weekend", LayoutManagerProjection.createCommit("Weekend"))
        assertEquals("Weekend", LayoutManagerProjection.createCommit("  Weekend "))
        assertNull(LayoutManagerProjection.createCommit("   "))
    }

    @Test
    fun startCreateOpensTemplatesOnlyWhenHostProvidesTheCallback() {
        assertTrue(LayoutManagerProjection.startCreateOpensTemplates(hasOpenTemplates = true))
        assertFalse(LayoutManagerProjection.startCreateOpensTemplates(hasOpenTemplates = false))
    }

    @Test
    fun surfaceForMapsLifecycleFlags() {
        assertEquals(LayoutManagerSurfaceState.Loading, layoutManagerSurfaceFor(isLoading = true, isError = false))
        assertEquals(LayoutManagerSurfaceState.Error, layoutManagerSurfaceFor(isLoading = false, isError = true))
        assertEquals(LayoutManagerSurfaceState.Loading, layoutManagerSurfaceFor(isLoading = true, isError = true))
        assertEquals(LayoutManagerSurfaceState.Ready, layoutManagerSurfaceFor(isLoading = false, isError = false))
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(LayoutManagerSurfaceState.Loading, surfaceFor(UiState.loading<List<LayoutTab>>()))
        val error = UiState<List<LayoutTab>>(UiPhase.Error, errorKind = ErrorKind.Network)
        assertEquals(LayoutManagerSurfaceState.Error, surfaceFor(error))
        assertEquals(LayoutManagerSurfaceState.Ready, surfaceFor(UiState(UiPhase.Content, data = sample)))
        // Empty resolves to Ready: the strip still offers the New Layout CTA (web parity), never a blank box.
        assertEquals(LayoutManagerSurfaceState.Ready, surfaceFor(UiState(UiPhase.Empty, data = emptyList<LayoutTab>())))
        // Offline: cached layouts shown while stale + errored — still Ready, with a freshness chip.
        val offline = UiState(UiPhase.Content, data = sample, stale = true, errorKind = ErrorKind.Network)
        assertEquals(LayoutManagerSurfaceState.Ready, surfaceFor(offline))
        assertTrue(offline.isOffline)
    }

    @Test
    fun accessibleAndVisibleKeysMirrorTheWebDashboardNamespace() {
        assertEquals("translation_dashboard_rename", KEY_RENAME)
        assertEquals("translation_dashboard_duplicate", KEY_DUPLICATE)
        assertEquals("translation_dashboard_settings", KEY_SETTINGS)
        assertEquals("translation_dashboard_delete", KEY_DELETE)
        assertEquals("translation_dashboard_default", KEY_DEFAULT)
        assertEquals("translation_dashboard_newLayout", KEY_NEW_LAYOUT)
        assertEquals("translation_dashboard_newName", KEY_NEW_NAME)
        assertEquals("translation_dashboard_confirmRename", KEY_CONFIRM_RENAME)
        assertEquals("translation_dashboard_cancelRename", KEY_CANCEL_RENAME)
        assertEquals("translation_dashboard_confirmCreate", KEY_CONFIRM_CREATE)
        assertEquals("translation_dashboard_cancelCreate", KEY_CANCEL_CREATE)
    }

    @Test
    fun fallbackKeysAndDefaultsBackThePlatformNativeAffordances() {
        assertEquals("translation_dashboard_moveLeft", KEY_MOVE_LEFT)
        assertEquals("translation_dashboard_moveRight", KEY_MOVE_RIGHT)
        assertEquals("translation_dashboard_options", KEY_OPTIONS)
        assertFalse(LayoutManagerDefaults.MOVE_LEFT.isBlank())
        assertFalse(LayoutManagerDefaults.MOVE_RIGHT.isBlank())
        assertFalse(LayoutManagerDefaults.OPTIONS.isBlank())
        assertEquals("LayoutManager", LayoutManagerRegistration.SLUG)
        assertEquals("LayoutManager", LayoutManagerDiagnostics.SLUG)
    }

    @Test
    fun resolveOptionalReturnsLookupWhenPresentElseFallback() {
        val present: (String) -> String? = mapOf(KEY_MOVE_LEFT to "Move left")::get
        assertEquals("Move left", resolveOptional(present, KEY_MOVE_LEFT, LayoutManagerDefaults.MOVE_LEFT))
        assertEquals(LayoutManagerDefaults.MOVE_RIGHT, resolveOptional({ null }, KEY_MOVE_RIGHT, LayoutManagerDefaults.MOVE_RIGHT))
        assertEquals(LayoutManagerDefaults.OPTIONS, resolveOptional({ "  " }, KEY_OPTIONS, LayoutManagerDefaults.OPTIONS))
    }

    @Test
    fun stringsResolveLabelForEveryMenuAction() {
        val strings =
            LayoutManagerStrings(
                rename = "Rename",
                duplicate = "Duplicate",
                settings = "Settings",
                delete = "Delete",
                default = "default",
                newLayout = "New Layout",
                newName = "Layout name...",
                confirmRename = "Confirm rename",
                cancelRename = "Cancel rename",
                confirmCreate = "Confirm create",
                cancelCreate = "Cancel create",
                moveLeft = "Move left",
                moveRight = "Move right",
                options = "Options",
            )
        assertEquals("Rename", strings.labelFor(LayoutAction.Rename))
        assertEquals("Duplicate", strings.labelFor(LayoutAction.Duplicate))
        assertEquals("Settings", strings.labelFor(LayoutAction.Settings))
        assertEquals("Move left", strings.labelFor(LayoutAction.MoveLeft))
        assertEquals("Move right", strings.labelFor(LayoutAction.MoveRight))
        assertEquals("Delete", strings.labelFor(LayoutAction.Delete))
    }

    /** Bridges a [UiState] to the composable's classifier the same way `LayoutManagerContent` does. */
    private fun surfaceFor(state: UiState<*>): LayoutManagerSurfaceState =
        layoutManagerSurfaceFor(isLoading = state.isLoading, isError = state.isError)
}
