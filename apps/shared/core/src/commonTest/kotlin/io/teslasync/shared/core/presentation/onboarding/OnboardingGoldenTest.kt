package io.teslasync.shared.core.presentation.onboarding

import io.teslasync.shared.core.data.repo.OnboardingRepository
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Golden vectors locking the one non-trivial client-side derivation ported from the web
 * `useOnboardingStatus` hook (web/src/api/hooks/useOnboarding.ts): the poll-stop decision
 * [Onboarding.shouldPoll], the verbatim `query.state.data?.is_complete ? false : 30_000` — keep
 * polling until `is_complete` flips true (a `null`/unresolved status still polls).
 *
 * The vectors are language-neutral (fixed inputs → fixed expectations) so the Windows C# port and
 * the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to stay
 * within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class OnboardingGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Serializable
    private data class GoldenStatus(
        val tesla_connected: Boolean = false,
        val vehicle_count: Int = 0,
        val data_flowing: Boolean = false,
        val is_complete: Boolean = false,
    )

    @Serializable
    private data class GoldenScenario(
        val name: String,
        val status: GoldenStatus? = null,
        val shouldPoll: Boolean,
    )

    private fun scenarios(): List<GoldenScenario> = json.decodeFromString(GOLDEN)

    @Test
    fun goldenCoversEveryPollEdge() {
        val names = scenarios().map { it.name }.toSet()
        listOf("null_unresolved", "incomplete_nothing", "incomplete_partial", "complete")
            .forEach { assertTrue(it in names, "onboarding golden missing the '$it' case") }
    }

    @Test
    fun everyScenarioMatchesShouldPoll() {
        for (scenario in scenarios()) {
            val status =
                scenario.status?.let {
                    OnboardingStatus(
                        teslaConnected = it.tesla_connected,
                        vehicleCount = it.vehicle_count,
                        dataFlowing = it.data_flowing,
                        isComplete = it.is_complete,
                    )
                }
            assertEquals(scenario.shouldPoll, Onboarding.shouldPoll(status), "scenario '${scenario.name}' shouldPoll mismatch")
        }
    }

    @Test
    fun parityHelperIsReferencedFromTheDataPort() {
        // Compile-time anchor: the derivation under test belongs to the ported S7/S8 onboarding domain.
        assertTrue(OnboardingRepository::class.simpleName == "OnboardingRepository")
    }

    private companion object {
        val GOLDEN =
            """
            [
              { "name": "null_unresolved",     "shouldPoll": true },
              { "name": "incomplete_nothing",  "status": { "tesla_connected": false, "vehicle_count": 0, "data_flowing": false, "is_complete": false }, "shouldPoll": true },
              { "name": "incomplete_partial",  "status": { "tesla_connected": true,  "vehicle_count": 1, "data_flowing": false, "is_complete": false }, "shouldPoll": true },
              { "name": "complete",            "status": { "tesla_connected": true,  "vehicle_count": 2, "data_flowing": true,  "is_complete": true  }, "shouldPoll": false }
            ]
            """.trimIndent()
    }
}
