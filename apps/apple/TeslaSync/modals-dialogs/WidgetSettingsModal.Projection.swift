//
//  WidgetSettingsModal.Projection.swift
//  TeslaSync — P4 modal / dialog · 0027 · WidgetSettingsModal (Apple)
//
//  The dependency-free projection core for the widget-settings modal — the faithful port of the web
//  component's draft seeding (`useState(widget.config ?? {})`), the category-driven section visibility
//  (web `isVehicleWidget` / `isChartWidget`), the vehicle-scope option labelling (web `v.display_name
//  || \`Vehicle ${id}\``), the select-value resolution (web `config.x?.toString() ?? 'default'`), the
//  body render branches, and the `handleSave` commit. Pure Foundation so the draft build, the phase
//  resolution, and the commit are all unit tested without a bundle or a rendered view. The value model
//  + catalogs live in WidgetSettingsModal.Adapter.swift; the state holder that drives these lives in
//  WidgetSettingsModal.Model.swift.
//

import Foundation

/// The dependency-free resolution from the edited widget + vehicle list to the editable draft, the
/// section visibility, the body phase, and the save commit.
public enum WidgetSettingsProjection {
    // MARK: Draft build (web `useState(widget.config ?? {})`)

    /// Seeds the editable draft from the edited widget's saved config (web `useState(widget.config ??
    /// {})`).
    public static func buildDraft(from widget: WidgetDescriptor) -> WidgetSettingsDraft {
        WidgetSettingsDraft(
            vehicleID: widget.config.vehicleID,
            refreshRate: widget.config.refreshRate,
            timeRange: widget.config.timeRange,
            showTitle: widget.config.showTitle,
            chartType: widget.config.chartType
        )
    }

    // MARK: Phase + inline failure

    /// The dialog body phase. Loading shows only before the widget resolves; once it is on hand the
    /// populated form stays (a failed vehicle-list reload keeps the cached form rather than flashing
    /// the error envelope), and a first-load failure with no resolved widget shows the error state. A
    /// resolved-but-absent widget (e.g. it was removed) is the friendly empty state.
    public static func phase(status: WidgetSettingsLoadStatus, hasWidget: Bool) -> WidgetSettingsPhase {
        switch status {
        case .loading:
            hasWidget ? .populated : .loading
        case .loaded:
            hasWidget ? .populated : .empty
        case let .failed(message):
            hasWidget ? .populated : .error(message)
        }
    }

    /// The failure message kept on screen while a resolved widget survives a failed vehicle-list
    /// reload (the inline banner above the form), else `nil`.
    public static func inlineFailure(status: WidgetSettingsLoadStatus, hasWidget: Bool) -> String? {
        guard hasWidget, case let .failed(message) = status else { return nil }
        return message
    }

    // MARK: Vehicle-scope labelling (web `v.display_name || \`Vehicle ${id}\``)

    /// The display label for a vehicle option (web `v.display_name || \`Vehicle ${v.id}\``): the
    /// operator name verbatim, or the localized `Vehicle {id}` fallback when the name is blank.
    public static func vehicleLabel(
        for vehicle: WidgetVehicleOption,
        localize: (String, String, String, String) -> String
    ) -> String {
        let trimmed = vehicle.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { return vehicle.displayName }
        return localize("widgetSettings.vehicleFallback", "Vehicle {{id}}", "{{id}}", String(vehicle.id))
    }

    // MARK: Select-value resolution

    /// The refresh option matching a draft's interval, falling back to the per-widget default (web
    /// `<Select>` value `config.refreshRate?.toString() ?? 'default'`).
    public static func refreshOption(for value: Int?) -> WidgetRefreshOption {
        WidgetRefreshCatalog.options.first { $0.value == value }
            ?? WidgetRefreshCatalog.options[0]
    }

    /// The time-range token shown for a draft (web `config.timeRange ?? '7d'`).
    public static func timeRangeValue(for value: String?) -> String {
        value ?? WidgetTimeRangeCatalog.defaultValue
    }

    // MARK: Save commit (web `handleSave`)

    /// Computes the saved config from the draft — the faithful port of the web `handleSave`
    /// (`onSave(config)`): the full edited config (vehicle scope / refresh cadence / time range / show
    /// title) plus the passed-through `chartType`.
    public static func commit(draft: WidgetSettingsDraft) -> WidgetSettingsCommit {
        WidgetSettingsCommit(config: draft.values)
    }

    /// Whether the draft differs from the widget's original saved config — drives the "unsaved
    /// changes" affordance (the web Save button is always enabled; native mirrors that but exposes the
    /// flag for accessibility + tests).
    public static func isDirty(draft: WidgetSettingsDraft, original: WidgetConfigValues) -> Bool {
        draft.values != original
    }
}
