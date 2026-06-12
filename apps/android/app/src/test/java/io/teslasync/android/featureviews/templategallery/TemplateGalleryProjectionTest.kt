package io.teslasync.android.featureviews.templategallery

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the TemplateGallery's pure logic — the native analogue of the web component's
 * per-preset derivations (web/src/features/dashboard/components/TemplateGallery.tsx): the embedded preset
 * catalog + widget registry, the MiniGridPreview auto-flow layout (web `buildDefaultLayouts` at the `lg`
 * breakpoint), the `useCategoryIcons` de-duplication + cap, the widget count + detail widget list, the empty
 * guard, and the PII-safe `view.opened` diagnostic. Runs in the :android:testReleaseUnitTest gate.
 */
class TemplateGalleryProjectionTest {
    private val presetIdsInOrder =
        listOf(
            "default",
            "commuter",
            "fleet_manager",
            "data_nerd",
            "charging_focus",
            "security_monitor",
            "road_trip",
            "performance",
            "kiosk_wall",
            "minimal",
        )

    // ── Catalog integrity (web DASHBOARD_PRESETS parity) ─────────────────────────

    @Test
    fun catalogHasTenPresetsInDeclarationOrder() {
        assertEquals(presetIdsInOrder, DASHBOARD_PRESETS.map { it.id })
    }

    @Test
    fun everyPresetWidgetResolvesInTheRegistry() {
        val unresolved = DASHBOARD_PRESETS.flatMap { it.widgetIds }.filterNot { it in WIDGET_REGISTRY }
        assertTrue("unresolved widget ids: $unresolved", unresolved.isEmpty())
    }

    // ── Projection ──────────────────────────────────────────────────────────────

    @Test
    fun projectMapsCatalogPreservingOrder() {
        val result = TemplateGalleryProjection.project(DASHBOARD_PRESETS)

        assertFalse(result.isEmpty)
        assertEquals(presetIdsInOrder, result.templates.map { it.id })
    }

    @Test
    fun projectReturnsEmptyResultForNoTemplates() {
        val result = TemplateGalleryProjection.project(emptyList())

        assertTrue(result.isEmpty)
        assertTrue(result.templates.isEmpty())
    }

    @Test
    fun projectedTemplateCarriesCountFallbackNameAndKnownWidgets() {
        val minimal = TemplateGalleryProjection.projectTemplate(presetById("minimal"))

        // widgetCount mirrors web `template.widgets.length` (all four instances).
        assertEquals(4, minimal.widgetCount)
        assertEquals("Minimal", minimal.name)
        // The detail widget list keeps every resolved widget's icon + registry name, in order.
        assertEquals(
            listOf("Battery Radial Gauge", "Charge Status", "Climate", "Quick Navigation"),
            minimal.widgets.map { it.name },
        )
        assertEquals(
            listOf(
                WidgetIconKind.Battery,
                WidgetIconKind.Zap,
                WidgetIconKind.Thermometer,
                WidgetIconKind.MapPin,
            ),
            minimal.widgets.map { it.icon },
        )
    }

    @Test
    fun projectedTemplateDropsUnknownWidgetsFromDetailListButKeepsCount() {
        val template = DashboardTemplateData("custom", "Custom", listOf("battery-gauge", "nope", "quick-nav"))

        val projection = TemplateGalleryProjection.projectTemplate(template)

        // Count mirrors the instance list length (web `template.widgets.length`)…
        assertEquals(3, projection.widgetCount)
        // …but the detail list drops the unresolved id (web `if (!def) return null`).
        assertEquals(listOf("Battery Level", "Quick Navigation"), projection.widgets.map { it.name })
    }

    // ── Mini-grid layout (web buildDefaultLayouts at lg) ─────────────────────────

