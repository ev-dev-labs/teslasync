//
//  SignalCatalogWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0087 · SignalCatalogWidget (Apple)
//
//  Foundation-only value types ported from the web source
//  (features/dashboard/widgets/SignalCatalogWidget.tsx): the cached DTO inputs
//  (catalog entries + the vehicle's signal observations), the row/group projection
//  the view renders, the load/connection/freshness/phase enums, and the i18n string
//  resolver. Kept transport- and SwiftUI-free so the adapter (Builder) and these
//  types compile + run headless in the executed unit harness.
//

import Foundation

// MARK: - Cached DTO inputs (port of the web hook payloads)

/// One catalog entry as delivered by `useSignalCatalog` (`SignalCatalogEntry`). Only
/// the fields the widget reads are modeled: the signal `name`, its owning
/// `sourceModule` (web `source_module`, used for grouping + search), the optional
/// `unit` badge, and the optional `description` (searchable). `sourceModule` is
/// optional here so an absent/empty module folds into the "Uncategorized" group the
/// same way the web `entry.source_module || 'Uncategorized'` does.
public struct SignalCatalogEntry: Sendable, Equatable, Identifiable {
    public var name: String
    public var sourceModule: String?
    public var unit: String?
    public var description: String?

    public var id: String {
        name
    }

    public init(
        name: String,
        sourceModule: String? = nil,
        unit: String? = nil,
        description: String? = nil
    ) {
        self.name = name
        self.sourceModule = sourceModule
        self.unit = unit
        self.description = description
    }
}

// MARK: - Projection (what the SwiftUI rows render)

/// The projected state of one catalog row: the signal name, its optional unit
/// badge, and the observation count for the active vehicle (port of the web row
/// `{sig.name} {sig.unit} {observationCounts.get(sig.name) ?? 0}`).
public struct SignalCatalogRow: Sendable, Equatable, Identifiable {
    public var name: String
    public var unit: String?
    public var observationCount: Int

    public var id: String {
        name
    }

    public init(name: String, unit: String? = nil, observationCount: Int = 0) {
        self.name = name
        self.unit = unit
        self.observationCount = observationCount
    }
}

/// One rendered category section: the (already-resolved) category label and its
/// rows, in the catalog order they were encountered — a port of the web `grouped`
/// map entry. `count` backs the "(N)" suffix the web header shows.
public struct SignalCatalogGroup: Sendable, Equatable, Identifiable {
    public var category: String
    public var rows: [SignalCatalogRow]

    public var id: String {
        category
    }

    public var count: Int {
        rows.count
    }

    public init(category: String, rows: [SignalCatalogRow]) {
        self.category = category
        self.rows = rows
    }
}

// MARK: - Load lifecycle / freshness / phase

/// The data load lifecycle, mirroring the shared `LoadableState` the production
/// source projects from the catalog `Resource<T>`.
public enum CatalogLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness band (ADR-013). The web has no explicit offline state;
/// `offline` is the native addition required by the surface's state matrix and is
/// reflected in the freshness chip + a cached banner.
public enum CatalogConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The freshness-chip status, a port of the web `DataFreshness` four-state model
/// (`fresh`/`fetching`/`stale`/`error`) extended with `offline`.
public enum CatalogFreshness: Sendable, Equatable {
    case fresh
    case fetching
    case stale
    case error
    case offline
}

/// The mutually-exclusive render branches of the widget shell: the web shows the
/// skeleton on the initial fetch, the "No signals in catalog" empty state when the
/// catalog resolves empty, and the search + grouped list otherwise (errors/
/// staleness ride along in the freshness chip).
public enum CatalogRenderPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Coalesced source snapshot

/// One snapshot pushed by a `SignalCatalogSource`: the cached catalog entries, the
/// active vehicle's observation signal-name stream (one element per observation row,
/// which the adapter tallies into per-signal counts), and the load/connection
/// status. The adapter turns this into `[SignalCatalogGroup]`.
public struct SignalCatalogUpdate: Sendable, Equatable {
    public var status: CatalogLoadStatus
    public var connection: CatalogConnection
    public var isFetching: Bool
    public var isError: Bool
    public var vehicleID: Int?
    public var entries: [SignalCatalogEntry]
    public var observations: [String]
    public var updatedAt: Date?

    public init(
        status: CatalogLoadStatus = .loading,
        connection: CatalogConnection = .live,
        isFetching: Bool = false,
        isError: Bool = false,
        vehicleID: Int? = nil,
        entries: [SignalCatalogEntry] = [],
        observations: [String] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.isError = isError
        self.vehicleID = vehicleID
        self.entries = entries
        self.observations = observations
        self.updatedAt = updatedAt
    }
}

// MARK: - Localization facade (P1/S10) — Foundation half

/// Resolves the surface's strings by key with the web `t(key, default)` English
/// fallback, so neither the adapter nor the view holds hardcoded literals. Keys
/// live in the "SignalCatalogWidget" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. The SwiftUI `text(_:_:)`
/// convenience lives in the Model file so this half stays Foundation-only (and the
/// adapter harness can resolve a11y/label copy headless).
public enum SignalCatalogStrings {
    public static let table = "SignalCatalogWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}
