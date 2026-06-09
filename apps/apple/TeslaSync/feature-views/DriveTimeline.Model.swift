//
//  DriveTimeline.Model.swift
//  TeslaSync — P4 feature view · 0140 · DriveTimeline (Apple)
//
//  The P1/S8 state-holder seam (a Shared-free `DriveTimelineSource` the view binds
//  through), the cache-then-network load state + error taxonomy, the surface-local
//  drive DTO that mirrors the subset of the web `DriveDetail` this timeline reads,
//  the observable view-model, and the P1/S10 i18n facade. No SwiftUI view code and
//  no direct networking live here, so every branch host-compiles + unit-tests on a
//  plain host.
//
//  Parity target: features/driving/components/drive-detail/DriveTimeline.tsx — the
//  web leaf takes a resolved `drive: DriveDetail` prop; the parent drive-detail page
//  owns the query. The P4 surface contract additionally requires the loading / empty
//  / error / stale / offline chrome, so the model carries the full cache-then-network
//  state while the web-prop init maps `<DriveTimeline drive />` onto its content
//  branch.
//

import Foundation
import Observation

// MARK: - Input DTO (the web `DriveDetail` subset this timeline reads)

/// The cached drive inputs this timeline consumes, mirroring the exact subset of the
/// web `DriveDetail` the source reads: `start_ts`, `end_ts`, and `duration_s`
/// (SI-canonical seconds). Kept surface-local (not shared with a sibling drive
/// surface) so the timeline compiles + tests in isolation and parallel surface
/// prompts never collide on a shared type. `startTs`/`endTs` are optional so the
/// projection can reproduce the web `formatTime` em-dash fallback for a missing or
/// unparseable instant, and `endTs == nil` is the canonical "still driving" signal.
public struct DriveTimelineDrive: Equatable, Sendable {
    public let startTs: Date?
    public let endTs: Date?
    public let durationS: Double

    public init(startTs: Date?, endTs: Date?, durationS: Double) {
        self.startTs = startTs
        self.endTs = endTs
        self.durationS = durationS
    }

    /// Whether the drive is still running (web `drive.endTs ? … : 'In progress'`).
    public var isInProgress: Bool {
        endTs == nil
    }
}

// MARK: - Snake-case decode (the API drive shape)

public extension DriveTimelineDrive {
    /// Decodes one drive from the API JSON object shape (`start_ts` / `end_ts` /
    /// `duration_s`), tolerating an integer or floating `duration_s` and an
    /// ISO-8601 timestamp with or without fractional seconds. Returns `nil` only for
    /// malformed top-level JSON; a present-but-unparseable `start_ts`/`end_ts`
    /// becomes `nil` so the projection renders the web em-dash fallback.
    static func decode(fromJSONString json: String) -> DriveTimelineDrive? {
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let dictionary = object as? [String: Any]
        else {
            return nil
        }
        return decode(fromJSONObject: dictionary)
    }

    /// Decodes one drive from an already-parsed JSON object.
    static func decode(fromJSONObject dictionary: [String: Any]) -> DriveTimelineDrive {
        DriveTimelineDrive(
            startTs: DriveTimelineTime.parse(dictionary["start_ts"]),
            endTs: DriveTimelineTime.parse(dictionary["end_ts"]),
            durationS: DriveTimelineTime.seconds(dictionary["duration_s"])
        )
    }
}

// MARK: - Timestamp + numeric parsing

/// ISO-8601 timestamp + numeric coercion shared by the decoder. Pure + public so the
/// parse rules (fractional-second tolerance, em-dash fallback) are unit-testable.
/// Formatters are built per-call rather than cached in a `static let`, because
/// `ISO8601DateFormatter` is non-`Sendable` and the project compiles under Swift 6
/// strict concurrency (a cached global would be a data race).
public enum DriveTimelineTime {
    /// Parses an ISO-8601 instant from a JSON value, accepting both the
    /// fractional-second (`…:00.250Z`) and whole-second (`…:00Z`) encodings the API
    /// emits. A non-string, empty, or unparseable value yields `nil`.
    public static func parse(_ value: Any?) -> Date? {
        guard let raw = value as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return date(from: trimmed, fractionalSeconds: true)
            ?? date(from: trimmed, fractionalSeconds: false)
    }

    private static func date(from value: String, fractionalSeconds: Bool) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = fractionalSeconds
            ? [.withInternetDateTime, .withFractionalSeconds]
            : [.withInternetDateTime]
        return formatter.date(from: value)
    }

    /// Coerces a JSON `duration_s` (integer or floating) to seconds, collapsing a
    /// missing or non-numeric value to `0` (the web reads `drive.durationS` as a
    /// number that is always present).
    public static func seconds(_ value: Any?) -> Double {
        switch value {
        case let number as Double: number
        case let number as Int: Double(number)
        case let number as NSNumber: number.doubleValue
        case let text as String: Double(text) ?? 0
        default: 0
        }
    }
}

// MARK: - Error taxonomy (mirrors the shared `FacadeError` cases the source maps)

