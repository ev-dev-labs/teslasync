package io.teslasync.android.featureviews.actionbuilder

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit tests for the pure ActionBuilder model + projection — the adapter test the prompt requires
 * (the controlled `actions` + `channels` props and localized strings → render-ready surface model). They pin
 * the web-parity action factory, the JavaScript value coercion (`parseInt`/`parseFloat`/`String(number)`),
 * the immutable list operations, the four render-driven states the command-params editor distinguishes
 * (cleared / valid object / not-an-object / unparseable), the option projections, and the i18n fold +
 * resolve-or-fallback contract. Mirrors the web spec (web/src/features/automations/pages/ActionBuilder.tsx).
 */
class ActionBuilderModelTest {
    // ---- registration ------------------------------------------------------------

    @Test
    fun registrationCarriesDiagnosticsSlug() {
        assertEquals("ActionBuilder", ActionBuilderRegistration.SLUG)
    }

    // ---- action kinds ------------------------------------------------------------

    @Test
    fun actionKindWireValuesMatchWebDiscriminators() {
        assertEquals("action_command", AutomationActionKind.Command.wireValue)
        assertEquals("action_notify", AutomationActionKind.Notify.wireValue)
        assertEquals("action_set_setting", AutomationActionKind.SetSetting.wireValue)
        assertEquals("action_call_automation", AutomationActionKind.CallAutomation.wireValue)
    }

    @Test
    fun actionKindFromWireResolvesKnownAndRejectsUnknown() {
        assertEquals(AutomationActionKind.Notify, AutomationActionKind.fromWire("action_notify"))
        assertNull(AutomationActionKind.fromWire("action_unknown"))
    }

    // ---- createDefaultAction (web createDefaultAction) ---------------------------

    @Test
    fun createDefaultCommandSeedsClimateOn() {
        val action = createDefaultAction(AutomationActionKind.Command)
        assertEquals(ActionStepInput.Command(commandName = "climate_on"), action)
    }

    @Test
    fun createDefaultNotifyUsesProvidedChannelAndEmptyTemplate() {
        val action = createDefaultAction(AutomationActionKind.Notify, channelId = 7)
        assertEquals(ActionStepInput.Notify(channelId = 7, template = ""), action)
    }

    @Test
    fun createDefaultSetSettingSeedsEmptyTextValue() {
        val action = createDefaultAction(AutomationActionKind.SetSetting)
        assertEquals(ActionStepInput.SetSetting(settingKey = "", valueText = ""), action)
    }

    @Test
    fun createDefaultCallAutomationSeedsZeroId() {
        val action = createDefaultAction(AutomationActionKind.CallAutomation)
        assertEquals(ActionStepInput.CallAutomation(targetAutomationId = 0), action)
    }

    // ---- defaultChannelId (web channels.find(enabled) ?? channels[0] ?? 0) -------

    @Test
    fun defaultChannelPrefersFirstEnabled() {
        val channels =
            listOf(
                ActionChannel(1, "A", "slack", enabled = false),
                ActionChannel(2, "B", "telegram", enabled = true),
            )
        assertEquals(2, defaultChannelId(channels))
    }

    @Test
    fun defaultChannelFallsBackToFirstThenZero() {
        val firstWhenNoneEnabled =
            listOf(
                ActionChannel(5, "A", "slack", enabled = false),
                ActionChannel(6, "B", "telegram", enabled = false),
            )
        assertEquals(5, defaultChannelId(firstWhenNoneEnabled))
        assertEquals(0, defaultChannelId(emptyList()))
    }

    // ---- settingValueKind + settingValueText (web settingValueKind + value) ------

    @Test
    fun settingValueKindReflectsTheSetField() {
        assertEquals(SettingValueKind.Number, settingValueKind(ActionStepInput.SetSetting("k", valueNum = 1.0)))
        assertEquals(SettingValueKind.Boolean, settingValueKind(ActionStepInput.SetSetting("k", valueBool = false)))
        assertEquals(SettingValueKind.Text, settingValueKind(ActionStepInput.SetSetting("k", valueText = "x")))
        assertEquals(SettingValueKind.Text, settingValueKind(ActionStepInput.SetSetting("k")))
    }

    @Test
    fun settingValueTextRendersEachKindLikeWebStringCoercion() {
        assertEquals("80", settingValueText(ActionStepInput.SetSetting("k", valueNum = 80.0)))
        assertEquals("80.5", settingValueText(ActionStepInput.SetSetting("k", valueNum = 80.5)))
        assertEquals("false", settingValueText(ActionStepInput.SetSetting("k", valueBool = false)))
        assertEquals("enabled", settingValueText(ActionStepInput.SetSetting("k", valueText = "enabled")))
        // Web `String(value_num ?? 0)` / `String(value_bool ?? false)` for an unset value.
        assertEquals("", settingValueText(ActionStepInput.SetSetting("k")))
    }

