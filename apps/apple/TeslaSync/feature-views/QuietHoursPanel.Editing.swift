//
//  QuietHoursPanel.Editing.swift
//  TeslaSync — P4 feature view · 0210 · QuietHoursPanel (Apple)
//
//  The draft CRUD + write flows for `QuietHoursModel`, split out from the model core for
//  the lint length budget. This is the native parity of the web `startCreate` /
//  `startEdit` / `cancel` / `toggleWeekday` / `toggleSeverity` / `submit` /
//  `removeWindow` handlers plus the controlled-input bindings (web `value` /
//  `onChange`). Validation routes through `QuietHoursValidator`; the writes route
//  through the injected `QuietHoursWriter`; every outcome raises the matching toast.
//

import Foundation

public extension QuietHoursModel {
    // MARK: - Open / close the form (web `startCreate` / `startEdit` / `cancel`)

    /// Opens a fresh "New window" form seeded with the resolved local timezone (web
    /// `startCreate`).
    func startCreate() {
        draft = QuietHoursDraft.makeNew(defaultTimezone: defaultTimezone())
        validationError = nil
        recomputePhase()
    }

    /// Opens an "Edit window" form copied from an existing row (web `startEdit`).
    func startEdit(_ item: QuietHoursWindowItem) {
        draft = QuietHoursDraft.makeEditing(from: item)
        validationError = nil
        recomputePhase()
    }

    /// Closes the form without saving (web `cancel`).
    func cancel() {
        draft = nil
        validationError = nil
        recomputePhase()
    }

    // MARK: - Field edits (web `toggleWeekday` / `toggleSeverity`)

    /// Flips a weekday bit in the open draft (web `toggleWeekday`).
    func toggleWeekday(_ bit: Int) {
        mutateDraft { $0.weekdays = QuietHoursWeekdays.toggled($0.weekdays, bit: bit) }
    }

    /// Adds or removes a bypass severity in the open draft (web `toggleSeverity`).
    func toggleSeverity(_ token: String) {
        mutateDraft { draft in
            if let index = draft.bypassSeverities.firstIndex(of: token) {
                draft.bypassSeverities.remove(at: index)
            } else {
                draft.bypassSeverities.append(token)
            }
        }
    }

    /// Whether a weekday bit is set in the open draft.
    func isWeekdayOn(_ bit: Int) -> Bool {
        guard let draft else { return false }
        return QuietHoursWeekdays.isOn(draft.weekdays, bit: bit)
    }

    /// Whether a bypass severity is allowed through in the open draft.
    func isSeverityOn(_ token: String) -> Bool {
        draft?.allows(token) ?? false
    }

    // MARK: - Controlled bindings (web controlled inputs `value` + `onChange`)

    /// The "Enabled" toggle binding (web `draft.enabled`).
    var draftEnabled: Bool {
        get { draft?.enabled ?? false }
        set { mutateDraft { $0.enabled = newValue } }
    }

    /// The IANA timezone selection binding (web `draft.timezone`).
    var draftTimezone: String {
        get { draft?.timezone ?? "UTC" }
        set { mutateDraft { $0.timezone = newValue } }
    }

    /// The start-time picker binding (web `<input type="time">` ↔ `draft.start_local`).
    var draftStartTime: Date {
        get { QuietHoursClock.date(fromHHMM: draft?.startLocal ?? "23:00", calendar: calendar) }
        set { mutateDraft { $0.startLocal = QuietHoursClock.hhmm(fromDate: newValue, calendar: calendar) } }
    }

    /// The end-time picker binding (web `<input type="time">` ↔ `draft.end_local`).
    var draftEndTime: Date {
        get { QuietHoursClock.date(fromHHMM: draft?.endLocal ?? "07:00", calendar: calendar) }
        set { mutateDraft { $0.endLocal = QuietHoursClock.hhmm(fromDate: newValue, calendar: calendar) } }
    }

    private func mutateDraft(_ transform: (inout QuietHoursDraft) -> Void) {
        guard var current = draft else { return }
        transform(&current)
        draft = current
    }

    // MARK: - Submit (web `submit` → `useSaveQuietHours`)

    /// Validates + persists the open draft. On an invalid draft it surfaces the matching
    /// localized message (web `setValidationError`); otherwise it awaits the writer,
    /// raises the created/updated or save-error toast, and on success closes the form +
    /// refreshes the list (web `onSuccess` → `cancel()` + invalidation).
    func submit() async {
        guard let draft else { return }
        let validation = QuietHoursValidator.validate(draft)
        guard validation.ok else {
            validationError = QuietHoursValidator.message(for: validation, localize: localize)
            return
        }
        validationError = nil
        isSaving = true
        let payload = QuietHoursSavePayload.from(draft: draft)
        let result = await writer.save(payload)
        isSaving = false
        applySaveResult(result, isUpdate: payload.isUpdate)
    }

    private func applySaveResult(_ result: QuietHoursWriteResult, isUpdate: Bool) {
        switch result {
        case .success:
            let title = isUpdate
                ? localize("toast.quietHours.updated", "Quiet hours window updated")
                : localize("toast.quietHours.created", "Quiet hours window created")
            raiseToast(QuietHoursToast(kind: .success, title: title))
            cancel()
            source.refresh()
        case let .failure(message):
            raiseToast(QuietHoursToast(
                kind: .error,
                title: localize("toast.quietHours.saveError", "Failed to save quiet hours window"),
                message: message
            ))
        }
    }

    // MARK: - Delete (web `removeWindow` → `useDeleteQuietHours`)

    /// Deletes a window. Awaits the writer, raises the removed or delete-error toast, and
    /// on success refreshes the list (web `onSuccess` → invalidation).
    func removeWindow(_ item: QuietHoursWindowItem) async {
        deletingID = item.id
        let result = await writer.delete(id: item.id)
        deletingID = nil
        switch result {
        case .success:
            raiseToast(QuietHoursToast(
                kind: .success,
                title: localize("toast.quietHours.deleted", "Quiet hours window removed")
            ))
            source.refresh()
        case let .failure(message):
            raiseToast(QuietHoursToast(
                kind: .error,
                title: localize("toast.quietHours.deleteError", "Failed to delete quiet hours window"),
                message: message
            ))
        }
    }
}
