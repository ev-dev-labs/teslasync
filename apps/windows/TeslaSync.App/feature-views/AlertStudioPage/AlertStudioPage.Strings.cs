using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// Every visible literal the <c>AlertStudioPage</c> renders, resolved once through the i18n facade — the native
/// mirror of the 125 <c>t()</c> call sites in web/src/features/notifications/pages/AlertStudioPage.tsx. Each
/// property is resolved by <see cref="Resolve"/> through a single keyed <see cref="ILocalizer.GetString"/> call
/// whose key + verbatim English fallback match the web source exactly, so the resource keys are asserted in
/// tests and resolved through the WinUI resource bridge in the app. Interpolated templates keep their
/// <c>{{token}}</c> slots verbatim; the projection / view substitutes the runtime values. Pure value so
/// it is asserted headlessly.
/// </summary>
public sealed record AlertStudioStrings
{
    // ── page chrome + actions ──
    public string Title { get; init; } = string.Empty;
    public string Subtitle { get; init; } = string.Empty;
    public string ActionsTemplates { get; init; } = string.Empty;
    public string ActionsNewRule { get; init; } = string.Empty;
    public string ActionsCreateRule { get; init; } = string.Empty;
    public string ActionsUpdateRule { get; init; } = string.Empty;
    public string ActionsSaving { get; init; } = string.Empty;
    public string ActionsDelete { get; init; } = string.Empty;
    public string ActionsTest { get; init; } = string.Empty;
    public string ActionsReset { get; init; } = string.Empty;

    // ── common / forms / draft ──
    public string CommonCancel { get; init; } = string.Empty;
    public string CommonDelete { get; init; } = string.Empty;
    public string DraftNounRule { get; init; } = string.Empty;
    public string FormsDiscard { get; init; } = string.Empty;
    public string FormsKeepEditing { get; init; } = string.Empty;
    public string FormsUnsavedRule { get; init; } = string.Empty;
    public string FormsUnsavedTitle { get; init; } = string.Empty;
    public string FormsUnsavedWarning { get; init; } = string.Empty;
    public string FormsValidationFailed { get; init; } = string.Empty;

    // ── bulk ──
    public string BulkEnable { get; init; } = string.Empty;
    public string BulkDisable { get; init; } = string.Empty;
    public string BulkNounRuleOne { get; init; } = string.Empty;
    public string BulkNounRuleOther { get; init; } = string.Empty;

    // ── rules list ──
    public string RulesTitle { get; init; } = string.Empty;
    public string RulesCountOne { get; init; } = string.Empty;
    public string RulesCountMany { get; init; } = string.Empty;
    public string RulesSearchPrompt { get; init; } = string.Empty;
    public string RulesEmptyTitle { get; init; } = string.Empty;
    public string RulesEmptyDescription { get; init; } = string.Empty;
    public string RulesNoMatchesTitle { get; init; } = string.Empty;
    public string RulesNoMatches { get; init; } = string.Empty;
    public string RulesSelectRow { get; init; } = string.Empty;
    public string RulesUntitled { get; init; } = string.Empty;
    public string RulesOnceMode { get; init; } = string.Empty;
    public string RulesOnceModeHint { get; init; } = string.Empty;
    public string RulesEnable { get; init; } = string.Empty;
    public string RulesDisable { get; init; } = string.Empty;
    public string RulesEnableRule { get; init; } = string.Empty;
    public string RulesDisableRule { get; init; } = string.Empty;
    public string RulesDeleteRule { get; init; } = string.Empty;
    public string RulesConfirmDeleteTitle { get; init; } = string.Empty;
    public string RulesConfirmDelete { get; init; } = string.Empty;

    // ── templates ──
    public string TemplatesHeader { get; init; } = string.Empty;
    public string TemplatesSearchPrompt { get; init; } = string.Empty;
    public string TemplatesAllCategory { get; init; } = string.Empty;
    public string TemplatesUse { get; init; } = string.Empty;
    public string TemplatesNoMatchesTitle { get; init; } = string.Empty;
    public string TemplatesNoMatches { get; init; } = string.Empty;

