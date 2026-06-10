//
//  AlertStudioPage.Copy.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The P1/S10 i18n descriptors for the AlertStudioPage surface — every `t(key,
//  fallback)` pair the web source resolves, named once here so the views stay literal-
//  free and the catalog key + English default never drift. The handful of keys whose
//  web identifier embeds the gate-flagged unit token carry the sanctioned
//  `// parity:allow verbatim web i18n key` opt-out so the ADR-011 stub gate records
//  them as ALLOWED (verbatim parity), never as violations. The fallbacks are the exact
//  web English, so a shared catalog resolves identically across web + native.
//

import Foundation

public enum ASCopy {
    // MARK: Page chrome

    public static let title = ASText("notifications.alertStudio.title", "Alert Studio")
    public static let subtitle = ASText(
        "notifications.alertStudio.subtitle",
        "Create custom rules from Fleet Telemetry signals"
    )
    public static let untitled = ASText("notifications.alertStudio.rules.untitled", "Untitled")

    // MARK: Page actions

    public static let actionsTemplates = ASText("notifications.alertStudio.actions.templates", "Templates")
    public static let actionsNewRule = ASText("notifications.alertStudio.actions.newRule", "New Rule")
    public static let actionsSaving = ASText("notifications.alertStudio.actions.saving", "Saving...")
    public static let actionsUpdateRule = ASText("notifications.alertStudio.actions.updateRule", "Update Rule")
    public static let actionsCreateRule = ASText("notifications.alertStudio.actions.createRule", "Create Rule")
    public static let actionsDelete = ASText("notifications.alertStudio.actions.delete", "Delete")
    public static let actionsTest = ASText("notifications.alertStudio.actions.test", "Test")
    public static let actionsReset = ASText("notifications.alertStudio.actions.reset", "Reset")

    // MARK: Templates panel

    public static let templatesHeader = ASText(
        "notifications.alertStudio.templates.header",
        "Rule Templates - {{count}} pre-built rules"
    )
    public static let templatesSearchPrompt = ASText(
        "notifications.alertStudio.templates.searchPlaceholder", // parity:allow verbatim web i18n key
        "Search templates..." // parity:allow verbatim web i18n key
    )
    public static let templatesAll = ASText("notifications.alertStudio.templates.allCategory", "All")
    public static let templatesUse = ASText("notifications.alertStudio.templates.use", "Use")
    public static let templatesNoMatchesTitle = ASText(
        "notifications.alertStudio.templates.noMatchesTitle",
        "No templates found"
    )
    public static let templatesNoMatches = ASText(
        "notifications.alertStudio.templates.noMatches",
        "No templates match your search"
    )

    // MARK: Rules panel

    public static let rulesTitle = ASText("notifications.alertStudio.rules.title", "Rules")
    public static let rulesCountOne = ASText("notifications.alertStudio.rules.countOne", "1 rule")
    public static let rulesCountMany = ASText("notifications.alertStudio.rules.countMany", "{{count}} rules")
    public static let rulesSearchPrompt = ASText(
        "notifications.alertStudio.rules.searchPlaceholder", "Search rules..." // parity:allow verbatim web i18n key
    )
    public static let rulesEmptyTitle = ASText("notifications.alertStudio.rules.emptyTitle", "No alert rules yet")
    public static let rulesEmptyDescription = ASText(
        "notifications.alertStudio.rules.emptyDescription",
        "Create your first rule or pick a template above."
    )
    public static let rulesNoMatchesTitle = ASText(
        "notifications.alertStudio.rules.noMatchesTitle",
        "No matching rules"
    )
    public static let rulesNoMatches = ASText(
        "notifications.alertStudio.rules.noMatches",
        "No rules match \"{{search}}\""
    )
    public static let rulesSelectRow = ASText("notifications.alertStudio.rules.selectRow", "Select rule {{name}}")
    public static let rulesOnceMode = ASText("notifications.alertStudio.rules.onceMode", "Once")
    public static let rulesOnceModeHint = ASText(
        "notifications.alertStudio.rules.onceModeHint",
        "Fires once until condition resets"
    )
    public static let rulesDisable = ASText("notifications.alertStudio.rules.disable", "Disable")
    public static let rulesEnable = ASText("notifications.alertStudio.rules.enable", "Enable")
    public static let rulesDisableRule = ASText("notifications.alertStudio.rules.disableRule", "Disable rule")
    public static let rulesEnableRule = ASText("notifications.alertStudio.rules.enableRule", "Enable rule")
    public static let rulesDeleteRule = ASText("notifications.alertStudio.rules.deleteRule", "Delete rule")
    public static let rulesConfirmDeleteTitle = ASText(
        "notifications.alertStudio.rules.confirmDeleteTitle",
        "Delete rule?"
    )
    public static let rulesConfirmDelete = ASText(
        "notifications.alertStudio.rules.confirmDelete",
        "Delete \"{{name}}\"?"
    )

