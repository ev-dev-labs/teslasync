//
//  WidgetPicker.Model.swift
//  TeslaSync — P4 feature view · 0134 · WidgetPicker (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for
//  the dashboard WidgetPicker. The view binds through `WidgetPickerModel`, which
//  owns the search text, the category filter, the session-added + persisted
//  recently-added id lists, and the live-region announcement — exactly the web
//  component's `useState` set. It derives the filtered/grouped/visible widget
//  projections through `WidgetPickerAdapter`, applies the web add/add-many/apply-
//  preset mutations, persists recents across launches (web `localStorage`), and
//  hands the host the added ids / chosen preset through callbacks (web
//  `onAddWidgets` / `onApplyPreset` / `onClose`). No networking lives here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; production injects an adapter that forwards to the
/// shared-core diagnostics contract (ADR-016).
public protocol WidgetPickerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogWidgetPickerTelemetry: WidgetPickerTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web t(key, default)

/// Resolves the surface's chrome strings by key with the web English fallback, so
/// the view holds no hardcoded UI literals. Keys live in the "WidgetPicker" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum WidgetPickerStrings {
    public static let table = "WidgetPicker"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// A `(key, fallback) -> String` localizer for the SwiftUI-free adapter copy.
    public static func localize(_ key: String, _ fallback: String) -> String {
        string(key, fallback)
    }
}

// MARK: - Recents store (web localStorage `teslasync-widgets-recent`)

/// Persistence seam for the cross-launch recently-added widget ids (web
/// `loadRecentlyAdded` / `saveRecentlyAdded`). Injected so the model unit-tests
/// without touching the real defaults.
public protocol WidgetRecentsStore: Sendable {
    func load() -> [String]
    func save(_ ids: [String])
}

/// `UserDefaults`-backed recents store, JSON-encoded for parity with the web's
/// `localStorage.setItem(JSON.stringify(ids))`. Unknown/garbage entries are
/// dropped against the catalog on load (web `loadRecentlyAdded` filter).
/// `UserDefaults` is thread-safe but not `Sendable`, so the `@unchecked` is sound.
public struct UserDefaultsWidgetRecentsStore: WidgetRecentsStore, @unchecked Sendable {
    /// Web `RECENTLY_ADDED_KEY`.
    public static let key = "teslasync-widgets-recent"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load() -> [String] {
        guard let data = defaults.data(forKey: Self.key),
              let ids = try? JSONDecoder().decode([String].self, from: data)
        else {
            return []
        }
        return WidgetPickerAdapter.sanitizeRecents(ids)
    }

    public func save(_ ids: [String]) {
        guard let data = try? JSONEncoder().encode(ids) else { return }
        defaults.set(data, forKey: Self.key)
    }
}

// MARK: - State holder (P1/S8 layer)

/// The WidgetPicker's observable view-model. Owns the search / category / added /
/// recents / announcement state (web `useState`), derives the widget projections
/// through `WidgetPickerAdapter`, applies the web mutations, persists recents,
/// and forwards added ids / chosen preset / close to the host. Emits the
/// `view.opened` diagnostics event exactly once.
@MainActor
@Observable
public final class WidgetPickerModel {
    /// The search text (web `search`).
    public var search: String = ""

    /// The active category filter, `nil` == "All" (web `categoryFilter`).
    public private(set) var categoryFilter: WidgetCatalogCategory?

    /// The widget ids added during this presentation (web `addedThisSessionIds`).
    public private(set) var addedThisSessionIDs: [String] = []

    /// The persisted most-recent widget ids (web `recentlyAddedIds`).
    public private(set) var recentlyAddedIDs: [String]

    /// The latest screen-reader announcement (web `announcement` live region).
    public private(set) var announcement = ""

    /// The widgets already on the dashboard (web `activeWidgetIds` prop); updated
    /// optimistically on add so cards flip to the disabled "Added" state, exactly
    /// as the web parent re-renders the prop after `onAddWidgets`.
    public private(set) var activeWidgetIDs: Set<String>

    @ObservationIgnored private let recentsStore: any WidgetRecentsStore
    @ObservationIgnored private let telemetry: any WidgetPickerTelemetry
    @ObservationIgnored private let onAddWidgets: ([String]) -> Void
    @ObservationIgnored private let onApplyPreset: (String) -> Void
    @ObservationIgnored private let onClose: () -> Void
    @ObservationIgnored private var started = false

    public init(
        activeWidgetIDs: [String] = [],
        categoryFilter: WidgetCatalogCategory? = nil,
        recentsStore: any WidgetRecentsStore = UserDefaultsWidgetRecentsStore(),
        telemetry: any WidgetPickerTelemetry = OSLogWidgetPickerTelemetry(),
        onAddWidgets: @escaping ([String]) -> Void = { _ in },
        onApplyPreset: @escaping (String) -> Void = { _ in },
        onClose: @escaping () -> Void = {}
    ) {
        self.activeWidgetIDs = Set(activeWidgetIDs)
        self.categoryFilter = categoryFilter
        self.recentsStore = recentsStore
        self.telemetry = telemetry
        self.onAddWidgets = onAddWidgets
        self.onApplyPreset = onApplyPreset
        self.onClose = onClose
        recentlyAddedIDs = recentsStore.load()
    }

