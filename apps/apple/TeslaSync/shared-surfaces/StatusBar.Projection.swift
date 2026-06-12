//
//  StatusBar.Projection.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  The container-level value types for the always-on footer: the persisted preferences (web
//  `StatusBarPrefs` / `useStatusBarPrefs`), the data phase + connectivity, the bound input snapshot for one
//  render (the union of every segment's data plus the chrome inputs), and the resolved
//  ``StatusBarPresentation`` the view draws. The pure projection that derives the presentation lives in
//  StatusBar.Resolve.swift; the per-segment view models live in StatusBar.SegmentModels.swift.
//

import Foundation

// MARK: - StatusBarPrefs (web `StatusBarPrefs` / localStorage)

/// The persisted status-bar preferences — the VERBATIM port of the web `StatusBarPrefs`. `enabled` shows
/// the bar at all (web `!prefs.enabled` renders nothing); `iconOnly` forces the dense icon-only variant at
/// any width. `Codable` so the UserDefaults-backed store round-trips it (the native peer of the localStorage
/// JSON), with the same boolean-validating defaults.
public struct StatusBarPrefs: Sendable, Equatable, Codable {
    public var enabled: Bool
    public var iconOnly: Bool

    public init(enabled: Bool = true, iconOnly: Bool = false) {
        self.enabled = enabled
        self.iconOnly = iconOnly
    }

    /// The web `DEFAULTS = { enabled: true, iconOnly: false }`.
    public static let defaults = StatusBarPrefs()
}

// MARK: - StatusBarPhase (the bar's data phase)

/// The bar's top-level data phase. `loading` is the first paint before any segment data has resolved (the
/// skeleton chrome); `ready` is the resolved bar. Orthogonal to it, the stale / offline / error flags on the
/// presentation reflect live-stream freshness, connectivity, and backend reachability.
public enum StatusBarPhase: String, Sendable, Equatable {
    case loading, ready
}

// MARK: - StatusBarConnectivity (device network reachability)

/// Device network reachability — the native peer of `navigator.onLine` (NWPathMonitor upstream). When
/// `offline`, the bar shows an offline chip and keeps the last-known segment values (cached), never a blank.
public enum StatusBarConnectivity: String, Sendable, Equatable {
    case online, offline
}

// MARK: - StatusBarInput (the bound snapshot for one render)

/// The bound props for one render — the union of the chrome inputs (prefs, compact, narrow, phase,
/// connectivity) and every segment's data. The state-holder (P1/S8) assembles this from the live sources;
/// the view never reaches past the resolved presentation. Every field defaults so previews + tests can
/// build a partial snapshot.
public struct StatusBarInput: Sendable, Equatable {
    // Chrome
    public var prefs: StatusBarPrefs
    public var compact: Bool
    public var isNarrow: Bool
    public var phase: StatusBarPhase
    public var connectivity: StatusBarConnectivity
    // Connection (useApiHealth)
    public var apiHealth: StatusBarApiHealth
    public var latencyMs: Int?
    // Live telemetry (useLiveConnection)
    public var liveStatus: StatusBarLiveStatus
    public var lastMessageAt: Date?
    // Active vehicle (useSelectedVehicle + useVehicleState)
    public var vehicles: [StatusBarVehicleRef]
    public var selectedVehicleID: Int?
    public var batteryLevel: Int?
    public var ratedRangeMeters: Double?
    public var hasVehicleState: Bool
    public var distanceUnit: StatusBarDistanceUnit
    /// Background work (useBackgroundJobs)
    public var jobs: [StatusBarJob]
    // Version (system/version + update-check + changelog)
    public var version: StatusBarVersionInfo
    public var updateCheck: StatusBarUpdateCheck
    public var hasUnseenChangelog: Bool
    public var newChangelogEntries: Int
    /// Reference clock for age formatting (injected so tests are deterministic).
    public var now: Date