    @Test
    fun miniGridAutoFlowsAndWrapsAtFourColumns() {
        // minimal = [battery-radial-gauge 1×2, charge-status 2×2, climate-status 1×2, quick-nav 4×2]
        val grid = buildMiniGrid(presetById("minimal").widgetIds)

        assertEquals(GRID_COLS_LG, grid.cols)
        assertEquals(4, grid.maxY)
        assertEquals(
            listOf(
                GridTile(0, 0, 1, 2, WidgetIconKind.Battery),
                GridTile(1, 0, 2, 2, WidgetIconKind.Zap),
                GridTile(3, 0, 1, 2, WidgetIconKind.Thermometer),
                // quick-nav (w=4) overflows the first row and wraps to a fresh row below it.
                GridTile(0, 2, 4, 2, WidgetIconKind.MapPin),
            ),
            grid.tiles,
        )
    }

    @Test
    fun miniGridComputesTallGridHeightForTheDefaultPreset() {
        val grid = buildMiniGrid(presetById("default").widgetIds)

        // The 2×9 vehicle-hero pushes the flowed rows down; maxY matches the web safeMaxY.
        assertEquals(17, grid.maxY)
        assertEquals(GridTile(0, 0, 2, 4, WidgetIconKind.Rocket), grid.tiles.first())
    }

    @Test
    fun miniGridFallsBackForUnknownWidgetAndEmptyList() {
        val unknown = buildMiniGrid(listOf("nope"))
        assertEquals(listOf(GridTile(0, 0, 1, 1, null)), unknown.tiles)
        assertEquals(1, unknown.maxY)

        val empty = buildMiniGrid(emptyList())
        assertTrue(empty.tiles.isEmpty())
        assertEquals(DEFAULT_MAX_Y, empty.maxY)
    }

    // ── Category icons (web useCategoryIcons) ────────────────────────────────────

    @Test
    fun categoryIconsDeduplicateByCategoryUsingFirstWidgetIcon() {
        // recent-drives + drive-score are both Driving; the icon is the FIRST widget's (Car), not TrendingUp.
        val icons = categoryIcons(listOf("recent-drives", "drive-score"))

        assertEquals(1, icons.size)
        assertEquals(WidgetCategory.Driving, icons.single().category)
        assertEquals(WidgetIconKind.Car, icons.single().icon)
    }

    @Test
    fun categoryIconsSkipUnknownWidgets() {
        val icons = categoryIcons(listOf("nope", "battery-gauge"))

        assertEquals(listOf(CategoryIcon(WidgetCategory.Battery, WidgetIconKind.Battery)), icons)
    }

    @Test
    fun categoryIconsCapAtFiveUniqueCategories() {
        val sevenCategories =
            listOf(
                "vehicle-hero",
                "battery-gauge",
                "charge-status",
                "climate-status",
                "security-status",
                "location-map",
                "live-signals",
            )

        val icons = categoryIcons(sevenCategories)

        assertEquals(MAX_CATEGORY_ICONS, icons.size)
        assertEquals(
            listOf(
                WidgetCategory.Vehicle,
                WidgetCategory.Battery,
                WidgetCategory.Charging,
                WidgetCategory.Climate,
                WidgetCategory.Security,
            ),
            icons.map { it.category },
        )
    }

    @Test
    fun defaultPresetCategoryIconsAreCappedAndIconedByFirstWidget() {
        val projection = TemplateGalleryProjection.projectTemplate(presetById("default"))

        assertEquals(MAX_CATEGORY_ICONS, projection.categoryIcons.size)
        assertEquals(
            CategoryIcon(WidgetCategory.System, WidgetIconKind.Rocket),
            projection.categoryIcons.first(),
        )
    }

    // ── Diagnostics (P1/S11 view.opened contract) ───────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordTemplateGalleryOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "TemplateGallery"), fields)
    }

    @Test
    fun registrationExposesStableIdAndSlugAndBlankSentinel() {
        assertEquals("template-gallery", TemplateGalleryRegistration.ID)
        assertEquals("TemplateGallery", TemplateGalleryRegistration.SLUG)
        assertEquals("__blank__", BLANK_PRESET_ID)
        assertNull(WIDGET_REGISTRY[BLANK_PRESET_ID])
    }

    private fun presetById(id: String): DashboardTemplateData = DASHBOARD_PRESETS.single { it.id == id }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
