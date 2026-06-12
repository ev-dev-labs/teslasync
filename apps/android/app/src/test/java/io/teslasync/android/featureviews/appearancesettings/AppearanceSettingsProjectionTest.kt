package io.teslasync.android.featureviews.appearancesettings

import io.teslasync.shared.core.data.repo.Resource
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
 * Off-device coverage of the pure AppearanceSettings model — the enum vocabularies + web-faithful defaults, the
 * `/settings` document parse ([AppearanceSettingsProjection.parseServerPrefs]), the partial-merge builders
 * (`withDensity` / `withTimeFormat` / `withChartPalette`), the cache-then-network [projectResource] fold, the
 * chart-palette swatch lists, and the [resolveOptional] i18n fallback. Run by the offline
 * `:android:testReleaseUnitTest` gate.
 */
class AppearanceSettingsProjectionTest {
    // ── enum vocabularies ─────────────────────────────────────────────────────────
    @Test
    fun densityClassifiesKnownAndDefaultsToComfortable() {
        assertEquals(DensityId.Compact, DensityId.from("compact"))
        assertEquals(DensityId.Spacious, DensityId.from("spacious"))
        assertEquals(DensityId.Comfortable, DensityId.from(null))
        assertEquals(DensityId.Comfortable, DensityId.from("nonsense"))
    }

    @Test
    fun timeFormatClassifiesKnownAndDefaultsToRelative() {
        assertEquals(TimeFormatId.Absolute, TimeFormatId.from("absolute"))
        assertEquals(TimeFormatId.Relative, TimeFormatId.from(null))
        assertEquals(TimeFormatId.Relative, TimeFormatId.from("x"))
    }

    @Test
    fun chartPaletteClassifiesKnownAndDefaultsToCbSafe() {
        assertEquals(ChartPaletteId.Neon, ChartPaletteId.from("neon"))
        assertEquals(ChartPaletteId.CbSafe, ChartPaletteId.from(null))
        assertEquals(ChartPaletteId.CbSafe, ChartPaletteId.from("x"))
    }

    @Test
    fun sidebarStyleClassifiesKnownAndDefaultsToLinear() {
        assertEquals(SidebarStyle.Notion, SidebarStyle.from("notion"))
        assertEquals(SidebarStyle.Legacy, SidebarStyle.from("legacy"))
        assertEquals(SidebarStyle.Linear, SidebarStyle.from(null))
        assertEquals(SidebarStyle.Linear, SidebarStyle.from("x"))
    }

    @Test
    fun deviceLocalDefaultsMatchTheWebSource() {
        assertEquals(StatusBarPrefs(enabled = true, iconOnly = false), StatusBarPrefs())
        assertEquals(
            CelebrationPrefs(showToasts = true, playSound = false, showOnDashboard = true, pushOnUnlock = true),
            CelebrationPrefs(),
        )
    }

    // ── parseServerPrefs ──────────────────────────────────────────────────────────
    @Test
    fun parsesAllThreeFieldsAndFlagsPresent() {
        val prefs =
            AppearanceSettingsProjection.parseServerPrefs(
                buildJsonObject {
                    put("ui_density", "spacious")
                    put("time_format_default", "absolute")
                    put("chart_palette", "neon")
                },
            )
        assertEquals(DensityId.Spacious, prefs.density)
        assertEquals(TimeFormatId.Absolute, prefs.timeFormat)
        assertEquals(ChartPaletteId.Neon, prefs.chartPalette)
        assertTrue(prefs.present)
    }

    @Test
    fun emptyDocumentYieldsDefaultsAndNotPresent() {
        val prefs = AppearanceSettingsProjection.parseServerPrefs(buildJsonObject {})
        assertEquals(DensityId.Comfortable, prefs.density)
        assertEquals(TimeFormatId.Relative, prefs.timeFormat)
        assertEquals(ChartPaletteId.CbSafe, prefs.chartPalette)
        assertFalse(prefs.present)
    }

    @Test
    fun nullDocumentYieldsDefaultsAndNotPresent() {
        val prefs = AppearanceSettingsProjection.parseServerPrefs(null)
        assertEquals(DensityId.Comfortable, prefs.density)
        assertFalse(prefs.present)
    }

    @Test
    fun unrelatedKeysStillCountAsAbsentForAppearance() {
        val prefs = AppearanceSettingsProjection.parseServerPrefs(buildJsonObject { put("locale", "en-US") })
        assertFalse(prefs.present)
        assertEquals(DensityId.Comfortable, prefs.density)
    }

