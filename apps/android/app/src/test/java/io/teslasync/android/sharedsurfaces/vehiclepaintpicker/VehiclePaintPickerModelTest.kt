// Off-device unit coverage for the VehiclePaintPicker surface's pure model (P3 acceptance: adapter + per-state
// + a11y label tests). Exercises the Tesla `exterior_color` → paint inference (web `inferPaintFromTesla`), the
// persisted-override type-guard (web `isPaintPaletteId`), the clear-on-inferred override normalisation (web
// `setPaint`), the persistable-vehicle guard (web `storageKey`), the swatch projection adapter (override +
// exterior colour → selected / inferred-tagged swatch row, web `useVehiclePaint` + the component's `.map`),
// the accessible swatch label fold (web `title`), the i18n key/default contract, and the PII-safe
// `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in :android:testReleaseUnitTest.
// Reference values are the strings + behaviour the web component + hook produce.

package io.teslasync.android.sharedsurfaces.vehiclepaintpicker

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VehiclePaintPickerModelTest {
    // ── registration + i18n key/default contract mirrors the web source ──────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("vehicle-paint-picker", VehiclePaintPickerRegistration.ID)
        assertEquals("VehiclePaintPicker", VehiclePaintPickerRegistration.SLUG)
    }

    @Test
    fun i18nKeysMapToCatalogResourceNames() {
        // Each web `paint.*` key maps to a `translation_*` resource present in values/, values-ar/, values-he/.
        assertEquals("translation_paint_pickerLabel", VehiclePaintPickerKeys.PICKER_LABEL)
        assertEquals("translation_paint_label", VehiclePaintPickerKeys.LABEL)
        assertEquals("translation_paint_detected", VehiclePaintPickerKeys.DETECTED)
        assertEquals("translation_paint_reset", VehiclePaintPickerKeys.RESET)
        assertEquals("translation_paint_pearlWhite", VehiclePaintPickerKeys.PEARL_WHITE)
        assertEquals("translation_paint_midnightSilver", VehiclePaintPickerKeys.MIDNIGHT_SILVER)
        assertEquals("translation_paint_deepBlue", VehiclePaintPickerKeys.DEEP_BLUE)
        assertEquals("translation_paint_solidBlack", VehiclePaintPickerKeys.SOLID_BLACK)
        assertEquals("translation_paint_redMulticoat", VehiclePaintPickerKeys.RED_MULTICOAT)
    }

    @Test
    fun defaultsMirrorWebSourceStrings() {
        assertEquals("Vehicle paint color", VehiclePaintPickerDefaults.PICKER_LABEL)
        assertEquals("Paint", VehiclePaintPickerDefaults.LABEL)
        assertEquals("Auto-detected", VehiclePaintPickerDefaults.DETECTED)
        assertEquals("Reset to auto-detected", VehiclePaintPickerDefaults.RESET)
        assertEquals("Pearl White Multi-Coat", VehiclePaintPickerDefaults.PEARL_WHITE)
        assertEquals("Midnight Silver Metallic", VehiclePaintPickerDefaults.MIDNIGHT_SILVER)
        assertEquals("Deep Blue Metallic", VehiclePaintPickerDefaults.DEEP_BLUE)
        assertEquals("Solid Black", VehiclePaintPickerDefaults.SOLID_BLACK)
        assertEquals("Red Multi-Coat", VehiclePaintPickerDefaults.RED_MULTICOAT)
    }

    // ── palette catalog mirrors web vehicleColors.ts ─────────────────────────────────

    @Test
    fun paletteListHasTheFiveStockPaintsInDisplayOrder() {
        assertEquals(
            listOf(
                PaintPaletteId.PearlWhite,
                PaintPaletteId.MidnightSilver,
                PaintPaletteId.DeepBlue,
                PaintPaletteId.SolidBlack,
                PaintPaletteId.RedMulticoat,
            ),
            PAINT_PALETTE_LIST.map { it.id },
        )
        assertEquals(5, PAINT_PALETTES.size)
    }

    @Test
    fun swatchColoursMatchTheWebHexes() {
        assertEquals(0xFFE9ECF2, paintOf(PaintPaletteId.PearlWhite).swatchArgb)
        assertEquals(0xFF5B6675, paintOf(PaintPaletteId.MidnightSilver).swatchArgb)
        assertEquals(0xFF1F3A72, paintOf(PaintPaletteId.DeepBlue).swatchArgb)
        assertEquals(0xFF0D1117, paintOf(PaintPaletteId.SolidBlack).swatchArgb)
        assertEquals(0xFFA3001A, paintOf(PaintPaletteId.RedMulticoat).swatchArgb)
    }

    @Test
    fun fallbackPaintIsPearlWhite() {
        assertEquals(PaintPaletteId.PearlWhite, FALLBACK_PAINT.id)
    }

    @Test
    fun eachPaletteLabelKeyMatchesItsCatalogResourceName() {
        assertEquals(VehiclePaintPickerKeys.PEARL_WHITE, paintOf(PaintPaletteId.PearlWhite).labelKey)
        assertEquals(VehiclePaintPickerKeys.MIDNIGHT_SILVER, paintOf(PaintPaletteId.MidnightSilver).labelKey)
        assertEquals(VehiclePaintPickerKeys.DEEP_BLUE, paintOf(PaintPaletteId.DeepBlue).labelKey)
        assertEquals(VehiclePaintPickerKeys.SOLID_BLACK, paintOf(PaintPaletteId.SolidBlack).labelKey)
        assertEquals(VehiclePaintPickerKeys.RED_MULTICOAT, paintOf(PaintPaletteId.RedMulticoat).labelKey)
    }

    // ── persisted-override type guard (web isPaintPaletteId) ─────────────────────────

    @Test
    fun paintPaletteIdOfMatchesTheWebStorageWireIds() {
        assertEquals(PaintPaletteId.PearlWhite, paintPaletteIdOf("pearl-white"))
        assertEquals(PaintPaletteId.MidnightSilver, paintPaletteIdOf("midnight-silver"))
        assertEquals(PaintPaletteId.DeepBlue, paintPaletteIdOf("deep-blue"))
        assertEquals(PaintPaletteId.SolidBlack, paintPaletteIdOf("solid-black"))
        assertEquals(PaintPaletteId.RedMulticoat, paintPaletteIdOf("red-multicoat"))
        assertNull(paintPaletteIdOf("bogus"))
        assertNull(paintPaletteIdOf(null))
    }

    @Test
    fun isPaintPaletteIdGuardsArbitraryStrings() {
        assertTrue(isPaintPaletteId("solid-black"))
        assertFalse(isPaintPaletteId("SolidBlack"))
        assertFalse(isPaintPaletteId(""))
        assertFalse(isPaintPaletteId(null))
    }

    // ── Tesla exterior_color → paint inference (web inferPaintFromTesla) ──────────────

    @Test
    fun inferenceMapsTeslaCodesToPaints() {
        assertEquals(PaintPaletteId.PearlWhite, inferPaintIdFromTesla("PearlWhite"))
        assertEquals(PaintPaletteId.PearlWhite, inferPaintIdFromTesla("PearlWhiteMultiCoat"))
        assertEquals(PaintPaletteId.MidnightSilver, inferPaintIdFromTesla("MidnightSilverMetallic"))
        assertEquals(PaintPaletteId.DeepBlue, inferPaintIdFromTesla("DeepBlueMetallic"))
        assertEquals(PaintPaletteId.SolidBlack, inferPaintIdFromTesla("SolidBlack"))
        assertEquals(PaintPaletteId.SolidBlack, inferPaintIdFromTesla("Black"))
        assertEquals(PaintPaletteId.SolidBlack, inferPaintIdFromTesla("ObsidianBlack"))
        assertEquals(PaintPaletteId.RedMulticoat, inferPaintIdFromTesla("RedMulticoat"))
        assertEquals(PaintPaletteId.RedMulticoat, inferPaintIdFromTesla("Red Multi-Coat"))
    }

    @Test
    fun inferenceIsForgivingAboutSeparatorsAndCase() {
        assertEquals(PaintPaletteId.MidnightSilver, inferPaintIdFromTesla("midnight_silver"))
        assertEquals(PaintPaletteId.DeepBlue, inferPaintIdFromTesla("deep blue"))
        assertEquals(PaintPaletteId.DeepBlue, inferPaintIdFromTesla("darkblue"))
        assertEquals(PaintPaletteId.MidnightSilver, inferPaintIdFromTesla("silver"))
    }

    @Test
    fun inferenceFallsBackToPearlWhiteForMissingOrUnknownCodes() {
        assertEquals(PaintPaletteId.PearlWhite, inferPaintIdFromTesla(null))
        assertEquals(PaintPaletteId.PearlWhite, inferPaintIdFromTesla(""))
        assertEquals(PaintPaletteId.PearlWhite, inferPaintIdFromTesla("SomeFutureColor"))
        assertEquals(PaintPaletteId.PearlWhite, inferPaintIdFromTesla("white"))
    }

    // ── override normalisation (web setPaint: pick-inferred ⇒ clear) ─────────────────

    @Test
    fun normalizeOverrideClearsWhenPickingTheInferredColour() {
        assertNull(normalizeOverride(PaintPaletteId.PearlWhite, inferred = PaintPaletteId.PearlWhite))
        assertNull(normalizeOverride(null, inferred = PaintPaletteId.PearlWhite))
    }

    @Test
    fun normalizeOverrideKeepsAnExplicitDifferentColour() {
        assertEquals(
            PaintPaletteId.RedMulticoat,
            normalizeOverride(PaintPaletteId.RedMulticoat, inferred = PaintPaletteId.PearlWhite),
        )
    }

    // ── persistable-vehicle guard (web storageKey) ───────────────────────────────────

    @Test
    fun isPersistableVehicleIdMirrorsWebStorageKeyGuard() {
        assertTrue(isPersistableVehicleId(1L))
        assertFalse(isPersistableVehicleId(null))
        assertFalse(isPersistableVehicleId(0L))
        assertFalse(isPersistableVehicleId(-3L))
    }

    // ── projection adapter: override + exterior colour → swatch row ──────────────────

    @Test
    fun projectionWithoutOverrideSelectsAndTagsTheInferredPaint() {
        val data = projectVehiclePaintPicker(overrideId = null, exteriorColor = "MidnightSilverMetallic")
        assertEquals(5, data.swatches.size)
        assertEquals(PaintPaletteId.MidnightSilver, data.activeId)
        assertEquals(PaintPaletteId.MidnightSilver, data.inferredId)
        assertFalse(data.isOverridden)
        val midnight = data.swatches.first { it.id == PaintPaletteId.MidnightSilver }
        assertTrue(midnight.selected)
        assertTrue(midnight.inferred)
        // Exactly one selected, exactly one inferred.
        assertEquals(1, data.swatches.count { it.selected })
        assertEquals(1, data.swatches.count { it.inferred })
    }

    @Test
    fun projectionWithOverrideSelectsOverrideButTagsInferredSeparately() {
        val data = projectVehiclePaintPicker(overrideId = PaintPaletteId.RedMulticoat, exteriorColor = "PearlWhite")
        assertEquals(PaintPaletteId.RedMulticoat, data.activeId)
        assertEquals(PaintPaletteId.PearlWhite, data.inferredId)
        assertTrue(data.isOverridden)
        val red = data.swatches.first { it.id == PaintPaletteId.RedMulticoat }
        val pearl = data.swatches.first { it.id == PaintPaletteId.PearlWhite }
        assertTrue(red.selected)
        assertFalse(red.inferred)
        assertFalse(pearl.selected)
        assertTrue(pearl.inferred)
        assertEquals("Red Multi-Coat", data.active.defaultLabel)
    }

    @Test
    fun projectionKeepsTheFixedFivePaintOrder() {
        val data = projectVehiclePaintPicker(overrideId = PaintPaletteId.DeepBlue, exteriorColor = null)
        assertEquals(
            listOf(
                PaintPaletteId.PearlWhite,
                PaintPaletteId.MidnightSilver,
                PaintPaletteId.DeepBlue,
                PaintPaletteId.SolidBlack,
                PaintPaletteId.RedMulticoat,
            ),
            data.swatches.map { it.id },
        )
    }

    @Test
    fun projectionWithNoVehicleColourStillRendersTheFallbackSelected() {
        // Web: a missing exterior_color resolves to the Pearl White fallback, still fully rendered.
        val data = projectVehiclePaintPicker(overrideId = null, exteriorColor = null)
        assertEquals(PaintPaletteId.PearlWhite, data.activeId)
        assertFalse(data.isOverridden)
        assertTrue(data.swatches.first { it.id == PaintPaletteId.PearlWhite }.selected)
    }

    // ── a11y swatch label fold (web title) ───────────────────────────────────────────

    @Test
    fun accessibilityLabelAppendsDetectedSuffixOnlyForInferredSwatch() {
        assertEquals(
            "Pearl White Multi-Coat · Auto-detected",
            paintSwatchAccessibilityLabel("Pearl White Multi-Coat", inferred = true, detectedWord = "Auto-detected"),
        )
        assertEquals(
            "Red Multi-Coat",
            paintSwatchAccessibilityLabel("Red Multi-Coat", inferred = false, detectedWord = "Auto-detected"),
        )
    }

    @Test
    fun everyProjectedSwatchHasANonBlankAccessibleLabel() {
        // a11y coverage: no swatch can be an unlabelled tap target.
        val data = projectVehiclePaintPicker(overrideId = null, exteriorColor = "PearlWhite")
        for (swatch in data.swatches) {
            val label = paintSwatchAccessibilityLabel(swatch.defaultLabel, swatch.inferred, "Auto-detected")
            assertTrue("swatch ${swatch.id} must carry a label", label.isNotBlank())
        }
    }

    // ── diagnostics: one PII-safe view.opened ────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        recordVehiclePaintPickerOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no vehicle id / VIN can leak through the diagnostic.
        assertEquals(mapOf("surface" to "VehiclePaintPicker"), records[0].fields)
    }
}
