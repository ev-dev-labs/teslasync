import SwiftUI

/// Navigation registration for the Trips **Trips list** page. The web route `/trips` is value-less, so
/// it is modeled natively as a typed `NavigationDestination` marker: a host stack adopts
/// `.tripListDestination()` and pushes a `TripListLink()` to open the page, so it is reachable +
/// deep-linkable on the macOS / iPad detail column and the iPhone stack (ADR-002/006) without widening
/// the shared `AppRoute` enum. Mirrors the sibling `TripsReplayRouteRegistration` shape (the
/// `@Observable` model is built inside the main-actor view builder, keeping the escaping destination /
/// data-source closures free of business logic, ADR-004).
public struct TripListLink: Hashable, Sendable {
    public init() {}
}

public extension View {
    /// Registers `TripListPage` as the `NavigationDestination` for a `TripListLink`, so any host stack
    /// can deep-link into the Trips list (web `/trips`).
    func tripListDestination(
        query: TripListQuery = TripListQuery(),
        currencySymbol: String = CurrencyMeta.defaultCurrencySymbol,
        locale: Locale = .autoupdatingCurrent,
        dataSource: @escaping @Sendable () -> any TripListDataSource = { SampleTripListDataSource() }
    ) -> some View {
        navigationDestination(for: TripListLink.self) { _ in
            TripListPage(
                query: query,
                currencySymbol: currencySymbol,
                locale: locale,
                dataSource: dataSource()
            )
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen without constructing the model, plus a forwarder that resolves the web `/trips`
/// path to a `TripListLink`.
public enum TripListRouteRegistration {
    /// Builds the Trips list screen for the given query + currency + data source (default = sample).
    @MainActor
    public static func make(
        query: TripListQuery = TripListQuery(),
        currencySymbol: String = CurrencyMeta.defaultCurrencySymbol,
        locale: Locale = .autoupdatingCurrent,
        dataSource: any TripListDataSource = SampleTripListDataSource()
    ) -> TripListPage {
        TripListPage(query: query, currencySymbol: currencySymbol, locale: locale, dataSource: dataSource)
    }

    /// Resolves the web route `/trips` (with optional trailing slash / query) to a `TripListLink`; any
    /// other path returns `nil`.
    public static func link(forPath rawPath: String) -> TripListLink? {
        let withoutQuery = rawPath.split(separator: "?", maxSplits: 1).first.map(String.init) ?? rawPath
        var normalized = withoutQuery
        while normalized.count > 1, normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        return normalized == "/trips" ? TripListLink() : nil
    }
}
