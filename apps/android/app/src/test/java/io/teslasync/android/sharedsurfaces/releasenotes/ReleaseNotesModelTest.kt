package io.teslasync.android.sharedsurfaces.releasenotes

import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogBadge
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogCatalog
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogChange
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogChangeType
import io.teslasync.android.modalsdialogs.changelogmodal.ChangelogRelease
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ReleaseNotes surface's pure logic — the native mirror of every decision the
 * web component makes (web/src/components/feedback/ReleaseNotes.tsx): the `limit` cap on the catalog, the
 * single-open accordion's initial/toggle/expanded state, the two reachable render states, the badge tint
 * mapping, the localized-string + a11y selectors, the `t(key, default)` resolver, the default catalog binding,
 * and the diagnostics slug. Because the composable is a thin render layer over [ReleaseNotesModel], the
 * per-branch assertions here double as the surface's per-state snapshot. Runs in the
 * :android:testReleaseUnitTest gate; the on-device render + accessibility live in ReleaseNotesUiTest.
 */
class ReleaseNotesModelTest {
    // ── visibleReleases (web `CHANGELOG.slice(0, limit)`) ─────────────────────────

    @Test
    fun defaultLimitMatchesTheWebProp() {
        assertEquals(3, ReleaseNotesModel.DEFAULT_LIMIT)
    }

    @Test
    fun visibleReleasesCapsToTheNewestLimit() {
        val all = sampleReleases()
        val result = ReleaseNotesModel.visibleReleases(all, 2)
        assertEquals(listOf("0.7.0", "0.6.0"), result.map { it.version })
    }

    @Test
    fun visibleReleasesReturnsTheWholeCatalogWhenLimitExceedsSize() {
        val all = sampleReleases()
        assertEquals(all, ReleaseNotesModel.visibleReleases(all, 99))
    }

    @Test
    fun visibleReleasesIsEmptyForNonPositiveLimit() {
        val all = sampleReleases()
        // JS `slice(0, n<=0)` yields []; a non-positive limit must therefore render nothing.
        assertTrue(ReleaseNotesModel.visibleReleases(all, 0).isEmpty())
        assertTrue(ReleaseNotesModel.visibleReleases(all, -5).isEmpty())
    }

    @Test
    fun visibleReleasesPreservesNewestFirstOrder() {
        val all = sampleReleases()
        val result = ReleaseNotesModel.visibleReleases(all, 3)
        assertEquals(all.map { it.version }, result.map { it.version })
    }

    // ── initialExpanded (web `useState(releases[0]?.version ?? null)`) ────────────

    @Test
    fun initialExpandedIsTheFirstReleaseVersion() {
        assertEquals("0.7.0", ReleaseNotesModel.initialExpanded(sampleReleases()))
    }

    @Test
    fun initialExpandedIsNullWhenNothingToShow() {
        assertNull(ReleaseNotesModel.initialExpanded(emptyList()))
    }

    // ── toggle / isExpanded (web `setExpanded(isExpanded ? null : version)`) ──────

    @Test
    fun toggleCollapsesTheOpenHeader() {
        assertNull(ReleaseNotesModel.toggle("0.7.0", "0.7.0"))
    }

    @Test
    fun toggleOpensADifferentHeaderAndCollapsesTheOther() {
        // Single-open: opening 0.6.0 while 0.7.0 is open replaces the one expanded value.
        assertEquals("0.6.0", ReleaseNotesModel.toggle("0.7.0", "0.6.0"))
    }

    @Test
    fun toggleOpensFromCollapsedState() {
        assertEquals("0.7.0", ReleaseNotesModel.toggle(null, "0.7.0"))
    }

    @Test
    fun isExpandedTracksTheCurrentVersion() {
        assertTrue(ReleaseNotesModel.isExpanded("0.7.0", "0.7.0"))
        assertFalse(ReleaseNotesModel.isExpanded("0.7.0", "0.6.0"))
        assertFalse(ReleaseNotesModel.isExpanded(null, "0.7.0"))
    }

    // ── classify: the per-state snapshot ──────────────────────────────────────────

    @Test
    fun classifyReturnsEmptyForNoReleases() {
        assertEquals(ReleaseNotesRender.Empty, ReleaseNotesModel.classify(0))
    }

    @Test
    fun classifyReturnsContentWithTheCount() {
        assertEquals(ReleaseNotesRender.Content(3), ReleaseNotesModel.classify(3))
    }

    // ── badge tint mapping (web `BADGE_VARIANT`) ──────────────────────────────────

    @Test
    fun badgeVariantMapsEveryBadgeToItsTint() {
        assertEquals(BadgeVariant.Success, badgeVariant(ChangelogBadge.Latest))
        assertEquals(BadgeVariant.Info, badgeVariant(ChangelogBadge.Stable))
        assertEquals(BadgeVariant.Warning, badgeVariant(ChangelogBadge.Beta))
    }

