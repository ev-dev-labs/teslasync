package io.teslasync.android.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** JVM unit tests for the framework-free per-app language catalog (P3/A8, ADR-014). */
class AppLanguageTest {
    @Test
    fun catalogMatchesTheBundledStringResources() {
        assertEquals(listOf("en", "ar", "he"), AppLanguage.supportedTags)
        assertEquals(setOf("ar", "he"), AppLanguage.rtlTags)
    }

    @Test
    fun normalizeFoldsRegionalTagsToTheSupportedBase() {
        assertEquals("ar", AppLanguage.normalize("ar-EG"))
        assertEquals("en", AppLanguage.normalize("EN"))
        assertEquals("he", AppLanguage.normalize("he-IL"))
    }

    @Test
    fun normalizeRejectsUnknownAndBlankAsFollowSystem() {
        assertNull(AppLanguage.normalize(null))
        assertNull(AppLanguage.normalize(""))
        assertNull(AppLanguage.normalize("   "))
        assertNull(AppLanguage.normalize("fr"))
    }

    @Test
    fun explicitAndRtlClassification() {
        assertTrue(AppLanguage.isExplicit("ar"))
        assertFalse(AppLanguage.isExplicit(AppLanguage.SYSTEM_TAG))
        assertTrue(AppLanguage.isRtl("he-IL"))
        assertFalse(AppLanguage.isRtl("en"))
        assertFalse(AppLanguage.isRtl(null))
    }

    @Test
    fun persistedFormRoundTrips() {
        assertEquals("ar", AppLanguage.toPersisted("ar-EG"))
        assertEquals(AppLanguage.SYSTEM_TAG, AppLanguage.toPersisted(null))
        assertEquals(AppLanguage.SYSTEM_TAG, AppLanguage.toPersisted("fr"))
        assertEquals("he", AppLanguage.fromPersisted("he"))
        assertNull(AppLanguage.fromPersisted(AppLanguage.SYSTEM_TAG))
    }
}
