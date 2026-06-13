package io.teslasync.android.sharedsurfaces.emptystatethreshold

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Off-device verification of the EmptyStateThreshold's pure logic — the native mirror of every decision the
 * web component makes (web/src/components/feedback/EmptyStateThreshold.tsx): the `itemNoun ?? t(defaultItem)`
 * noun resolution, the `message ?? defaultMessage` choice (with the default carrying the threshold + current
 * counts the catalog string interpolates), and the section label / description pass-through. Because the
 * composable is a thin render layer over [projectEmptyStateThreshold], the per-branch assertions here double
 * as the surface's per-state snapshot. Runs in the :app:testReleaseUnitTest gate.
 */
class EmptyStateThresholdModelTest {
    // ── Noun resolution (web `itemNoun ?? t('emptyState.threshold.defaultItem', 'items')`) ──────────────────

    @Test
    fun anAbsentItemNounProjectsTheDefaultNounSentinel() {
        val projection =
            projectEmptyStateThreshold(
                EmptyStateThresholdInput(currentCount = 1, threshold = 10, sectionLabel = "Section"),
            )

        assertEquals(EmptyStateThresholdNoun.Default, projection.noun)
    }

    @Test
    fun aSuppliedItemNounProjectsTheCustomNounVerbatim() {
        val projection =
            projectEmptyStateThreshold(
                EmptyStateThresholdInput(
                    currentCount = 5,
                    threshold = 30,
                    sectionLabel = "Cost Heatmap",
                    itemNoun = "sessions",
                ),
            )

        assertEquals(EmptyStateThresholdNoun.Custom("sessions"), projection.noun)
    }

    // ── Message resolution (web `message ?? defaultMessage`) ────────────────────────────────────────────────

    @Test
    fun anAbsentMessageProjectsTheDefaultCarryingTheRawCounts() {
        val projection =
            projectEmptyStateThreshold(
                EmptyStateThresholdInput(currentCount = 5, threshold = 30, sectionLabel = "Cost Heatmap"),
            )

        assertEquals(EmptyStateThresholdMessage.Default(threshold = 30, current = 5), projection.message)
    }

    @Test
    fun aSuppliedMessageProjectsTheCustomOverrideAndSkipsTheDefault() {
        val projection =
            projectEmptyStateThreshold(
                EmptyStateThresholdInput(
                    currentCount = 1,
                    threshold = 10,
                    sectionLabel = "Section",
                    message = "Custom prompt here",
                ),
            )

        // The override wins and the default count copy is never composed (web `message ?? defaultMessage`).
        assertEquals(EmptyStateThresholdMessage.Custom("Custom prompt here"), projection.message)
    }

    @Test
    fun theDefaultMessagePreservesThresholdAndCurrentDistinctly() {
        val projection =
            projectEmptyStateThreshold(
                EmptyStateThresholdInput(currentCount = 7, threshold = 42, sectionLabel = "Section"),
            )

        val message = projection.message as EmptyStateThresholdMessage.Default
        assertEquals(42, message.threshold)
        assertEquals(7, message.current)
    }

    // ── Section label + description pass-through ─────────────────────────────────────────────────────────────

    @Test
    fun theSectionLabelIsCarriedVerbatim() {
        val projection =
            projectEmptyStateThreshold(
                EmptyStateThresholdInput(currentCount = 5, threshold = 30, sectionLabel = "Cost Heatmap"),
            )

        assertEquals("Cost Heatmap", projection.sectionLabel)
    }

    @Test
    fun theDescriptionIsCarriedWhenPresentAndNullWhenAbsent() {
        val withDescription =
            projectEmptyStateThreshold(
                EmptyStateThresholdInput(
                    currentCount = 1,
                    threshold = 10,
                    sectionLabel = "Section",
                    description = "A subtitle that explains the section",
                ),
            )
        assertEquals("A subtitle that explains the section", withDescription.description)

        val withoutDescription =
            projectEmptyStateThreshold(
                EmptyStateThresholdInput(currentCount = 1, threshold = 10, sectionLabel = "Section"),
            )
        assertNull(withoutDescription.description)
    }

    // ── A complete default-path projection (the most common branch combination) ─────────────────────────────

    @Test
    fun theDefaultPathProjectsLabelDefaultNounAndDefaultMessageTogether() {
        val projection =
            projectEmptyStateThreshold(
                EmptyStateThresholdInput(currentCount = 0, threshold = 30, sectionLabel = "Regen Insights"),
            )

        assertEquals(
            EmptyStateThresholdProjection(
                sectionLabel = "Regen Insights",
                description = null,
                noun = EmptyStateThresholdNoun.Default,
                message = EmptyStateThresholdMessage.Default(threshold = 30, current = 0),
            ),
            projection,
        )
    }
}