/// The failure modes the source surfaces, mirroring the shared `FacadeError` shape so
/// the production binding is a 1:1 map (offline keeps the cached drive; decode is
/// non-retryable; network / api are retryable).
public enum DriveTimelineError: Equatable, Sendable {
    case offline
    case network(message: String)
    case decode(message: String)
    case api(status: Int, code: String?, body: String?)

    /// Whether a retry affordance should be offered (web `QueryError` retry).
    public var isRetryable: Bool {
        switch self {
        case .offline, .network, .api: true
        case .decode: false
        }
    }
}

// MARK: - Load state (cache-then-network + stale flag, ADR-013)

/// Native projection of the shared core's `Resource<T>` lifecycle, carrying the last
/// cached value to keep on screen behind a refresh / error and the ADR-013 `stale`
/// flag. Mirrors the facade `LoadableState` without importing `Shared`, so the
/// surface host-compiles and every branch is unit-testable.
public enum DriveTimelineLoadState<Value> {
    case idle
    case loading(cached: Value?, stale: Bool)
    case loaded(Value, stale: Bool)
    case empty(stale: Bool)
    case failed(DriveTimelineError, cached: Value?, stale: Bool)
}

extension DriveTimelineLoadState: Equatable where Value: Equatable {}

// MARK: - Source seam (P1/S8) — the view never touches HTTP

/// The seam the model binds through. The production app implements this over the
/// shared P1/S8 state holders (the `DrivingStore.driveDetail` query projected via
/// `StateHolderModel<LoadableState<…>>`); previews and tests use
/// `InMemoryDriveTimelineSource`. The view never talks to the network directly.
@MainActor
public protocol DriveTimelineSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (DriveTimelineLoadState<DriveTimelineDrive>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryDriveTimelineSource: DriveTimelineSource {
    public var onUpdate: (@MainActor (DriveTimelineLoadState<DriveTimelineDrive>) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DriveTimelineLoadState<DriveTimelineDrive>?

    public init(initial: DriveTimelineLoadState<DriveTimelineDrive>? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ state: DriveTimelineLoadState<DriveTimelineDrive>) {
        onUpdate?(state)
    }
}

// MARK: - View model (P1/S8 binding)

/// The surface's observable view-model. Subscribes to a `DriveTimelineSource` and
/// republishes its load state for SwiftUI to switch over. The view performs no
/// networking; `start` / `stop` / `refresh` delegate to the source.
@MainActor
@Observable
public final class DriveTimelineModel {
    /// The current cache-then-network state for the drive timeline.
    public private(set) var state: DriveTimelineLoadState<DriveTimelineDrive> = .idle

    @ObservationIgnored private let source: any DriveTimelineSource
    @ObservationIgnored private var started = false

    /// Live binding: observe the shared drive-detail feed.
    public init(source: any DriveTimelineSource) {
        self.source = source
        source.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Preview / test binding: render a fixed state without the shared core.
    public init(previewState: DriveTimelineLoadState<DriveTimelineDrive>) {
        let inMemory = InMemoryDriveTimelineSource(initial: previewState)
        source = inMemory
        state = previewState
        inMemory.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Web-prop binding: the source component renders from a resolved `drive` prop
    /// (`<DriveTimeline drive={drive} />`). Maps the prop onto the content branch so
    /// the native surface renders the identical timeline.
    public convenience init(drive: DriveTimelineDrive) {
        self.init(previewState: DriveTimelineModel.loadState(drive: drive, loading: false))
    }

    /// Pure web-prop → load-state mapping (unit-tested): a `loading` prop keeps any
    /// resolved drive as cache; otherwise a present drive becomes the content
    /// timeline. A drive is always a value (never "empty" per-field), so the empty
    /// state arrives only from the source resolving with no drive. `nonisolated`
    /// because it touches no actor state — callable off the main actor.
    public nonisolated static func loadState(
        drive: DriveTimelineDrive,
        loading: Bool
    ) -> DriveTimelineLoadState<DriveTimelineDrive> {
        loading ? .loading(cached: drive, stale: false) : .loaded(drive, stale: false)
    }

    /// Begins observing the upstream feed (idempotent).
    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    /// Stops observing and closes the upstream subscription.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh; any cached drive stays visible (web `refetch`).
    public func refresh() {
        source.refresh()
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so no view
/// holds a hardcoded literal. Keys live in the per-surface "DriveTimeline" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time (kept
/// separate so parallel surface prompts never collide on the shared catalog). The
/// SwiftUI `text(_:_:)` helper lives in `DriveTimeline.Components.swift` so this
/// facade stays Foundation-only for the adapter + accessibility seams.
public enum DriveTimelineStrings {
    public static let table = "DriveTimeline"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a templated string and substitutes `{{name}}` tokens, matching the
    /// web i18next `t(key, { name, defaultValue })` interpolation signature.
    public static func format(_ key: String, _ fallback: String, _ values: [String: String]) -> String {
        var resolved = string(key, fallback)
        for (name, value) in values {
            resolved = resolved.replacingOccurrences(of: "{{\(name)}}", with: value)
        }
        return resolved
    }
}