    // MARK: Snooze

    public static let snoozeBadge = ASText("notifications.alertStudio.snooze.badge", "Snoozed until {{time}}")
    public static let snoozeManage = ASText("notifications.alertStudio.snooze.manage", "Manage snooze")
    public static let snoozeButton = ASText("notifications.alertStudio.snooze.button", "Snooze")
    public static let snoozeTitle = ASText("notifications.alertStudio.snooze.title", "Snooze \"{{name}}\"")
    public static let snoozeDescription = ASText(
        "notifications.alertStudio.snooze.description",
        "Suppress this rule temporarily. Snooze auto-expires; the rule will fire again afterwards "
            + "if its condition is true."
    )
    public static let snoozeCurrentlySnoozed = ASText(
        "notifications.alertStudio.snooze.currentlySnoozed",
        "Currently snoozed until {{time}}"
    )
    public static let snooze1h = ASText("notifications.alertStudio.snooze.1h", "Snooze 1 hour")
    public static let snooze4h = ASText("notifications.alertStudio.snooze.4h", "Snooze 4 hours")
    public static let snooze24h = ASText("notifications.alertStudio.snooze.24h", "Snooze 24 hours")
    public static let snoozeCancel = ASText("notifications.alertStudio.snooze.cancel", "Cancel snooze")

    // MARK: Editor — headers + identity

    public static let editorEditTitle = ASText("notifications.alertStudio.editor.editTitle", "Edit Rule")
    public static let editorNewTitle = ASText("notifications.alertStudio.editor.newTitle", "New Rule")
    public static let editorNameLabel = ASText("notifications.alertStudio.editor.nameLabel", "Name")
    public static let editorNamePrompt = ASText(
        "notifications.alertStudio.editor.namePlaceholder", "My alert rule" // parity:allow verbatim web i18n key
    )
    public static let editorEnabledLabel = ASText("notifications.alertStudio.editor.enabledLabel", "Status")
    public static let editorEnabled = ASText("notifications.alertStudio.editor.enabled", "Enabled")
    public static let editorDisabled = ASText("notifications.alertStudio.editor.disabled", "Disabled")
    public static let editorVehiclesLabel = ASText("notifications.alertStudio.editor.vehiclesLabel", "Vehicles")
    public static let editorVehiclesEmptyError = ASText(
        "notifications.alertStudio.editor.vehiclesEmptyError",
        "Select at least one vehicle."
    )
    public static let editorKindLabel = ASText("notifications.alertStudio.editor.kindLabel", "Rule type")

    // MARK: Editor — targeting + computed metric (native chrome for the inline pickers)

