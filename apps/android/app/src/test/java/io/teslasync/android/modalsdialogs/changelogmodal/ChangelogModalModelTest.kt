package io.teslasync.android.modalsdialogs.changelogmodal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ChangelogModal's pure logic — the native analogue of the derivations the
 * web component + useChangelog hook compute before rendering (web/src/components/feedback/ChangelogModal.tsx,
 * web/src/hooks/useChangelog.ts): semver comparison (with pre-release ordering), the new-since-seen filter,
 * first-visit detection, the 24h auto-show throttle + gating predicate, Keep-a-Changelog section grouping,
 * the default-open rule, the seen/throttle reducers, and the three reachable render states. Also pins the
 * surface registration, the strings/affordance selectors, the `t(key, default)` resolver, the default
 * state-holder binding, and the embedded catalog's integrity. Runs in the :android:testReleaseUnitTest gate;
 * the on-device render + accessibility live in ChangelogModalUiTest.
 */
class ChangelogModalModelTest {
    // ── compareVersions (web `compareVersions`) ──────────────────────────────────

    @Test
    fun compareReturnsZeroForEqualVersions() {
        assertEquals(0, ChangelogModalModel.compareVersions("0.7.0", "0.7.0"))
    }

    @Test
    fun compareOrdersByMajorMinorPatch() {
        assertEquals(1, ChangelogModalModel.compareVersions("0.7.0", "0.6.0"))
        assertEquals(-1, ChangelogModalModel.compareVersions("0.6.0", "0.7.0"))
        assertEquals(1, ChangelogModalModel.compareVersions("1.0.0", "0.9.9"))
        assertEquals(-1, ChangelogModalModel.compareVersions("0.7.1", "0.7.2"))
    }

    @Test
    fun preReleaseSortsBeforeRelease() {
        // web: "1.0.0-beta.1" < "1.0.0"
        assertEquals(-1, ChangelogModalModel.compareVersions("1.0.0-beta.1", "1.0.0"))
        assertEquals(1, ChangelogModalModel.compareVersions("1.0.0", "1.0.0-beta.1"))
    }

    @Test
    fun preReleaseTagsCompareLexicographically() {
        assertEquals(-1, ChangelogModalModel.compareVersions("1.0.0-alpha.1", "1.0.0-beta.1"))
    }

    @Test
    fun unparseableVersionsFallBackToLexicographic() {
        assertEquals(-1, ChangelogModalModel.compareVersions("nightly", "stable"))
        assertEquals(1, ChangelogModalModel.compareVersions("zeta", "alpha"))
    }

    @Test
    fun compareAlwaysReturnsMinusOneZeroOrOne() {
        val result = ChangelogModalModel.compareVersions("9.9.9", "0.0.1")
        assertEquals(1, result)
    }

    // ── newReleases / hasUnseen (web `newEntries` / `hasUnseen`) ──────────────────

    @Test
    fun newReleasesReturnsAllOnFirstVisit() {
        val all = sampleReleases()
        assertEquals(all, ChangelogModalModel.newReleases(all, null))
    }

    @Test
    fun newReleasesFiltersToVersionsAfterSeen() {
        val all = sampleReleases()
        val result = ChangelogModalModel.newReleases(all, "0.6.0")
        assertEquals(listOf("0.7.0"), result.map { it.version })
    }

    @Test
    fun newReleasesIsEmptyWhenCaughtUp() {
        val all = sampleReleases()
        assertTrue(ChangelogModalModel.newReleases(all, "0.7.0").isEmpty())
    }

    @Test
    fun hasUnseenTracksTheNewList() {
        assertTrue(ChangelogModalModel.hasUnseen(sampleReleases()))
        assertFalse(ChangelogModalModel.hasUnseen(emptyList()))
    }

    // ── visibleReleases / isFirstVisit (web `visibleEntries` / `isFirstVisit`) ────

    @Test
    fun visibleReleasesPrefersTheNewSubset() {
        val all = sampleReleases()
        val newOnes = listOf(all.first())
        assertEquals(newOnes, ChangelogModalModel.visibleReleases(newOnes, all))
    }

    @Test
    fun visibleReleasesFallsBackToFullHistoryWhenCaughtUp() {
        val all = sampleReleases()
        assertEquals(all, ChangelogModalModel.visibleReleases(emptyList(), all))
    }

    @Test
    fun isFirstVisitWhenEveryReleaseIsNew() {
        assertTrue(ChangelogModalModel.isFirstVisit(newCount = 3, totalCount = 3))
        assertFalse(ChangelogModalModel.isFirstVisit(newCount = 1, totalCount = 3))
    }

    // ── canAutoShow / shouldAutoShow (web throttle + effect guard) ────────────────