    // ---- actionWithSettingValue (web actionWithSettingValue) ---------------------

    @Test
    fun actionWithSettingValueSwitchesKindAndDropsOtherFields() {
        val base = ActionStepInput.SetSetting(settingKey = "limit", valueText = "old")

        val asNumber = actionWithSettingValue(base, SettingValueKind.Number, "80")
        assertEquals(ActionStepInput.SetSetting(settingKey = "limit", valueNum = 80.0), asNumber)
        assertNull(asNumber.valueText)
        assertNull(asNumber.valueBool)

        val asBool = actionWithSettingValue(base, SettingValueKind.Boolean, "true")
        assertEquals(ActionStepInput.SetSetting(settingKey = "limit", valueBool = true), asBool)

        val asBoolFalse = actionWithSettingValue(base, SettingValueKind.Boolean, "false")
        assertEquals(false, asBoolFalse.valueBool)

        val asText = actionWithSettingValue(base, SettingValueKind.Text, "enabled")
        assertEquals(ActionStepInput.SetSetting(settingKey = "limit", valueText = "enabled"), asText)
    }

    // ---- immutable list ops (web add/remove/replace/move) ------------------------

    @Test
    fun addActionAppendsACommandSeededWithTheChannel() {
        val before = listOf<ActionStepInput>(ActionStepInput.CallAutomation(1))
        val after = addAction(before, channelId = 3)
        assertEquals(2, after.size)
        assertEquals(ActionStepInput.Command(commandName = "climate_on"), after[1])
    }

    @Test
    fun removeActionDropsTheIndexedEntry() {
        val before =
            listOf<ActionStepInput>(
                ActionStepInput.Command("lock"),
                ActionStepInput.Command("unlock"),
                ActionStepInput.Command("honk"),
            )
        assertEquals(listOf(before[0], before[2]), removeAction(before, 1))
    }

    @Test
    fun replaceActionSwapsOnlyTheIndexedEntry() {
        val before = listOf<ActionStepInput>(ActionStepInput.Command("lock"), ActionStepInput.Command("unlock"))
        val next = ActionStepInput.CallAutomation(9)
        assertEquals(listOf(next, before[1]), replaceAction(before, 0, next))
    }

    @Test
    fun moveActionSwapsNeighboursAndNoOpsAtEdges() {
        val a = ActionStepInput.Command("a")
        val b = ActionStepInput.Command("b")
        val c = ActionStepInput.Command("c")
        val list = listOf<ActionStepInput>(a, b, c)
        assertEquals(listOf(b, a, c), moveAction(list, 1, -1))
        assertEquals(listOf(a, c, b), moveAction(list, 1, 1))
        // Off either end returns the list unchanged (web early return).
        assertEquals(list, moveAction(list, 0, -1))
        assertEquals(list, moveAction(list, 2, 1))
    }

    // ---- parseCommandParams (web ActionFields onChange) --------------------------

    @Test
    fun parseCommandParamsClearsOnBlank() {
        assertEquals(CommandParamsParse.Cleared, parseCommandParams(""))
        assertEquals(CommandParamsParse.Cleared, parseCommandParams("   \n  "))
    }

    @Test
    fun parseCommandParamsAcceptsAJsonObject() {
        val parsed = parseCommandParams("""{"temp": 21}""")
        assertTrue(parsed is CommandParamsParse.Valid)
        val params = (parsed as CommandParamsParse.Valid).params
        assertEquals(JsonPrimitive(21), params["temp"])
    }

    @Test
    fun parseCommandParamsRejectsNonObjects() {
        // Web `isCommandParams`: arrays, scalars and null are not objects.
        assertEquals(CommandParamsParse.NotObject, parseCommandParams("[1, 2, 3]"))
        assertEquals(CommandParamsParse.NotObject, parseCommandParams("42"))
        assertEquals(CommandParamsParse.NotObject, parseCommandParams("\"text\""))
        assertEquals(CommandParamsParse.NotObject, parseCommandParams("null"))
    }

    @Test
    fun parseCommandParamsReportsUnparseableInput() {
        val parsed = parseCommandParams("{not valid")
        assertTrue(parsed is CommandParamsParse.Invalid)
    }

    // ---- formatCommandParams (web JSON.stringify(params, null, 2)) ---------------

    @Test
    fun formatCommandParamsPrettyPrintsAndHandlesNull() {
        val text = formatCommandParams(buildJsonObject { put("temp", 21) })
        assertTrue(text.startsWith("{"))
        assertTrue(text.contains("\"temp\": 21"))
        assertEquals("", formatCommandParams(null))
    }

    @Test
    fun formatThenParseRoundTripsAnObject() {
        val original: JsonObject = buildJsonObject { put("percent", 80) }
        val roundTripped = parseCommandParams(formatCommandParams(original))
        assertTrue(roundTripped is CommandParamsParse.Valid)
        assertEquals(original, (roundTripped as CommandParamsParse.Valid).params)
    }

