package io.teslasync.android.sharedsurfaces.themeprovider

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the pure [ThemeProviderProjection] + model — the cached → projection adapter
 * test the prompt mandates. Covers the web provider's `hexToRGB`, the exact `themes`/`modes` catalogues, the
 * `buildCustomTheme` + `currentThemes` builder, the `resolvedMode` auto rule, the settings-document parse
 * (mount `useEffect`) + merge (`saveThemeToBackend`), the cache-then-network freshness fold (live/stale/
 * offline), the shared QueryError recovery bucket, and the presence of every accessibility label. No Android,
 * no coroutines.
 */
class ThemeProviderProjectionTest {
    private val defaults = ThemeProviderRegistration.DEFAULTS

    @Test
    fun hexToRgbDecomposesChannelsLikeTheWebHelper() {
        assertEquals(Rgb(0, 240, 255), ThemeProviderProjection.hexToRgb("#00f0ff"))
        assertEquals(Rgb(0, 180, 216), ThemeProviderProjection.hexToRgb("#00b4d8"))
        assertEquals("0, 180, 216", ThemeProviderProjection.hexToRgb("#00b4d8").css)
    }

    @Test
    fun toArgbConvertsHexAndRgbaToPackedColor() {
        assertEquals(0xFF00F0FFL, ThemeProviderProjection.toArgb("#00f0ff"))
        assertEquals(0xFF10B981L, ThemeProviderProjection.toArgb("rgb(16, 185, 129)"))
        // rgba alpha 0.04 → round(10.2) = 10 = 0x0A.
        assertEquals(0x0AFFFFFFL, ThemeProviderProjection.toArgb("rgba(255, 255, 255, 0.04)"))
        // rgba alpha 0.8 → round(204) = 204 = 0xCC.
        assertEquals(0xCCFFFFFFL, ThemeProviderProjection.toArgb("rgba(255, 255, 255, 0.8)"))
    }

    @Test
    fun themeCatalogPinsTheWebColours() {
        val neon = ThemeProviderProjection.themes.getValue(ThemeId.NeonCyan)
        assertEquals("#00f0ff", neon.primary)
        assertEquals("0, 240, 255", neon.primaryRgb.css)
        assertEquals("#4f46e5", neon.accent)
        assertEquals("Neon Cyan", neon.name)
        // neon-cyan / tesla-red / matrix-green / royal-purple / solar-amber / custom.
        assertEquals(6, ThemeProviderProjection.themes.size)
    }

    @Test
    fun modeCatalogPinsTheWebColoursAndScheme() {
        assertEquals("#0a0a0f", ThemeProviderProjection.modes.getValue(ModeId.Dark).bg)
        assertEquals("OLED Black", ThemeProviderProjection.modes.getValue(ModeId.Oled).name)
        assertFalse(ThemeProviderProjection.modes.getValue(ModeId.Light).dark)
        assertTrue(ThemeProviderProjection.modes.getValue(ModeId.Nord).dark)
        // dark / light / oled / midnight / auto / sunset / nord.
        assertEquals(7, ThemeProviderProjection.modes.size)
    }

    @Test
    fun buildCustomThemeUsesTheSuppliedColours() {
        val custom = ThemeProviderProjection.buildCustomTheme("#112233", "#445566")
        assertEquals(ThemeId.Custom, custom.id)
        assertEquals("#112233", custom.primary)
        assertEquals(Rgb(0x11, 0x22, 0x33), custom.primaryRgb)
        assertEquals("#445566", custom.accent)
    }

    @Test
    fun themesForOverridesCustomWithTheSelectionColours() {
        val selection = defaults.copy(themeId = ThemeId.Custom, customPrimary = "#abcdef", customAccent = "#123456")
        val custom = ThemeProviderProjection.themesFor(selection).getValue(ThemeId.Custom)
        assertEquals("#abcdef", custom.primary)
        assertEquals("#123456", custom.accent)
    }

