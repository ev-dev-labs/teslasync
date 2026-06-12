package io.teslasync.android.featureviews.recentlyviewed

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit tests for the pure Recently Viewed model + projection — the adapter test the prompt
 * requires (a cached/persisted JSON list → render-ready rows) plus the per-state and accessibility pins.
 * The web source renders exactly two data states (a populated list and a non-actionable empty hint) from
 * a synchronous client store, so these tests pin the decode contract (web `load()`), the newest-first +
 * limit slice and relative-time formatting (web `getRecentPages` + `formatRelative`), the folded TalkBack
 * content descriptions, the empty projection, the kind taxonomy, and the surface metadata.
 */
class RecentlyViewedProjectionTest {
    private val strings =
        RecentlyViewedStrings(
            widgetTitle = "Recently Viewed",
            empty = "Pages you visit will appear here for quick access.",
            justNow = "Just now",
            shortMinute = "m",
            shortHour = "h",
            shortDay = "d",
        )

    // ---- registration / metadata -------------------------------------------------

    @Test
    fun registrationMetadataMatchesWebSource() {
        assertEquals("RecentlyViewedWidget", RecentlyViewedRegistration.SLUG)
        assertEquals(5, RecentlyViewedRegistration.DISPLAY_LIMIT)
        assertEquals(50, RecentlyViewedRegistration.MAX_ENTRIES)
        assertEquals("teslasync:recent-pages:v1", RecentlyViewedRegistration.STORAGE_KEY)
    }

    // ---- kind taxonomy (web RecentPageKind) --------------------------------------

    @Test
    fun fromWireMapsEveryWebKind() {
        assertEquals(RecentPageKind.Page, RecentPageKind.fromWire("page"))
        assertEquals(RecentPageKind.Vehicle, RecentPageKind.fromWire("vehicle"))
        assertEquals(RecentPageKind.Drive, RecentPageKind.fromWire("drive"))
        assertEquals(RecentPageKind.Trip, RecentPageKind.fromWire("trip"))
        assertEquals(RecentPageKind.Charging, RecentPageKind.fromWire("charging"))
        assertEquals(RecentPageKind.Geofence, RecentPageKind.fromWire("geofence"))
        assertEquals(RecentPageKind.YearReview, RecentPageKind.fromWire("year-review"))
    }

    @Test
    fun fromWireFallsBackToPageForUnknownKind() {
        // Web: "unknown kinds read from storage are surfaced as 'page'".
        assertEquals(RecentPageKind.Page, RecentPageKind.fromWire("spaceship"))
        assertEquals(RecentPageKind.Page, RecentPageKind.fromWire(""))
    }

    // ---- relative-time formatter (web formatRelative) ----------------------------

    @Test
    fun formatRelativeMatchesWebBuckets() {
        assertEquals("Just now", formatRelative(NOW, NOW, strings))
        assertEquals("Just now", formatRelative(NOW - 30_000L, NOW, strings))
        assertEquals("5m", formatRelative(NOW - 5L * 60_000L, NOW, strings))
        assertEquals("59m", formatRelative(NOW - 59L * 60_000L, NOW, strings))
        assertEquals("1h", formatRelative(NOW - 90L * 60_000L, NOW, strings))
        assertEquals("23h", formatRelative(NOW - 23L * 3_600_000L, NOW, strings))
        assertEquals("1d", formatRelative(NOW - 25L * 3_600_000L, NOW, strings))
        assertEquals("3d", formatRelative(NOW - 3L * 86_400_000L, NOW, strings))
    }

    @Test
    fun formatRelativeClampsFutureStampsToJustNow() {
        // A future-dated visit never renders a negative age.
        assertEquals("Just now", formatRelative(NOW + 60_000L, NOW, strings))
    }

    // ---- decoder (web load()) — the "cached → parsed" adapter --------------------

    @Test
    fun decodeParsesAWellFormedListWithKindsAndRefId() {
        val raw =
            "[" +
                entryJson("/vehicles/3", "Model 3", "vehicle", NOW, refId = "3") + "," +
                entryJson("/drives/9", "Morning drive", "drive", NOW - 1_000L) +
                "]"
        val entries = RecentPagesCodec.decode(raw)
        assertEquals(2, entries.size)
        assertEquals("/vehicles/3", entries[0].path)
        assertEquals("Model 3", entries[0].title)
        assertEquals(RecentPageKind.Vehicle, entries[0].kind)
        assertEquals("3", entries[0].refId)
        assertEquals(RecentPageKind.Drive, entries[1].kind)
        assertNull(entries[1].refId)
    }

    @Test
    fun decodeMapsUnknownKindToPage() {
        val entries = RecentPagesCodec.decode("[" + entryJson("/x", "X", "spaceship", NOW) + "]")
        assertEquals(1, entries.size)
        assertEquals(RecentPageKind.Page, entries.single().kind)
    }

    @Test
    fun decodeSkipsEntriesMissingOrMistypedRequiredFields() {
        val raw =
            "[" +
                """{"title":"no path","kind":"page","visited_at":$NOW},""" +
                """{"path":"/n","title":42,"kind":"page","visited_at":$NOW},""" +
                """{"path":"/s","title":"string ts","kind":"page","visited_at":"$NOW"},""" +
                """{"path":"   ","title":"blank path","kind":"page","visited_at":$NOW},""" +
                entryJson("/ok", "Valid", "page", NOW) +
                "]"
        val entries = RecentPagesCodec.decode(raw)
        // Only the fully valid entry survives (missing path, numeric title, string ts, blank path all dropped).
        assertEquals(1, entries.size)
        assertEquals("/ok", entries.single().path)
    }

