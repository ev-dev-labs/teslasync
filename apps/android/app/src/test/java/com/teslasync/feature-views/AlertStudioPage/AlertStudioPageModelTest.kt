// Off-device unit tests for the AlertStudioPage model + projections (the :android:testReleaseUnitTest gate).
// These cover the framework-free core the composable renders: the template/signal catalog derivation, the
// editor hydration + field transitions, the save-payload builder + submit-time validation (web
// `alertRuleSchema`), the can-save gate, the per-state rules-list projection (loading / error / empty /
// no-match / content + stale/offline), and the i18n key folding that backs every accessible label. The
// composable is a thin render layer over these, so exercising them here is the surface's behavioral contract.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.alertstudiopage

import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.AlertRuleSaveRequest
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertStudioPageModelTest {
    private val fallbackResolver: StringResolver = { _, fallback -> fallback }

    @Suppress("LongParameterList")
    private fun rule(
        id: Long = 1,
        name: String = "Rule",
        enabled: Boolean = true,
        signalName: String = "BatteryLevel",
        op: String = Operators.LT,
        severity: String = Severities.WARN,
        triggerMode: String = TriggerModes.REPEAT,
        valueNum: Double? = 20.0,
        snoozedUntil: String? = null,
        allVehicles: Boolean? = null,
        vehicleIds: List<Long>? = null,
    ): AlertRule =
        AlertRule(
            id = id,
            name = name,
            enabled = enabled,
            signalName = signalName,
            op = op,
            valueNum = valueNum,
            severity = severity,
            cooldownMin = 15,
            triggerMode = triggerMode,
            snoozedUntil = snoozedUntil,
            allVehicles = allVehicles,
            vehicleIds = vehicleIds,
        )

    // ── i18n folding (backs every accessible label) ──────────────────────────────────────────────────────

    @Test
    fun foldCatalogKey_matchesGeneratedResourceNames() {
        assertEquals(
            "translation_notifications_alertStudio_title",
            foldCatalogKey("notifications.alertStudio.title"),
        )
        assertEquals(
            "translation_notifications_alertStudio_rules_selectRow",
            foldCatalogKey("notifications.alertStudio.rules.selectRow"),
        )
        assertEquals("translation_common_delete", foldCatalogKey("common.delete"))
    }

    @Test
    fun resolverFormat_interpolatesPositionalArgs() {
        assertEquals("Select rule Battery", fallbackResolver.format("x", "Select rule %1\$s", "Battery"))
        assertEquals("5 rules", fallbackResolver.format("x", "%1\$s rules", 5))
    }

    // ── Catalog derivation ───────────────────────────────────────────────────────────────────────────────

    @Test
    fun templates_areNonEmpty_andCategoriesSorted() {
        assertTrue(ruleTemplates.size >= 40)
        assertEquals(templateCategories, templateCategories.sorted())
        assertTrue(templateCategories.contains("Battery"))
    }

    @Test
    fun signalCatalog_infersValueTypes() {
        assertEquals(SignalValueType.NUMERIC, signalCatalogByName.getValue("BatteryLevel").valueType)
        assertEquals(SignalValueType.BOOL, signalCatalogByName.getValue("Locked").valueType)
        assertEquals(SignalValueType.TEXT, signalCatalogByName.getValue("ChargeState").valueType)
    }

    // ── Editor defaults + transitions ──────────────────────────────────────────────────────────────────────

    @Test
    fun freshEditor_opensInForceChooseTriState() {
        val editor = freshEditor()
        assertEquals(TriggerModes.UNSET, editor.triggerMode)
        assertEquals(RuleKinds.SIGNAL, editor.kind)
        assertTrue(editor.vehicleSelection is EditorVehicleSelection.AllSticky)
    }

    @Test
    fun applySignalChange_coercesOperatorAndValueKind() {
        // A bool signal cannot keep a numeric '<' operator; it coerces to '='.
        val next = applySignalChange(freshEditor().copy(op = Operators.LT), "Locked")
        assertEquals(Operators.EQ, next.op)
        assertEquals(ValueKind.BOOL, next.valueKind)
    }

    @Test
    fun applyOperatorChange_changedOperatorYieldsNoneValueKind() {
        val next = applyOperatorChange(freshEditor().copy(signalName = "BatteryLevel"), Operators.CHANGED)
        assertEquals(Operators.CHANGED, next.op)
        assertEquals(ValueKind.NONE, next.valueKind)
    }

    @Test
    fun applySeverityChange_clearsNowInvalidEscalationSeverity() {
        val state = freshEditor().copy(severity = Severities.WARN, escalationSeverity = Severities.WARN)
        // Raising the base severity to critical makes a warn escalation a downgrade → cleared.
        assertEquals("", applySeverityChange(state, Severities.CRITICAL).escalationSeverity)
    }

    @Test
    fun applyTriggerModeChange_clearsEscalationWhenLeavingRepeat() {
        val state =
            freshEditor().copy(
                triggerMode = TriggerModes.REPEAT,
                escalationEnabled = true,
                escalationAfterMin = "30",
                escalationSeverity = Severities.CRITICAL,
            )
        val once = applyTriggerModeChange(state, TriggerModes.ONCE)
        assertFalse(once.escalationEnabled)
        assertEquals("", once.escalationAfterMin)
        assertEquals("", once.escalationSeverity)
    }

    // ── Hydration ──────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun ruleToEditor_hydratesSpecificVehicleSelection() {
        val editor = ruleToEditor(rule(vehicleIds = listOf(7, 3), allVehicles = false))
        val selection = editor.vehicleSelection
        assertTrue(selection is EditorVehicleSelection.Specific)
        assertEquals(listOf(7L, 3L), (selection as EditorVehicleSelection.Specific).vehicleIds)
        assertEquals(1L, editor.id)
    }

    @Test
    fun templateToEditor_seedsTypedValueAndMessage() {
        val template = ruleTemplates.first { it.name == "Battery Low (< 20%)" }
        val editor = templateToEditor(template, "My Battery Rule", "Battery at {{BatteryLevel}}%")
        assertEquals("BatteryLevel", editor.signalName)
        assertEquals(ValueKind.NUMBER, editor.valueKind)
        assertEquals("20", editor.valueNum)
        assertEquals("Battery at {{BatteryLevel}}%", editor.msgTemplate)
    }

    // ── Save payload + request ─────────────────────────────────────────────────────────────────────────────

    @Test
    fun buildSavePayload_signalRule_setsOnlyTheNumericSlot() {
        val state =
            freshEditor().copy(
                name = "  Low battery  ",
                signalName = "BatteryLevel",
                op = Operators.LT,
                valueKind = ValueKind.NUMBER,
                valueNum = "15",
                triggerMode = TriggerModes.REPEAT,
            )
        val payload = buildSavePayload(state)
        assertEquals("Low battery", payload.name)
        assertEquals(15.0, payload.valueNum)
        assertNull(payload.valueText)
        assertNull(payload.valueBool)
        assertEquals(true, payload.allVehicles)
    }

    @Test
    fun buildSavePayload_computedMetric_setsMetricFields() {
        val state =
            freshEditor().copy(
                name = "Cost spike",
                kind = RuleKinds.COMPUTED_METRIC,
                metricId = "charging_cost",
                metricWindow = "7d",
                metricOp = ">",
                metricThreshold = "42",
                triggerMode = TriggerModes.ONCE,
            )
        val payload = buildSavePayload(state)
        assertEquals(RuleKinds.COMPUTED_METRIC, payload.kind)
        assertEquals("charging_cost", payload.metricId)
        assertEquals(42.0, payload.metricThreshold)
    }

    @Test
    fun buildSavePayload_repeatEscalation_emitsPair() {
        val state =
            freshEditor().copy(
                name = "Escalating",
                signalName = "BatteryLevel",
                op = Operators.LT,
                valueNum = "10",
                triggerMode = TriggerModes.REPEAT,
                escalationEnabled = true,
                escalationAfterMin = "30",
                severity = Severities.WARN,
                escalationSeverity = Severities.CRITICAL,
            )
        val payload = buildSavePayload(state)
        assertEquals(30, payload.escalationAfterMin)
        assertEquals(Severities.CRITICAL, payload.escalationSeverity)
    }

    @Test
    fun buildSaveRequest_branchesOnId() {
        val create = buildSaveRequest(savableSignalEditor())
        assertTrue(create is AlertRuleSaveRequest.Create)
        val update = buildSaveRequest(savableSignalEditor().copy(id = 9))
        assertTrue(update is AlertRuleSaveRequest.Update)
        assertEquals(9L, (update as AlertRuleSaveRequest.Update).id)
    }

    @Test
    fun buildTestRequest_nullSelectionTargetsAllChannels() {
        val request = buildTestRequest("hi", selectedIds = null, allIds = listOf(1, 2), msgTemplate = "", includeTitle = true)
        assertEquals(true, request.target?.allChannels)
        assertNull(request.msgTemplate)
    }

    // ── Validation (web `alertRuleSchema`) ─────────────────────────────────────────────────────────────────

    @Test
    fun validateForSave_acceptsAValidSignalRule() {
        assertNull(validateForSave(buildSavePayload(savableSignalEditor())))
    }

    @Test
    fun validateForSave_rejectsBlankName() {
        val issue = validateForSave(buildSavePayload(savableSignalEditor().copy(name = "   ")))
        assertEquals(ValidationField.NAME, issue?.field)
    }

    @Test
    fun validateForSave_rejectsEscalationNotHigherThanBase() {
        val state =
            savableSignalEditor().copy(
                triggerMode = TriggerModes.REPEAT,
                escalationEnabled = true,
                escalationAfterMin = "30",
                severity = Severities.CRITICAL,
                escalationSeverity = Severities.WARN,
            )
        // canSave already blocks this, so validate the raw wire input directly.
        val input =
            buildSavePayload(state.copy(escalationEnabled = true)).copy(
                escalationAfterMin = 30,
                escalationSeverity = Severities.WARN,
                severity = Severities.CRITICAL,
            )
        assertEquals(ValidationField.ESCALATION_SEVERITY, validateForSave(input)?.field)
    }

    @Test
    fun validateForSave_rejectsRangeWithMinAboveMax() {
        val input =
            buildSavePayload(
                freshEditor().copy(
                    name = "Range",
                    signalName = "ChargeAmps",
                    op = Operators.BETWEEN,
                    valueKind = ValueKind.RANGE,
                    valueMin = "9",
                    valueMax = "2",
                    triggerMode = TriggerModes.REPEAT,
                ),
            )
        assertEquals(ValidationField.VALUE_MAX, validateForSave(input)?.field)
    }

    @Test
    fun validateForSave_rejectsComputedMetricMissingMetric() {
        val input =
            buildSavePayload(
                freshEditor().copy(
                    name = "Metric",
                    kind = RuleKinds.COMPUTED_METRIC,
                    metricId = "",
                    metricWindow = "7d",
                    metricOp = ">",
                    metricThreshold = "1",
                    triggerMode = TriggerModes.ONCE,
                ),
            )
        assertEquals(ValidationField.METRIC_ID, validateForSave(input)?.field)
    }

    // ── Can-save gate ──────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun canSave_blocksUnsetTriggerModeForNewRule() {
        val state = savableSignalEditor().copy(triggerMode = TriggerModes.UNSET)
        assertFalse(canSave(state, emptyList(), isNewRule = true))
        // An existing rule keeps whatever the server stored — never tri-state.
        assertTrue(canSave(state.copy(triggerMode = TriggerModes.REPEAT), emptyList(), isNewRule = false))
    }

    @Test
    fun canSave_requiresAtLeastOneSpecificVehicle() {
        val state = savableSignalEditor().copy(vehicleSelection = EditorVehicleSelection.Specific(emptyList()))
        assertFalse(canSave(state, emptyList(), isNewRule = true))
    }

    @Test
    fun canSave_validComputedMetricMatchesRegistry() {
        val metrics = listOf(ComputedMetricSummary(id = "cost", windows = listOf("7d"), ops = listOf(">")))
        val state =
            freshEditor().copy(
                name = "Cost",
                kind = RuleKinds.COMPUTED_METRIC,
                metricId = "cost",
                metricWindow = "7d",
                metricOp = ">",
                metricThreshold = "5",
                triggerMode = TriggerModes.ONCE,
            )
        assertTrue(canSave(state, metrics, isNewRule = true))
        assertFalse(canSave(state.copy(metricWindow = "30d"), metrics, isNewRule = true))
    }

    @Test
    fun recommendedTriggerMode_followsOperatorSemantics() {
        assertEquals(TriggerModes.ONCE, recommendedTriggerMode(Operators.EQ))
        assertEquals(TriggerModes.ONCE, recommendedTriggerMode(Operators.CHANGED))
        assertEquals(TriggerModes.REPEAT, recommendedTriggerMode(Operators.GT))
    }

    // ── Snooze parsing ─────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun isSnoozeActive_comparesAgainstNow() {
        assertTrue(isSnoozeActive("2030-01-01T00:00:00Z", nowMillis = 0L))
        assertFalse(isSnoozeActive("2019-01-01T00:00:00Z", nowMillis = parseIsoMillis("2020-01-01T00:00:00Z")!!))
        assertFalse(isSnoozeActive(null, nowMillis = 0L))
        assertFalse(isSnoozeActive("not-a-date", nowMillis = 0L))
    }

    // ── Per-state rules-list projection (loading / error / empty / no-match / content + stale/offline) ──────

    @Test
    fun projectRulesList_loadingWhenColdAndFetching() {
        val projection =
            projectRulesList(emptyList(), "", isLoading = true, isError = false, stale = false, offline = false, refreshing = false)
        assertEquals(RulesListPhase.LOADING, projection.phase)
    }

    @Test
    fun projectRulesList_errorWhenColdFailure() {
        val projection =
            projectRulesList(emptyList(), "", isLoading = false, isError = true, stale = false, offline = false, refreshing = false)
        assertEquals(RulesListPhase.ERROR, projection.phase)
    }

    @Test
    fun projectRulesList_emptyWhenResolvedWithNoRows() {
        val projection =
            projectRulesList(emptyList(), "", isLoading = false, isError = false, stale = false, offline = false, refreshing = false)
        assertEquals(RulesListPhase.EMPTY, projection.phase)
    }

    @Test
    fun projectRulesList_noMatchesWhenSearchExcludesEverything() {
        val projection =
            projectRulesList(
                listOf(rule(name = "Battery")),
                "zzz",
                isLoading = false,
                isError = false,
                stale = false,
                offline = false,
                refreshing = false,
            )
        assertEquals(RulesListPhase.NO_MATCHES, projection.phase)
    }

    @Test
    fun projectRulesList_contentSurfacesStaleAndOffline() {
        val projection =
            projectRulesList(
                listOf(rule(name = "Battery")),
                "bat",
                isLoading = false,
                isError = false,
                stale = true,
                offline = true,
                refreshing = false,
            )
        assertEquals(RulesListPhase.CONTENT, projection.phase)
        assertEquals(1, projection.rules.size)
        assertTrue(projection.stale)
        assertTrue(projection.offline)
    }

    @Test
    fun projectRulesList_showsSearchOnlyBeyondThreshold() {
        val many = (1..4L).map { rule(id = it, name = "Rule $it") }
        assertTrue(
            projectRulesList(many, "", isLoading = false, isError = false, stale = false, offline = false, refreshing = false).showSearch,
        )
        assertFalse(
            projectRulesList(
                many.take(2),
                "",
                isLoading = false,
                isError = false,
                stale = false,
                offline = false,
                refreshing = false,
            ).showSearch,
        )
    }

    @Test
    fun filterTemplates_matchesLocalizedNameMessageOrCategory() {
        val filtered =
            filterTemplates(
                templates = ruleTemplates,
                category = null,
                search = "supercharg",
                label = { templateNameFor(it) },
                message = { it.message },
                categoryLabel = { it },
            )
        assertTrue(filtered.any { it.name.contains("Supercharging") })
    }

    private fun templateNameFor(template: RuleTemplate): String = template.name

    private fun savableSignalEditor(): EditorState =
        freshEditor().copy(
            name = "Low battery",
            signalName = "BatteryLevel",
            op = Operators.LT,
            valueKind = ValueKind.NUMBER,
            valueNum = "15",
            triggerMode = TriggerModes.REPEAT,
        )
}
