//
//  SignalConfigModal.Projection.swift
//  TeslaSync — P4 modal / dialog · 0016 · SignalConfigModal (Apple)
//
//  The dependency-free projection core for the signal-configuration modal — the faithful port of the
//  web component's `useMemo` maps, the per-row / per-category / master mutators, and the render
//  branches. Pure Foundation so the draft build, the search filter, the category grouping, the
//  selection counts + tri-state, the body phase, the footer summary, the submit payload, and the
//  category icon are all unit-tested without a bundle or a rendered view. The interval catalog +
//  presets live in SignalConfigModal.Adapter.swift; the state holder that drives these lives in
//  SignalConfigModal.Model.swift.
//

import Foundation

/// The dependency-free resolution from the catalog + draft rows to the grouped list, the counts, the
/// phase, the summary, and the submit payload — plus the pure mutators the model applies.
public enum SignalConfigProjection {
    // MARK: Draft build (web `useState` initializer)

    /// Builds the editable draft from the catalog (web
    /// `categories.flatMap(cat => cat.fields.map(f => ({ name, category, selected, interval })))`):
    /// each field becomes a row pre-selected iff it is in `initialSelected`, at `initialInterval`.
    public static func buildRows(
        catalog: [SignalConfigCategoryCatalog],
        initialSelected: [String],
        initialInterval: Int
    ) -> [SignalConfigRow] {
        let selectedSet = Set(initialSelected)
        return catalog.flatMap { category in
            category.fields.map { field in
                SignalConfigRow(
                    name: field,
                    category: category.category,
                    selected: selectedSet.contains(field),
                    interval: initialInterval
                )
            }
        }
    }

    // MARK: Filter + group (web `filtered` / `grouped`)

