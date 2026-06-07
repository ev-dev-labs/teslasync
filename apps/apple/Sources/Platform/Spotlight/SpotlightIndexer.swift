import CoreSpotlight
import Foundation
import UniformTypeIdentifiers

/// Abstraction over the Core Spotlight index so the indexer's build + privacy
/// logic is unit-testable without touching the real on-device index.
public protocol SearchableIndexing: Sendable {
    func index(_ items: [CSSearchableItem]) async throws
    func deleteAll(withDomainIdentifiers domainIdentifiers: [String]) async throws
}

/// Production `SearchableIndexing` backed by the default Core Spotlight index.
public struct CoreSpotlightIndex: SearchableIndexing {
    public init() {}

    public func index(_ items: [CSSearchableItem]) async throws {
        try await CSSearchableIndex.default().indexSearchableItems(items)
    }

    public func deleteAll(withDomainIdentifiers domainIdentifiers: [String]) async throws {
        try await CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: domainIdentifiers)
    }
}

/// Indexes the app's **non-sensitive** route shortcuts into Spotlight so the user
/// can search "TeslaSync Charging" and jump straight in. Strictly privacy-gated:
/// when indexing is disabled (or on sign-out) every item is removed.
///
/// Items carry only route titles/keywords — no vehicle, location, or account data.
public struct SpotlightIndexer: Sendable {
    /// Domain grouping every route shortcut, so they can be removed in one call.
    public static let domain = "io.teslasync.routes"

    private let index: SearchableIndexing

    public init(index: SearchableIndexing = CoreSpotlightIndex()) {
        self.index = index
    }

    /// The routes worth surfacing in Spotlight (skips the onboarding/search shells).
    public static let indexableRoutes: [AppRoute] = AppRoute.allCases.filter {
        $0 != .onboarding && $0 != .search && $0 != .explore
    }

    /// Builds the searchable item for a route. Pure + testable.
    public static func item(for route: AppRoute) -> CSSearchableItem {
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.item)
        attributes.title = String(localized: String.LocalizationValue("route." + route.rawValue))
        attributes.contentDescription = String(
            localized: String.LocalizationValue("spotlight.route.\(route.rawValue).description")
        )
        attributes.keywords = ["TeslaSync", route.rawValue, route.pathSegment]
        return CSSearchableItem(
            uniqueIdentifier: route.pathSegment,
            domainIdentifier: domain,
            attributeSet: attributes
        )
    }

    /// Reindexes (or fully removes, when `enabled` is false) the route shortcuts.
    public func reindex(routes: [AppRoute] = SpotlightIndexer.indexableRoutes, enabled: Bool) async {
        do {
            if enabled {
                try await index.index(routes.map(Self.item(for:)))
            } else {
                try await index.deleteAll(withDomainIdentifiers: [Self.domain])
            }
        } catch {
            // Spotlight indexing is best-effort; a failure must never disrupt the
            // app. The next reindex retries.
        }
    }

    /// Resolves the route a tapped Spotlight result should open.
    public static func route(fromSearchableItemActivity activity: NSUserActivity) -> AppRoute? {
        guard activity.activityType == CSSearchableItemActionType,
              let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String
        else { return nil }
        return AppRouteParser.parse(path: "/" + id)
    }
}
