//
//  SignalLogWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0089 · SignalLogWidget (Apple)
//
//  Foundation-only value types ported from the web source
//  (features/dashboard/widgets/SignalLogWidget.tsx): the cached observation DTO,
//  the source taxonomy + its label/tone mapping, the feed-row projection the view
//  renders, the load/connection/freshness/phase enums, the coalesced snapshot, and
//  the i18n string resolver. Kept transport- and SwiftUI-free so the adapter
//  (Builder) and these types compile + run headless in the executed unit harness.
//

import Foundation

// MARK: - Source taxonomy (port of SOURCE_LABELS / SOURCE_COLORS)

/// The provenance of a signal observation (web `SignalSource`). Unknown wire
/// values are preserved as `.other` so the chip still labels them, mirroring the
/// web `SOURCE_LABELS[source] ?? source` fallback.
public enum SignalLogSourceKind: Sendable, Equatable {
    case fleetTelemetry
    case fleetApi
    case manual
    case backfill
    case other(String)

    /// Maps a wire `source` string (or `nil`) to a case. The web defaults a
    /// missing source to `backfill` (`obs.source ?? 'backfill'`).
    public static func from(wire: String?) -> SignalLogSourceKind {
        switch wire {
        case "fleet_telemetry": .fleetTelemetry
        case "fleet_api": .fleetApi
        case "manual": .manual
        case "backfill", nil: .backfill
        case let .some(raw): .other(raw)
        }
    }

    /// The short chip label (web `SOURCE_LABELS`): MQTT / API / Manual / Cache, or
    /// the raw source string for an unknown provenance.
    public var label: String {
        switch self {
        case .fleetTelemetry: "MQTT"
        case .fleetApi: "API"
        case .manual: "Manual"
        case .backfill: "Cache"
        case let .other(raw): raw
        }
    }

    /// The semantic tone the chip + rail adopt (token parity for the web
    /// `SOURCE_COLORS` hexes: telemetry→success, api→accent, manual→warning,
    /// cache/unknown→muted).
    public var tone: SignalLogTone {
        switch self {
        case .fleetTelemetry: .success
        case .fleetApi: .accent
        case .manual: .warning
        case .backfill, .other: .muted
        }
    }

    /// The web renders the telemetry badge as `variant="success"` and everything
    /// else as `variant="neutral"`.
    public var isLiveBadge: Bool {
        self == .fleetTelemetry
    }
}

/// A SwiftUI-free semantic tone key. The view maps it to a `Color.TS` token at the
/// render boundary so no hex literal leaks into the projection.
public enum SignalLogTone: String, Sendable, Equatable {
    case success
    case accent
    case warning
    case muted
}

// MARK: - Cached DTO input (port of the web `SignalObservation`)

/// One observation as delivered by `useSignalObservations` after the hook's
/// envelope adapter (`{vehicle_id, ts, signal_name, value_numeric, value_text,
/// value_bool, source}`). Exactly the fields the web widget reads.
public struct SignalObservationDTO: Sendable, Equatable {
    public var timestamp: Date
    public var signalName: String?
    public var valueNumeric: Double?
    public var valueText: String?
    public var valueBool: Bool?
    public var source: SignalLogSourceKind

    public init(
        timestamp: Date,
        signalName: String?,
        valueNumeric: Double? = nil,
        valueText: String? = nil,
        valueBool: Bool? = nil,
        source: SignalLogSourceKind
    ) {
        self.timestamp = timestamp
        self.signalName = signalName
        self.valueNumeric = valueNumeric
        self.valueText = valueText
        self.valueBool = valueBool
        self.source = source
    }
}

// MARK: - Projection (what the SwiftUI feed renders)

/// The projected state of one feed row (port of the web `EventFeedItem` mapping):
/// a stable id, the source chip label/tone/liveness, the signal title, the
/// formatted value, and the timestamp the row renders relatively.
public struct SignalLogRowProjection: Sendable, Equatable, Identifiable {
    public var id: String
    public var sourceLabel: String
    public var tone: SignalLogTone
    public var isLiveBadge: Bool
    public var title: String
    public var value: String
    public var timestamp: Date

    public init(
        id: String,
        sourceLabel: String,
        tone: SignalLogTone,
        isLiveBadge: Bool,
        title: String,
        value: String,
        timestamp: Date
    ) {
        self.id = id
        self.sourceLabel = sourceLabel
        self.tone = tone
        self.isLiveBadge = isLiveBadge
        self.title = title
        self.value = value
        self.timestamp = timestamp
    }
}

// MARK: - Load lifecycle / connection / freshness / phase

/// The data load lifecycle, mirroring the shared `LoadableState` the production
/// source projects from the `useSignalObservations` `Resource<[Observation]>`.
public enum SignalLogStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream connectivity (ADR-013). The web has no explicit offline state;
/// `offline` is the native addition required by the surface's state matrix and is
/// reflected in the freshness chip + a cached banner.
public enum SignalLogConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The freshness-chip status — a port of the web `DataFreshness` four-state model
/// (`fresh`/`fetching`/`stale`/`error`) extended with `offline`.
public enum SignalLogFreshness: Sendable, Equatable {
    case fresh
    case fetching
    case stale
    case error
    case offline
}

/// The mutually-exclusive render branches of the widget shell. Whenever rows are
/// known they stay visible (errors/staleness ride along in the chip); only an
/// empty resolved feed shows the empty state, and only a rowless initial fetch
/// shows the skeleton.
public enum SignalLogRenderPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Coalesced source snapshot

/// One snapshot pushed by a `SignalLogSource`: the cached observations + the MQTT
/// per-vehicle rates plus their load/connection status. The adapter turns this
/// into `[SignalLogRowProjection]` + the aggregate signals/sec.
public struct SignalLogUpdate: Sendable, Equatable {
    public var status: SignalLogStatus
    public var connection: SignalLogConnection
    public var isFetching: Bool
    public var isError: Bool
    public var vehicleID: Int?
    public var observations: [SignalObservationDTO]
    public var signalRates: [Double]
    public var updatedAt: Date?

    public init(
        status: SignalLogStatus = .loading,
        connection: SignalLogConnection = .live,
        isFetching: Bool = false,
        isError: Bool = false,
        vehicleID: Int? = nil,
        observations: [SignalObservationDTO] = [],
        signalRates: [Double] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.isError = isError
        self.vehicleID = vehicleID
        self.observations = observations
        self.signalRates = signalRates
        self.updatedAt = updatedAt
    }
}

// MARK: - Localization facade (P1/S10) — Foundation half

/// Resolves the surface's strings by key with the web `t(key, default)` English
/// fallback, so neither the adapter nor the view holds hardcoded literals. Keys
/// live in the "SignalLogWidget" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time. The SwiftUI `text(_:_:)` convenience lives in the
/// Model file so this half stays Foundation-only (and the adapter harness can
/// resolve a11y/label copy headless).
public enum SignalLogStrings {
    public static let table = "SignalLogWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}
