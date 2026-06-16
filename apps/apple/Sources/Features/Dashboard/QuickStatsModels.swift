import Foundation

// Value types + pure derivations for the Quick Stats surface (web
// `web/src/features/dashboard/pages/QuickStatsPage.tsx`, route `/quick-stats`). The page reads
// the vehicle list (`useVehicles`), the 30-day fleet analytics summary (`useAnalyticsSummary`),
// and the first vehicle's live state (`useVehicleState`). Every measurement the summary exposes
// is SI on the wire — `totalDistanceM` is metres and `totalEnergyWh` is watt-hours — so nothing
// non-SI is stored or computed here; the view converts at the render boundary via the shared
// `Units` facade + `QuickStatsPageFormat` (ADR-005). The web page's inline `?? 0` / `?? '—'`
// fallbacks live here as typed defaults so the SwiftUI view stays declarative.

// MARK: - Vehicle (web `useVehicles` → `GET /vehicles`)

/// One vehicle in the kiosk header (web `vehicles[0]`). Holds only identity + label strings, so
/// they round-trip verbatim (no SI measurements here).
public struct QuickStatsPageVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let model: String

    public init(id: Int64, displayName: String, model: String) {
        self.id = id
        self.displayName = displayName
        self.model = model
    }

    /// Web `vehicle.display_name || t('quickStats.defaultName')` — the resolved name, or `nil`
    /// when `display_name` is empty so the view falls back to the localized `quickStats.defaultName`
    /// ("Tesla"). Unlike the sibling Glance header there is NO model fallback for the name; the
    /// model is shown separately in the subtitle.
    public var resolvedName: String? {
        displayName.isEmpty ? nil : displayName
    }
}

// MARK: - Vehicle state (web `useVehicleState` → `GET /vehicles/{id}/state`)

/// The first vehicle's latest connection state (web `stateData.state`). Only the `state` token the
/// kiosk subtitle reads is modelled; `nil` means the signal has not been reported.
public struct QuickStatsPageVehicleState: Hashable, Sendable {
    public let state: String?

    public init(state: String?) {
        self.state = state
    }

    /// Web `stateData?.state?.state ?? 'offline'` — the raw connection token rendered verbatim,
    /// defaulting to the API's `offline` sentinel (a data value, like `online` / `asleep`, NOT UI
    /// prose, so it is not a localized literal — faithful to the web's bare `'offline'` fallback).
    public var displayState: String {
        if let state, !state.isEmpty { return state }
        return Self.offlineSentinel
    }

    /// The web `'offline'` data fallback for an absent connection state.
    public static let offlineSentinel = "offline"
}

// MARK: - Analytics summary (web `useAnalyticsSummary` → `GET /analytics/fleet?days=`)

/// The four headline figures the kiosk shows from the fleet analytics summary (web
/// `AnalyticsSummary`). Distance is SI metres (web wire is km × 1000) and energy SI watt-hours
/// (web wire is kWh); `totalCost` is raw currency and `totalDrives` a plain count. The presence of
/// this value drives the page's success metrics; the per-metric `?? 0` fallbacks live in the view.
public struct QuickStatsPageSummary: Hashable, Sendable {
    public let totalDistanceM: Double
    public let totalDrives: Int
    public let totalEnergyWh: Double
    public let totalCost: Double

    public init(totalDistanceM: Double, totalDrives: Int, totalEnergyWh: Double, totalCost: Double) {
        self.totalDistanceM = totalDistanceM
        self.totalDrives = totalDrives
        self.totalEnergyWh = totalEnergyWh
        self.totalCost = totalCost
    }

    /// A zeroed summary mirroring the web `?? 0` fallbacks — used so the four metric cards always
    /// render (never hidden) even before/without analytics data.
    public static let zero = QuickStatsPageSummary(totalDistanceM: 0, totalDrives: 0, totalEnergyWh: 0, totalCost: 0)
}

// MARK: - Data source seam (web `useVehicles` + `useAnalyticsSummary` + `useVehicleState`)

/// Supplies every datum the Quick Stats page renders. The production implementation binds the
/// shared KMP repositories/use-cases (ADR-004 — the view holds no networking); previews and tests
/// inject doubles to drive the loading / empty / error / success states. Mirrors the sibling
/// feature `*DataSource` seams.
///
/// Method ↔ web map: `loadVehicles` ← `useVehicles` / `GET /vehicles`; `loadSummary` ←
/// `useAnalyticsSummary` / `GET /analytics/fleet?days=`; `loadState` ← `useVehicleState` /
/// `GET /vehicles/{id}/state`.
public protocol QuickStatsPageDataSource: Sendable {
    func loadVehicles() async throws -> [QuickStatsPageVehicle]
    func loadSummary(days: Int) async throws -> QuickStatsPageSummary
    func loadState(vehicleID: Int64) async throws -> QuickStatsPageVehicleState?
}

// MARK: - Page phase (web `PageContainer loading / error / body`)

/// The page's terminal phase, mirroring the web `PageContainer` props. `.loading` is the
/// `vehiclesLoading || analyticsLoading` phase, `.error` is the `vehiclesError || analyticsError`
/// retryable region, and `.ready` is the body — which itself shows the no-vehicle empty card or
/// the populated vehicle card, with the four metric cards always rendered.
public enum QuickStatsPagePhase: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}
