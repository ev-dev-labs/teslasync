//
//  TeslaApiRefTool.Models.swift
//  TeslaSync — P4 feature view · 0020 · TeslaApiRefTool (Apple)
//
//  Foundation-only value types ported from the web source
//  (features/admin/components/devtools/tools/TeslaApiRefTool.tsx + its constants.ts):
//  the endpoint row, the bundled Tesla Fleet API endpoint catalog (the web
//  `TESLA_ENDPOINTS` constant), the load / connection / freshness / phase enums, the
//  method tone, the coalesced source snapshot, and the i18n string resolver. Kept
//  transport- and SwiftUI-free so the adapter (Builder) and these types compile + run
//  headless in the executed unit harness.
//

import Foundation

// MARK: - Endpoint row (port of the web `TESLA_ENDPOINTS` element)

/// One Tesla Fleet API endpoint reference row, as modeled by the web source's
/// `{ method, path, desc }` records. `method` is the HTTP verb, `path` the request
/// path (also the stable identity, mirroring the web `keyExtractor={(r) => r.path}`),
/// and `desc` the human description. All three are searched by the filter.
public struct TeslaApiEndpoint: Sendable, Equatable, Identifiable {
    public var method: String
    public var path: String
    public var desc: String

    public var id: String {
        path
    }

    public init(method: String, path: String, desc: String) {
        self.method = method
        self.path = path
        self.desc = desc
    }
}

// MARK: - Method tone (port of the web `Badge variant`)

/// The semantic tone of a method badge. The web renders
/// `variant={r.method === 'GET' ? 'info' : 'warning'}`, so reads are `info` and any
/// mutating verb is `warning`. Foundation-only; the view maps it to a status color.
public enum ApiRefMethodTone: Sendable, Equatable {
    case info
    case warning
}

// MARK: - Load lifecycle / connection / freshness / phase

/// The data load lifecycle, mirroring the shared `LoadableState` a production source
/// would project from the catalog `Resource<T>`. The bundled reference catalog
/// resolves immediately, but the full lifecycle is modeled so every state in the
/// surface's matrix is reachable + testable.
public enum ApiRefLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness band (ADR-013). The web tool has no connectivity model;
/// `stale` / `offline` are the native additions required by the surface state matrix
/// and are reflected in the freshness chip + a cached banner.
public enum ApiRefConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The freshness-chip status — `fresh` / `fetching` / `stale` / `error` extended with
/// `offline` for the native chip.
public enum ApiRefFreshness: Sendable, Equatable {
    case fresh
    case fetching
    case stale
    case error
    case offline
}

/// The mutually-exclusive render branches of the tool shell: the skeleton on the
/// initial fetch, the empty state when the catalog resolves with no rows, a retryable
/// error when the fetch failed with nothing cached, and the search + table otherwise
/// (staleness / offline ride along in the freshness chip + a banner).
public enum ApiRefRenderPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Coalesced source snapshot

/// One snapshot pushed by a `TeslaApiRefSource`: the cached endpoint catalog plus the
/// load / connection status and fetch flags. The model stores `endpoints` and resolves
/// the render phase + freshness; the view derives the filtered rows from `endpoints` +
/// the search text (mirroring the web `filtered` memo).
public struct ApiRefUpdate: Sendable, Equatable {
    public var status: ApiRefLoadStatus
    public var connection: ApiRefConnection
    public var isFetching: Bool
    public var isError: Bool
    public var endpoints: [TeslaApiEndpoint]
    public var updatedAt: Date?

    public init(
        status: ApiRefLoadStatus = .loading,
        connection: ApiRefConnection = .live,
        isFetching: Bool = false,
        isError: Bool = false,
        endpoints: [TeslaApiEndpoint] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.isError = isError
        self.endpoints = endpoints
        self.updatedAt = updatedAt
    }
}

// MARK: - Bundled catalog (port of the web `TESLA_ENDPOINTS` constant)

/// The bundled Tesla Fleet API endpoint reference, a 1:1 port of the web
/// `TESLA_ENDPOINTS` constant (devtools/constants.ts). It is a static reference table,
/// not a network resource — the production source delivers it through the state-holder
/// seam so the view stays transport-free, exactly as the web reads the constant.
public enum TeslaApiCatalog {
    public static let endpoints: [TeslaApiEndpoint] = [
        TeslaApiEndpoint(method: "GET", path: "/api/1/vehicles", desc: "List vehicles"),
        TeslaApiEndpoint(method: "GET", path: "/api/1/vehicles/{id}/vehicle_data", desc: "Get vehicle data"),
        TeslaApiEndpoint(method: "POST", path: "/api/1/vehicles/{id}/command/wake_up", desc: "Wake up vehicle"),
        TeslaApiEndpoint(method: "POST", path: "/api/1/vehicles/{id}/command/door_lock", desc: "Lock doors"),
        TeslaApiEndpoint(method: "POST", path: "/api/1/vehicles/{id}/command/door_unlock", desc: "Unlock doors"),
        TeslaApiEndpoint(method: "POST", path: "/api/1/vehicles/{id}/command/flash_lights", desc: "Flash lights"),
        TeslaApiEndpoint(method: "POST", path: "/api/1/vehicles/{id}/command/honk_horn", desc: "Honk horn"),
        TeslaApiEndpoint(
            method: "POST",
            path: "/api/1/vehicles/{id}/command/set_charge_limit",
            desc: "Set charge limit"
        ),
        TeslaApiEndpoint(method: "POST", path: "/api/1/vehicles/{id}/command/charge_start", desc: "Start charging"),
        TeslaApiEndpoint(method: "POST", path: "/api/1/vehicles/{id}/command/charge_stop", desc: "Stop charging"),
        TeslaApiEndpoint(
            method: "GET",
            path: "/api/1/vehicles/{id}/nearby_charging_sites",
            desc: "Nearby chargers"
        )
    ]
}

// MARK: - Localization facade (P1/S10) — Foundation half

/// Resolves the surface's strings by key with the web English fallback, so neither the
/// adapter nor the view holds hardcoded literals. Keys live in the "TeslaApiRefTool"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time. The
/// web-parity keys are the exact `t(...)` keys from the source ("Tesla Api Ref",
/// "Tesla Api Ref Desc", "Search Endpoints", "Method", "Path", "Endpoint Desc"); the
/// remaining keys back the native chrome (freshness, states, a11y). The SwiftUI
/// `text(_:_:)` convenience lives in the Model file so this half stays Foundation-only.
public enum TeslaApiRefStrings {
    public static let table = "TeslaApiRefTool"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}
