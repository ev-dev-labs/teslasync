package io.teslasync.android.sharedsurfaces.scorebadge

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [ScoreBadge] view — the parity port of the web `ScoreBadge`
 * (web/src/components/data-display/ScoreBadge.tsx). Covers what the offline model test cannot: each grade
 * branch renders a single accessibility node speaking the localized `score.aria` label ("Score {grade}"),
 * the key resolves through the P1/S10 catalog, a numeric score maps to the right spoken grade, the
 * `ariaLabel` override wins, and the one-shot PII-safe `view.opened` diagnostic fires on mount. The offline
 * `:app:testReleaseUnitTest` gate covers the pure projection + the diagnostics emitter.
 */
class ScoreBadgeUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── State: a top grade speaks the localized "Score A+" label ──────────────────────────────────────────

    @Test
    fun aTopGradeRendersTheLocalizedAccessibleLabel() {
        mountGrade(ScoreGrade.APlus)

        compose.onNodeWithContentDescription(APLUS_LABEL).assertExists()
    }

    // ── State: a mid grade speaks "Score B" ───────────────────────────────────────────────────────────────

    @Test
    fun aMidGradeRendersTheLocalizedAccessibleLabel() {
        mountGrade(ScoreGrade.B)

        compose.onNodeWithContentDescription(B_LABEL).assertExists()
    }

    // ── State: the "no score" sentinel speaks "Score —" (the em-dash grade) ───────────────────────────────

    @Test
    fun theDashSentinelRendersTheLocalizedAccessibleLabel() {
        mountGrade(ScoreGrade.Dash)

        compose.onNodeWithContentDescription(DASH_LABEL).assertExists()
        // No graded label leaked into the sentinel branch.
        compose.onAllNodesWithContentDescription(APLUS_LABEL).assertCountEquals(0)
    }

    // ── State: a numeric score maps to the right spoken grade (web numericToGrade) ────────────────────────

    @Test
    fun aNumericScoreSpeaksItsMappedGrade() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ScoreBadge(score = 95.0, logger = RecordingLogger())
            }
        }
        compose.waitForIdle()

        compose.onNodeWithContentDescription(APLUS_LABEL).assertExists()
    }

    // ── State: a missing score speaks the sentinel label ──────────────────────────────────────────────────

    @Test
    fun aMissingScoreSpeaksTheSentinelLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ScoreBadge(score = null, logger = RecordingLogger())
            }
        }
        compose.waitForIdle()

        compose.onNodeWithContentDescription(DASH_LABEL).assertExists()
    }

    // ── Size: a large badge still speaks the same label (size is presentation-only) ───────────────────────

    @Test
    fun aLargeBadgeKeepsTheSameAccessibleLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ScoreBadge(grade = ScoreGrade.B, size = ScoreBadgeSize.Lg, logger = RecordingLogger())
            }
        }
        compose.waitForIdle()

        compose.onNodeWithContentDescription(B_LABEL).assertExists()
    }

    // ── Accessibility: the caller-supplied ariaLabel overrides the auto-generated one (web `ariaLabel`) ────

    @Test
    fun anAriaLabelOverrideWins() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ScoreBadge(grade = ScoreGrade.A, ariaLabel = OVERRIDE_LABEL, logger = RecordingLogger())
            }
        }
        compose.waitForIdle()

        compose.onNodeWithContentDescription(OVERRIDE_LABEL).assertExists()
    }

    // ── Accessibility: the whole readout is one node (the visible letter is not separately announced) ──────

    @Test
    fun theReadoutCollapsesIntoExactlyOneAccessibleNode() {
        mountGrade(ScoreGrade.APlus)

        compose.onAllNodesWithContentDescription(APLUS_LABEL).assertCountEquals(1)
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ───────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ScoreBadge(grade = ScoreGrade.B, logger = logger)
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ScoreBadge"), fields)
    }

    private fun mountGrade(grade: ScoreGrade) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ScoreBadge(grade = grade, logger = RecordingLogger())
            }
        }
        compose.waitForIdle()
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }

    private companion object {
        // The en catalog values (instrumentation default locale) the surface speaks for each grade.
        const val APLUS_LABEL = "Score A+"
        const val B_LABEL = "Score B"
        const val DASH_LABEL = "Score \u2014"
        const val OVERRIDE_LABEL = "Charging session score B"
    }
}