    public init(
        prefs: StatusBarPrefs = .defaults,
        compact: Bool = false,
        isNarrow: Bool = false,
        phase: StatusBarPhase = .ready,
        connectivity: StatusBarConnectivity = .online,
        apiHealth: StatusBarApiHealth = .ok,
        latencyMs: Int? = nil,
        liveStatus: StatusBarLiveStatus = .connected,
        lastMessageAt: Date? = nil,
        vehicles: [StatusBarVehicleRef] = [],
        selectedVehicleID: Int? = nil,
        batteryLevel: Int? = nil,
        ratedRangeMeters: Double? = nil,
        hasVehicleState: Bool = false,
        distanceUnit: StatusBarDistanceUnit = .km,
        jobs: [StatusBarJob] = [],
        version: StatusBarVersionInfo = StatusBarVersionInfo(appVersion: "dev", sha: "dev"),
        updateCheck: StatusBarUpdateCheck = .none,
        hasUnseenChangelog: Bool = false,
        newChangelogEntries: Int = 0,
        now: Date = Date()
    ) {
        self.prefs = prefs
        self.compact = compact
        self.isNarrow = isNarrow
        self.phase = phase
        self.connectivity = connectivity
        self.apiHealth = apiHealth
        self.latencyMs = latencyMs
        self.liveStatus = liveStatus
        self.lastMessageAt = lastMessageAt
        self.vehicles = vehicles
        self.selectedVehicleID = selectedVehicleID
        self.batteryLevel = batteryLevel
        self.ratedRangeMeters = ratedRangeMeters
        self.hasVehicleState = hasVehicleState
        self.distanceUnit = distanceUnit
        self.jobs = jobs
        self.version = version
        self.updateCheck = updateCheck
        self.hasUnseenChangelog = hasUnseenChangelog
        self.newChangelogEntries = newChangelogEntries
        self.now = now
    }

    /// The resolved icon-only flag — web `compact || prefs.iconOnly || isNarrow`.
    public var resolvedIconOnly: Bool {
        compact || prefs.iconOnly || isNarrow
    }
}

// MARK: - StatusBarPresentation (the whole resolved bar)

/// The resolved, view-ready projection of the whole bar — the native peer of the web component's full
/// render. The view reads this and draws; it never recomputes a tone, a label, visibility, or a fallback.
public struct StatusBarPresentation: Sendable, Equatable {
    /// `true` when the user disabled the bar — web `!prefs.enabled` returns `null` (the view renders
    /// nothing, faithfully).
    public let isHidden: Bool
    /// The resolved dense variant — web `compact || prefs.iconOnly || isNarrow`.
    public let iconOnly: Bool
    /// The data phase — `loading` shows skeleton chrome; `ready` shows the resolved segments.
    public let phase: StatusBarPhase
    /// `true` when the device is offline — shows the offline chip + keeps cached values.
    public let isOffline: Bool
    /// `true` when the live stream is past the freshness window — shows the stale chip + auto-refresh.
    public let isStale: Bool
    /// `true` when the backend is unreachable while the network is up — shows the error / retry chip.
    public let isError: Bool
    /// `true` when both data-driven segments are empty (0 vehicles + 0 jobs) — the bar keeps its Help +
    /// Version chrome so it is never a blank box.
    public let isEmpty: Bool

    // Segments
    public let connection: StatusBarConnectionVM
    public let live: StatusBarLiveVM
    public let vehicle: StatusBarVehicleVM
    public let background: StatusBarBackgroundVM
    public let help: StatusBarHelpVM
    public let version: StatusBarVersionVM

    // Container copy
    public let accessibilityLabel: String
    public let offlineChipLabel: String
    public let staleChipLabel: String
    public let errorChipLabel: String
    public let loadingLabel: String
    public let emptyLabel: String
    public let retryLabel: String

    public init(
        isHidden: Bool,
        iconOnly: Bool,
        phase: StatusBarPhase,
        isOffline: Bool,
        isStale: Bool,
        isError: Bool,
        isEmpty: Bool,
        connection: StatusBarConnectionVM,
        live: StatusBarLiveVM,
        vehicle: StatusBarVehicleVM,
        background: StatusBarBackgroundVM,
        help: StatusBarHelpVM,
        version: StatusBarVersionVM,
        accessibilityLabel: String,
        offlineChipLabel: String,
        staleChipLabel: String,
        errorChipLabel: String,
        loadingLabel: String,
        emptyLabel: String,
        retryLabel: String
    ) {
        self.isHidden = isHidden
        self.iconOnly = iconOnly
        self.phase = phase
        self.isOffline = isOffline
        self.isStale = isStale
        self.isError = isError
        self.isEmpty = isEmpty
        self.connection = connection
        self.live = live
        self.vehicle = vehicle
        self.background = background
        self.help = help
        self.version = version
        self.accessibilityLabel = accessibilityLabel
        self.offlineChipLabel = offlineChipLabel
        self.staleChipLabel = staleChipLabel
        self.errorChipLabel = errorChipLabel
        self.loadingLabel = loadingLabel
        self.emptyLabel = emptyLabel
        self.retryLabel = retryLabel
    }
}