    public static let kindAllLabel = ASText("notifications.alertStudio.editor.vehiclesAll", "All vehicles")
    public static let kindSpecificLabel = ASText("notifications.alertStudio.editor.vehiclesSpecific", "Specific")
    public static let vehiclesNone = ASText("notifications.alertStudio.editor.vehiclesNone", "No vehicles available")
    public static let metricLabel = ASText("notifications.alertStudio.editor.metricLabel", "Metric")
    public static let metricWindowLabel = ASText("notifications.alertStudio.editor.metricWindowLabel", "Window")
    public static let metricOpLabel = ASText("notifications.alertStudio.editor.metricOpLabel", "Operator")
    public static let metricThresholdLabel = ASText(
        "notifications.alertStudio.editor.metricThresholdLabel",
        "Threshold"
    )
    public static let metricPrompt = ASText("notifications.alertStudio.editor.metricPrompt", "Select a metric")
    public static let metricWindowPrompt = ASText(
        "notifications.alertStudio.editor.metricWindowPrompt",
        "Select a window"
    )
    public static let metricsEmpty = ASText(
        "notifications.alertStudio.editor.metricsEmpty",
        "No computed metrics available"
    )

    // MARK: Editor — kind

    public static let kindSignal = ASText("notifications.alertStudio.kind.signal", "Signal threshold")
    public static let kindComputedMetric = ASText("notifications.alertStudio.kind.computedMetric", "Computed metric")
    public static let kindComputedMetricHint = ASText(
        "notifications.alertStudio.kind.computedMetricHint",
        "Aggregate metric (cost, kWh, distance) over a time window."
    )
    public static let kindSignalHint = ASText(
        "notifications.alertStudio.kind.signalHint",
        "Fires when a raw telemetry signal crosses a threshold."
    )

    // MARK: Editor — signal + operator

    public static let editorSignalNameLabel = ASText("notifications.alertStudio.editor.signalNameLabel", "Signal")
    public static let editorSignalNamePrompt = ASText(
        "notifications.alertStudio.editor.signalNamePlaceholder", // parity:allow verbatim web i18n key
        "Select a telemetry signal" // parity:allow verbatim web i18n key
    )
    public static let editorSignalTypeHint = ASText(
        "notifications.alertStudio.editor.signalTypeHint",
        "{{type}} signal from {{category}}"
    )
    public static let editorOperatorLabel = ASText("notifications.alertStudio.editor.operatorLabel", "Operator")
    public static let editorAllowedOperatorsLabel = ASText(
        "notifications.alertStudio.editor.allowedOperatorsLabel",
        "Allowed Operators"
    )
    public static let editorAllowedOperatorsEmpty = ASText(
        "notifications.alertStudio.editor.allowedOperatorsPlaceholder", // parity:allow verbatim web i18n key
        "Select a signal to see its operators" // parity:allow verbatim web i18n key
    )

    // MARK: Editor — typed value

    public static let editorTypedValueLabel = ASText("notifications.alertStudio.editor.typedValueLabel", "Typed Value")
    public static let editorNoSignalTitle = ASText("notifications.alertStudio.editor.noSignalTitle", "Choose a signal")
    public static let editorNoSignalDescription = ASText(
        "notifications.alertStudio.editor.noSignalDescription",
        "Select a telemetry signal before entering a comparison value."
    )
    public static let editorMinValueLabel = ASText("notifications.alertStudio.editor.minValueLabel", "Minimum Value")
    public static let editorMaxValueLabel = ASText("notifications.alertStudio.editor.maxValueLabel", "Maximum Value")
    public static let editorTextValueLabel = ASText("notifications.alertStudio.editor.textValueLabel", "Text Value")
    public static let editorTextValuePrompt = ASText(
        "notifications.alertStudio.editor.textValuePlaceholder", // parity:allow verbatim web i18n key
        "Value to compare" // parity:allow verbatim web i18n key
    )
    public static let editorBooleanValueLabel = ASText(
        "notifications.alertStudio.editor.booleanValueLabel",
        "Boolean Value"
    )
    public static let editorAnyChangeDescription = ASText(
        "notifications.alertStudio.editor.anyChangeDescription",
        "This rule fires whenever the selected signal changes."
    )
    public static let editorNumericValueLabel = ASText(
        "notifications.alertStudio.editor.numericValueLabel",
        "Numeric Value"
    )
}
