import Foundation
import Observation

// MARK: - Data source seam (web four energy `useQuery`/`useMutation` hooks)

/// Supplies every datum the Energy Products page renders. The production implementation binds the
/// shared KMP repositories/use-cases (ADR-004 — the view holds no networking); previews and tests
/// inject doubles to drive the loading / empty / error / success states. Mirrors the sibling
/// battery `*DataSource` seams.
///
/// Method ↔ web hook map:
/// `loadSites` ← `useTeslaEnergySites` → `GET /tesla/energy-sites`;
/// `refreshSites` ← `useRefreshTeslaEnergySites` → `POST /tesla/energy-sites/refresh`;
/// `loadSiteInfo` ← `useTeslaEnergySiteInfo(siteId)` → `GET /tesla/energy-sites/{id}/site-info`;
/// `refreshSiteInfo` ← `useRefreshTeslaEnergySiteInfo` → `POST /tesla/energy-sites/{id}/site-info/refresh`.
public protocol EnergyProductsDataSource: Sendable {
    func loadSites() async throws -> [EnergyProductSite]
    func refreshSites() async throws -> [EnergyProductSite]
    func loadSiteInfo(siteID: Int64) async throws -> EnergyProductSiteInfoResponse?
    func refreshSiteInfo(siteID: Int64) async throws -> EnergyProductSiteInfoResponse?
}

// MARK: - Page phase (web PageContainer loading / error / body)

/// The page's terminal phase, driven by the primary sites source (web `useTeslaEnergySites`).
/// `loading` shows the spinner, `error` replaces the body with the message + retry (web
/// PageContainer `error`), `ready` renders the summary + cards (with the per-site empty handled
/// inside the body, web `sites.length > 0 ? … : <EmptyState/>`).
public enum EnergyProductsPhase: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the Energy Products page binds to (ADR-004 — no networking in
/// the view). Owns the discovered product list (web `useTeslaEnergySites`), the per-site
/// configuration snapshots (web per-card `useTeslaEnergySiteInfo`), and the summary tallies the
/// web computes inline with `sites.filter(...)`.
@MainActor
@Observable
public final class EnergyProductsPageModel {
    public private(set) var phase: EnergyProductsPhase = .loading

    /// Whether the header "Refresh from Tesla" refetch is in flight while content is shown (web
    /// `refreshMutation.isPending`).
    public private(set) var isRefreshing = false

    public private(set) var sites: [EnergyProductSite] = []

    /// Per-site-info render state keyed by `energySiteID` (the id that drives the info query).
    public private(set) var siteInfo: [Int64: EnergyProductSiteInfoState] = [:]

    @ObservationIgnored private let dataSource: any EnergyProductsDataSource

    public init(dataSource: any EnergyProductsDataSource = SampleEnergyProductsDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Summary tallies (web summary StatCards)

    public var totalSites: Int { sites.count }
    public var sitesWithSolar: Int { sites.filter(\.hasSolar).count }
    public var sitesWithBattery: Int { sites.filter(\.hasBattery).count }
    public var sitesBackupCapable: Int { sites.filter(\.backupCapable).count }

    /// Web `sites.length > 0 ? … : <EmptyState/>` — the populated-vs-empty body gate.
    public var hasNoSites: Bool { sites.isEmpty }

    // MARK: Loading

    /// Loads the product list then each site's configuration (web `useTeslaEnergySites` + the
    /// per-card `useTeslaEnergySiteInfo`). A sites failure surfaces the page error state.
    public func load() async {
        phase = .loading
        await fetchSites(refresh: false)
    }

    /// Header "Refresh from Tesla" (web `refreshMutation.mutate()` → invalidates the sites query),
    /// keeping current content visible while the refetch runs.
    public func refresh() async {
        isRefreshing = true
        await fetchSites(refresh: true)
        isRefreshing = false
    }

    private func fetchSites(refresh: Bool) async {
        do {
            sites = refresh ? try await dataSource.refreshSites() : try await dataSource.loadSites()
            phase = .ready
            await loadAllSiteInfo()
        } catch {
            // The sites query drives the page error (web PageContainer `error`). A background
            // refresh that fails while content is already shown keeps the existing list.
            phase = sites.isEmpty ? .error(error.localizedDescription) : .ready
        }
    }

    /// Loads the per-site configuration for every discovered site. Each card shows its own
    /// skeleton then its detail / empty as the snapshot arrives (web independent per-card queries).
    private func loadAllSiteInfo() async {
        var initial: [Int64: EnergyProductSiteInfoState] = [:]
        for site in sites {
            initial[site.energySiteID] = EnergyProductSiteInfoState(status: .loading)
        }
        siteInfo = initial

        for site in sites {
            let response = try? await dataSource.loadSiteInfo(siteID: site.energySiteID)
            siteInfo[site.energySiteID] = EnergyProductSiteInfoState(
                status: .loaded,
                info: response?.data,
                fetchedAt: response?.fetchedAt,
                isRefreshing: false
            )
        }
    }

    /// Per-card "Refresh site info" (web `refreshMutation.mutate(siteId)`). A failed refresh keeps
    /// the last-known detail visible (web mutation error surfaces a toast, never wipes the card).
    public func refreshSiteInfo(siteID: Int64) async {
        let previous = siteInfo[siteID]
        var pending = previous ?? EnergyProductSiteInfoState(status: .loading)
        pending.isRefreshing = true
        siteInfo[siteID] = pending

        if let response = try? await dataSource.refreshSiteInfo(siteID: siteID) {
            siteInfo[siteID] = EnergyProductSiteInfoState(
                status: .loaded,
                info: response.data,
                fetchedAt: response.fetchedAt,
                isRefreshing: false
            )
        } else {
            siteInfo[siteID] = EnergyProductSiteInfoState(
                status: .loaded,
                info: previous?.info,
                fetchedAt: previous?.fetchedAt,
                isRefreshing: false
            )
        }
    }

    /// The render state for one card's site-info subsection (loading until its snapshot arrives).
    public func siteInfoState(for site: EnergyProductSite) -> EnergyProductSiteInfoState {
        siteInfo[site.energySiteID] ?? EnergyProductSiteInfoState(status: .loading)
    }
}