    // ── string + affordance selectors ─────────────────────────────────────────────

    @Test
    fun badgeLabelResolvesMappedLabelsAndFallsBackToTheEnumName() {
        val strings = sampleStrings(badgeLabels = mapOf(ChangelogBadge.Latest to "Latest"))
        assertEquals("Latest", strings.badgeLabel(ChangelogBadge.Latest))
        // Unmapped badge falls back to its enum name rather than rendering blank.
        assertEquals(ChangelogBadge.Stable.name, strings.badgeLabel(ChangelogBadge.Stable))
    }

    @Test
    fun affordanceLabelsTrackTheExpandedState() {
        val affordances =
            ReleaseNotesEntryAffordances(
                expandAction = "Expand",
                collapseAction = "Collapse",
                expandedState = "Expanded",
                collapsedState = "Collapsed",
            )
        assertEquals("Collapse", affordances.actionLabel(expanded = true))
        assertEquals("Expand", affordances.actionLabel(expanded = false))
        assertEquals("Expanded", affordances.stateLabel(expanded = true))
        assertEquals("Collapsed", affordances.stateLabel(expanded = false))
    }

    // ── resolveOptional (web `t(key, default)`) ───────────────────────────────────

    @Test
    fun resolveOptionalReturnsTheCatalogValueWhenPresent() {
        val resolved = resolveOptional({ "Réduire" }, KEY_COLLAPSE_ACTION, ReleaseNotesDefaults.COLLAPSE_ACTION)
        assertEquals("Réduire", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenAbsentOrBlank() {
        val fallback = ReleaseNotesDefaults.EXPAND_ACTION
        assertEquals(fallback, resolveOptional({ null }, KEY_EXPAND_ACTION, fallback))
        assertEquals(fallback, resolveOptional({ "  " }, KEY_EXPAND_ACTION, fallback))
    }

    // ── diagnostics + registration (P1/S11) ───────────────────────────────────────

    @Test
    fun diagnosticsSlugMatchesTheSurfaceContract() {
        assertEquals("ReleaseNotes", ReleaseNotesDiagnostics.SLUG)
        assertEquals(ReleaseNotesRegistration.SLUG, ReleaseNotesDiagnostics.SLUG)
        assertEquals("release-notes", ReleaseNotesRegistration.ID)
    }

    // ── default catalog binding (web `@/generated/changelog`) ─────────────────────

    @Test
    fun defaultSourceBindsTheSingleEmbeddedCatalog() {
        val source = DefaultReleaseNotesSource()
        // Reuses the one native catalog the ChangelogModal surface also reads — never a second, drifting copy.
        assertSame(ChangelogCatalog.releases, source.releases)
        assertTrue(source.releases.isNotEmpty())
        assertEquals(ChangelogBadge.Latest, source.releases.first().badge)
    }

    @Test
    fun defaultLimitOverTheRealCatalogYieldsAtMostThreeNewestReleases() {
        val all = DefaultReleaseNotesSource().releases
        val visible = ReleaseNotesModel.visibleReleases(all, ReleaseNotesModel.DEFAULT_LIMIT)
        assertTrue(visible.size <= ReleaseNotesModel.DEFAULT_LIMIT)
        assertEquals(ChangelogCatalog.releases.first().version, visible.first().version)
    }

    private fun sampleReleases(): List<ChangelogRelease> =
        listOf(
            release("0.7.0", "2026-03-29", ChangelogBadge.Latest, ChangelogChangeType.Added),
            release("0.6.0", "2026-03-28", ChangelogBadge.Stable, ChangelogChangeType.Fixed),
            release("0.5.0", "2026-03-23", ChangelogBadge.Stable, ChangelogChangeType.Security),
        )

    private fun release(
        version: String,
        date: String,
        badge: ChangelogBadge,
        type: ChangelogChangeType,
    ): ChangelogRelease = ChangelogRelease(version, date, badge, listOf(ChangelogChange(type, "change")))

    private fun sampleStrings(badgeLabels: Map<ChangelogBadge, String>): ReleaseNotesStrings =
        ReleaseNotesStrings(
            heading = "What's New",
            emptyMessage = "No data available",
            badgeLabels = badgeLabels,
            affordances =
                ReleaseNotesEntryAffordances(
                    expandAction = ReleaseNotesDefaults.EXPAND_ACTION,
                    collapseAction = ReleaseNotesDefaults.COLLAPSE_ACTION,
                    expandedState = ReleaseNotesDefaults.EXPANDED_STATE,
                    collapsedState = ReleaseNotesDefaults.COLLAPSED_STATE,
                ),
        )
}