    // ── editor: identity + kind ──
    public string EditorNewTitle { get; init; } = string.Empty;
    public string EditorEditTitle { get; init; } = string.Empty;
    public string NameLabel { get; init; } = string.Empty;
    public string NamePrompt { get; init; } = string.Empty;
    public string EnabledLabel { get; init; } = string.Empty;
    public string EditorEnabled { get; init; } = string.Empty;
    public string EditorDisabled { get; init; } = string.Empty;
    public string VehiclesLabel { get; init; } = string.Empty;
    public string KindLabel { get; init; } = string.Empty;
    public string KindSignal { get; init; } = string.Empty;
    public string KindSignalHint { get; init; } = string.Empty;
    public string KindComputedMetric { get; init; } = string.Empty;
    public string KindComputedMetricHint { get; init; } = string.Empty;

    // ── editor: signal + operator + value ──
    public string SignalNameLabel { get; init; } = string.Empty;
    public string SignalNamePrompt { get; init; } = string.Empty;
    public string SignalTypeHint { get; init; } = string.Empty;
    public string OperatorLabel { get; init; } = string.Empty;
    public string AllowedOperatorsLabel { get; init; } = string.Empty;
    public string AllowedOperatorsPrompt { get; init; } = string.Empty;
    public string TypedValueLabel { get; init; } = string.Empty;
    public string NumericValueLabel { get; init; } = string.Empty;
    public string TextValueLabel { get; init; } = string.Empty;
    public string TextValuePrompt { get; init; } = string.Empty;
    public string BooleanValueLabel { get; init; } = string.Empty;
    public string MinValueLabel { get; init; } = string.Empty;
    public string MaxValueLabel { get; init; } = string.Empty;
    public string AnyChangeDescription { get; init; } = string.Empty;
    public string NoSignalTitle { get; init; } = string.Empty;
    public string NoSignalDescription { get; init; } = string.Empty;
    public string SignalCategoryCustom { get; init; } = string.Empty;
    public string SignalTypeNumeric { get; init; } = string.Empty;
    public string SignalTypeText { get; init; } = string.Empty;
    public string SignalTypeBool { get; init; } = string.Empty;
    public string SignalsOptionLabel { get; init; } = string.Empty;
    public string SignalsCustomOptionLabel { get; init; } = string.Empty;

    // ── editor: severity ──
    public string SeverityLabel { get; init; } = string.Empty;
    public string SeverityInfo { get; init; } = string.Empty;
    public string SeverityWarn { get; init; } = string.Empty;
    public string SeverityCritical { get; init; } = string.Empty;

    // ── editor: behavior + cooldown + escalation ──
    public string CooldownLabel { get; init; } = string.Empty;
    public string AlertBehaviorLabel { get; init; } = string.Empty;
    public string AlertBehaviorPrompt { get; init; } = string.Empty;
    public string AlertBehaviorOnceLabel { get; init; } = string.Empty;
    public string AlertBehaviorOnceDesc { get; init; } = string.Empty;
    public string AlertBehaviorRepeatLabel { get; init; } = string.Empty;
    public string AlertBehaviorRepeatDesc { get; init; } = string.Empty;
    public string AlertBehaviorForceChoose { get; init; } = string.Empty;
    public string AlertBehaviorRecommendBanner { get; init; } = string.Empty;
    public string AlertBehaviorRecommendBannerAlt { get; init; } = string.Empty;
    public string MaxFiresLabel { get; init; } = string.Empty;
    public string MaxFiresPrompt { get; init; } = string.Empty;
    public string MaxFiresHint { get; init; } = string.Empty;
    public string EscalationCheckboxLabel { get; init; } = string.Empty;
    public string EscalationAfterLabel { get; init; } = string.Empty;
    public string EscalationAfterPrompt { get; init; } = string.Empty;
    public string EscalationSeverityLabel { get; init; } = string.Empty;
    public string EscalationSeverityPrompt { get; init; } = string.Empty;
    public string EscalationHint { get; init; } = string.Empty;

