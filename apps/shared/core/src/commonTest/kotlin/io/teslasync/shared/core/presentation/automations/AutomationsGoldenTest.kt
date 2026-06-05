package io.teslasync.shared.core.presentation.automations

import io.teslasync.shared.core.data.repo.AutomationsRepository
import io.teslasync.shared.core.data.repo.automationDetailKey
import io.teslasync.shared.core.data.repo.automationHistoryKey
import io.teslasync.shared.core.data.repo.automationHistoryQuery
import io.teslasync.shared.core.data.repo.automationListKey
import io.teslasync.shared.core.data.repo.automationPresetKey
import io.teslasync.shared.core.data.repo.automationPresetsKey
import io.teslasync.shared.core.data.repo.automationPresetsQuery
import io.teslasync.shared.core.net.defaultApiJson
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Language-neutral golden vectors locking the non-trivial, client-side derivations ported from
 * the web `useAutomations` domain (web/src/api/hooks/useAutomations.ts) so the Windows C# port
 * and the KMP core cannot drift (ADR-004):
 *
 *  1. [automationHistoryQuery] / [automationPresetsQuery] — the `/automations/history` and
 *     `/automations/presets` query builders (`limit` always; `category` only when non-empty,
 *     mirroring the web truthy guard `category ? '?category=' + category : ''`).
 *  2. The cache/feed key builders — the web TanStack `automationKeys` / `presetKeys` tuples
 *     (a null OR empty preset category collapses to the un-categorised key).
 *  3. The id-free step-body contract — every `AutomationFullInput` step serializes with a
 *     `kind` discriminator and NO `id`/`automation_id`/`step_id`, so the strict
 *     `DisallowUnknownFields` create/update backend can never 400 the body.
 *
 * Fixtures are inlined to stay within this slice's allowed file scope; the C# port mirrors them.
 */
class AutomationsGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---- query builders -----------------------------------------------------------

    @Serializable
    private data class HistoryQueryRow(
        val name: String,
        val limit: Int,
        val expected: Map<String, String>,
    )

    @Serializable
    private data class PresetsQueryRow(
        val name: String,
        val category: String? = null,
        val expected: Map<String, String>,
    )

    @Test
    fun historyQueryAlwaysSendsLimit() {
        val rows: List<HistoryQueryRow> = json.decodeFromString(HISTORY_QUERY_GOLDEN)
        assertTrue(rows.map { it.name }.containsAll(listOf("default", "custom")))
        for (row in rows) {
            assertEquals(row.expected, automationHistoryQuery(row.limit), "historyQuery('${row.name}')")
        }
    }

    @Test
    fun presetsQueryGuardsBlankCategory() {
        val rows: List<PresetsQueryRow> = json.decodeFromString(PRESETS_QUERY_GOLDEN)
        assertTrue(rows.map { it.name }.containsAll(listOf("null", "blank", "present")))
        for (row in rows) {
            assertEquals(row.expected, automationPresetsQuery(row.category), "presetsQuery('${row.name}')")
        }
    }

    // ---- cache/feed key builders --------------------------------------------------

    @Test
    fun cacheKeyBuildersMatchGolden() {
        assertEquals("list", automationListKey())
        assertEquals("history:20", automationHistoryKey(AutomationsRepository.DEFAULT_HISTORY_LIMIT))
        assertEquals("history:50", automationHistoryKey(50))
        assertEquals("detail:5", automationDetailKey(5))
        assertEquals("preset:p1", automationPresetKey("p1"))
        // Null AND empty category collapse to the un-categorised key (web truthy guard).
        assertEquals("presets", automationPresetsKey(null))
        assertEquals("presets", automationPresetsKey(""))
        assertEquals("presets:comfort", automationPresetsKey("comfort"))
    }

    // ---- id-free step-body contract -----------------------------------------------

    @Test
    fun everyStepKindSerializesIdFreeWithKindDiscriminator() {
        val input =
            AutomationFullInput(
                name = "all-kinds",
                triggers =
                    listOf(
                        AutomationTriggerInput.Signal(stepOrder = 0, signal = "battery_level", op = "<", valueNum = 20.0),
                        AutomationTriggerInput.Geofence(placeId = 3, event = "enter"),
                        AutomationTriggerInput.Schedule(cronExpr = "0 22 * * *", timezone = "UTC"),
                        AutomationTriggerInput.Event(eventType = "drive_start"),
                    ),
                conditions =
                    listOf(
                        AutomationConditionInput.Signal(signal = "soc", op = ">", valueNum = 50.0),
                        AutomationConditionInput.TimeWindow(startTime = "22:00", endTime = "06:00", timezone = "UTC"),
                        AutomationConditionInput.Geofence(placeId = 4, state = "inside"),
                        AutomationConditionInput.OtherAutomation(otherAutomationId = 9, state = "enabled"),
                    ),
                actions =
                    listOf(
                        AutomationActionInput.Command(commandName = "charge_start"),
                        AutomationActionInput.Notify(channelId = 1, template = "done"),
                        AutomationActionInput.SetSetting(settingKey = "charge_limit", valueNum = 80.0),
                        AutomationActionInput.CallAutomation(targetAutomationId = 12),
                    ),
            )

        val body = defaultApiJson.encodeToString(AutomationFullInput.serializer(), input)
        val root = json.parseToJsonElement(body) as JsonObject

        val expectedKinds =
            mapOf(
                "triggers" to listOf("trigger_signal", "trigger_geofence", "trigger_schedule", "trigger_event"),
                "conditions" to
                    listOf(
                        "condition_signal",
                        "condition_time_window",
                        "condition_geofence",
                        "condition_other_automation",
                    ),
                "actions" to listOf("action_command", "action_notify", "action_set_setting", "action_call_automation"),
            )

        for ((lane, kinds) in expectedKinds) {
            val steps = root[lane]!!.jsonArray
            assertEquals(kinds.size, steps.size, "$lane element count")
            steps.forEachIndexed { i, element ->
                val step = element.jsonObject
                assertEquals(kinds[i], step["kind"]!!.jsonPrimitive.content, "$lane[$i] kind")
                // Backend `DisallowUnknownFields` rejects identity fields on a mutation body.
                assertFalse(step.containsKey("id"), "$lane[$i] must not carry id")
                assertFalse(step.containsKey("automation_id"), "$lane[$i] must not carry automation_id")
                assertFalse(step.containsKey("step_id"), "$lane[$i] must not carry step_id")
            }
        }
    }

    @Test
    fun nullOptionalsAreDroppedAndRequiredArraysAlwaysEmit() {
        // Web JSON.stringify parity: undefined/null scalars vanish; the required step arrays
        // are always present (even when empty) because the backend requires them.
        val body = defaultApiJson.encodeToString(AutomationFullInput.serializer(), AutomationFullInput(name = "min"))
        val root = json.parseToJsonElement(body) as JsonObject

        assertEquals("min", root["name"]!!.jsonPrimitive.content)
        assertFalse(root.containsKey("description"))
        assertFalse(root.containsKey("vehicle_id"))
        assertFalse(root.containsKey("enabled"))
        assertTrue(root.containsKey("triggers"))
        assertTrue(root.containsKey("conditions"))
        assertTrue(root.containsKey("actions"))
        assertEquals(0, root["triggers"]!!.jsonArray.size)
    }

    @Test
    fun parityHelpersAreReferencedFromTheDataPort() {
        // Compile-time anchor: the derivations under test are the ones the S7 port exposes.
        assertEquals("AutomationsRepository", AutomationsRepository::class.simpleName)
    }

    private companion object {
        val HISTORY_QUERY_GOLDEN =
            """
            [
              { "name": "default", "limit": 20, "expected": { "limit": "20" } },
              { "name": "custom",  "limit": 50, "expected": { "limit": "50" } }
            ]
            """.trimIndent()

        val PRESETS_QUERY_GOLDEN =
            """
            [
              { "name": "null",                       "expected": {} },
              { "name": "blank",    "category": "",   "expected": {} },
              { "name": "present",  "category": "comfort", "expected": { "category": "comfort" } }
            ]
            """.trimIndent()
    }
}