    @Test
    fun resolveThemePicksCustomOrCatalogEntry() {
        val custom = defaults.copy(themeId = ThemeId.Custom, customPrimary = "#0a0b0c", customAccent = "#0d0e0f")
        assertEquals("#0a0b0c", ThemeProviderProjection.resolveTheme(custom).primary)
        assertEquals("Tesla Red", ThemeProviderProjection.resolveTheme(defaults.copy(themeId = ThemeId.TeslaRed)).name)
    }

    @Test
    fun resolveModeFollowsSystemForAutoAndCatalogOtherwise() {
        val auto = defaults.copy(modeId = ModeId.Auto)
        assertEquals(ModeId.Dark, ThemeProviderProjection.resolveMode(auto, systemDark = true).id)
        assertEquals(ModeId.Light, ThemeProviderProjection.resolveMode(auto, systemDark = false).id)
        assertEquals(ModeId.Nord, ThemeProviderProjection.resolveMode(defaults.copy(modeId = ModeId.Nord), systemDark = true).id)
    }

    @Test
    fun resolveProducesAnAppliedLabel() {
        val resolution = ThemeProviderProjection.resolve(defaults, systemDark = true)
        assertEquals("Neon Cyan · Dark", resolution.label)
    }

    @Test
    fun parseSelectionAdoptsRecognisedThemeModeAndCustomColours() {
        val doc =
            buildJsonObject {
                put("theme", "tesla-red")
                put("mode", "oled")
                put("custom_primary", "#101010")
                put("custom_accent", "#202020")
            }
        val parsed = ThemeProviderProjection.parseSelection(doc, defaults)
        assertEquals(ThemeId.TeslaRed, parsed.themeId)
        assertEquals(ModeId.Oled, parsed.modeId)
        assertEquals("#101010", parsed.customPrimary)
        assertEquals("#202020", parsed.customAccent)
    }

    @Test
    fun parseSelectionKeepsFallbackForUnknownOrPartialValues() {
        val unknown = buildJsonObject { put("theme", "rainbow") }
        assertEquals(defaults.themeId, ThemeProviderProjection.parseSelection(unknown, defaults).themeId)

        // Only one of the custom pair present ⇒ neither applies (web `if (primary && accent)`).
        val halfCustom = buildJsonObject { put("custom_primary", "#999999") }
        assertEquals(defaults.customPrimary, ThemeProviderProjection.parseSelection(halfCustom, defaults).customPrimary)

        assertEquals(defaults, ThemeProviderProjection.parseSelection(null, defaults))
    }

    @Test
    fun hasThemeSettingsIsTrueOnlyForARecognisedThemeOrMode() {
        assertTrue(ThemeProviderProjection.hasThemeSettings(buildJsonObject { put("theme", "neon-cyan") }))
        assertTrue(ThemeProviderProjection.hasThemeSettings(buildJsonObject { put("mode", "dark") }))
        assertFalse(ThemeProviderProjection.hasThemeSettings(buildJsonObject { put("distance_unit", "mi") }))
        assertFalse(ThemeProviderProjection.hasThemeSettings(buildJsonObject { put("theme", "bogus") }))
        assertFalse(ThemeProviderProjection.hasThemeSettings(null))
    }

    @Test
    fun mergeSelectionPreservesOtherKeysAndWritesTheAppearanceFields() {
        val base = buildJsonObject { put("distance_unit", "mi") }
        val selection = defaults.copy(themeId = ThemeId.MatrixGreen, modeId = ModeId.Nord)
        val merged: JsonObject = ThemeProviderProjection.mergeSelection(base, selection)
        assertEquals("mi", merged["distance_unit"]?.jsonPrimitive?.content)
        assertEquals("matrix-green", merged["theme"]?.jsonPrimitive?.content)
        assertEquals("nord", merged["mode"]?.jsonPrimitive?.content)
        assertEquals(defaults.customPrimary, merged["custom_primary"]?.jsonPrimitive?.content)
    }

