import Foundation
import Observation

// Native SwiftUI parity model for `web/src/features/automations/pages/ConditionBuilder.tsx`.
//
// The web `ConditionBuilder` is a controlled editor the parent `AutomationBuilder` page owns: it is
// fed a `conditions` prop and hands a fresh `conditions` array back through `onChange`, and it reads
// one data hook — `useGeofences` (GET `/geofences`) — to populate the geofence picker. So the page
// owns the editable list itself through this `@Observable` model and binds the geofence feed through
// the reused P1/S8 `GeofenceOptionsModel` state holder — no networking lives in the view (ADR-004).
//
// The pure projection logic (the discriminated `ConditionBody` union, the four default-condition
// factories, the signal value-coercion ladder, the operator/day/timezone/geofence helpers, and the
// `GeofenceOptionsModel` cache-then-network state machine) is REUSED verbatim from the module-public
// P4 feature-view (`ConditionBuilder.{Types,Adapter,Model}.swift`) so there is one source of truth;
// only the localization boundary differs — this page resolves every string from the platform
// `Localizable.xcstrings` catalog (the P7 string requirement), not the per-surface table.

// MARK: - Localization facade (web `t(key, default)` → Localizable.xcstrings)

/// Resolves the page's copy by key from the platform `Localizable.xcstrings` catalog, with the web
/// English value as a safety fallback if a key is somehow absent. Keys match the web names verbatim.
enum ConditionBuilderPageStrings {
    /// Resolves `key` from `Localizable.xcstrings`; returns `fallback` only if the catalog has no
    /// entry (a missing dynamic key resolves to itself).
    static func localize(_ key: String, _ fallback: String) -> String {
        let value = String(localized: String.LocalizationValue(key), bundle: .main)
        return value == key ? fallback : value
    }

    /// Resolves an `i18n` descriptor (web `t(key, fallback)`).
    static func localize(_ text: LocalizedText) -> String {
        localize(text.key, text.fallback)
    }
}

// MARK: - Render state (manifest data state + no-blank-region robustness)

/// The page's typed render state. `success` is the manifest-declared data state (the geofence feed
/// loaded + the editor rendered); `loading` and `empty` are added so no region ever renders blank
/// (HIG redacted skeleton / `ContentUnavailableView`). The geofence source's own
/// loading/empty/error/offline branches render inside the geofence picker (`geofences.presentation`).
public enum ConditionBuilderPageState: Sendable, Equatable {
    case loading
    case empty
    case success
}

// MARK: - Input seam (navigation values / local state)

/// The values the page is seeded with (web `conditions` prop): the editable condition list.
public protocol ConditionBuilderPageProviding: Sendable {
    func load() async -> [ConditionBody]
}

/// Representative local state for the default page — one of each condition kind so every editor and
/// the `GlassPanel` row render (web's "navigation values / local state", no networking).
public struct DefaultConditionBuilderPageData: ConditionBuilderPageProviding {
    public init() {}

    public func load() async -> [ConditionBody] {
        [
            .signal(SignalCondition(signal: "battery_level", op: .lessThan, valueNum: 20)),
            .timeWindow(TimeWindowCondition(
                startTime: "06:00", endTime: "09:00", timezone: "UTC", daysOfWeek: [1, 2, 3, 4, 5]
            )),
            .geofence(GeofenceCondition(placeId: 1, state: .inside)),
            .otherAutomation(OtherAutomationCondition(otherAutomationId: 0, state: .enabled))
        ]
    }
}

/// An empty seam (no conditions) for the empty-state preview / test.
public struct EmptyConditionBuilderPageData: ConditionBuilderPageProviding {
    public init() {}

    public func load() async -> [ConditionBody] {
        []
    }
}

// MARK: - State holder (P1/S8 layer)

/// The ConditionBuilder page's observable view-model. Owns the editable condition rows (web
/// `conditions`), binds the geofence feed through the reused `GeofenceOptionsModel` (web
/// `useGeofences`), and applies the same add / remove / change-kind / replace mutations the web
/// callbacks do — every payload transform reused from `ConditionBuilderAdapter`. Pure form logic; no
/// networking lives here (the geofence HTTP is behind the injected `GeofenceOptionsSource`).
@MainActor
@Observable
public final class ConditionBuilderPageModel {
    private enum Phase: Equatable {
        case loading
        case ready
    }

