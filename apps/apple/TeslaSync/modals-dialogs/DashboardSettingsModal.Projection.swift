//
//  DashboardSettingsModal.Projection.swift
//  TeslaSync — P4 modal / dialog · 0022 · DashboardSettingsModal (Apple)
//
//  The dependency-free projection core for the dashboard-settings modal — the faithful port of the
//  web component's draft seeding (`useState` initializers + the `useEffect` reset), the vehicle-scope
//  option list (web `vehicleOptions`), the body render branches, and the `handleSave` delta logic.
//  Pure Foundation so the draft build, the phase resolution, and the commit deltas are all unit
//  tested without a bundle or a rendered view. The value model + catalogs live in
//  DashboardSettingsModal.Adapter.swift; the state holder that drives these lives in
//  DashboardSettingsModal.Model.swift.
//

import Foundation

/// The dependency-free resolution from the edited dashboard + vehicle list to the editable draft, the
/// scope options, the body phase, and the save deltas.
public enum DashboardSettingsProjection {
    // MARK: Draft build (web `useState` initializers + `useEffect` reset)

    /// Seeds the editable draft from the edited dashboard (web `setSettings(dashboard.settings ??
    /// DEFAULT)`, `setName(dashboard.name)`, `setIcon(dashboard.icon ?? '📊')`).
    public static func buildDraft(from dashboard: DashboardDescriptor) -> DashboardSettingsDraft {
        DashboardSettingsDraft(
            name: dashboard.name,
            icon: dashboard.icon.isEmpty ? DashboardIconCatalog.defaultIcon : dashboard.icon,
            refreshInterval: dashboard.settings.refreshInterval,
            vehicleID: dashboard.settings.vehicleID,
            showWidgetBorders: dashboard.settings.showWidgetBorders,
            compactMode: dashboard.settings.compactMode
        )
    }

    // MARK: Phase + inline failure

    /// The dialog body phase. Loading shows only before the dashboard resolves; once it is on hand the
    /// populated form stays (a failed vehicle-list reload keeps the cached form rather than flashing
    /// the error envelope), and a first-load failure with no resolved dashboard shows the error state.
    /// A resolved-but-absent dashboard (e.g. it was deleted) is the friendly empty state.
    public static func phase(status: DashboardSettingsLoadStatus, hasDashboard: Bool) -> DashboardSettingsPhase {
        switch status {
        case .loading:
            hasDashboard ? .populated : .loading
        case .loaded:
            hasDashboard ? .populated : .empty
        case let .failed(message):
            hasDashboard ? .populated : .error(message)
        }
    }

    /// The failure message kept on screen while a resolved dashboard survives a failed vehicle-list
    /// reload (the inline banner above the form), else `nil`.
    public static func inlineFailure(status: DashboardSettingsLoadStatus, hasDashboard: Bool) -> String? {
        guard hasDashboard, case let .failed(message) = status else { return nil }
        return message
    }

    // MARK: Save deltas (web `handleSave`)

    /// Computes the save deltas from the draft against the original dashboard — the faithful port of
    /// the web `handleSave`: a renamed title only when the trimmed name is non-empty and differs (web
    /// `if (name.trim() && name.trim() !== dashboard.name)`), a changed icon only when it differs (web
    /// `if (icon !== dashboard.icon)`), and the always-applied settings (web `onUpdate(settings)`).
    public static func commit(
        draft: DashboardSettingsDraft,
        original: DashboardDescriptor
    ) -> DashboardSettingsCommit {
        let trimmed = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let renamedName = (!trimmed.isEmpty && trimmed != original.name) ? trimmed : nil
        let changedIcon = (draft.icon != original.icon) ? draft.icon : nil
        return DashboardSettingsCommit(
            renamedName: renamedName,
            changedIcon: changedIcon,
            settings: draft.settings
        )
    }

    /// Whether the draft differs from the original dashboard in any committed field — drives the
    /// "unsaved changes" affordance (the web Save button is always enabled; native mirrors that but
    /// exposes the flag for accessibility + tests).
    public static func isDirty(draft: DashboardSettingsDraft, original: DashboardDescriptor) -> Bool {
        let result = commit(draft: draft, original: original)
        return result.renamedName != nil
            || result.changedIcon != nil
            || result.settings != original.settings
    }
}
