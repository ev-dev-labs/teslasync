import SwiftUI

/// Navigation registration for the System **incident timeline** page. The web route
/// `/system-status/incidents/:id` carries the incident id as a path parameter, so it is modeled
/// natively as a typed `NavigationDestination` value (`IncidentTimelineLink`) that a host stack
/// pushes to open the post-mortem, making it reachable + deep-linkable on the macOS / iPad detail
/// column and the iPhone stack (ADR-002/006) without widening the shared `AppRoute` enum. Mirrors
/// the sibling `SharingTripsRouteRegistration` shape (the `@Observable` model is built inside the
/// main-actor view builder, keeping the escaping destination / data-source closures free of business
/// logic, ADR-004).
public struct IncidentTimelineLink: Hashable, Sendable {
    /// The parsed numeric incident id (web `Number(id) > 0 ? n : null`); `nil` for an invalid id,
    /// which opens the not-found panel.
    public let incidentID: Int64?
    /// The raw `:id` path segment, shown verbatim in the not-found copy (web `Incident {id}`).
    public let rawID: String

    public init(incidentID: Int64?, rawID: String) {
        self.incidentID = incidentID
        self.rawID = rawID
    }

    /// Builds a link from a raw route id, applying the web numeric gate (`Number(id) > 0`).
    public init(rawID: String) {
        self.rawID = rawID
        if let value = Int64(rawID), value > 0 {
            incidentID = value
        } else {
            incidentID = nil
        }
    }
}

public extension View {
    /// Registers `IncidentTimelinePage` as the `NavigationDestination` for an `IncidentTimelineLink`,
    /// so any host stack can deep-link into a per-incident post-mortem (web
    /// `/system-status/incidents/:id`).
    func incidentTimelineDestination(
        dataSource: @escaping @Sendable () -> any IncidentTimelineDataSource = { SampleIncidentTimelineDataSource() }
    ) -> some View {
        navigationDestination(for: IncidentTimelineLink.self) { link in
            IncidentTimelinePage(
                incidentID: link.incidentID,
                rawID: link.rawID,
                dataSource: dataSource()
            )
        }
    }
}

/// Factory namespace mirroring the routed pages' `…RouteRegistration` shape, for hosts that want a
/// ready-built screen without constructing the model, plus a forwarder that resolves the web
/// `/system-status/incidents/:id` path to an `IncidentTimelineLink`.
public enum IncidentTimelineRouteRegistration {
    /// Builds the screen for the given incident link + data source (default = sample).
    @MainActor
    public static func make(
        link: IncidentTimelineLink,
        dataSource: any IncidentTimelineDataSource = SampleIncidentTimelineDataSource(),
        onBack: (() -> Void)? = nil
    ) -> IncidentTimelinePage {
        IncidentTimelinePage(
            incidentID: link.incidentID,
            rawID: link.rawID,
            dataSource: dataSource,
            onBack: onBack
        )
    }

    /// Resolves the web route `/system-status/incidents/:id` (with optional trailing slash / query)
    /// to an `IncidentTimelineLink`; any other path returns `nil`. The `:id` segment is preserved
    /// verbatim (the numeric gate is applied by `IncidentTimelineLink`).
    public static func link(forPath rawPath: String) -> IncidentTimelineLink? {
        let withoutQuery = rawPath.split(separator: "?", maxSplits: 1).first.map(String.init) ?? rawPath
        var normalized = withoutQuery
        while normalized.count > 1, normalized.hasSuffix("/") {
            normalized.removeLast()
        }
        let prefix = "/system-status/incidents/"
        guard normalized.hasPrefix(prefix) else { return nil }
        let idSegment = String(normalized.dropFirst(prefix.count))
        guard !idSegment.isEmpty, !idSegment.contains("/") else { return nil }
        return IncidentTimelineLink(rawID: idSegment)
    }
}