    // ---- JavaScript numeric coercion ---------------------------------------------

    @Test
    fun jsParseIntReadsLeadingIntegerOrZero() {
        assertEquals(12, jsParseInt("12abc"))
        assertEquals(-5, jsParseInt("-5"))
        assertEquals(3, jsParseInt("3.7"))
        assertEquals(7, jsParseInt("  7 "))
        assertEquals(0, jsParseInt(""))
        assertEquals(0, jsParseInt("abc"))
    }

    @Test
    fun jsParseFloatReadsLeadingFloatOrZero() {
        assertEquals(80.0, jsParseFloat("80"), 0.0)
        assertEquals(80.5, jsParseFloat("80.5"), 0.0)
        assertEquals(1000.0, jsParseFloat("1e3"), 0.0)
        assertEquals(-2.5, jsParseFloat("-2.5x"), 0.0)
        assertEquals(0.0, jsParseFloat(""), 0.0)
        assertEquals(0.0, jsParseFloat("abc"), 0.0)
    }

    @Test
    fun jsNumberToStringDropsTrailingDecimalForWholeNumbers() {
        assertEquals("80", jsNumberToString(80.0))
        assertEquals("0", jsNumberToString(0.0))
        assertEquals("-3", jsNumberToString(-3.0))
        assertEquals("80.5", jsNumberToString(80.5))
    }

    // ---- option projections (web actionTypeOptions / commandOptions / channelOptions) ----

    @Test
    fun actionTypeOptionsFallBackToWebLabelsAndCarryWireValues() {
        val options = buildActionTypeOptions { null }
        assertEquals(4, options.size)
        assertEquals(
            listOf("action_command", "action_notify", "action_set_setting", "action_call_automation"),
            options.map { it.value },
        )
        assertEquals("Vehicle Command", options.first().label)
        assertEquals("Call Automation", options.last().label)
    }

    @Test
    fun actionTypeOptionsResolveLiveCatalogLabelByName() {
        val options = buildActionTypeOptions { name -> if (name == "translation_automations_actions_command") "Befehl" else null }
        assertEquals("Befehl", options.first { it.value == "action_command" }.label)
    }

    @Test
    fun commandOptionsFlattenAllGroupsWithGroupPrefix() {
        val options = buildCommandOptions { null }
        // 6 + 8 + 6 + 2 + 2 + 3 + 2 = 29 commands across the seven groups.
        assertEquals(29, options.size)
        assertEquals("lock", options.first().value)
        assertEquals("Security & Access - Lock Doors", options.first().label)
        assertEquals("wake_up", options.last().value)
        assertEquals("Drive & Software - Wake Up", options.last().label)
    }

    @Test
    fun channelOptionsLabelNameAndKindAndExposeDisabledIds() {
        val channels =
            listOf(
                ActionChannel(1, "Family", "telegram", enabled = true),
                ActionChannel(2, "Ops", "slack", enabled = false),
            )
        val options = channelOptions(channels)
        assertEquals(listOf("Family (telegram)", "Ops (slack)"), options.map { it.label })
        assertEquals(listOf("1", "2"), options.map { it.value })
        assertEquals(setOf("2"), disabledChannelIds(channels))
    }

    // ---- i18n facade -------------------------------------------------------------

    @Test
    fun foldCatalogKeyMatchesGeneratedResourceNames() {
        assertEquals("translation_automations_builder_actionType", foldCatalogKey("automations.builder.actionType"))
        assertEquals("translation_common_true", foldCatalogKey("common.true"))
    }

    @Test
    fun resolveOptionalPrefersCatalogElseFallback() {
        assertEquals("Live", resolveOptional({ "Live" }, "any", "Fallback"))
        assertEquals("Fallback", resolveOptional({ null }, "any", "Fallback"))
        assertEquals("Fallback", resolveOptional({ "   " }, "any", "Fallback"))
    }

    @Test
    fun buildActionBuilderStringsFallsBackToWebDefaults() {
        val strings = buildActionBuilderStrings { null }
        assertEquals("Action Type", strings.actionType)
        assertEquals("Add Action", strings.addAction)
        assertEquals("Params (JSON, optional)", strings.commandParams)
        assertEquals("Params must be a JSON object.", strings.commandParamsObjectError)
        assertEquals("No channels configured", strings.noChannels)
        assertEquals("True", strings.valueTrue)
        assertEquals("False", strings.valueFalse)
        assertEquals("Target Automation ID", strings.targetAutomationId)
    }

    @Test
    fun buildActionBuilderStringsResolvesLiveCatalogEntries() {
        val strings =
            buildActionBuilderStrings { name ->
                if (name == "translation_automations_builder_command") "Befehl" else null
            }
        assertEquals("Befehl", strings.command)
        // Untouched keys still fall back to the web default.
        assertFalse(strings.addAction.isBlank())
        assertEquals("Add Action", strings.addAction)
    }
}
