//
//  ChartContainer.Model.swift
//  TeslaSync — P4 shared surface · 0065 · ChartContainer (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the
//  observable view-model for the chart-framing surface. The view binds through `ChartContainerModel`;
//  no networking lives in the view. It keeps the web data contract (`useChartAnnotationsAsData` /
//  `useCreateAnnotation` / `useDeleteAnnotation` / `useHiddenSeries`): a source pushes the coalesced
//  annotation snapshot + connectivity, the model projects it, owns the persisted hidden-overlay
//  toggle, forwards add/remove to the mutation seam, emits `view.opened` once, and auto-refreshes
//  once on the stale edge.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; production injects an adapter that forwards to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ChartContainerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogChartContainerTelemetry: ChartContainerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Hidden-overlay store (web `localStorage` / `useHiddenSeries`)

/// Persists the per-chart "hide annotations" toggle — the native port of the web
/// `readHiddenPref` / `writeHiddenPref` `localStorage` helpers. `UserDefaults` is the platform
/// equivalent; tests use the in-memory variant.
public protocol ChartContainerHiddenStore: Sendable {
    func isHidden(_ key: String) -> Bool
    func setHidden(_ hidden: Bool, for key: String)
}

/// `UserDefaults`-backed store (web `window.localStorage`). Writing `false` removes the key so the
/// default ("show") never leaves a stale entry (web `removeItem`). A `final class` marked
/// `@unchecked Sendable` because `UserDefaults` is documented thread-safe — this keeps the store
/// `Sendable` under strict concurrency regardless of the SDK's `UserDefaults` annotation.
public final class UserDefaultsChartContainerHiddenStore: ChartContainerHiddenStore, @unchecked Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func isHidden(_ key: String) -> Bool {
        defaults.string(forKey: ChartContainerLogic.hiddenStorageKey(key)) == "1"
    }

    public func setHidden(_ hidden: Bool, for key: String) {
        let storageKey = ChartContainerLogic.hiddenStorageKey(key)
        if hidden {
            defaults.set("1", forKey: storageKey)
        } else {
            defaults.removeObject(forKey: storageKey)
        }
    }
}

/// In-memory hidden store for previews + tests (no global `UserDefaults` mutation).
public final class InMemoryChartContainerHiddenStore: ChartContainerHiddenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: Bool]

    public init(seed: [String: Bool] = [:]) {
        storage = seed
    }

    public func isHidden(_ key: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return storage[key] ?? false
    }

    public func setHidden(_ hidden: Bool, for key: String) {
        lock.lock(); defer { lock.unlock() }
        if hidden { storage[key] = true } else { storage.removeValue(forKey: key) }
    }
}

// MARK: - Annotation snapshot + mutation request (web `stream` slice + mutations)

/// One coalesced snapshot of the surface's data inputs — the native mirror of the
/// `useChartAnnotationsAsData` result plus the P4 connectivity axis. The model projects the wire
/// rows once on apply.
public struct ChartContainerInput: Sendable, Equatable {
    public var connection: ChartContainerConnection
    public var annotations: [ChartContainerAnnotationRow]

    public init(connection: ChartContainerConnection = .live, annotations: [ChartContainerAnnotationRow] = []) {
        self.connection = connection
        self.annotations = annotations
    }
}

/// A new-annotation request — the native shape of the web `useCreateAnnotation` `mutate` payload
/// (`{ vehicle_id, occurred_at, category, title, description, scope }`).
public struct ChartContainerAnnotationDraft: Sendable, Equatable {
    public var vehicleID: Int64?
    public var occurredAt: String
    public var category: ChartContainerAnnotationCategory
    public var title: String
    public var description: String?
    public var scope: ChartContainerAnnotationScope?

    public init(
        vehicleID: Int64?,
        occurredAt: String,
        category: ChartContainerAnnotationCategory,
        title: String,
        description: String?,
        scope: ChartContainerAnnotationScope?
    ) {
        self.vehicleID = vehicleID
        self.occurredAt = occurredAt
        self.category = category
        self.title = title
        self.description = description
        self.scope = scope
    }
}

// MARK: - Source seam (P1/S8 layer)

