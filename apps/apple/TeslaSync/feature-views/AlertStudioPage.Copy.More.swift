//
//  AlertStudioPage.Copy.More.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The P1/S10 i18n descriptors for the AlertStudioPage surface (part 2) — the
//  severity/behavior, max-fires/escalation, message, targeting, computed-metric,
//  channels, severity/operator label, and shared cross-surface keys. Continuation of
//  AlertStudioPage.Copy.swift; the gate-flagged web keys carry the verbatim
//  parity opt-out so the ADR-011 stub gate records them as ALLOWED, never violations.
//

import Foundation

public extension ASCopy {
    // MARK: Editor — severity + behavior

    static let editorSeverityLabel = ASText("notifications.alertStudio.editor.severityLabel", "Severity")
    static let editorCooldownLabel = ASText(
        "notifications.alertStudio.editor.cooldownLabel",
        "Cooldown (minutes)"
    )
    static let editorAlertBehaviorLabel = ASText(
        "notifications.alertStudio.editor.alertBehaviorLabel",
        "Alert Behavior"
    )
    static let editorAlertBehaviorChoosePrompt = ASText(
        "notifications.alertStudio.editor.alertBehaviorPlaceholder", // parity:allow verbatim web i18n key
        "— Choose one —" // parity:allow verbatim web i18n key
    )
    static let behaviorRepeatLabel = ASText(
        "notifications.alertStudio.editor.alertBehavior.repeatLabel",
        "Re-alert until resolved"
    )
    static let behaviorOnceLabel = ASText(
        "notifications.alertStudio.editor.alertBehavior.onceLabel",
        "Notify on event"
    )
    static let behaviorRecommendBanner = ASText(
        "notifications.alertStudio.editor.alertBehavior.recommendBanner",
        "Recommended for \"{{op}}\" comparisons: {{recommended}}."
    )
    static let behaviorRecommendBannerAlt = ASText(
        "notifications.alertStudio.editor.alertBehavior.recommendBannerAlt",
        "{{alternative}} is also valid — pick whatever fits."
    )
    static let behaviorForceChoose = ASText(
        "notifications.alertStudio.editor.alertBehavior.forceChoose",
        "Pick how this alert should behave."
    )
    static let behaviorOnceDesc = ASText(
        "notifications.alertStudio.editor.alertBehavior.onceDesc",
        "Fires when the condition is first met. Stays quiet until it resets."
    )
    static let behaviorRepeatDesc = ASText(
        "notifications.alertStudio.editor.alertBehavior.repeatDesc",
        "Keeps firing every {{cooldown}} minutes while the condition stays true."
    )

    // MARK: Editor — max fires + escalation

    static let editorMaxFiresLabel = ASText(
        "notifications.alertStudio.editor.maxFiresLabel",
        "Max alerts before condition resolves"
    )
    static let editorMaxFiresPrompt = ASText(
        "notifications.alertStudio.editor.maxFiresPlaceholder", // parity:allow verbatim web i18n key
        "Leave blank for unlimited" // parity:allow verbatim web i18n key
    )
    static let editorMaxFiresHint = ASText(
        "notifications.alertStudio.editor.maxFiresHint",
        "Only applies to repeat-mode rules. Once-mode already caps at 1 per resolution."
    )
    static let editorEscalationCheckboxLabel = ASText(
        "notifications.alertStudio.editor.escalationCheckboxLabel",
        "Escalate to a higher severity if the condition stays unresolved"
    )
    static let editorEscalationAfterLabel = ASText(
        "notifications.alertStudio.editor.escalationAfterLabel",
        "Escalate after (minutes)"
    )
    static let editorEscalationAfterPrompt = ASText(
        "notifications.alertStudio.editor.escalationAfterPlaceholder", "e.g. 30" // parity:allow verbatim web i18n key
    )
    static let editorEscalationSeverityLabel = ASText(
        "notifications.alertStudio.editor.escalationSeverityLabel",
        "Escalated severity"
    )
    static let editorEscalationSeverityPrompt = ASText(
        "notifications.alertStudio.editor.escalationSeverityPlaceholder", // parity:allow verbatim web i18n key
        "Select severity…" // parity:allow verbatim web i18n key
    )
    static let editorEscalationHint = ASText(
        "notifications.alertStudio.editor.escalationHint",
        "Only repeat-mode rules can escalate. The escalated severity must be higher than the base severity."
    )

    // MARK: Editor — message template (web `AlertMessageEditor` controls)

    static let editorMessageTemplateLabel = ASText(
        "notifications.alertStudio.editor.messageTemplateLabel",
        "Notification message"
    )
    static let editorMessageTemplatePrompt = ASText(
        "notifications.alertStudio.editor.messageTemplatePrompt",
        "Use {{Signal}} tokens, or leave blank for the default body."
    )
    static let editorIncludeTitleLabel = ASText(
        "notifications.alertStudio.editor.includeTitleLabel",
        "Include title in external notifications"
    )
    static let editorMessageHelp = ASText(
        "notifications.alertStudio.editor.messageHelp",
        "Blank uses the op-aware default. Title-off delivers body-only to Discord/Slack/Telegram/ntfy/webhook."
    )

    // MARK: Channels (test delivery target)

