package io.teslasync.android.featureviews.settingssearch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SettingsSearch surface's pure logic — the native analogue of how the web
 * component and its index derive matches before returning JSX
 * (web/src/features/settings/components/SettingsSearch.tsx + searchIndex.ts): the `getSettingsIndex(t)`
 * catalogue, the `fuzzyMatch` subsequence helper, the `searchSettings` ranking (substring > keyword >
 * description > fuzzy; title beats description within each tier), the `MAX_RESULTS` cap, and the
 * idle / results / empty dropdown branch. The catalogue is resolved with the web test's
 * `tStub = (_k, d) => d` (English defaults) so the ranking is verified against the same wording the web
 * vitest uses. Runs in the offline `:app:testReleaseUnitTest` gate; the Compose render + accessibility are
 * covered on-device by SettingsSearchUiTest, and the diagnostic by SettingsSearchDiagnosticsTest.
 */
class SettingsSearchProjectionTest {
    // The web test's dummy `t`: return the inline English default so the index is fully populated
    // off-device (web `const tStub = ((_k, d) => d)`).
    private val index = SettingsSearchCatalog.buildIndex { _, default -> default }

    // ── fuzzyMatch — mirrors the web `describe('fuzzyMatch')` ────────────────────────

    @Test
    fun fuzzyMatchMatchesEveryNeedleCharacterInOrder() {
        assertTrue(SettingsSearchProjection.fuzzyMatch("lng", "Language"))
        assertTrue(SettingsSearchProjection.fuzzyMatch("thm", "Theme"))
        assertTrue(SettingsSearchProjection.fuzzyMatch("cur", "Currency"))
    }

    @Test
    fun fuzzyMatchRejectsWhenCharactersAreOutOfOrder() {
        assertFalse(SettingsSearchProjection.fuzzyMatch("eag", "Language"))
    }

    @Test
    fun fuzzyMatchRejectsWhenACharacterIsMissing() {
        assertFalse(SettingsSearchProjection.fuzzyMatch("xyz", "Language"))
    }

    @Test
    fun fuzzyMatchReturnsFalseOnAnEmptyNeedle() {
        assertFalse(SettingsSearchProjection.fuzzyMatch("", "Anything"))
    }

    @Test
    fun fuzzyMatchIsCaseInsensitive() {
        assertTrue(SettingsSearchProjection.fuzzyMatch("LNG", "Language"))
        assertTrue(SettingsSearchProjection.fuzzyMatch("lng", "LANGUAGE"))
    }

    // ── searchSettings — mirrors the web `describe('searchSettings')` ────────────────

    @Test
    fun searchSettingsReturnsNoEntriesOnAnEmptyQuery() {
        assertTrue(SettingsSearchProjection.searchSettings(index, "").isEmpty())
        assertTrue(SettingsSearchProjection.searchSettings(index, "   ").isEmpty())
    }

    @Test
    fun searchSettingsSubstringMatchesThemeFirst() {
        val results = SettingsSearchProjection.searchSettings(index, "theme")
        val topTitle = results.first().title.lowercase()
        assertTrue(topTitle.contains("theme"))
    }

    @Test
    fun searchSettingsFuzzyMatchesLngToLanguage() {
        val results = SettingsSearchProjection.searchSettings(index, "lng")
        assertTrue(results.any { it.title == "Language" })
    }

    @Test
    fun searchSettingsKeywordMatchesPsiToTirePressureUnit() {
        val results = SettingsSearchProjection.searchSettings(index, "psi")
        assertTrue(results.any { it.id == "general.units.pressure" })
    }

    @Test
    fun searchSettingsRanksTheExactTitleHitThemeFirst() {
        val results = SettingsSearchProjection.searchSettings(index, "theme")
        assertEquals("appearance.theme", results.first().id)
    }

    @Test
    fun searchSettingsRanksSubstringAboveFuzzy() {
        // "Currency" is an exact-title hit (1000) for "currency"; any fuzzy-only hit must rank below it.
        val results = SettingsSearchProjection.searchSettings(index, "currency")
        assertEquals("general.currency", results.first().id)
    }

    @Test
    fun searchSettingsColorSurfacesMoreThanOneAppearanceEntry() {
        // The web ArrowDown+Enter test relies on "color" matching multiple appearance entries (via
        // description/keywords), giving more than one navigable row.
        val results = SettingsSearchProjection.searchSettings(index, "color")
        assertTrue("expected >1 match for 'color', was ${results.size}", results.size > 1)
        assertTrue(results.any { it.id == "appearance.theme" })
        assertTrue(results.any { it.id == "appearance.chartPalette" })
    }

