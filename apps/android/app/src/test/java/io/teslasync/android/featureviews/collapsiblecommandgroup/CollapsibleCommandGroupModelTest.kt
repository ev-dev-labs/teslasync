package io.teslasync.android.featureviews.collapsiblecommandgroup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the CollapsibleCommandGroup's pure logic — the native mirror of every derivation
 * the web component performs (web/src/features/system/components/CollapsibleCommandGroup.tsx and its
 * `CATEGORY_META`): the per-category label metadata, the i18n facade (`t(key, default)`), the session-storage
 * open-state contract (key, initializer, serialize), and the `(count)` header label. This is the surface's
 * adapter unit test; it runs in the :android:testReleaseUnitTest gate.
 */
class CollapsibleCommandGroupModelTest {
    // ── Category metadata (web `CommandCategory` union + `CATEGORY_META`) ─────────────────────────────────

    @Test
    fun everyWebCategoryIsModelledWithItsWireName() {
        val wireNames = CommandCategory.entries.map { it.wireName }.toSet()
        val expected =
            setOf(
                "security",
                "climate",
                "climate_protection",
                "charging",
                "doors",
                "drive",
                "windows",
                "sunroof",
                "schedules",
                "alerts",
                "navigation",
                "software",
                "vehicle",
                "media",
            )
        assertEquals(expected, wireNames)
    }

    @Test
    fun labelMetadataMatchesTheWebCategoryMeta() {
        assertEquals("commands.cat.security", CommandCategory.Security.labelKey)
        assertEquals("Security & Access", CommandCategory.Security.labelFallback)
        // The web key for climate_protection is the camelCase `climateProtect`, not the snake wire name.
        assertEquals("commands.cat.climateProtect", CommandCategory.ClimateProtection.labelKey)
        assertEquals("Climate Protection", CommandCategory.ClimateProtection.labelFallback)
        assertEquals("commands.cat.media", CommandCategory.Media.labelKey)
        assertEquals("Media", CommandCategory.Media.labelFallback)
    }

    @Test
    fun fromWireNameRoundTripsEveryCategory() {
        for (category in CommandCategory.entries) {
            assertEquals(category, CommandCategory.fromWireName(category.wireName))
        }
    }

    @Test
    fun fromWireNameReturnsNullForUnknownValues() {
        assertNull(CommandCategory.fromWireName("not_a_category"))
        assertNull(CommandCategory.fromWireName(""))
        // Matching is on the wire name, not the enum constant name.
        assertNull(CommandCategory.fromWireName("Security"))
    }

    // ── i18n facade (web `t(key, default)`) ───────────────────────────────────────────────────────────────

    @Test
    fun foldCatalogKeyMatchesTheGeneratorNaming() {
        assertEquals("translation_commands_cat_security", foldCatalogKey("commands.cat.security"))
        assertEquals("translation_commands_cat_climateProtect", foldCatalogKey("commands.cat.climateProtect"))
    }

    @Test
    fun foldCatalogKeyCollapsesPunctuationAndTrimsUnderscores() {
        assertEquals("translation_a_b_c_d", foldCatalogKey("a.b-c d"))
        assertEquals("translation_x", foldCatalogKey(".x."))
        assertEquals("translation_one_two", foldCatalogKey("one..two"))
    }

    @Test
    fun categoryLabelResourceFoldsEachCategoryKey() {
        assertEquals("translation_commands_cat_doors", categoryLabelResource(CommandCategory.Doors))
        assertEquals(
            "translation_commands_cat_climateProtect",
            categoryLabelResource(CommandCategory.ClimateProtection),
        )
    }

    @Test
    fun resolveOptionalPrefersACatalogHitOverTheFallback() {
        val lookup: (String) -> String? = { name -> if (name == "present") "Localized" else null }
        assertEquals("Localized", resolveOptional(lookup, "present", "Fallback"))
    }

