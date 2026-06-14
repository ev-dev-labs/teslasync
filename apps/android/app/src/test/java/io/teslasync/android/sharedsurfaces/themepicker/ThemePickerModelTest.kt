// Pure off-device unit tests for the ThemePicker model — the catalogues, the projection, the ARGB colour
// round-trip, and the PII-safe diagnostics. Framework-free; runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.themepicker

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemePickerModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    @Test
    fun catalogueMirrorsTheWebThemeProvider() {
        // Five brand accent themes (web `themes` minus the synthetic custom) and seven display modes.
        assertEquals(5, ThemeCatalog.THEMES.size)
        assertEquals(7, ThemeCatalog.MODES.size)
        val themeIds = ThemeCatalog.THEMES.map { it.id }
        assertEquals(listOf("neon-cyan", "tesla-red", "matrix-green", "royal-purple", "solar-amber"), themeIds)
        val modeIds = ThemeCatalog.MODES.map { it.id }
        assertEquals(listOf("dark", "light", "oled", "midnight", "auto", "sunset", "nord"), modeIds)
    }

    @Test
    fun neonCyanPrimaryMatchesTheWebHex() {
        val neon = ThemeCatalog.THEMES.first { it.id == "neon-cyan" }
        assertEquals(0xFF00F0FF, neon.primary)
        assertEquals("#00F0FF", ThemeColor.hex(neon.primary))
        assertEquals(0xFF4F46E5, neon.accent)
    }

    @Test
    fun everyModeExposesItsFourSwatchStrip() {
        ThemeCatalog.MODES.forEach { mode ->
            assertEquals(4, mode.swatches.size)
            assertEquals(listOf(mode.bg, mode.surface1, mode.surface2, mode.surface3), mode.swatches)
        }
    }

    @Test
    fun projectFoldsSelectionWithTheStaticCatalogues() {
        val data = ThemeCatalog.project(ThemePickerRegistration.DEFAULTS)
        assertEquals(5, data.themes.size)
        assertEquals(7, data.modes.size)
        assertEquals("neon-cyan", data.selection.themeId)
        assertTrue(data.isThemeSelected("neon-cyan"))
        assertFalse(data.isThemeSelected("tesla-red"))
        assertTrue(data.isModeSelected("dark"))
        assertFalse(data.isModeSelected("light"))
        assertFalse(data.isCustomSelected)
        assertFalse(data.isEmpty)
    }

    @Test
    fun customSelectionIsDetectedAndBuildsACustomTheme() {
        val selection = ThemePickerRegistration.DEFAULTS.copy(themeId = "custom")
        val data = ThemeCatalog.project(selection)
        assertTrue(data.isCustomSelected)
        val custom = data.customTheme("Custom")
        assertEquals("custom", custom.id)
        assertEquals("Custom", custom.name)
        assertEquals(ThemePickerRegistration.DEFAULT_CUSTOM_PRIMARY, custom.primary)
        assertEquals(ThemePickerRegistration.DEFAULT_CUSTOM_ACCENT, custom.accent)
    }

    @Test
    fun emptyCatalogueIsTheDefensiveEmptyBranch() {
        val data = ThemePickerData(ThemePickerRegistration.DEFAULTS, emptyList(), emptyList())
        assertTrue(data.isEmpty)
    }

    @Test
    fun colourChannelsDecomposeAndRecompose() {
        val color = 0xFF12_34_56
        assertEquals(0x12, ThemeColor.red(color))
        assertEquals(0x34, ThemeColor.green(color))
        assertEquals(0x56, ThemeColor.blue(color))
        assertEquals(color, ThemeColor.fromRgb(0x12, 0x34, 0x56))
    }

    @Test
    fun fromRgbCoercesOutOfRangeChannels() {
        assertEquals(0xFFFFFFFF, ThemeColor.fromRgb(999, 999, 999))
        assertEquals(0xFF000000, ThemeColor.fromRgb(-5, -5, -5))
    }

    @Test
    fun hexFormatsUppercaseRgb() {
        assertEquals("#00B4D8", ThemeColor.hex(ThemePickerRegistration.DEFAULT_CUSTOM_PRIMARY))
        assertEquals("#E63946", ThemeColor.hex(ThemePickerRegistration.DEFAULT_CUSTOM_ACCENT))
    }

    @Test
    fun parseHexRoundTripsAndFallsBackOnGarbage() {
        assertEquals(0xFF00B4D8, ThemeColor.parseHex("#00b4d8", fallback = 0))
        assertEquals(0xFF00B4D8, ThemeColor.parseHex("00B4D8", fallback = 0))
        assertEquals(0xFF00B4D8, ThemeColor.parseHex("#FF00B4D8", fallback = 0))
        assertEquals(0xFFE63946, ThemeColor.parseHex("not-a-color", fallback = 0xFFE63946))
    }

    @Test
    fun recordViewOpenedCarriesOnlyTheSurfaceSlug() {
        val logger = RecordingLogger()

        recordThemePickerOpened(logger)

        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(EVENT_VIEW_OPENED, record.event)
        assertEquals(mapOf(FIELD_SURFACE to "ThemePicker"), record.fields)
    }

    @Test
    fun registrationExposesStableIdsAndDefaults() {
        assertEquals("ThemePicker", ThemePickerRegistration.SLUG)
        assertTrue(ThemePickerRegistration.ID.isNotBlank())
        assertEquals("neon-cyan", ThemePickerRegistration.DEFAULTS.themeId)
        assertEquals("dark", ThemePickerRegistration.DEFAULTS.modeId)
        assertNotNull(SURFACE_FIELD[FIELD_SURFACE])
    }
}