    @Test
    fun mergeSelectionStartsFromAnEmptyDocumentWhenSettingsAreAbsent() {
        val merged = ThemeProviderProjection.mergeSelection(null, defaults)
        assertEquals(JsonPrimitive("neon-cyan"), merged["theme"])
        assertEquals(JsonPrimitive("dark"), merged["mode"])
    }

    @Test
    fun wireTokensRoundTripForEveryThemeAndMode() {
        ThemeId.entries.forEach { assertEquals(it, ThemeId.fromWire(it.wire)) }
        ModeId.entries.forEach { assertEquals(it, ModeId.fromWire(it.wire)) }
        assertNull(ThemeId.fromWire("nope"))
        assertNull(ModeId.fromWire(null))
    }

    @Test
    fun freshnessFoldsLiveStaleAndOffline() {
        val live = UiState(UiPhase.Content, data = DOC, fetchedAt = STAMP)
        assertEquals(ThemeSyncFreshness.Live, ThemeProviderProjection.freshness(live))

        val stale = UiState(UiPhase.Content, data = DOC, fetchedAt = STAMP, stale = true, refreshing = true)
        assertEquals(ThemeSyncFreshness.Stale, ThemeProviderProjection.freshness(stale))

        val offline = UiState(UiPhase.Content, data = DOC, fetchedAt = STAMP, stale = true, errorKind = ErrorKind.Network)
        assertEquals(ThemeSyncFreshness.Offline, ThemeProviderProjection.freshness(offline))
    }

    @Test
    fun queryErrorKindMapsEveryFailureBucket() {
        assertEquals(QueryErrorKind.Waiting, ThemeProviderProjection.queryErrorKind(error(ErrorKind.CircuitOpen)))
        assertEquals(QueryErrorKind.Network, ThemeProviderProjection.queryErrorKind(error(ErrorKind.Network)))
        assertEquals(QueryErrorKind.Network, ThemeProviderProjection.queryErrorKind(error(ErrorKind.Timeout)))
        assertEquals(QueryErrorKind.Unauthorized, ThemeProviderProjection.queryErrorKind(error(ErrorKind.Http, status = 401)))
        assertEquals(QueryErrorKind.NotFound, ThemeProviderProjection.queryErrorKind(error(ErrorKind.Http, status = 404)))
        assertEquals(QueryErrorKind.ServerError, ThemeProviderProjection.queryErrorKind(error(ErrorKind.Http, status = 500)))
        assertEquals(QueryErrorKind.ServerError, ThemeProviderProjection.queryErrorKind(error(ErrorKind.Unknown)))
    }

    @Test
    fun stringsExposeAccessibilityLabelsForEveryInteractiveAffordance() {
        val labels = strings()
        assertTrue(labels.hasAccessibilityLabels)
        assertFalse(labels.copy(region = "", retry = "").hasAccessibilityLabels)
    }

    @Test
    fun registrationPinsTheDiagnosticsSlugAndDefaults() {
        assertEquals("ThemeProvider", ThemeProviderRegistration.SLUG)
        assertEquals(ThemeId.NeonCyan, ThemeProviderRegistration.DEFAULTS.themeId)
        assertEquals(ModeId.Dark, ThemeProviderRegistration.DEFAULTS.modeId)
        assertEquals("#00b4d8", ThemeProviderRegistration.DEFAULTS.customPrimary)
    }

    private fun error(
        kind: ErrorKind,
        status: Int? = null,
    ): UiState<JsonObject> = UiState(UiPhase.Error, errorKind = kind, httpStatus = status)

    private fun strings(): ThemeProviderStrings =
        ThemeProviderStrings(region = "Appearance", syncing = "Loading", stale = "Stale", offline = "Offline", retry = "Retry")

    private companion object {
        const val STAMP = 1_700_000_000_000L
        val DOC: JsonObject = buildJsonObject { put("theme", "neon-cyan") }
    }
}
