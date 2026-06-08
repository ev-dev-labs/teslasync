import Foundation
import Observation
import Shared

// MARK: - Presentation resolution (every state)

/// Freshness chrome shown in the widget header.
public enum BatteryCellsFreshness: Equatable, Sendable {
    case live
    case stale
    case offline
}

/// The mutually-exclusive surface the widget renders for the current data state.
/// Exhaustive so each branch is unit-tested (loading / empty / error / offline /
/// stale-or-live content).
public enum BatteryCellsPresentation: Equatable, Sendable {
    case loading
    case empty
    case offlineNoData
    case error(retryable: Bool)
    case content(BatteryCellsProjection, freshness: BatteryCellsFreshness, refreshing: Bool)
}

public extension BatteryCellsPresentation {
    /// Pure mapping from the facade `LoadableState` (ADR-013 cache-then-network +
    /// stale flag) to a render-ready presentation, reproducing the web widget's
    /// loading / error / empty branches and adding the prompt's stale + offline
    /// chrome on top of any cached value.
    static func resolve(
        state: LoadableState<BatteryCellSummary>,
        size: DashboardWidgetSize,
        cellWord: String,
        locale: Locale = .current
    ) -> BatteryCellsPresentation {
        func project(_ summary: BatteryCellSummary) -> BatteryCellsProjection {
            BatteryCellsProjection.make(from: summary, size: size, cellWord: cellWord, locale: locale)
        }

        switch state {
        case .idle:
            return .loading

        case let .loading(cached, stale):
            guard let cached else { return .loading }
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: true)

        case let .loaded(summary, stale):
            return .content(project(summary), freshness: stale ? .stale : .live, refreshing: false)

        case .empty:
            return .empty

        case let .failed(error, cached, stale):
            if error == .offline {
                guard let cached else { return .offlineNoData }
                return .content(project(cached), freshness: .offline, refreshing: false)
            }
            if let cached {
                return .content(project(cached), freshness: stale ? .stale : .live, refreshing: false)
            }
            return .error(retryable: error.isRetryable)
        }
    }
}

// MARK: - View model (P1/S8 state-holder binding)

/// `@Observable` view model for the battery-cells widget. Binds the shared core's
/// `EnergyStore.batteryCells` feed through the P1/S8 `StateHolderModel`, exactly
/// like `VehicleSettingsModel` — the view never touches HTTP. A preview/test
/// initializer injects a fixed `LoadableState` so the surface renders every state
/// without the KMP runtime.
@MainActor
@Observable
public final class BatteryCellsModel {
    @ObservationIgnored private let holder: StateHolderModel<LoadableState<BatteryCellSummary>>?
    @ObservationIgnored private let injectedState: LoadableState<BatteryCellSummary>

    /// Live binding: observe `GET /vehicles/{id}/battery/cells` via the shared
    /// Energy holder (web `useBatteryCells`).
    public init(store: EnergyStore, vehicleID: String) {
        let flow = store.batteryCells(vehicleId: vehicleID)
        holder = StateHolderModel(flow: flow) { raw in
            guard let resource = raw as? Resource else { return nil }
            return LoadableState.from(resource) { BatteryCellSummary.decode(fromSharedPayload: $0) }
        }
        injectedState = .idle
    }

    /// Preview / test binding: render a fixed state without the shared core.
    public init(previewState: LoadableState<BatteryCellSummary>) {
        holder = nil
        injectedState = previewState
    }

    /// The current cache-then-network state for the cells feed.
    public var state: LoadableState<BatteryCellSummary> {
        holder?.state ?? injectedState
    }

    /// Begins observing the feed (idempotent).
    public func start() {
        holder?.start()
    }

    /// Stops observing and closes the upstream subscription.
    public func stop() {
        holder?.stop()
    }

    /// Re-subscribes the shared feed to re-collect cache-then-network (the only
    /// refetch path the Energy holder exposes for reads).
    public func refresh() {
        guard holder != nil else { return }
        stop()
        start()
    }
}