    // ── editor: booleans ──
    public string BooleanTrue { get; init; } = string.Empty;
    public string BooleanFalse { get; init; } = string.Empty;

    // ── channels (test delivery target) ──
    public string ChannelsTestTargetLabel { get; init; } = string.Empty;
    public string ChannelsBrowserToast { get; init; } = string.Empty;
    public string ChannelsAlertHistory { get; init; } = string.Empty;
    public string ChannelsExternalChannels { get; init; } = string.Empty;
    public string ChannelsEmptyTitle { get; init; } = string.Empty;
    public string ChannelsEmptyDescription { get; init; } = string.Empty;

    // ── snooze ──
    public string SnoozeButton { get; init; } = string.Empty;
    public string SnoozeManage { get; init; } = string.Empty;
    public string SnoozeBadge { get; init; } = string.Empty;
    public string SnoozeTitle { get; init; } = string.Empty;
    public string SnoozeDescription { get; init; } = string.Empty;
    public string SnoozeCurrentlySnoozed { get; init; } = string.Empty;
    public string Snooze1h { get; init; } = string.Empty;
    public string Snooze4h { get; init; } = string.Empty;
    public string Snooze24h { get; init; } = string.Empty;
    public string SnoozeCancel { get; init; } = string.Empty;

    // ── test ──
    public string TestDefaultMessage { get; init; } = string.Empty;

    /// <summary>
    /// Resolve every visible literal through <paramref name="localizer"/>. Each call site's key + verbatim
    /// English fallback mirror the web <c>t()</c> calls exactly (web AlertStudioPage.tsx).
    /// </summary>
    public static AlertStudioStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string G(string key, string fallback) => localizer.GetString(key, fallback);

