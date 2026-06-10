package io.teslasync.shared.core.presentation.logstream

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Replays the language-neutral derivation vectors
 * (apps/shared/core/spec/log-stream-golden.json) through [LogStreamReducer], folding
 * ops exactly as [LogStreamStore] does (including the `paused` skip and the `count > 0`
 * drop guard). The same fixture pins the Windows C# port so the rolling-buffer /
 * eviction / drop / pause / clear rules cannot drift across platforms (ADR-004).
 */
class LogStreamGoldenTest {
    @Serializable
    private data class GoldenOp(
        val op: String,
        val level: String? = null,
        val count: Int? = null,
    )

    @Serializable
    private data class GoldenScenario(
        val name: String,
        val max_events: Int,
        val ops: List<GoldenOp>,
        val expected_levels: List<String>,
        val expected_drops: Int,
        val expected_total_received: Int,
    )

    private val json = Json { ignoreUnknownKeys = true }

    private fun scenarios(): List<GoldenScenario> = json.decodeFromString(readLogStreamGoldenJson())

    private var seq = 0

    private fun logEventOf(level: String): LogStreamEvent {
        seq += 1
        return LogStreamReducer.buildLogEvent("{\"level\":\"$level\",\"msg\":\"m\"}", seq, 0L)
    }

    @Test
    fun goldenFileParsesAndIsComprehensive() {
        val all = scenarios()
        assertTrue(all.size >= 8, "golden fixture should be comprehensive, got ${all.size}")
    }

    @Test
    fun everyScenarioMatchesReducerOutput() {
        for (scenario in scenarios()) {
            var state = LogStreamState()
            var paused = false
            for (op in scenario.ops) {
                when (op.op) {
                    "log" -> {
                        val level = requireNotNull(op.level) { "log op needs a level in ${scenario.name}" }
                        if (!paused) {
                            state = LogStreamReducer.appendLog(state, logEventOf(level), scenario.max_events)
                        }
                    }

                    "drop" -> {
                        val count = requireNotNull(op.count) { "drop op needs a count in ${scenario.name}" }
                        if (count > 0) state = LogStreamReducer.applyDrop(state, count)
                    }

                    "pause" -> paused = true
                    "resume" -> paused = false
                    "clear" -> state = LogStreamReducer.cleared(state)
                    else -> error("unknown op ${op.op} in scenario ${scenario.name}")
                }
            }
            assertEquals(
                scenario.expected_levels,
                state.events.map { it.level },
                "scenario '${scenario.name}' buffer-levels mismatch",
            )
            assertEquals(
                scenario.expected_drops,
                state.drops,
                "scenario '${scenario.name}' drops mismatch",
            )
            assertEquals(
                scenario.expected_total_received,
                state.totalReceived,
                "scenario '${scenario.name}' total-received mismatch",
            )
        }
    }
}
