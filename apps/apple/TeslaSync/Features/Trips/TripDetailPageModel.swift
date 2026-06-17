//
//  TripDetailPageModel.swift
//  TeslaSync — P4-APPLE P7 · page:trips/TripDetail (Apple) — View model
//
//  The `@MainActor @Observable` state holder for `TripDetailPage` (ADR-004 — no networking in the
//  view). It consumes the `TripDetailDataSource` seam (web `useTrip`) and projects the result into
//  the loading / empty / error / success states the web page renders, then exposes the formatted
//  stat panels + detail rows for the success body. The currency symbol mirrors the web
//  `settings.currency_symbol` the cost card prefixes. No view logic lives here.
//

import Observation
import SwiftUI

@MainActor
@Observable
public final class TripDetailPageModel {
    /// The trip id this page renders (web route `:id`).
    public let tripID: Int64
    /// Web `settings.currency_symbol` (default `'$'`) — the prefix the cost card formats with.
    public let currencySymbol: String

    @ObservationIgnored private let dataSource: any TripDetailDataSource

    public private(set) var state: TripDetailState = .loading

    public init(
        tripID: Int64,
        currencySymbol: String = TripDetailFormat.defaultCurrencySymbol,
        dataSource: any TripDetailDataSource = SampleTripDetailDataSource()
    ) {
        self.tripID = tripID
        self.currencySymbol = currencySymbol
        self.dataSource = dataSource
    }

    /// The resolved trip, when the source has loaded successfully (web `trip`).
    public var trip: TripDetailRecord? {
        if case let .success(record) = state { return record }
        return nil
    }

    /// Web header subtitle: `trip.name ?? "Trip #{id}"`, shown once the trip resolves.
    public var subtitle: String? {
        trip?.displayTitle
    }

    // MARK: Loading (web `useTrip`)

    /// Loads the trip. Projects the result into loading → empty | error | success.
    public func load() async {
        state = .loading
        await fetch()
    }

    /// Pull-to-refresh / Retry: re-runs the trip fetch (web refetch).
    public func refresh() async {
        await fetch()
    }

    private func fetch() async {
        do {
            if let record = try await dataSource.useTrip(tripID: tripID) {
                state = .success(record)
            } else {
                state = .empty
            }
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    // MARK: Display projection (web render boundary)

    /// The four stat panels formatted to the user's units (web `StatCard` row). Empty until the
    /// trip resolves so the view binds a single source of truth.
    public func stats(units: UnitPreferences) -> [TripDetailStatValue] {
        guard case let .success(record) = state else { return [] }
        return TripDetailFormat.stats(record, units: units, currencySymbol: currencySymbol)
    }

    /// The six detail rows formatted from the trip (web `KVList`).
    public var infoRows: [TripDetailInfoRow] {
        guard case let .success(record) = state else { return [] }
        return TripDetailFormat.infoRows(record)
    }
}