    @Test
    fun decodeReturnsEmptyForNullBlankCorruptOrNonArray() {
        assertTrue(RecentPagesCodec.decode(null).isEmpty())
        assertTrue(RecentPagesCodec.decode("").isEmpty())
        assertTrue(RecentPagesCodec.decode("   ").isEmpty())
        assertTrue(RecentPagesCodec.decode("{not json").isEmpty())
        assertTrue(RecentPagesCodec.decode("{}").isEmpty())
    }

    @Test
    fun decodeCapsAtMaxEntriesPreservingOrder() {
        val overflow = RecentlyViewedRegistration.MAX_ENTRIES + 10
        val raw = (0 until overflow).joinToString(prefix = "[", postfix = "]") { i -> entryJson("/p$i", "Page $i", "page", NOW - i) }
        val entries = RecentPagesCodec.decode(raw)
        assertEquals(RecentlyViewedRegistration.MAX_ENTRIES, entries.size)
        assertEquals("/p0", entries.first().path)
        assertEquals("/p${RecentlyViewedRegistration.MAX_ENTRIES - 1}", entries.last().path)
    }

    // ---- visible(): newest-first + limit (web getRecentPages) --------------------

    @Test
    fun visibleSortsNewestFirstAndCapsToLimit() {
        val entries =
            listOf(
                entry("/old", NOW - 5_000L),
                entry("/newest", NOW),
                entry("/mid", NOW - 2_000L),
                entry("/old2", NOW - 9_000L),
            )
        val visible = RecentlyViewedProjection.visible(entries, limit = 2)
        assertEquals(listOf("/newest", "/mid"), visible.map { it.path })
    }

    @Test
    fun visibleReturnsAllWhenLimitExceedsSizeAndNothingWhenLimitIsZero() {
        val entries = listOf(entry("/a", NOW), entry("/b", NOW - 1L))
        assertEquals(2, RecentlyViewedProjection.visible(entries, limit = 10).size)
        assertTrue(RecentlyViewedProjection.visible(entries, limit = 0).isEmpty())
    }

    // ---- rows()/project(): the populated content state ---------------------------

    @Test
    fun projectProducesNewestFirstRowsWithRelativeLabels() {
        val entries =
            listOf(
                entry("/drives/1", NOW - 5L * 60_000L, RecentPageKind.Drive, title = "Drive 1"),
                entry("/vehicles/2", NOW, RecentPageKind.Vehicle, title = "Model Y"),
                entry("/charging/3", NOW - 2L * 3_600_000L, RecentPageKind.Charging, title = "Supercharger"),
            )
        val rows = RecentlyViewedProjection.project(entries, RecentlyViewedRegistration.DISPLAY_LIMIT, NOW, strings)
        assertEquals(listOf("Model Y", "Drive 1", "Supercharger"), rows.map { it.title })
        assertEquals(listOf("Just now", "5m", "2h"), rows.map { it.relativeLabel })
        assertEquals(
            listOf(RecentPageKind.Vehicle, RecentPageKind.Drive, RecentPageKind.Charging),
            rows.map { it.kind },
        )
    }

    @Test
    fun rowTitleFallsBackToPathWhenBlank() {
        val row = RecentlyViewedProjection.row(entry("/settings", NOW, title = ""), NOW, strings)
        assertEquals("/settings", row.title)
        assertEquals("/settings, Just now", row.contentDescription)
    }

    // ---- accessibility -----------------------------------------------------------

    @Test
    fun everyRowExposesAFoldedNonBlankContentDescription() {
        val entries =
            listOf(
                entry("/a", NOW, title = "Alpha"),
                entry("/b", NOW - 90L * 60_000L, title = "Bravo"),
            )
        val rows = RecentlyViewedProjection.project(entries, RecentlyViewedRegistration.DISPLAY_LIMIT, NOW, strings)
        rows.forEach { row ->
            assertTrue(row.contentDescription.isNotBlank())
            assertEquals("${row.title}, ${row.relativeLabel}", row.contentDescription)
        }
        assertEquals("Alpha, Just now", rows.first().contentDescription)
        assertEquals("Bravo, 1h", rows.last().contentDescription)
    }

    // ---- empty content state -----------------------------------------------------

    @Test
    fun projectOfNoEntriesIsEmpty() {
        assertTrue(RecentlyViewedProjection.project(emptyList(), RecentlyViewedRegistration.DISPLAY_LIMIT, NOW, strings).isEmpty())
    }

    private fun entry(
        path: String,
        visitedAt: Long,
        kind: RecentPageKind = RecentPageKind.Page,
        title: String = path,
    ): RecentPageEntry = RecentPageEntry(path = path, title = title, kind = kind, visitedAt = visitedAt)

    private fun entryJson(
        path: String,
        title: String,
        kind: String,
        visitedAt: Long,
        refId: String? = null,
    ): String {
        val ref = refId?.let { ""","ref_id":"$it"""" } ?: ""
        return """{"path":"$path","title":"$title","kind":"$kind","visited_at":$visitedAt$ref}"""
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
    }
}
