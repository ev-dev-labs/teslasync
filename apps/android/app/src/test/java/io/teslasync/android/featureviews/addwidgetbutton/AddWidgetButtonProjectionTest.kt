package io.teslasync.android.featureviews.addwidgetbutton

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the AddWidgetButton's pure logic — the native analogue of the web component's
 * only render decision (web/src/features/dashboard/components/AddWidgetButton.tsx): `isEditing ? null : FAB`.
 * Also pins the stable surface identifiers the diagnostics + UI test depend on. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class AddWidgetButtonProjectionTest {
    @Test
    fun notEditingProjectsTheVisibleFab() {
        val display = AddWidgetButtonProjection.project(isEditing = false)
        assertEquals(AddWidgetButtonSurface.Visible, display.surface)
        assertTrue(display.visible)
    }

    @Test
    fun editingProjectsTheHiddenSurface() {
        val display = AddWidgetButtonProjection.project(isEditing = true)
        assertEquals(AddWidgetButtonSurface.Hidden, display.surface)
        assertFalse(display.visible)
    }

    @Test
    fun registrationExposesStableIdSlugAndTestTag() {
        assertEquals("add-widget-button", AddWidgetButtonRegistration.ID)
        assertEquals("AddWidgetButton", AddWidgetButtonRegistration.SLUG)
        assertEquals("dashboard-add-widget-fab", AddWidgetButtonRegistration.TEST_TAG)
    }
}
