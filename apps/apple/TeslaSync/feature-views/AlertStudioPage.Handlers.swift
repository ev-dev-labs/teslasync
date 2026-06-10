//
//  AlertStudioPage.Handlers.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The AlertStudioViewModel handlers (web `setEditor` + the event callbacks): editor
//  mutation + signal/operator/severity/trigger/escalation coercion, the guarded discard
//  switch, draft recovery, bulk + test-channel selection, URL-backed search, and the
//  save / delete / test / snooze / toggle / bulk mutator flows. Split from the class for
//  the lint length budget; all mutations flow through the seam.
//

import Foundation
import Observation

@MainActor
public extension AlertStudioViewModel {
    // MARK: Editor mutation (web `setEditor`)

    /// Applies an in-place mutation to the editor and persists the new-rule draft (web
    /// `setEditor` + the autosave `skipPersist` guard).
    func updateEditor(_ mutate: (inout EditorState) -> Void) {
        mutate(&editor)
        persistDraftIfNeeded()
    }

    internal func persistDraftIfNeeded() {
        guard isNewRule, !savePending, !deletePending else { return }
        if editor == EditorState.fresh() { return }
        draftStore.save(editor)
    }

    /// Web `handleSignalChange`.
    func handleSignalChange(_ signalName: String) {
        updateEditor { current in
            let signalType = signalName.isEmpty
                ? ASSignalValueType.numeric
                : AlertStudioAdapter.signalTypeForName(signalName, fallbackKind: current.valueKind)
            let nextOp = AlertStudioAdapter.coerceOperatorForSignalType(current.op, signalType)
            current.signalName = signalName
            current.op = nextOp
            current.valueKind = AlertStudioAdapter.valueKindForSignalOp(signalType, nextOp)
        }
    }

    /// Web `handleOperatorChange`.
    func handleOperatorChange(_ nextOp: ASRuleOp) {
        updateEditor { current in
            let signalType = AlertStudioAdapter.signalTypeForName(current.signalName, fallbackKind: current.valueKind)
            let coerced = AlertStudioAdapter.coerceOperatorForSignalType(nextOp, signalType)
            current.op = coerced
            current.valueKind = AlertStudioAdapter.valueKindForSignalOp(signalType, coerced)
        }
    }

    /// Web severity-change handler: drops a now-invalid escalation severity.
    func handleSeverityChange(_ next: ASSeverity) {
        updateEditor { current in
            let escSeverity = current.escalationSeverity
            let stillValid = escSeverity == nil
                || AlertStudioAdapter.severityRank(escSeverity!) > AlertStudioAdapter.severityRank(next)
            current.severity = next
            current.escalationSeverity = stillValid ? escSeverity : nil
        }
    }

    /// Web trigger-mode `onChange`: flipping to once-mode nulls the escalation pair.
    func handleTriggerModeChange(_ selection: ASTriggerSelection) {
        guard selection == .once || selection == .repeatMode else { return }
        updateEditor { current in
            current.triggerMode = selection
            let isRepeat = selection == .repeatMode
            current.escalationEnabled = isRepeat ? current.escalationEnabled : false
            current.escalationAfterMin = isRepeat ? current.escalationAfterMin : ""
            current.escalationSeverity = isRepeat ? current.escalationSeverity : nil
        }
    }

    /// Web escalation-toggle handler: clears the pair when turned off.
    func handleEscalationToggle(_ enabled: Bool) {
        updateEditor { current in
            current.escalationEnabled = enabled
            current.escalationAfterMin = enabled ? current.escalationAfterMin : ""
            current.escalationSeverity = enabled ? current.escalationSeverity : nil
        }
    }

    // MARK: Guarded switches (web `guardSwitch` + `useConfirm`)

    func requestSelectRule(_ rule: ASAlertRule) {
        requestSwitch(.selectRule(rule))
    }

    func requestNewRule() {
        requestSwitch(.newRule)
    }

    func requestCloneTemplate(_ template: RuleTemplate) {
        requestSwitch(.cloneTemplate(template))
    }

    internal func requestSwitch(_ target: ASPendingSwitch) {
        if isDirty {
            pendingSwitch = target
        } else {
            applySwitch(target)
        }
    }

    /// Web discard-confirm "Discard": apply the parked switch.
    func confirmDiscardSwitch() {
        guard let pendingSwitch else { return }
        applySwitch(pendingSwitch)
        self.pendingSwitch = nil
    }

    /// Web discard-confirm "Keep editing": drop the parked switch.
    func cancelDiscardSwitch() {
        pendingSwitch = nil
    }

    internal func applySwitch(_ target: ASPendingSwitch) {
        switch target {
        case let .selectRule(rule):
            let hydrated = AlertStudioAdapter.ruleToEditor(rule)
            let signalType = AlertStudioAdapter.signalTypeForName(
                hydrated.signalName,
                fallbackKind: hydrated.valueKind
            )
            let nextOp = AlertStudioAdapter.coerceOperatorForSignalType(hydrated.op, signalType)
            var finalEditor = hydrated
            finalEditor.op = nextOp
            finalEditor.valueKind = AlertStudioAdapter.valueKindForSignalOp(signalType, nextOp)
            selectedID = rule.id
            setEditorAndBaseline(finalEditor)
            formError = nil
        case .newRule:
            selectedID = nil
            setEditorAndBaseline(.fresh())
            formError = nil
        case let .cloneTemplate(template):
            let next = AlertStudioAdapter.templateToEditor(
                template,
                name: templateName(template),
                message: templateMessage(template)
            )
            selectedID = nil
            setEditorAndBaseline(next)
            showTemplates = false
            formError = nil
        }
    }