    @Test
    fun canAutoShowFalseWhenNothingUnseen() {
        assertFalse(ChangelogModalModel.canAutoShow(hasUnseen = false, lastShownAt = null, nowMs = 0L))
    }

    @Test
    fun canAutoShowTrueOnFirstEligibleRun() {
        assertTrue(ChangelogModalModel.canAutoShow(hasUnseen = true, lastShownAt = null, nowMs = 0L))
    }

    @Test
    fun canAutoShowGatedByThrottleWindow() {
        val throttle = ChangelogModalModel.AUTO_SHOW_THROTTLE_MS
        assertFalse(ChangelogModalModel.canAutoShow(true, lastShownAt = 0L, nowMs = throttle - 1))
        assertTrue(ChangelogModalModel.canAutoShow(true, lastShownAt = 0L, nowMs = throttle))
    }

    @Test
    fun shouldAutoShowRequiresEveryGate() {
        assertTrue(
            ChangelogModalModel.shouldAutoShow(true, hasCompletedOnboarding = true, canAutoShow = true, suppressed = false),
        )
        assertFalse(ChangelogModalModel.shouldAutoShow(false, true, true, false))
        assertFalse(ChangelogModalModel.shouldAutoShow(true, false, true, false))
        assertFalse(ChangelogModalModel.shouldAutoShow(true, true, false, false))
        assertFalse(ChangelogModalModel.shouldAutoShow(true, true, true, suppressed = true))
    }

    // ── groupChanges (web per-entry grouping) ─────────────────────────────────────

    @Test
    fun groupChangesKeepsCanonicalOrderAndDropsEmptySections() {
        val changes =
            listOf(
                ChangelogChange(ChangelogChangeType.Security, "s1"),
                ChangelogChange(ChangelogChangeType.Added, "a1"),
                ChangelogChange(ChangelogChangeType.Added, "a2"),
                ChangelogChange(ChangelogChangeType.Fixed, "f1"),
            )
        val grouped = ChangelogModalModel.groupChanges(changes)
        assertEquals(
            listOf(ChangelogChangeType.Added, ChangelogChangeType.Fixed, ChangelogChangeType.Security),
            grouped.map { it.type },
        )
        assertEquals(2, grouped.first().items.size)
    }

    // ── defaultExpanded (web `idx < 2`) ──────────────────────────────────────────

    @Test
    fun defaultExpandedForFirstTwoEntries() {
        assertTrue(ChangelogModalModel.defaultExpanded(0))
        assertTrue(ChangelogModalModel.defaultExpanded(1))
        assertFalse(ChangelogModalModel.defaultExpanded(2))
    }

    // ── seen / throttle reducers (web `markSeen` / `stampShown`) ──────────────────

    @Test
    fun markSeenStampsVersionAndTime() {
        val result = ChangelogModalModel.markSeen(ChangelogAck(), latestVersion = "0.7.0", nowMs = 42L)
        assertEquals("0.7.0", result.seenVersion)
        assertEquals(42L, result.lastShownAt)
    }

    @Test
    fun stampShownLeavesSeenVersionUntouched() {
        val result = ChangelogModalModel.stampShown(ChangelogAck(seenVersion = "0.5.0"), nowMs = 99L)
        assertEquals("0.5.0", result.seenVersion)
        assertEquals(99L, result.lastShownAt)
    }

    // ── classify (the three reachable render states) ─────────────────────────────

    @Test
    fun classifyEmptyWhenNothingVisible() {
        assertEquals(ChangelogRender.Empty, ChangelogModalModel.classify(visibleCount = 0, isFirstVisit = true))
    }

    @Test
    fun classifyFirstVisitAndSinceLastVisit() {
        assertEquals(ChangelogRender.FirstVisit(3), ChangelogModalModel.classify(3, isFirstVisit = true))
        assertEquals(ChangelogRender.SinceLastVisit(2), ChangelogModalModel.classify(2, isFirstVisit = false))
    }

    // ── String + affordance selectors ────────────────────────────────────────────

    @Test
    fun stringsFallBackToEnumNameWhenUnmapped() {
        val strings =
            ChangelogStrings(
                title = "t",
                viewFull = "v",
                gotIt = "g",
                closeLabel = "c",
                emptyMessage = "e",
                badgeLabels = emptyMap(),
                sectionLabels = emptyMap(),
            )
        assertEquals("Latest", strings.badgeLabel(ChangelogBadge.Latest))
        assertEquals("Added", strings.sectionLabel(ChangelogChangeType.Added))
    }