    // ── partial-merge builders ──────────────────────────────────────────────────────
    @Test
    fun withDensityOverwritesOnlyDensityAndKeepsOtherKeys() {
        val original =
            buildJsonObject {
                put("ui_density", "comfortable")
                put("locale", "en-US")
                put("chart_palette", "cb_safe")
            }
        val merged = AppearanceSettingsProjection.withDensity(original, DensityId.Spacious)
        assertEquals("spacious", merged["ui_density"]?.jsonPrimitive?.content)
        assertEquals("en-US", merged["locale"]?.jsonPrimitive?.content)
        assertEquals("cb_safe", merged["chart_palette"]?.jsonPrimitive?.content)
    }

    @Test
    fun withTimeFormatAndChartPaletteWriteTheirOwnKey() {
        val time = AppearanceSettingsProjection.withTimeFormat(buildJsonObject {}, TimeFormatId.Absolute)
        assertEquals("absolute", time["time_format_default"]?.jsonPrimitive?.content)
        val palette = AppearanceSettingsProjection.withChartPalette(buildJsonObject {}, ChartPaletteId.Neon)
        assertEquals("neon", palette["chart_palette"]?.jsonPrimitive?.content)
    }

    @Test
    fun mergeFromNullStartsFromAnEmptyObject() {
        val merged = AppearanceSettingsProjection.withDensity(null, DensityId.Compact)
        assertEquals("compact", merged["ui_density"]?.jsonPrimitive?.content)
        assertEquals(1, merged.size)
    }

    // ── projectResource fold ────────────────────────────────────────────────────────
    @Test
    fun projectSuccessMapsDataAndKeepsFreshness() {
        val resource =
            Resource.Success(buildJsonObject { put("ui_density", "compact") }, fetchedAt = 42L, stale = false)
        val projected = AppearanceSettingsProjection.projectResource(resource)
        assertTrue(projected is Resource.Success)
        projected as Resource.Success
        assertEquals(DensityId.Compact, projected.cached.density)
        assertEquals(42L, projected.fetchedAt)
    }

    @Test
    fun projectErrorKeepsCachedAndStale() {
        val resource =
            Resource.Error(
                cached = buildJsonObject { put("chart_palette", "neon") },
                fetchedAt = 7L,
                stale = true,
                error = RuntimeException("x"),
            )
        val projected = AppearanceSettingsProjection.projectResource(resource)
        assertTrue(projected is Resource.Error)
        assertEquals(ChartPaletteId.Neon, projected.cached!!.chartPalette)
        assertTrue(projected.stale)
    }

    @Test
    fun projectLoadingWithNoCacheStaysNull() {
        val projected =
            AppearanceSettingsProjection.projectResource(Resource.Loading(cached = null, fetchedAt = null, stale = false))
        assertTrue(projected is Resource.Loading)
        assertNull(projected.cached)
    }

    // ── swatches ──────────────────────────────────────────────────────────────────
    @Test
    fun swatchesMatchTheWebPalettes() {
        assertEquals(8, AppearanceSettingsProjection.swatchesFor(ChartPaletteId.CbSafe).size)
        assertEquals(8, AppearanceSettingsProjection.swatchesFor(ChartPaletteId.Neon).size)
        assertEquals("#0072B2", AppearanceSettingsProjection.swatchesFor(ChartPaletteId.CbSafe).first())
        assertEquals("#00f0ff", AppearanceSettingsProjection.swatchesFor(ChartPaletteId.Neon).first())
    }

    // ── resolveOptional i18n fallback ─────────────────────────────────────────────
    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresentElseFallback() {
        val catalog = mapOf(AppearanceSettingsKeys.SIDEBAR_LABEL to "Barra lateral")
        assertEquals(
            "Barra lateral",
            resolveOptional(catalog::get, AppearanceSettingsKeys.SIDEBAR_LABEL, AppearanceSettingsDefaults.SIDEBAR_LABEL),
        )
        assertEquals(
            AppearanceSettingsDefaults.SIDEBAR_LINEAR,
            resolveOptional(catalog::get, AppearanceSettingsKeys.SIDEBAR_LINEAR, AppearanceSettingsDefaults.SIDEBAR_LINEAR),
        )
        assertEquals(
            AppearanceSettingsDefaults.SIDEBAR_HELP,
            resolveOptional({ "  " }, AppearanceSettingsKeys.SIDEBAR_HELP, AppearanceSettingsDefaults.SIDEBAR_HELP),
        )
    }

    @Test
    fun wireTokensMatchTheServerContract() {
        assertEquals("ui_density", AppearanceSettingsProjection.KEY_DENSITY)
        assertEquals("time_format_default", AppearanceSettingsProjection.KEY_TIME_FORMAT)
        assertEquals("chart_palette", AppearanceSettingsProjection.KEY_CHART_PALETTE)
        assertEquals("cb_safe", ChartPaletteId.CbSafe.wire)
        assertEquals(JsonPrimitive("linear").content, SidebarStyle.Linear.wire)
    }
}