    // ── buildIndex — the web getSettingsIndex(t) catalogue ───────────────────────────

    @Test
    fun buildIndexHasEveryWebEntryWithAStableUniqueId() {
        // The web getSettingsIndex returns 53 entries; the count guards against an accidental drop/dupe.
        assertEquals(53, index.size)
        assertEquals(index.size, index.map { it.id }.toSet().size)
    }

    @Test
    fun everyEntryCarriesANonBlankTitleDescriptionAndRoute() {
        index.forEach { entry ->
            assertTrue("title must be non-blank for ${entry.id}", entry.title.isNotBlank())
            assertTrue("description must be non-blank for ${entry.id}", entry.description.isNotBlank())
            assertTrue("route must be non-blank for ${entry.id}", entry.route.isNotBlank())
            assertTrue("route must be an absolute path for ${entry.id}", entry.route.startsWith("/"))
        }
    }

    @Test
    fun buildIndexUsesTheEnglishDefaultWhenTheResolverFallsBack() {
        // The Compose boundary resolver falls back to the English default for any absent key (i18next
        // `t(key, default)`); the fallback path must yield exactly the web default wording.
        val theme = index.single { it.id == "appearance.theme" }
        assertEquals("Theme", theme.title)
        assertEquals("Choose light, dark, or system mode and pick an accent color.", theme.description)
    }

    @Test
    fun buildIndexResolvesEachEntryThroughTheKeyDefaultSeam() {
        // A resolver that echoes the KEY proves every title/description routes through resolve(key, default)
        // rather than being hard-coded — the web `t(key, default)` indirection.
        val keyed = SettingsSearchCatalog.buildIndex { key, _ -> key }
        val theme = keyed.single { it.id == "appearance.theme" }
        assertEquals("search.entries.appearance.theme.title", theme.title)
        assertEquals("search.entries.appearance.theme.desc", theme.description)
    }

    @Test
    fun crossPageEntriesKeepTheirPromotedRoutes() {
        // Entries promoted out of /settings still surface here but deep-link to their own page (web `href`).
        assertEquals("/integrations/helix", index.single { it.id == "helix.integration" }.route)
        assertEquals("/account/2fa", index.single { it.id == "security.totp.enroll" }.route)
        assertEquals("/tesla-account", index.single { it.id == "tesla.connect" }.route)
    }

    // ── project — the web showDropdown gate + MAX_RESULTS cap ────────────────────────

    @Test
    fun projectIsIdleForAnEmptyQuery() {
        val results = SettingsSearchProjection.project(index, "")
        assertEquals(SettingsSearchStatus.Idle, results.status)
        assertTrue(results.entries.isEmpty())
    }

    @Test
    fun projectIsEmptyForAWhitespaceOnlyQuery() {
        // Web `showDropdown = open && query.length > 0`: a whitespace query has length > 0 so the dropdown
        // opens, but searchSettings trims to "" → no matches → the "No matching settings." row.
        val results = SettingsSearchProjection.project(index, "   ")
        assertEquals(SettingsSearchStatus.Empty, results.status)
        assertTrue(results.entries.isEmpty())
    }

    @Test
    fun projectIsEmptyWhenNothingMatches() {
        val results = SettingsSearchProjection.project(index, "zzzzzz")
        assertEquals(SettingsSearchStatus.Empty, results.status)
        assertTrue(results.entries.isEmpty())
    }

    @Test
    fun projectSurfacesRankedResultsForAMatchingQuery() {
        val results = SettingsSearchProjection.project(index, "theme")
        assertEquals(SettingsSearchStatus.Results, results.status)
        assertEquals("appearance.theme", results.entries.first().id)
    }

    @Test
    fun projectCapsResultsAtMaxResults() {
        // A very broad fuzzy/substring query ("e") matches far more than the cap; the dropdown must show
        // at most MAX_RESULTS rows (web `matches.slice(0, MAX_RESULTS)`).
        val raw = SettingsSearchProjection.searchSettings(index, "e")
        assertTrue("expected the raw match set to exceed the cap, was ${raw.size}", raw.size > MAX_RESULTS)
        val results = SettingsSearchProjection.project(index, "e")
        assertEquals(SettingsSearchStatus.Results, results.status)
        assertEquals(MAX_RESULTS, results.entries.size)
        assertEquals(raw.take(MAX_RESULTS).map { it.id }, results.entries.map { it.id })
    }
}