    // MARK: Derived projections (web useMemo)

    /// Web `query` (trimmed, lowercased).
    public var query: String {
        WidgetPickerAdapter.normalizedQuery(search)
    }

    /// Web `search.trim()` — original-case trimmed query for display copy.
    public var trimmedSearch: String {
        search.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Web `filteredWidgets`.
    public var filteredWidgets: [WidgetCatalogEntry] {
        WidgetPickerAdapter.filteredWidgets(category: categoryFilter, query: query)
    }

    /// Web `groupedEntries`.
    public var groupedEntries: [WidgetCatalogGroup] {
        WidgetPickerAdapter.groupedEntries(category: categoryFilter)
    }

    /// Web `visibleWidgets`.
    public var visibleWidgets: [WidgetCatalogEntry] {
        WidgetPickerAdapter.visibleWidgets(category: categoryFilter, query: query)
    }

    /// Web `addableSearchWidgets`.
    public var addableSearchWidgets: [WidgetCatalogEntry] {
        WidgetPickerAdapter.addable(filteredWidgets, active: activeWidgetIDs)
    }

    /// Web `recentlyAddedVisible`.
    public var recentlyAddedVisible: [WidgetCatalogEntry] {
        WidgetPickerAdapter.recentlyAddedVisible(
            recentIDs: recentlyAddedIDs,
            active: activeWidgetIDs,
            category: categoryFilter,
            query: query
        )
    }

    /// Web `availableCategories` (the filter pills).
    public var availableCategories: [WidgetCatalogCategory] {
        WidgetCatalog.availableCategories
    }

    /// Web `addedThisSessionCount`.
    public var addedThisSessionCount: Int {
        addedThisSessionIDs.count
    }

    /// Whether a widget is already on the dashboard (web `activeWidgetIdSet.has`).
    public func isAdded(_ entry: WidgetCatalogEntry) -> Bool {
        activeWidgetIDs.contains(entry.id)
    }

    /// The addable entries of a category section (web `addableCategoryWidgets`).
    public func addable(in entries: [WidgetCatalogEntry]) -> [WidgetCatalogEntry] {
        WidgetPickerAdapter.addable(entries, active: activeWidgetIDs)
    }

    // MARK: Mutations (web callbacks)

    /// Web category pill selection (`setCategoryFilter`).
    public func selectCategory(_ category: WidgetCatalogCategory?) {
        categoryFilter = category
    }

    /// Web search `Escape` handler: clear a non-empty query (the view lets an
    /// already-empty field bubble to dismiss).
    public func clearSearch() {
        search = ""
    }

    /// Web `handleAdd(widget)`.
    public func add(_ entry: WidgetCatalogEntry, closeAfterAdd: Bool = false) {
        addMany([entry.id], closeAfterAdd: closeAfterAdd)
    }

    /// Web `handleAddMany(widgetIds)`: de-dupe against seen/active/unknown, push
    /// to the dashboard, track the session + persisted recents, announce, and
    /// optionally close.
    public func addMany(_ ids: [String], closeAfterAdd: Bool = false) {
        let addableIDs = WidgetPickerAdapter.addableIDs(from: ids, active: activeWidgetIDs)
        guard !addableIDs.isEmpty else { return }

        for id in addableIDs {
            activeWidgetIDs.insert(id)
        }

        var session = Set(addedThisSessionIDs)
        for id in addableIDs where !session.contains(id) {
            session.insert(id)
            addedThisSessionIDs.append(id)
        }

        recentlyAddedIDs = WidgetPickerAdapter.updatedRecents(previous: recentlyAddedIDs, adding: addableIDs)
        recentsStore.save(recentlyAddedIDs)

        let names = addableIDs.compactMap { WidgetCatalog.byID[$0]?.name }
        if let message = WidgetPickerAdapter.addedAnnouncement(names: names, localize: WidgetPickerStrings.localize) {
            announcement = message
        }

        onAddWidgets(addableIDs)
        if closeAfterAdd { onClose() }
    }

    /// Web preset card tap: apply the preset then close.
    public func applyPreset(_ id: String) {
        onApplyPreset(id)
        onClose()
    }

    /// Web search `Enter` handler: when a query resolves to exactly one addable
    /// widget, add it.
    public func submitSearch() {
        guard !query.isEmpty else { return }
        let addable = addableSearchWidgets
        if addable.count == 1 {
            add(addable[0])
        }
    }

    /// Host-driven dismissal (web `onClose`).
    public func requestClose() {
        onClose()
    }

    // MARK: Copy (web t(...) call sites)

    /// Web footer "{{count}} widget(s) added".
    public var addedCountText: String {
        WidgetPickerAdapter.addedCountText(count: addedThisSessionCount, localize: WidgetPickerStrings.localize)
    }

    /// Web "{count} widgets available".
    public var availableText: String {
        WidgetPickerAdapter.availableText(count: filteredWidgets.count, localize: WidgetPickerStrings.localize)
    }

    // MARK: Lifecycle

    /// Emits the `view.opened` diagnostics event exactly once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WidgetPickerSurface.slug)
    }
}