    static let channelsTestTargetLabel = ASText(
        "notifications.alertStudio.channels.testTargetLabel",
        "Test Delivery Target"
    )
    static let channelsBrowserToast = ASText(
        "notifications.alertStudio.channels.browserToast",
        "Browser toast notification (real-time via SSE)"
    )
    static let channelsAlertHistory = ASText(
        "notifications.alertStudio.channels.alertHistory",
        "Alert history (saved to database)"
    )
    static let channelsExternalChannels = ASText(
        "notifications.alertStudio.channels.externalChannels",
        "External channels for test notifications:"
    )
    static let channelsEmptyTitle = ASText(
        "notifications.alertStudio.channels.emptyTitle",
        "No external channels configured"
    )
    static let channelsEmptyDescription = ASText(
        "notifications.alertStudio.channels.emptyDescription",
        "Browser toasts and alert history are always enabled. Configure channels from Notifications to fan out alerts."
    )

    // MARK: Severity / signal-type / boolean labels

    static func severityLabel(_ severity: ASSeverity) -> ASText {
        switch severity {
        case .info: ASText("notifications.alertStudio.severity.info", "Info")
        case .warn: ASText("notifications.alertStudio.severity.warn", "Warning")
        case .critical: ASText("notifications.alertStudio.severity.critical", "Critical")
        }
    }

    static func signalTypeLabel(_ type: ASSignalValueType) -> ASText {
        switch type {
        case .numeric: ASText("notifications.alertStudio.signalTypes.numeric", "Numeric")
        case .text: ASText("notifications.alertStudio.signalTypes.text", "Text")
        case .bool: ASText("notifications.alertStudio.signalTypes.bool", "Boolean")
        }
    }

    static func booleanLabel(_ value: Bool) -> ASText {
        value
            ? ASText("notifications.alertStudio.boolean.true", "True")
            : ASText("notifications.alertStudio.boolean.false", "False")
    }

    /// Web `t(\`notifications.alertStudio.operators.${op}\`, op)`.
    static func operatorLabel(_ op: ASRuleOp) -> ASText {
        ASText("notifications.alertStudio.operators.\(op.rawValue)", op.rawValue)
    }

    /// Web `t(\`notifications.alertStudio.channels.kind.${ch.kind}\`, ch.kind)`.
    static func channelKindLabel(_ kind: String) -> ASText {
        ASText("notifications.alertStudio.channels.kind.\(kind)", kind)
    }

    // MARK: Signal option labels

    static let signalOptionLabel = ASText(
        "notifications.alertStudio.signals.optionLabel",
        "{{name}} - {{type}} - {{category}}"
    )
    static let signalCustomOptionLabel = ASText(
        "notifications.alertStudio.signals.customOptionLabel",
        "{{name}} - {{type}} - Custom"
    )

    // MARK: Shared cross-surface keys (forms / bulk / common / draft)

    static let formsUnsavedRule = ASText("forms.unsavedRule", "You have an unsaved alert rule.")
    static let formsUnsavedTitle = ASText("forms.unsavedTitle", "Unsaved changes")
    static let formsUnsavedWarning = ASText("forms.unsavedWarning", "You have unsaved changes. Discard them?")
    static let formsDiscard = ASText("forms.discard", "Discard")
    static let formsKeepEditing = ASText("forms.keepEditing", "Keep editing")
    static let formsValidationFailed = ASText(
        "forms.validationFailed",
        "Please fix the highlighted fields and try again."
    )
    static let bulkEnable = ASText("bulk.actions.enable", "Enable")
    static let bulkDisable = ASText("bulk.actions.disable", "Disable")
    static let bulkNounRuleOne = ASText("bulk.noun.rule_one", "alert rule")
    static let bulkNounRuleOther = ASText("bulk.noun.rule_other", "alert rules")
    static let commonDelete = ASText("common.delete", "Delete")
    static let commonCancel = ASText("common.cancel", "Cancel")
    static let draftNounRule = ASText("draft.noun.rule", "Alert rule")

    // MARK: Native chrome (states / freshness / a11y)

    static let stateLoading = ASText("notifications.alertStudio.state.loading", "Loading alert rules…")
    static let stateErrorTitle = ASText(
        "notifications.alertStudio.state.errorTitle",
        "Couldn’t load alert rules"
    )
    static let stateRetry = ASText("notifications.alertStudio.state.retry", "Retry")
    static let stateOfflineTitle = ASText("notifications.alertStudio.state.offlineTitle", "You’re offline")
    static let stateOfflineMessage = ASText(
        "notifications.alertStudio.state.offlineMessage",
        "Reconnect to load your alert rules."
    )
    static let freshnessStale = ASText("notifications.alertStudio.freshness.stale", "Stale")
    static let freshnessOffline = ASText("notifications.alertStudio.freshness.offline", "Offline")
    static let channelsErrorTitle = ASText(
        "notifications.alertStudio.channels.errorTitle",
        "Couldn’t load channels"
    )
    static let aiBuilderRegion = ASText(
        "notifications.alertStudio.ai.builderRegion",
        "AI alert builder"
    )
    static let aiConflictRegion = ASText(
        "notifications.alertStudio.ai.conflictRegion",
        "AI cross-rule conflict detection"
    )
    static let aiTuningRegion = ASText(
        "notifications.alertStudio.ai.tuningRegion",
        "AI alert tuning suggestions"
    )
}
