package io.teslasync.android.featureviews.stepper

import io.teslasync.android.data.UiPhase
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Stepper's pure logic — the native mirror of the web component's `stateOf`
 * state machine and its `showCta` / connector branches (web/src/features/onboarding/components/Stepper.tsx).
 * Because the surface is purely presentational each [StepperRow] is exactly what the thin composable renders,
 * so these assertions double as the per-state "snapshot". Also covers the data-adapter path — decoding the
 * cached onboarding steps off the API JSON (snake-case-free single-word keys, unknown columns ignored) and
 * projecting them — plus the cache-then-network [UiState] mapping. Runs in the :app:testReleaseUnitTest gate.
 */
class StepperProjectionTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }

    private fun step(
        key: String,
        done: Boolean,
        cta: OnboardingStepCta? = null,
    ) = OnboardingStepData(
        key = key,
        title = "Title $key",
        description = "Description $key",
        done = done,
        cta = cta,
    )

    // ── stateOf: the verbatim web state machine ─────────────────────────────────────

    @Test
    fun firstNotDoneStepIsCurrentAndLaterNotDoneStepsArePending() {
        // The canonical onboarding case: [done, not-done, not-done].
        val steps = listOf(step("a", true), step("b", false), step("c", false))

        assertEquals(StepState.Done, StepperProjection.stateOf(steps, 0))
        assertEquals(StepState.Current, StepperProjection.stateOf(steps, 1))
        assertEquals(StepState.Pending, StepperProjection.stateOf(steps, 2))
    }

    @Test
    fun aDoneStepAfterANotDoneStepStillReadsAsDone() {
        // Web `if (steps[index].done) return 'done'` wins regardless of position; the first not-done
        // (index 0) is current, and the trailing not-done stays pending.
        val steps = listOf(step("a", false), step("b", true), step("c", false))

        assertEquals(StepState.Current, StepperProjection.stateOf(steps, 0))
        assertEquals(StepState.Done, StepperProjection.stateOf(steps, 1))
        assertEquals(StepState.Pending, StepperProjection.stateOf(steps, 2))
    }

    @Test
    fun everyStepDoneLeavesNoCurrentStep() {
        val steps = listOf(step("a", true), step("b", true))
        val states = steps.indices.map { StepperProjection.stateOf(steps, it) }

        assertEquals(listOf(StepState.Done, StepState.Done), states)
        assertFalse(states.contains(StepState.Current))
    }

    @Test
    fun theFirstStepIsCurrentWhenNothingIsDoneYet() {
        val steps = listOf(step("a", false), step("b", false))

        assertEquals(StepState.Current, StepperProjection.stateOf(steps, 0))
        assertEquals(StepState.Pending, StepperProjection.stateOf(steps, 1))
    }

    // ── rows: number, showCta, showConnector ────────────────────────────────────────

    @Test
    fun rowsCarryOneBasedNumbersAndDropTheTrailingConnector() {
        val steps = listOf(step("a", true), step("b", false), step("c", false))
        val rows = StepperProjection.rows(steps)

        assertEquals(listOf(1, 2, 3), rows.map { it.number })
        assertEquals(listOf("a", "b", "c"), rows.map { it.key })
        // Web `idx < steps.length - 1`: every row but the last draws its connector.
        assertEquals(listOf(true, true, false), rows.map { it.showConnector })
    }

    @Test
    fun onlyTheCurrentStepWithACtaShowsItsCta() {
        val cta = OnboardingStepCta(label = "Go")
        val steps =
            listOf(
                step("a", true, cta),
                step("b", false, cta),
                step("c", false, cta),
            )
        val rows = StepperProjection.rows(steps)

        // Web `state === 'current' && step.cta`: shown only on the current step, even though all three have one.
        assertFalse(rows[0].showCta)
        assertTrue(rows[1].showCta)
        assertFalse(rows[2].showCta)
    }

    @Test
    fun aCurrentStepWithoutACtaDoesNotShowOne() {
        val steps = listOf(step("a", true), step("b", false))
        val rows = StepperProjection.rows(steps)

        assertEquals(StepState.Current, rows[1].state)
        assertFalse(rows[1].showCta)
    }

    @Test
    fun rowsAreEmptyForAnEmptyStepList() {
        assertTrue(StepperProjection.rows(emptyList()).isEmpty())
    }

    // ── projectUiState: the cache-then-network lifecycle ────────────────────────────

    @Test
    fun loadingWinsOutright() {
        assertEquals(UiPhase.Loading, StepperProjection.projectUiState(null, isLoading = true).phase)
        // Even with a snapshot in hand, a first load shows the skeleton.
        val steps = listOf(step("a", false))
        assertEquals(UiPhase.Loading, StepperProjection.projectUiState(steps, isLoading = true).phase)
    }

    @Test
    fun aNonEmptyListProjectsToContentAndAnEmptyOrNullListToEmpty() {
        val steps = listOf(step("a", false))
        val content = StepperProjection.projectUiState(steps, isLoading = false)
        assertEquals(UiPhase.Content, content.phase)
        assertEquals(steps, content.data)

        assertEquals(UiPhase.Empty, StepperProjection.projectUiState(emptyList(), isLoading = false).phase)
        assertEquals(UiPhase.Empty, StepperProjection.projectUiState(null, isLoading = false).phase)
    }

    // ── data adapter: cached API JSON -> projection ─────────────────────────────────

    @Test
    fun decodesCachedStepsIgnoringUnknownColumnsAndProjectsTheState() {
        // The owning page caches the raw onboarding response; its step rows can carry extra columns and a
        // nested cta object. Decoding + projecting must yield the rendered rows.
        val json =
            """
            [
              {
                "key": "tesla",
                "title": "Connect your Tesla account",
                "description": "Authorize the Fleet API connection.",
                "done": true,
                "cta": { "label": "Connect", "to": "/tesla-account" },
                "anchor": "tesla_connected"
              },
              {
                "key": "vehicle",
                "title": "Wait for vehicles to appear",
                "description": "Vehicles sync automatically.",
                "done": false,
                "cta": { "label": "Refresh", "disabled": true }
              },
              {
                "key": "telemetry",
                "title": "Wait for telemetry data",
                "description": "Live data appears after the first signal batch.",
                "done": false,
                "cta": { "label": "Setup guide", "href": "/docs/fleet-telemetry-setup" }
              }
            ]
            """.trimIndent()
        val steps = lenientJson.decodeFromString<List<OnboardingStepData>>(json)

        assertEquals(3, steps.size)
        assertEquals("/tesla-account", steps[0].cta?.to)
        assertTrue(steps[1].cta?.disabled == true)
        assertEquals("/docs/fleet-telemetry-setup", steps[2].cta?.href)
        assertNull(steps[2].cta?.to)

        val rows = StepperProjection.rows(steps)
        assertEquals(StepState.Done, rows[0].state)
        assertEquals(StepState.Current, rows[1].state)
        assertEquals(StepState.Pending, rows[2].state)
        assertTrue(rows[1].showCta)
        assertFalse(rows[0].showCta)
        assertFalse(rows[2].showCta)
        assertEquals("Wait for vehicles to appear", rows[1].title)
        assertEquals(2, rows[1].number)
    }

    @Test
    fun decodesAStepWithNoCtaAndDefaultsMissingFields() {
        val json = """{ "key": "telemetry", "title": "Wait", "done": false }"""
        val decoded = lenientJson.decodeFromString<OnboardingStepData>(json)

        assertEquals("telemetry", decoded.key)
        assertEquals("", decoded.description)
        assertNull(decoded.cta)
        assertFalse(decoded.done)
    }
}