    /// The editable condition rows (web `conditions`).
    public private(set) var conditions: [AutomationConditionInput] = []

    /// The geofence picker's data feed (web `useGeofences` → GET `/geofences`), reused P1/S8 holder.
    @ObservationIgnored public let geofences: GeofenceOptionsModel

    @ObservationIgnored private let provider: any ConditionBuilderPageProviding
    private var phase: Phase = .loading

    /// Sample geofences for the default page / previews (web `useGeofences` content state).
    public static let sampleGeofences: [GeofenceOption] = [
        GeofenceOption(id: "1", name: "Home"),
        GeofenceOption(id: "2", name: "Work"),
        GeofenceOption(id: "3", name: "Supercharger — Downtown")
    ]

    /// Live/preview binding. `geofences` defaults to a content feed of the sample places so the
    /// default page shows a populated picker; tests/previews inject any `GeofenceOptionsModel` to
    /// exercise the loading / empty / error / offline branches.
    public init(
        provider: any ConditionBuilderPageProviding = DefaultConditionBuilderPageData(),
        geofences: GeofenceOptionsModel? = nil
    ) {
        self.provider = provider
        self.geofences = geofences ?? GeofenceOptionsModel(
            source: InMemoryGeofenceOptionsSource(
                initial: .loaded(ConditionBuilderPageModel.sampleGeofences, stale: false)
            )
        )
    }

    // MARK: Derived render state

    /// The typed render state (web loading / content; empty when no conditions remain).
    public var state: ConditionBuilderPageState {
        switch phase {
        case .loading:
            .loading
        case .ready:
            conditions.isEmpty ? .empty : .success
        }
    }

    /// The current condition payloads (web `conditions`), stripped of the view-only row identity.
    public var conditionBodies: [ConditionBody] {
        conditions.map(\.body)
    }

    /// The 0-based row position (web `index`), used for the first-row-only label.
    public func index(of id: AutomationConditionInput.ID) -> Int? {
        conditions.firstIndex { $0.id == id }
    }

    /// The body for a row id (the editor card's binding getter).
    public func body(for id: AutomationConditionInput.ID) -> ConditionBody? {
        conditions.first { $0.id == id }?.body
    }

    // MARK: Load / refresh

    /// Seeds the editable list from the provider (web initial `conditions`) and starts the geofence
    /// feed (web `useGeofences`).
    public func load() async {
        let seed = await provider.load()
        conditions = seed.map { AutomationConditionInput(body: $0) }
        phase = .ready
        geofences.start()
    }

    /// Re-seeds from the provider and refreshes the geofence feed (web `refetch`).
    public func refresh() async {
        phase = .loading
        geofences.refresh()
        await load()
    }

    /// Stops the geofence subscription (web effect cleanup); called from the view's `onDisappear`.
    public func stop() {
        geofences.stop()
    }

    // MARK: Mutations (web addCondition / removeCondition / replaceCondition)

    /// Web `addCondition`: append a default signal condition.
    public func addCondition() {
        conditions.append(AutomationConditionInput(body: ConditionBuilderAdapter.defaultCondition(kind: .signal)))
    }

    /// Web `removeCondition(index)`.
    public func removeCondition(id: AutomationConditionInput.ID) {
        conditions.removeAll { $0.id == id }
    }

    /// Web condition-type select: replace with a fresh default of the chosen kind.
    public func changeKind(id: AutomationConditionInput.ID, to kind: AutomationConditionKind) {
        guard let index = index(of: id) else { return }
        conditions[index].body = ConditionBuilderAdapter.defaultCondition(kind: kind)
    }

    /// Web `replaceCondition(index, nextCondition)`: commit an in-place field edit.
    public func updateBody(id: AutomationConditionInput.ID, _ body: ConditionBody) {
        guard let index = index(of: id) else { return }
        conditions[index].body = body
    }
}