    @Test
    fun affordanceSelectorsTrackTheExpandedState() {
        val affordances = ChangelogEntryAffordances("Expand", "Collapse", "Expanded", "Collapsed")
        assertEquals("Collapse", affordances.actionLabel(expanded = true))
        assertEquals("Expand", affordances.actionLabel(expanded = false))
        assertEquals("Expanded", affordances.stateLabel(expanded = true))
        assertEquals("Collapsed", affordances.stateLabel(expanded = false))
    }

    // ── resolveOptional (web `t(key, default)`) ──────────────────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresent() {
        assertEquals("Bekijk", resolveOptional({ "Bekijk" }, KEY_EMPTY_MESSAGE, ChangelogDefaults.EMPTY_MESSAGE))
    }

    @Test
    fun resolveOptionalFallsBackWhenAbsentOrBlank() {
        assertEquals(
            ChangelogDefaults.EMPTY_MESSAGE,
            resolveOptional({ null }, KEY_EMPTY_MESSAGE, ChangelogDefaults.EMPTY_MESSAGE),
        )
        assertEquals(
            ChangelogDefaults.EXPAND_ACTION,
            resolveOptional({ "  " }, KEY_EXPAND_ACTION, ChangelogDefaults.EXPAND_ACTION),
        )
    }

    // ── Registration (web parity) ────────────────────────────────────────────────

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("changelog-modal", ChangelogRegistration.ID)
        assertEquals("ChangelogModal", ChangelogRegistration.SLUG)
    }

    // ── DefaultChangelogSource (web `useChangelog` binding) ───────────────────────

    @Test
    fun defaultSourceMarkSeenWritesLatestAndStamp() {
        val store = FakeAckStore()
        val source =
            DefaultChangelogSource(
                store = store,
                onboardingProbe = { true },
                releases = sampleReleases(),
                latestVersion = "0.7.0",
                clock = { 123L },
            )
        source.markSeen()
        assertEquals("0.7.0", store.read().seenVersion)
        assertEquals(123L, store.read().lastShownAt)
        assertTrue(source.hasCompletedOnboarding)
        assertEquals(123L, source.now())
    }

    @Test
    fun defaultSourceStampShownLeavesSeenVersionUntouched() {
        val store = FakeAckStore(ChangelogAck(seenVersion = "0.5.0"))
        val source = DefaultChangelogSource(store = store, onboardingProbe = { false }, clock = { 7L })
        source.stampShown()
        assertEquals("0.5.0", store.read().seenVersion)
        assertEquals(7L, store.read().lastShownAt)
        assertFalse(source.hasCompletedOnboarding)
    }

    // ── Embedded catalog integrity (real content, no placeholder) ─────────────────

    @Test
    fun catalogLatestVersionMatchesTopmostRelease() {
        assertTrue(ChangelogCatalog.releases.isNotEmpty())
        assertEquals(ChangelogCatalog.LATEST_VERSION, ChangelogCatalog.releases.first().version)
        assertEquals(ChangelogBadge.Latest, ChangelogCatalog.releases.first().badge)
    }

    @Test
    fun catalogEntriesAreOrderedNewestFirst() {
        val versions = ChangelogCatalog.releases
        versions.zipWithNext().forEach { (newer, older) ->
            assertTrue(
                "expected ${newer.version} >= ${older.version}",
                ChangelogModalModel.compareVersions(newer.version, older.version) >= 0,
            )
        }
    }

    @Test
    fun catalogChangesAllCarryNonBlankText() {
        val blank = ChangelogCatalog.releases.flatMap { it.changes }.firstOrNull { it.text.isBlank() }
        assertNull(blank)
        assertTrue(ChangelogCatalog.releases.sumOf { it.changes.size } > 0)
    }

    @Test
    fun catalogContainsTheEarliestKnownRelease() {
        val earliest = ChangelogCatalog.releases.firstOrNull { it.version == "0.1.0" }
        assertNotNull(earliest)
    }

    private fun sampleReleases(): List<ChangelogRelease> =
        listOf(
            ChangelogRelease(
                "0.7.0",
                "2026-03-29",
                ChangelogBadge.Latest,
                listOf(ChangelogChange(ChangelogChangeType.Added, "a")),
            ),
            ChangelogRelease(
                "0.6.0",
                "2026-03-28",
                ChangelogBadge.Stable,
                listOf(ChangelogChange(ChangelogChangeType.Fixed, "f")),
            ),
            ChangelogRelease(
                "0.5.0",
                "2026-03-23",
                ChangelogBadge.Stable,
                listOf(ChangelogChange(ChangelogChangeType.Changed, "c")),
            ),
        )

    private class FakeAckStore(
        private var ack: ChangelogAck = ChangelogAck(),
    ) : ChangelogAckStore {
        override fun read(): ChangelogAck = ack

        override fun write(ack: ChangelogAck) {
            this.ack = ack
        }
    }
}