    internal func setEditorAndBaseline(_ next: EditorState) {
        editor = next
        initialEditor = next
    }

    // MARK: Draft recovery (web `discardDraft`)

    func discardDraft() {
        draftStore.discard()
        hasDraft = false
        draftSavedAt = nil
    }

    // MARK: Bulk selection (web `bulkSelected`)

    func isBulkSelected(_ id: Int64) -> Bool {
        bulkSelected.contains(id)
    }

    func toggleBulkSelected(_ id: Int64, _ on: Bool) {
        if on { bulkSelected.insert(id) } else { bulkSelected.remove(id) }
    }

    func clearBulk() {
        bulkSelected = []
    }

    /// Web effect: drop any bulk ids no longer in the visible result set.
    func pruneBulkSelectionToVisible() {
        guard !bulkSelected.isEmpty else { return }
        let visible = Set(filteredRules.map(\.id))
        let next = bulkSelected.intersection(visible)
        if next.count != bulkSelected.count { bulkSelected = next }
    }

    // MARK: Rule search (web `useUrlString`)

    func setRuleSearch(_ value: String) {
        ruleSearch = value
        urlSearchSink(value)
        pruneBulkSelectionToVisible()
    }

    // MARK: Test-channel selection (web `handleToggleTestChannel`)

    func isTestChannelSelected(_ id: Int64) -> Bool {
        testChannelIDs == nil || testChannelIDs?.contains(id) == true
    }

    func toggleTestChannel(_ channelID: Int64) {
        let selected = testChannelIDs ?? allChannelIDs
        let next = selected.contains(channelID)
            ? selected.filter { $0 != channelID }
            : selected + [channelID]
        if next.isEmpty { return }
        testChannelIDs = next.count == allChannelIDs.count ? nil : next
    }

    // MARK: Save / delete / test / snooze / toggle / bulk

    /// Web `handleSave`.
    func save() {
        guard canSave, !savePending else { return }
        guard let payload = AlertStudioAdapter.buildSavePayload(editor) else {
            formError = localize.string(
                ASText("forms.validationFailed", "Please fix the highlighted fields and try again.")
            )
            return
        }
        formError = nil
        savePending = true
        Task { [mutator] in
            let ok = await mutator.save(payload)
            savePending = false
            guard ok else { return }
            discardDraft()
            selectedID = nil
            setEditorAndBaseline(.fresh())
            rulesModel.refresh()
        }
    }

    /// Web `handleDelete`.
    func performDelete(id: Int64) {
        guard !deletePending else { return }
        deletePending = true
        Task { [mutator] in
            let ok = await mutator.delete(id: id)
            deletePending = false
            guard ok else { return }
            discardDraft()
            selectedID = nil
            setEditorAndBaseline(.fresh())
            formError = nil
            rulesModel.refresh()
        }
    }

    func requestDelete(_ rule: ASAlertRule) {
        pendingDelete = rule
    }

    func cancelDelete() {
        pendingDelete = nil
    }

    func confirmDelete() {
        guard let rule = pendingDelete else { return }
        pendingDelete = nil
        performDelete(id: rule.id)
    }

    /// Web `handleTest`.
    func test() {
        guard !testPending else { return }
        let trimmed = editor.message.trimmingCharacters(in: .whitespaces)
        let message = trimmed.isEmpty
            ? localize.string(ASText(
                "notifications.alertStudio.test.defaultMessage",
                "Test notification from Alert Studio"
            ))
            : trimmed
        let target = AlertStudioAdapter.buildTestTarget(selectedIDs: testChannelIDs, allIDs: allChannelIDs)
        let request = ASAlertTestRequest(
            message: message,
            msgTemplate: AlertStudioAdapter.normalizeMsgTemplateForSave(editor.msgTemplate),
            includeTitle: editor.includeTitle,
            target: target
        )
        testPending = true
        Task { [mutator] in
            _ = await mutator.test(request)
            testPending = false
        }
    }

    /// Web `handleSnooze`.
    func snooze(id: Int64, minutes: Int) {
        guard !snoozePending else { return }
        snoozePending = true
        Task { [mutator] in
            let ok = await mutator.snooze(id: id, minutes: minutes)
            snoozePending = false
            guard ok else { return }
            snoozeTargetID = nil
            rulesModel.refresh()
        }
    }

    /// Web inline toggle button.
    func toggleEnabled(_ rule: ASAlertRule) {
        Task { [mutator] in
            let ok = await mutator.toggle(id: rule.id, enabled: !rule.enabled)
            if ok { rulesModel.refresh() }
        }
    }

    /// Web bulk enable action.
    func bulkEnable() {
        let ids = Array(bulkSelected)
        guard !ids.isEmpty else { return }
        Task { [mutator] in
            let ok = await mutator.bulkEnable(ids: ids)
            clearBulk()
            if ok { rulesModel.refresh() }
        }
    }

    /// Web bulk disable action.
    func bulkDisable() {
        let ids = Array(bulkSelected)
        guard !ids.isEmpty else { return }
        Task { [mutator] in
            let ok = await mutator.bulkDisable(ids: ids)
            clearBulk()
            if ok { rulesModel.refresh() }
        }
    }
}