/// The seam the model binds through for the annotation data + the create/delete mutations + the P4
/// connectivity axis (web `useChartAnnotationsAsData` / `useCreateAnnotation` / `useDeleteAnnotation`).
/// Production implements this over the API hooks (`LiveChartContainerSource`); previews + tests use
/// `InMemoryChartContainerSource`. The surface owns no networking — it forwards to the source.
@MainActor
public protocol ChartContainerSource: AnyObject {
    var onUpdate: (@MainActor (ChartContainerInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func create(_ draft: ChartContainerAnnotationDraft)
    func delete(id: Int64)
}

/// The production source. Holds the host-provided snapshot + create/delete closures (web mutation
/// callbacks), re-emitting the snapshot on `start` / `refresh`. The host re-creates the source (or
/// pushes through its own hook) as the query result changes.
@MainActor
public final class LiveChartContainerSource: ChartContainerSource {
    public var onUpdate: (@MainActor (ChartContainerInput) -> Void)?

    private let input: ChartContainerInput
    private let onCreate: @MainActor (ChartContainerAnnotationDraft) -> Void
    private let onDelete: @MainActor (Int64) -> Void

    public init(
        input: ChartContainerInput,
        onCreate: @escaping @MainActor (ChartContainerAnnotationDraft) -> Void,
        onDelete: @escaping @MainActor (Int64) -> Void
    ) {
        self.input = input
        self.onCreate = onCreate
        self.onDelete = onDelete
    }

    public func start() {
        onUpdate?(input)
    }

    public func stop() {}
    public func refresh() {
        onUpdate?(input)
    }

    public func create(_ draft: ChartContainerAnnotationDraft) {
        onCreate(draft)
    }

    public func delete(id: Int64) {
        onDelete(id)
    }
}

/// In-memory source for previews + unit/UI tests. Seeds an optional snapshot on `start()`, lets a
/// test push further snapshots, and records every create/delete so the mutation contract is asserted.
@MainActor
public final class InMemoryChartContainerSource: ChartContainerSource {
    public var onUpdate: (@MainActor (ChartContainerInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var created: [ChartContainerAnnotationDraft] = []
    public private(set) var deleted: [Int64] = []

    private let initial: ChartContainerInput?

    public init(initial: ChartContainerInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func create(_ draft: ChartContainerAnnotationDraft) {
        created.append(draft)
    }

    public func delete(id: Int64) {
        deleted.append(id)
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: ChartContainerInput) {
        onUpdate?(input)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds a `ChartContainerSource`, projects the wire rows once,
/// owns the persisted hidden-overlay toggle + the add-annotation sheet flag, exposes the connectivity
/// axis, emits `view.opened` once on first appear, auto-refreshes once on the stale edge, and
/// forwards add/remove to the source after the web validation guards.
@MainActor
@Observable
public final class ChartContainerModel {
    public private(set) var connection: ChartContainerConnection = .live
    public private(set) var fetchedAnnotations: [ChartContainerAnnotation] = []
    public private(set) var hidden: Bool
    public var addFormOpen = false

    public let content: ChartContainerContent

    @ObservationIgnored private let source: any ChartContainerSource
    @ObservationIgnored private let telemetry: any ChartContainerTelemetry
    @ObservationIgnored private let hiddenStore: any ChartContainerHiddenStore
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var lastConnection: ChartContainerConnection = .live

    public init(
        content: ChartContainerContent,
        source: any ChartContainerSource,
        telemetry: any ChartContainerTelemetry = OSLogChartContainerTelemetry(),
        hiddenStore: any ChartContainerHiddenStore = UserDefaultsChartContainerHiddenStore()
    ) {
        self.content = content
        self.source = source
        self.telemetry = telemetry
        self.hiddenStore = hiddenStore
        hidden = content.annotationsEnabled ? hiddenStore.isHidden(content.annotationKey) : false
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    // MARK: Resolved state (the view renders this — body props arrive from the surface)

    /// Resolves the full view-state by folding the model state with the chart-body props the surface
    /// supplies (web `loading` / `empty` props, the `SectionErrorBoundary` signal, and the fallback
    /// table inputs). The view holds no decision logic — it calls this and renders the result.
    public func resolved(
        loading: Bool,
        empty: Bool,
        hasError: Bool,
        rowCount: Int,
        columnCount: Int
    ) -> ChartContainerResolved {
        ChartContainerProjection.resolve(
            content: content,
            connection: connection,
            body: ChartContainerBodyState(
                loading: loading,
                empty: empty,
                hasError: hasError,
                rowCount: rowCount,
                columnCount: columnCount
            ),
            hidden: hidden,
            fetched: fetchedAnnotations
        )
    }

    // MARK: Lifecycle

    /// Begins observing the source and emits `view.opened` once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        source.start()
        emitOpenOnce()
    }

    /// Stops observing the source.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the snapshot (freshness chip + stale/offline recovery).
    public func refresh() {
        source.refresh()
    }

    // MARK: Actions (web toggle / create / delete)

    /// Toggles the annotation overlay and persists the preference (web `toggleHidden` +
    /// `writeHiddenPref`). No-op when annotations are disabled.
    public func toggleHidden() {
        guard content.annotationsEnabled else { return }
        hidden.toggle()
        hiddenStore.setHidden(hidden, for: content.annotationKey)
    }

    /// Opens / closes the add-annotation sheet (web `setPopoverOpen`).
    public func setAddFormOpen(_ open: Bool) {
        addFormOpen = open
    }

    /// Validates + forwards a new annotation to the source (web `handleAddAnnotation`): requires a
    /// non-empty label + `occurredAt`, stamps the configured scope + vehicle, and closes the sheet.
    public func addAnnotation(
        label: String,
        category: ChartContainerAnnotationCategory,
        description: String?,
        occurredAt: String
    ) {
        guard content.annotationsEnabled else { return }
        guard ChartContainerLogic.isValidNewAnnotation(label: label, occurredAt: occurredAt) else { return }
        source.create(
            ChartContainerAnnotationDraft(
                vehicleID: content.vehicleID,
                occurredAt: occurredAt,
                category: category,
                title: label,
                description: description?.isEmpty == true ? nil : description,
                scope: content.scope
            )
        )
        addFormOpen = false
    }

    /// Validates + forwards a delete to the source (web `handleRemoveAnnotation`): a non-numeric or
    /// non-positive id is ignored.
    public func removeAnnotation(id: String) {
        guard ChartContainerLogic.isRemovableID(id), let numeric = Int64(id) else { return }
        source.delete(id: numeric)
    }

    // MARK: Private

    private func apply(_ input: ChartContainerInput) {
        let previous = lastConnection
        connection = input.connection
        lastConnection = input.connection
        fetchedAnnotations = content.annotationsEnabled
            ? ChartContainerAnnotationAdapter.projectAll(input.annotations)
            : []
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch); offline never
        // auto-refreshes (there is no connection to re-fetch over).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func emitOpenOnce() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: ChartContainerMeta.surfaceSlug)
    }
}

// MARK: - Localisation facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the per-surface "ChartContainer" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum ChartContainerStrings {
    public static let table = "ChartContainer"

    public static let string: ChartContainerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
