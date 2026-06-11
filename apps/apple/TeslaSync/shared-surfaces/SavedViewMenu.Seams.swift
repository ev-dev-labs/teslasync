//
//  SavedViewMenu.Seams.swift
//  TeslaSync — P4 shared surface · 0102 · SavedViewMenu (Apple)
//
//  The dependency seams the SavedViewMenu view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S8 read source (the host page's `useSavedViews(route)` feed re-emitted
//  as a snapshot), the P1/S8 mutation seam (the web `useCreateSavedView` / `useUpdateSavedView` /
//  `useDeleteSavedView` / `useSetDefaultSavedView` hooks), the production closure-backed
//  implementations, and the in-memory store + spy for previews / tests. The view never reads the feed
//  or calls a mutation directly — it goes through the model, which goes through these seams.
//

import Foundation

// MARK: - Read source (P1/S8 seam — web `useSavedViews(route)`)

/// The read seam the model binds through. The production app implements this over the host page's
/// `useSavedViews(route)` query (`LiveSavedViewMenuSource`); previews and tests use
/// `InMemorySavedViewMenuStore`. The model never reads the feed directly.
@MainActor
public protocol SavedViewMenuSource: AnyObject {
    var onUpdate: (@MainActor (SavedViewMenuInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Mutation seam (P1/S8 — web create / update / delete / setDefault hooks)

/// The write seam the model binds through — the native shape of the web saved-view mutation hooks.
/// Each call resolves to whether the mutation succeeded, so the model can close its dialog on success
/// exactly like the web `onSuccess` callbacks. The production app forwards to the shared-core mutation
/// holders; tests use `SpySavedViewMenuMutations` or `InMemorySavedViewMenuStore`.
@MainActor
public protocol SavedViewMenuMutating: AnyObject {
    func create(name: String, route: String, query: String, isDefault: Bool) async -> Bool
    func update(id: Int, route: String, patch: SavedViewPatch) async -> Bool
    func delete(id: Int, route: String) async -> Bool
    func setDefault(id: Int, route: String, isDefault: Bool) async -> Bool
}

// MARK: - Live source (production — holds the host page's current feed)

/// The production read source. Holds the host page's current `useSavedViews` snapshot and re-emits it
/// whenever the page updates it (a fresh query result, a query-string change, or a connectivity
/// transition) — the native bridge between the TanStack Query feed and the surface's snapshot
/// contract. Defaults to an empty, loading snapshot so a freshly-mounted menu shows the loading state.
@MainActor
public final class LiveSavedViewMenuSource: SavedViewMenuSource {
    public var onUpdate: (@MainActor (SavedViewMenuInput) -> Void)?

    private var snapshot: SavedViewMenuInput

    public init(snapshot: SavedViewMenuInput = SavedViewMenuInput(isLoading: true)) {
        self.snapshot = snapshot
    }

    public func start() {
        emit()
    }

    public func stop() {}
    public func refresh() {
        emit()
    }

    /// Sets the host page's current snapshot and re-emits it — the native parity of the list page
    /// pushing a fresh `useSavedViews` result / a new `currentQuery` into the menu.
    public func update(_ snapshot: SavedViewMenuInput) {
        self.snapshot = snapshot
        emit()
    }

    private func emit() {
        onUpdate?(snapshot)
    }
}

// MARK: - Live mutations (production — closure-backed bridge to the shared-core holders)

/// The production mutation seam. Holds one async closure per operation, wired by the host to the
/// shared-core create / update / delete / setDefault holders. The defaults return `false` (no-op)
/// until the host wires them, so the menu degrades safely rather than claiming a phantom success.
@MainActor
public final class LiveSavedViewMenuMutations: SavedViewMenuMutating {
    public var onCreate: (String, String, String, Bool) async -> Bool
    public var onUpdate: (Int, String, SavedViewPatch) async -> Bool
    public var onDelete: (Int, String) async -> Bool
    public var onSetDefault: (Int, String, Bool) async -> Bool

    public init(
        onCreate: @escaping (String, String, String, Bool) async -> Bool = { _, _, _, _ in false },
        onUpdate: @escaping (Int, String, SavedViewPatch) async -> Bool = { _, _, _ in false },
        onDelete: @escaping (Int, String) async -> Bool = { _, _ in false },
        onSetDefault: @escaping (Int, String, Bool) async -> Bool = { _, _, _ in false }
    ) {
        self.onCreate = onCreate
        self.onUpdate = onUpdate
        self.onDelete = onDelete
        self.onSetDefault = onSetDefault
    }

    public func create(name: String, route: String, query: String, isDefault: Bool) async -> Bool {
        await onCreate(name, route, query, isDefault)
    }

    public func update(id: Int, route: String, patch: SavedViewPatch) async -> Bool {
        await onUpdate(id, route, patch)
    }

    public func delete(id: Int, route: String) async -> Bool {
        await onDelete(id, route)
    }

    public func setDefault(id: Int, route: String, isDefault: Bool) async -> Bool {
        await onSetDefault(id, route, isDefault)
    }
}

// MARK: - In-memory store (previews + tests — implements BOTH seams over a local array)

/// A fully-working in-memory backing for previews and tests. Implements the read source AND the
/// mutation seam over a mutable array, re-emitting the snapshot after every change — the native parity
/// of the web optimistic-update + query-invalidation cycle, so a preview's create / rename / delete /
/// pin / default all visibly update the menu. Records the applied querystrings for assertion.
@MainActor
public final class InMemorySavedViewMenuStore: SavedViewMenuSource, SavedViewMenuMutating {
    public var onUpdate: (@MainActor (SavedViewMenuInput) -> Void)?
    public private(set) var appliedQueries: [String] = []
    public private(set) var startCount = 0

    private var views: [SavedView]
    private let route: String
    private var currentQuery: String
    private let connection: SavedViewMenuConnection
    private var nextID: Int

    public init(
        views: [SavedView] = [],
        route: String = "/drives",
        currentQuery: String = "",
        connection: SavedViewMenuConnection = .live
    ) {
        self.views = views
        self.route = route
        self.currentQuery = currentQuery
        self.connection = connection
        nextID = (views.map(\.id).max() ?? 0) + 1
    }

    public func start() {
        startCount += 1
        emit()
    }

    public func stop() {}
    public func refresh() {
        emit()
    }

    public func create(name: String, route: String, query: String, isDefault: Bool) async -> Bool {
        if isDefault { clearDefault() }
        views.append(SavedView(
            id: nextID, name: name, route: route, query: query,
            isDefault: isDefault, isPinned: false, sortOrder: views.count
        ))
        nextID += 1
        emit()
        return true
    }

    public func update(id: Int, route _: String, patch: SavedViewPatch) async -> Bool {
        guard let index = views.firstIndex(where: { $0.id == id }) else { return false }
        if patch.isDefault == true { clearDefault() }
        views[index] = apply(patch, to: views[index])
        emit()
        return true
    }

    public func delete(id: Int, route _: String) async -> Bool {
        let before = views.count
        views.removeAll { $0.id == id }
        emit()
        return views.count < before
    }

    public func setDefault(id: Int, route _: String, isDefault: Bool) async -> Bool {
        if isDefault { clearDefault() }
        guard let index = views.firstIndex(where: { $0.id == id }) else { return false }
        views[index] = apply(SavedViewPatch(isDefault: isDefault), to: views[index])
        emit()
        return true
    }

    private func apply(_ patch: SavedViewPatch, to view: SavedView) -> SavedView {
        SavedView(
            id: view.id,
            name: patch.name ?? view.name,
            route: view.route,
            query: patch.query ?? view.query,
            isDefault: patch.isDefault ?? view.isDefault,
            isPinned: patch.isPinned ?? view.isPinned,
            sortOrder: view.sortOrder
        )
    }

    private func clearDefault() {
        views = views.map { view in
            view.isDefault ? apply(SavedViewPatch(isDefault: false), to: view) : view
        }
    }

    private func recordApply(_ query: String) {
        appliedQueries.append(query)
        currentQuery = query
        emit()
    }

    private func emit() {
        onUpdate?(SavedViewMenuInput(
            views: views,
            route: route,
            currentQuery: currentQuery,
            isLoading: false,
            errorMessage: nil,
            connection: connection,
            onApply: { [weak self] query in self?.recordApply(query) }
        ))
    }
}

// MARK: - Mutation spy (tests — records calls, returns a scripted result)

/// A mutation seam that records every call and returns a scripted result — lets the model's dialog
/// flows (save / rename / delete / pin / default) be asserted without a backing array.
@MainActor
public final class SpySavedViewMenuMutations: SavedViewMenuMutating {
    public struct Call: Equatable {
        public let kind: String
        public let id: Int?
        public let detail: String
    }

    public private(set) var calls: [Call] = []
    private let result: Bool

    public init(result: Bool = true) {
        self.result = result
    }

    public func create(name: String, route _: String, query _: String, isDefault: Bool) async -> Bool {
        calls.append(Call(kind: "create", id: nil, detail: "\(name)|default=\(isDefault)"))
        return result
    }

    public func update(id: Int, route _: String, patch: SavedViewPatch) async -> Bool {
        let pin = patch.isPinned.map(String.init) ?? ""
        calls.append(Call(kind: "update", id: id, detail: "name=\(patch.name ?? "")|pin=\(pin)"))
        return result
    }

    public func delete(id: Int, route _: String) async -> Bool {
        calls.append(Call(kind: "delete", id: id, detail: ""))
        return result
    }

    public func setDefault(id: Int, route _: String, isDefault: Bool) async -> Bool {
        calls.append(Call(kind: "setDefault", id: id, detail: "default=\(isDefault)"))
        return result
    }
}