    /// Filters rows by a case-insensitive name query (web
    /// `signals.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))`). A blank query
    /// returns every row.
    public static func filter(rows: [SignalConfigRow], search: String) -> [SignalConfigRow] {
        let needle = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return rows }
        return rows.filter { $0.name.lowercased().contains(needle) }
    }

    /// Groups rows by category preserving first-appearance order (web `grouped` `Map`, fed by the
    /// catalog-ordered `filtered` list).
    public static func group(rows: [SignalConfigRow]) -> [SignalConfigGroup] {
        var order: [String] = []
        var buckets: [String: [SignalConfigRow]] = [:]
        for row in rows {
            if buckets[row.category] == nil { order.append(row.category) }
            buckets[row.category, default: []].append(row)
        }
        return order.map { SignalConfigGroup(category: $0, rows: buckets[$0] ?? []) }
    }

    // MARK: Counts + selection state

    /// The number of selected rows (web `selectedCount`).
    public static func selectedCount(_ rows: [SignalConfigRow]) -> Int {
        rows.reduce(0) { $0 + ($1.selected ? 1 : 0) }
    }

    /// Whether every row is selected (web `allSelected = selectedCount === totalCount`). An empty
    /// draft is treated as not-all-selected so the master toggle reads "Select All".
    public static func allSelected(_ rows: [SignalConfigRow]) -> Bool {
        !rows.isEmpty && rows.allSatisfy(\.selected)
    }

    /// Whether any row is selected — gates the Subscribe action (web `disabled={selectedCount === 0}`).
    public static func canSubmit(_ rows: [SignalConfigRow]) -> Bool {
        rows.contains(where: \.selected)
    }

    /// A category header's tri-state (web `allCatSelected` / `someCatSelected`).
    public static func categoryState(rows: [SignalConfigRow], category: String) -> SignalConfigCategoryState {
        let catRows = rows.filter { $0.category == category }
        guard !catRows.isEmpty else { return .none }
        if catRows.allSatisfy(\.selected) { return .all }
        if catRows.contains(where: \.selected) { return .some }
        return .none
    }

    /// The "(selected/total)" pair shown in a category header (web
    /// `({catSignals.filter(selected).length}/{catSignals.length})`).
    public static func categoryTally(rows: [SignalConfigRow]) -> (selected: Int, total: Int) {
        (selected: selectedCount(rows), total: rows.count)
    }

    // MARK: Phase + inline failure

    /// The dialog body phase. Loading shows only before any catalog resolves; once a catalog is on
    /// hand the populated form stays (a failed reload keeps the cached catalog rather than flashing
    /// the error envelope), and a first-load failure with no cached catalog shows the error state. A
    /// resolved-but-empty catalog is the friendly empty state.
    public static func phase(status: SignalConfigLoadStatus, hasRows: Bool) -> SignalConfigPhase {
        switch status {
        case .loading:
            hasRows ? .populated : .loading
        case .loaded:
            hasRows ? .populated : .empty
        case let .failed(message):
            hasRows ? .populated : .error(message)
        }
    }

    /// The failure message kept on screen while a cached catalog survives a failed reload (the inline
    /// banner above the form), else `nil`.
    public static func inlineFailure(status: SignalConfigLoadStatus, hasRows: Bool) -> String? {
        guard hasRows, case let .failed(message) = status else { return nil }
        return message
    }

    // MARK: Footer summary + submit payload

    /// The footer counts (web footer line): total selected + how many at 500 ms + how many at 10 s.
    public static func summary(_ rows: [SignalConfigRow]) -> SignalConfigSummary {
        let selected = rows.filter(\.selected)
        return SignalConfigSummary(
            selected: selected.count,
            realtime: selected.reduce(0) { $0 + ($1.interval == SignalConfigCatalog.realtimeIntervalValue ? 1 : 0) },
            standard: selected.reduce(0) { $0 + ($1.interval == SignalConfigCatalog.defaultIntervalValue ? 1 : 0) }
        )
    }

    /// The submit payload (web `signals.filter(selected).map(s => ({ name: s.name, interval: s.interval }))`).
    public static func submitPayload(_ rows: [SignalConfigRow]) -> [SignalConfigSubscription] {
        rows.filter(\.selected).map { SignalConfigSubscription(name: $0.name, interval: $0.interval) }
    }

    // MARK: Pure mutators (web `setSignals` updaters)

    /// Sets one row's selection and/or interval (web `updateSignal`).
    public static func updating(
        rows: [SignalConfigRow],
        name: String,
        selected: Bool? = nil,
        interval: Int? = nil
    ) -> [SignalConfigRow] {
        rows.map { row in
            guard row.name == name else { return row }
            var next = row
            if let selected { next.selected = selected }
            if let interval { next.interval = interval }
            return next
        }
    }

    /// Selects or deselects every row (web `toggleAll`).
    public static func togglingAll(rows: [SignalConfigRow], selected: Bool) -> [SignalConfigRow] {
        rows.map { row in
            var next = row
            next.selected = selected
            return next
        }
    }

    /// Sets every row's interval to the master cadence (web `setMasterIntervalAll`).
    public static func settingAllInterval(rows: [SignalConfigRow], interval: Int) -> [SignalConfigRow] {
        rows.map { row in
            var next = row
            next.interval = interval
            return next
        }
    }

    /// Toggles a whole category: if every field is on it deselects them, else it selects them all
    /// (web `toggleCategory`).
    public static func togglingCategory(rows: [SignalConfigRow], category: String) -> [SignalConfigRow] {
        let allOn = rows.filter { $0.category == category }.allSatisfy(\.selected)
        return rows.map { row in
            guard row.category == category else { return row }
            var next = row
            next.selected = !allOn
            return next
        }
    }

    /// Sets the interval for every row in a category (web `setCategoryInterval`).
    public static func settingCategoryInterval(
        rows: [SignalConfigRow],
        category: String,
        interval: Int
    ) -> [SignalConfigRow] {
        rows.map { row in
            guard row.category == category else { return row }
            var next = row
            next.interval = interval
            return next
        }
    }

    // MARK: Category icon (web `CATEGORY_ICONS`)

    /// The lucide → SF Symbol map for category headers (web `CATEGORY_ICONS`).
    private static let categoryIcons: [String: String] = [
        "Driving": "speedometer",
        "Charging": "battery.100percent.bolt",
        "Climate": "thermometer.medium",
        "Vehicle State": "shield.fill",
        "Safety": "shield.lefthalf.filled",
        "Powertrain": "bolt.fill",
        "Tires & Service": "wrench.and.screwdriver.fill",
        "Media": "music.note",
        "Location": "location.fill",
        "User Preference": "gearshape.fill",
        "Vehicle Config": "gearshape.2.fill"
    ]

    /// The SF Symbol for a category header (web `CATEGORY_ICONS[category] || Zap`).
    public static func iconSystemName(for category: String) -> String {
        categoryIcons[category] ?? "dot.radiowaves.left.and.right"
    }
}