        return new AlertStudioStrings
        {
            Title = G("notifications.alertStudio.title", "Alert Studio"),
            Subtitle = G("notifications.alertStudio.subtitle", "Create custom rules from Fleet Telemetry signals"),
            ActionsTemplates = G("notifications.alertStudio.actions.templates", "Templates"),
            ActionsNewRule = G("notifications.alertStudio.actions.newRule", "New Rule"),
            ActionsCreateRule = G("notifications.alertStudio.actions.createRule", "Create Rule"),
            ActionsUpdateRule = G("notifications.alertStudio.actions.updateRule", "Update Rule"),
            ActionsSaving = G("notifications.alertStudio.actions.saving", "Saving..."),
            ActionsDelete = G("notifications.alertStudio.actions.delete", "Delete"),
            ActionsTest = G("notifications.alertStudio.actions.test", "Test"),
            ActionsReset = G("notifications.alertStudio.actions.reset", "Reset"),

            CommonCancel = G("common.cancel", "Cancel"),
            CommonDelete = G("common.delete", "Delete"),
            DraftNounRule = G("draft.noun.rule", "Alert rule"),
            FormsDiscard = G("forms.discard", "Discard"),
            FormsKeepEditing = G("forms.keepEditing", "Keep editing"),
            FormsUnsavedRule = G("forms.unsavedRule", "You have an unsaved alert rule."),
            FormsUnsavedTitle = G("forms.unsavedTitle", "Unsaved changes"),
            FormsUnsavedWarning = G("forms.unsavedWarning", "You have unsaved changes. Discard them?"),
            FormsValidationFailed = G("forms.validationFailed", "Please fix the highlighted fields and try again."),

            BulkEnable = G("bulk.actions.enable", "Enable"),
            BulkDisable = G("bulk.actions.disable", "Disable"),
            BulkNounRuleOne = G("bulk.noun.rule_one", "alert rule"),
            BulkNounRuleOther = G("bulk.noun.rule_other", "alert rules"),

            RulesTitle = G("notifications.alertStudio.rules.title", "Rules"),
            RulesCountOne = G("notifications.alertStudio.rules.countOne", "1 rule"),
            RulesCountMany = G("notifications.alertStudio.rules.countMany", "{{count}} rules"),
            RulesSearchPrompt = G("notifications.alertStudio.rules.searchPlaceholder", "Search rules..."), // parity:allow web i18n key name, not a stub marker
            RulesEmptyTitle = G("notifications.alertStudio.rules.emptyTitle", "No alert rules yet"),
            RulesEmptyDescription = G("notifications.alertStudio.rules.emptyDescription", "Create your first rule or pick a template above."),
            RulesNoMatchesTitle = G("notifications.alertStudio.rules.noMatchesTitle", "No matching rules"),
            RulesNoMatches = G("notifications.alertStudio.rules.noMatches", "No rules match \"{{search}}\""),
            RulesSelectRow = G("notifications.alertStudio.rules.selectRow", "Select rule {{name}}"),
            RulesUntitled = G("notifications.alertStudio.rules.untitled", "Untitled"),
            RulesOnceMode = G("notifications.alertStudio.rules.onceMode", "Once"),
            RulesOnceModeHint = G("notifications.alertStudio.rules.onceModeHint", "Fires once until condition resets"),
            RulesEnable = G("notifications.alertStudio.rules.enable", "Enable"),
            RulesDisable = G("notifications.alertStudio.rules.disable", "Disable"),
            RulesEnableRule = G("notifications.alertStudio.rules.enableRule", "Enable rule"),
            RulesDisableRule = G("notifications.alertStudio.rules.disableRule", "Disable rule"),
            RulesDeleteRule = G("notifications.alertStudio.rules.deleteRule", "Delete rule"),
            RulesConfirmDeleteTitle = G("notifications.alertStudio.rules.confirmDeleteTitle", "Delete rule?"),
            RulesConfirmDelete = G("notifications.alertStudio.rules.confirmDelete", "Delete \"{{name}}\"?"),

            TemplatesHeader = G("notifications.alertStudio.templates.header", "Rule Templates - {{count}} pre-built rules"),
            TemplatesSearchPrompt = G("notifications.alertStudio.templates.searchPlaceholder", "Search templates..."), // parity:allow web i18n key name, not a stub marker
            TemplatesAllCategory = G("notifications.alertStudio.templates.allCategory", "All"),
            TemplatesUse = G("notifications.alertStudio.templates.use", "Use"),
            TemplatesNoMatchesTitle = G("notifications.alertStudio.templates.noMatchesTitle", "No templates found"),
            TemplatesNoMatches = G("notifications.alertStudio.templates.noMatches", "No templates match your search"),

            EditorNewTitle = G("notifications.alertStudio.editor.newTitle", "New Rule"),
            EditorEditTitle = G("notifications.alertStudio.editor.editTitle", "Edit Rule"),
            NameLabel = G("notifications.alertStudio.editor.nameLabel", "Name"),
            NamePrompt = G("notifications.alertStudio.editor.namePlaceholder", "My alert rule"), // parity:allow web i18n key name, not a stub marker
            EnabledLabel = G("notifications.alertStudio.editor.enabledLabel", "Status"),
            EditorEnabled = G("notifications.alertStudio.editor.enabled", "Enabled"),
            EditorDisabled = G("notifications.alertStudio.editor.disabled", "Disabled"),
            VehiclesLabel = G("notifications.alertStudio.editor.vehiclesLabel", "Vehicles"),
            KindLabel = G("notifications.alertStudio.editor.kindLabel", "Rule type"),
            KindSignal = G("notifications.alertStudio.kind.signal", "Signal threshold"),
            KindSignalHint = G("notifications.alertStudio.kind.signalHint", "Fires when a raw telemetry signal crosses a threshold."),
            KindComputedMetric = G("notifications.alertStudio.kind.computedMetric", "Computed metric"),
            KindComputedMetricHint = G("notifications.alertStudio.kind.computedMetricHint", "Aggregate metric (cost, kWh, distance) over a time window."),

            SignalNameLabel = G("notifications.alertStudio.editor.signalNameLabel", "Signal"),
            SignalNamePrompt = G("notifications.alertStudio.editor.signalNamePlaceholder", "Select a telemetry signal"), // parity:allow web i18n key name, not a stub marker
            SignalTypeHint = G("notifications.alertStudio.editor.signalTypeHint", "{{type}} signal from {{category}}"),
            OperatorLabel = G("notifications.alertStudio.editor.operatorLabel", "Operator"),
            AllowedOperatorsLabel = G("notifications.alertStudio.editor.allowedOperatorsLabel", "Allowed Operators"),
            AllowedOperatorsPrompt = G("notifications.alertStudio.editor.allowedOperatorsPlaceholder", "Select a signal to see its operators"), // parity:allow web i18n key name, not a stub marker
            TypedValueLabel = G("notifications.alertStudio.editor.typedValueLabel", "Typed Value"),
            NumericValueLabel = G("notifications.alertStudio.editor.numericValueLabel", "Numeric Value"),
            TextValueLabel = G("notifications.alertStudio.editor.textValueLabel", "Text Value"),
            TextValuePrompt = G("notifications.alertStudio.editor.textValuePlaceholder", "Value to compare"), // parity:allow web i18n key name, not a stub marker
            BooleanValueLabel = G("notifications.alertStudio.editor.booleanValueLabel", "Boolean Value"),
            MinValueLabel = G("notifications.alertStudio.editor.minValueLabel", "Minimum Value"),
            MaxValueLabel = G("notifications.alertStudio.editor.maxValueLabel", "Maximum Value"),
            AnyChangeDescription = G("notifications.alertStudio.editor.anyChangeDescription", "This rule fires whenever the selected signal changes."),
            NoSignalTitle = G("notifications.alertStudio.editor.noSignalTitle", "Choose a signal"),
            NoSignalDescription = G("notifications.alertStudio.editor.noSignalDescription", "Select a telemetry signal before entering a comparison value."),
            SignalCategoryCustom = G("notifications.alertStudio.signalCategories.custom", "Custom"),
            SignalTypeNumeric = G("notifications.alertStudio.signalTypes.numeric", "Numeric"),
            SignalTypeText = G("notifications.alertStudio.signalTypes.text", "Text"),
            SignalTypeBool = G("notifications.alertStudio.signalTypes.bool", "Boolean"),
            SignalsOptionLabel = G("notifications.alertStudio.signals.optionLabel", "{{name}} - {{type}} - {{category}}"),
            SignalsCustomOptionLabel = G("notifications.alertStudio.signals.customOptionLabel", "{{name}} - {{type}} - Custom"),

            SeverityLabel = G("notifications.alertStudio.editor.severityLabel", "Severity"),
            SeverityInfo = G("notifications.alertStudio.severity.info", "Info"),
            SeverityWarn = G("notifications.alertStudio.severity.warn", "Warning"),
            SeverityCritical = G("notifications.alertStudio.severity.critical", "Critical"),

            CooldownLabel = G("notifications.alertStudio.editor.cooldownLabel", "Cooldown (minutes)"),
            AlertBehaviorLabel = G("notifications.alertStudio.editor.alertBehaviorLabel", "Alert Behavior"),
            AlertBehaviorPrompt = G("notifications.alertStudio.editor.alertBehaviorPlaceholder", "\u2014 Choose one \u2014"), // parity:allow web i18n key name, not a stub marker
            AlertBehaviorOnceLabel = G("notifications.alertStudio.editor.alertBehavior.onceLabel", "Notify on event"),
            AlertBehaviorOnceDesc = G("notifications.alertStudio.editor.alertBehavior.onceDesc", "Fires when the condition is first met. Stays quiet until it resets."),
            AlertBehaviorRepeatLabel = G("notifications.alertStudio.editor.alertBehavior.repeatLabel", "Re-alert until resolved"),
            AlertBehaviorRepeatDesc = G("notifications.alertStudio.editor.alertBehavior.repeatDesc", "Keeps firing every {{cooldown}} minutes while the condition stays true."),
            AlertBehaviorForceChoose = G("notifications.alertStudio.editor.alertBehavior.forceChoose", "Pick how this alert should behave."),
            AlertBehaviorRecommendBanner = G("notifications.alertStudio.editor.alertBehavior.recommendBanner", "Recommended for \"{{op}}\" comparisons: {{recommended}}."),
            AlertBehaviorRecommendBannerAlt = G("notifications.alertStudio.editor.alertBehavior.recommendBannerAlt", "{{alternative}} is also valid \u2014 pick whatever fits."),
            MaxFiresLabel = G("notifications.alertStudio.editor.maxFiresLabel", "Max alerts before condition resolves"),
            MaxFiresPrompt = G("notifications.alertStudio.editor.maxFiresPlaceholder", "Leave blank for unlimited"), // parity:allow web i18n key name, not a stub marker
            MaxFiresHint = G("notifications.alertStudio.editor.maxFiresHint", "Only applies to repeat-mode rules. Once-mode already caps at 1 per resolution."),
            EscalationCheckboxLabel = G("notifications.alertStudio.editor.escalationCheckboxLabel", "Escalate to a higher severity if the condition stays unresolved"),
            EscalationAfterLabel = G("notifications.alertStudio.editor.escalationAfterLabel", "Escalate after (minutes)"),
            EscalationAfterPrompt = G("notifications.alertStudio.editor.escalationAfterPlaceholder", "e.g. 30"), // parity:allow web i18n key name, not a stub marker
            EscalationSeverityLabel = G("notifications.alertStudio.editor.escalationSeverityLabel", "Escalated severity"),
            EscalationSeverityPrompt = G("notifications.alertStudio.editor.escalationSeverityPlaceholder", "Select severity\u2026"), // parity:allow web i18n key name, not a stub marker
            EscalationHint = G("notifications.alertStudio.editor.escalationHint", "Only repeat-mode rules can escalate. The escalated severity must be higher than the base severity."),

            BooleanTrue = G("notifications.alertStudio.boolean.true", "True"),
            BooleanFalse = G("notifications.alertStudio.boolean.false", "False"),

            ChannelsTestTargetLabel = G("notifications.alertStudio.channels.testTargetLabel", "Test Delivery Target"),
            ChannelsBrowserToast = G("notifications.alertStudio.channels.browserToast", "Browser toast notification (real-time via SSE)"),
            ChannelsAlertHistory = G("notifications.alertStudio.channels.alertHistory", "Alert history (saved to database)"),
            ChannelsExternalChannels = G("notifications.alertStudio.channels.externalChannels", "External channels for test notifications:"),
            ChannelsEmptyTitle = G("notifications.alertStudio.channels.emptyTitle", "No external channels configured"),
            ChannelsEmptyDescription = G("notifications.alertStudio.channels.emptyDescription", "Browser toasts and alert history are always enabled. Configure channels from Notifications to fan out alerts."),

            SnoozeButton = G("notifications.alertStudio.snooze.button", "Snooze"),
            SnoozeManage = G("notifications.alertStudio.snooze.manage", "Manage snooze"),
            SnoozeBadge = G("notifications.alertStudio.snooze.badge", "Snoozed until {{time}}"),
            SnoozeTitle = G("notifications.alertStudio.snooze.title", "Snooze \"{{name}}\""),
            SnoozeDescription = G("notifications.alertStudio.snooze.description", "Suppress this rule temporarily. Snooze auto-expires; the rule will fire again afterwards if its condition is true."),
            SnoozeCurrentlySnoozed = G("notifications.alertStudio.snooze.currentlySnoozed", "Currently snoozed until {{time}}"),
            Snooze1h = G("notifications.alertStudio.snooze.1h", "Snooze 1 hour"),
            Snooze4h = G("notifications.alertStudio.snooze.4h", "Snooze 4 hours"),
            Snooze24h = G("notifications.alertStudio.snooze.24h", "Snooze 24 hours"),
            SnoozeCancel = G("notifications.alertStudio.snooze.cancel", "Cancel snooze"),

            TestDefaultMessage = G("notifications.alertStudio.test.defaultMessage", "Test notification from Alert Studio"),
        };
    }
}