    @Test
    fun resolveOptionalFallsBackWhenAbsentOrBlank() {
        val lookup: (String) -> String? = { name -> if (name == "blank") "   " else null }
        assertEquals("Fallback", resolveOptional(lookup, "absent", "Fallback"))
        assertEquals("Fallback", resolveOptional(lookup, "blank", "Fallback"))
    }

    @Test
    fun categoryLabelUsesTheCatalogWhenPresent() {
        val lookup: (String) -> String? =
            mapOf("translation_commands_cat_charging" to "Laden")::get
        assertEquals("Laden", categoryLabel(CommandCategory.Charging, lookup))
    }

    @Test
    fun categoryLabelFallsBackToTheWebDefault() {
        val empty: (String) -> String? = { null }
        assertEquals("Security & Access", categoryLabel(CommandCategory.Security, empty))
        assertEquals("Alerts & Location", categoryLabel(CommandCategory.Alerts, empty))
    }

    // ── Persistence (web `sessionStorage` keyed `teslasync-cat-{vehicleId}-{category}`) ───────────────────

    @Test
    fun collapseStorageKeyMatchesTheWebKey() {
        assertEquals("teslasync-cat-7-security", collapseStorageKey(7L, CommandCategory.Security))
        assertEquals(
            "teslasync-cat-42-climate_protection",
            collapseStorageKey(42L, CommandCategory.ClimateProtection),
        )
    }

    @Test
    fun resolveInitialOpenDefersToDefaultWhenAbsent() {
        assertTrue(resolveInitialOpen(null, defaultOpen = true))
        assertFalse(resolveInitialOpen(null, defaultOpen = false))
    }

    @Test
    fun resolveInitialOpenIsOpenOnlyForExactlyTrue() {
        assertTrue(resolveInitialOpen("true", defaultOpen = false))
        assertFalse(resolveInitialOpen("false", defaultOpen = true))
        // A present-but-not-"true" value reads as closed (web `stored === 'true'`), ignoring defaultOpen.
        assertFalse(resolveInitialOpen("garbage", defaultOpen = true))
        assertFalse(resolveInitialOpen("", defaultOpen = true))
        assertFalse(resolveInitialOpen("TRUE", defaultOpen = true))
    }

    @Test
    fun serializeOpenMatchesTheWebStringConversion() {
        assertEquals("true", serializeOpen(true))
        assertEquals("false", serializeOpen(false))
    }

    @Test
    fun serializeAndResolveAreRoundTripStable() {
        assertTrue(resolveInitialOpen(serializeOpen(true), defaultOpen = false))
        assertFalse(resolveInitialOpen(serializeOpen(false), defaultOpen = true))
    }

    // ── Count label (web `({count})`) ─────────────────────────────────────────────────────────────────────

    @Test
    fun countLabelWrapsTheRawCountInParentheses() {
        assertEquals("(0)", countLabel(0))
        assertEquals("(3)", countLabel(3))
        // Web `String(count)` does not group thousands.
        assertEquals("(1234)", countLabel(1234))
    }

    // ── Session store (the native sessionStorage analogue) ────────────────────────────────────────────────

    @Test
    fun sessionStoreReadsBackWhatItWrote() {
        val store: CommandGroupCollapseStore = SessionCommandGroupCollapseStore
        val key = collapseStorageKey(99L, CommandCategory.Media)
        store.write(key, serializeOpen(true))
        assertEquals("true", store.read(key))
        SessionCommandGroupCollapseStore.clear()
        assertNull(store.read(key))
    }

    @Test
    fun aFakeStoreSatisfiesTheOpenStateContract() {
        val backing = mutableMapOf<String, String>()
        val store =
            object : CommandGroupCollapseStore {
                override fun read(key: String): String? = backing[key]

                override fun write(
                    key: String,
                    value: String,
                ) {
                    backing[key] = value
                }
            }
        val key = collapseStorageKey(1L, CommandCategory.Charging)
        assertFalse(resolveInitialOpen(store.read(key), defaultOpen = false))
        store.write(key, serializeOpen(true))
        assertTrue(resolveInitialOpen(store.read(key), defaultOpen = false))
    }
}
