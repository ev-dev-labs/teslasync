//
//  AlertRulesPageModel.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/AlertRules (Apple) — View Model
//
//  Full parity with `web/src/features/notifications/pages/AlertRulesPage.tsx`. An
//  `@Observable` model that drives the view from the shared KMP core (ADR-004).
//  The web hooks keep their names at the Swift call sites (`useAlertRules`,
//  `useBulkEnableRules`, `useBulkDisableRules`, `useDeleteAlertRule`,
//  `useSaveAlertRule`) inside `AlertRulesDataSource`; that file is the only seam
//  that changes when the generated client lands (P1/S2-S3). The web bulk-selection
//  (`useBulkSelection`) + edit-lease (`useEditLease`) state live here too. The view
//  never touches the network and holds no business logic.
//

import Foundation
import Observation

// MARK: - Render state

/// The page's terminal data states (loading · empty · error · success). `.empty`
/// is a successful load with zero rules (web `rules.length === 0` → `EmptyState`);
/// `.error` is a retryable load failure (web `error` → `ErrorDisplay`); `.success`
/// renders the rules table (web `<table>`).
enum AlertRulesViewState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case success
}

/// The select-all checkbox tri-state (web `useBulkSelection.masterState`).
enum AlertRulesSelectAllState: Equatable, Sendable {
    case none
    case some
    case all
}

// MARK: - View Model

@MainActor
@Observable
final class AlertRulesPageModel {
    /// Web `EditableText maxLength={120}` rename cap.
    static let nameMaxLength = 120

    // Page render state.
    private(set) var viewState: AlertRulesViewState = .loading

    // Source data (web `useAlertRules` result, `rules = rulesRaw ?? []`).
    private(set) var rules: [AlertRule] = []

    // Bulk selection (web `useBulkSelection<number>`), scoped to visible ids.
    private(set) var selectedIDs: Set<Int64> = []

    /// Edit-lease conflict (web `useEditLease` + `EditConflictBanner`): `true`
    /// when another session holds the `alert-rules/list` lease. Surfaced by the
    /// shared edit-lease holder (P1/S8); defaults inactive for a lone session.
    var editConflictActive: Bool

    @ObservationIgnored private let dataSource: any AlertRulesDataSource

    init(
        dataSource: any AlertRulesDataSource = SampleAlertRulesDataSource(),
        editConflictActive: Bool = false
    ) {
        self.dataSource = dataSource
        self.editConflictActive = editConflictActive
    }
}

// MARK: - Lifecycle

extension AlertRulesPageModel {
    /// Initial load (web `useAlertRules`). `.loading` → `.error` on failure, else
    /// `.empty` (no rules) / `.success`.
    func load() async {
        viewState = .loading
        await fetch(resetToLoading: false)
    }

    /// Re-fetches the rules without flashing the skeleton (web background refetch
    /// after a mutation / `usePageTitle` revisit).
    func refresh() async {
        await fetch(resetToLoading: false)
    }

    private func fetch(resetToLoading: Bool) async {
        if resetToLoading { viewState = .loading }
        do {
            rules = try await dataSource.useAlertRules()
        } catch {
            viewState = .error(Self.message(from: error))
            return
        }
        pruneSelection()
        viewState = rules.isEmpty ? .empty : .success
    }

    private static func message(from error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}

// MARK: - Selection (web `useBulkSelection`)

extension AlertRulesPageModel {
    /// Visible row ids in display order (web `visibleIds = rules.map(r => r.id)`).
    var visibleIDs: [Int64] {
        rules.map(\.id)
    }

    var selectedCount: Int {
        selectedIDs.count
    }

    func isSelected(_ id: Int64) -> Bool {
        selectedIDs.contains(id)
    }

    /// Web `masterState(visibleIds)`: all / some / none selected.
    var selectAllState: AlertRulesSelectAllState {
        guard !visibleIDs.isEmpty else { return .none }
        let selectedVisible = visibleIDs.filter(selectedIDs.contains).count
        if selectedVisible == 0 { return .none }
        return selectedVisible == visibleIDs.count ? .all : .some
    }

    /// Toggles one row (web `sel.toggle(r.id)`).
    func toggle(_ id: Int64) {
        if selectedIDs.contains(id) {
            selectedIDs.remove(id)
        } else {
            selectedIDs.insert(id)
        }
    }

    /// Header checkbox (web `sel.toggleAll(visibleIds)`): clears when all are
    /// already selected, otherwise selects every visible row.
    func toggleAll() {
        if selectAllState == .all {
            selectedIDs.removeAll()
        } else {
            selectedIDs = Set(visibleIDs)
        }
    }

    /// Clears the selection (web `sel.clear`).
    func clearSelection() {
        selectedIDs.removeAll()
    }

    /// Drops selected ids that are no longer visible after a refetch.
    private func pruneSelection() {
        let visible = Set(visibleIDs)
        selectedIDs = selectedIDs.intersection(visible)
    }
}

// MARK: - Mutations (web TanStack mutations → invalidate → refetch)

extension AlertRulesPageModel {
    /// Web `bulkEnable.mutateAsync(ids)` then `sel.clear()`.
    func bulkEnable() async {
        let ids = Array(selectedIDs)
        guard !ids.isEmpty else { return }
        try? await dataSource.useBulkEnableRules(ids: ids)
        clearSelection()
        await refresh()
    }

    /// Web `bulkDisable.mutateAsync(ids)` then `sel.clear()`.
    func bulkDisable() async {
        let ids = Array(selectedIDs)
        guard !ids.isEmpty else { return }
        try? await dataSource.useBulkDisableRules(ids: ids)
        clearSelection()
        await refresh()
    }

    /// Web `onBulkDelete`: no bulk endpoint, so `Promise.allSettled` over per-id
    /// DELETE, then `sel.clear()`. Confirmation is handled by the toolbar.
    func bulkDelete() async {
        let ids = Array(selectedIDs)
        guard !ids.isEmpty else { return }
        for id in ids {
            try? await dataSource.useDeleteAlertRule(id: id)
        }
        clearSelection()
        await refresh()
    }

    /// Web `saveRule.mutateAsync({ id, name: next })` from the inline rename.
    func rename(id: Int64, to name: String) async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, validateName(trimmed) == nil else { return }
        try? await dataSource.useSaveAlertRule(id: id, name: trimmed)
        await refresh()
    }

    /// Web `validate(next)`: `> 120` chars → `alertRules.error.nameTooLong`, else nil.
    func validateName(_ next: String) -> String? {
        next.count > Self.nameMaxLength
            ? ARStrings.text("alertRules.error.nameTooLong", "Max 120 characters")
            : nil
    }
}
