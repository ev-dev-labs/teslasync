//
//  LegacyAlertsRedirect.Resolver.swift
//  TeslaSync — P4 feature view · 0185 · LegacyAlertsRedirect (Apple)
//
//  The pure, dependency-free parity core (the "adapter"/projection) for the legacy
//  `/alerts?tab=…` redirect. This is the exact reproduction of the web source
//  (web/src/features/notifications/components/LegacyAlertsRedirect.tsx):
//
//      const params = new URLSearchParams(location.search);
//      const tab    = params.get('tab') ?? 'alerts';
//      params.delete('tab');
//      const target = TAB_TO_ROUTE[tab] ?? '/notifications/alerts';
//      const qs     = params.toString();
//      const to     = qs ? `${target}?${qs}` : target;
//
//  Foundation-only on purpose: it holds no SwiftUI / design-system / KMP symbols so
//  the whole parity surface (tab map, fallback, param forwarding, `tab` deletion,
//  target assembly) is host-free unit-testable.
//
//  NOTE on naming: every type here is `Alerts`-prefixed because the sibling redirect
//  surfaces in this module already claim the generic `ResolvedRedirect` /
//  `RedirectLocation` / `RedirectPhase` names — re-using them would collide.
//

import Foundation

// MARK: - Tab → route (web `TAB_TO_ROUTE`)

/// The notifications sub-routes the legacy `?tab=…` query maps onto. The raw values
/// are the web `TAB_TO_ROUTE` *keys* (`alerts` / `history` / `preferences`) and
/// ``path`` is the matching *value* — note the keys deliberately differ from their
/// destination path segments (`history` → `/inbox`, `preferences` → `/quiet-hours`).
/// The `alerts` case is the web `?? 'alerts'` / `?? '/notifications/alerts'` fallback.
public enum AlertsRedirectTab: String, CaseIterable, Sendable, Equatable {
    case alerts
    case history
    case preferences

    /// The base path every target shares (web `/notifications`).
    public static let basePath = "/notifications"

    /// The tab used when `tab` is absent or unrecognised — parity with the web
    /// `params.get('tab') ?? 'alerts'` *and* `TAB_TO_ROUTE[tab] ?? '…/alerts'`.
    public static let fallback: AlertsRedirectTab = .alerts

    /// The canonical destination path (web `TAB_TO_ROUTE[tab]`). The key→segment
    /// mapping is explicit because two of the three keys are not their own segment.
    public var path: String {
        switch self {
        case .alerts: "\(Self.basePath)/alerts"
        case .history: "\(Self.basePath)/inbox"
        case .preferences: "\(Self.basePath)/quiet-hours"
        }
    }

    /// Resolves a raw `tab` query value (web `params.get('tab')`) to a tab, folding
    /// both the missing (`nil`) and the unknown-string cases onto ``fallback`` —
    /// exactly the two `??` fallbacks the web source applies.
    public init(tabParameter: String?) {
        guard let raw = tabParameter, let match = AlertsRedirectTab(rawValue: raw) else {
            self = Self.fallback
            return
        }
        self = match
    }
}

// MARK: - Incoming location (web `useLocation()`)

/// The native analogue of the web router `location` the component reads. Only the
/// `search` string drives the redirect (the path is implied by the mounted route);
/// `path` is carried for completeness + accessibility copy and defaults to the legacy
/// `/alerts` route the web component is mounted on.
public struct LegacyAlertsLocation: Sendable, Equatable {
    /// The mounted path (web `location.pathname`); defaults to the legacy route.
    public var path: String
    /// The raw query string (web `location.search`, e.g. `"?tab=history&filter=open"`).
    public var search: String

    public init(path: String = "/alerts", search: String = "") {
        self.path = path
        self.search = search
    }
}

// MARK: - Resolved redirect (web `to`)

/// The resolved redirect target: which tab won, the forwarded (non-`tab`) params in
/// their original order, whether the tab was defaulted, and the assembled `to` URL.
public struct ResolvedAlertsRedirect: Sendable, Equatable {
    /// The destination tab (web mapped route).
    public let tab: AlertsRedirectTab
    /// The remaining query params, in source order, with every `tab` entry removed
    /// (web `params.delete('tab')`).
    public let forwardedItems: [URLQueryItem]
    /// `true` when `tab` was missing or unrecognised, so ``tab`` is the alerts default.
    public let usedFallback: Bool

    public init(tab: AlertsRedirectTab, forwardedItems: [URLQueryItem], usedFallback: Bool) {
        self.tab = tab
        self.forwardedItems = forwardedItems
        self.usedFallback = usedFallback
    }

    /// The destination path without query (web `target`).
    public var targetPath: String {
        tab.path
    }

    /// The forwarded params re-encoded as a query string (web `params.toString()`),
    /// empty when nothing remains after dropping `tab`.
    public var query: String {
        LegacyAlertsRedirectResolver.encodeQuery(forwardedItems)
    }

    /// The full redirect URL — `targetPath` plus the forwarded query when non-empty
    /// (web `qs ? \`${target}?${qs}\` : target`).
    public var target: String {
        let qs = query
        return qs.isEmpty ? targetPath : "\(targetPath)?\(qs)"
    }
}

// MARK: - Resolver (web component body)

/// The pure redirect resolver. Mirrors the web component's body one-for-one.
public enum LegacyAlertsRedirectResolver {
    /// The query key the legacy route selects the destination tab from.
    static let tabKey = "tab"

    /// Resolves a location into its redirect target (web component body).
    public static func resolve(_ location: LegacyAlertsLocation) -> ResolvedAlertsRedirect {
        let items = parseQuery(location.search)
        // web: `params.get('tab')` → the FIRST `tab` value (or nil).
        let rawTab = items.first { $0.name == tabKey }?.value
        // web: `params.delete('tab')` → drop EVERY `tab` entry, keep source order.
        let forwarded = items.filter { $0.name != tabKey }
        let tab = AlertsRedirectTab(tabParameter: rawTab)
        let usedFallback = rawTab.flatMap(AlertsRedirectTab.init(rawValue:)) == nil
        return ResolvedAlertsRedirect(tab: tab, forwardedItems: forwarded, usedFallback: usedFallback)
    }

    /// Convenience overload for callers that hold the path + search separately.
    public static func resolve(path: String, search: String) -> ResolvedAlertsRedirect {
        resolve(LegacyAlertsLocation(path: path, search: search))
    }

    /// Parses a `location.search` string into ordered query items (web
    /// `new URLSearchParams(search)`), tolerating an optional leading `?` and empty
    /// values. Order is preserved so forwarded params round-trip unchanged.
    public static func parseQuery(_ search: String) -> [URLQueryItem] {
        var raw = search
        if raw.hasPrefix("?") { raw.removeFirst() }
        guard !raw.isEmpty else { return [] }
        return raw.split(separator: "&", omittingEmptySubsequences: true).map { pair in
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            let name = decodeComponent(String(parts[0]))
            let value = parts.count > 1 ? decodeComponent(String(parts[1])) : nil
            return URLQueryItem(name: name, value: value)
        }
    }

    /// Re-encodes ordered query items into a query string (web
    /// `URLSearchParams.toString()`). Values are RFC 3986 percent-encoded; a `nil`
    /// value emits a bare key (web `key=`-less entries stay valueless on decode).
    public static func encodeQuery(_ items: [URLQueryItem]) -> String {
        items
            .map { item in
                let name = encodeComponent(item.name)
                guard let value = item.value else { return name }
                return "\(name)=\(encodeComponent(value))"
            }
            .joined(separator: "&")
    }

    private static func decodeComponent(_ raw: String) -> String {
        raw.replacingOccurrences(of: "+", with: " ").removingPercentEncoding ?? raw
    }

    private static func encodeComponent(_ raw: String) -> String {
        raw.addingPercentEncoding(withAllowedCharacters: componentAllowed) ?? raw
    }

    /// RFC 3986 unreserved set — everything else (incl. `&`, `=`, `+`, space) is
    /// percent-encoded so the re-assembled query is unambiguous on decode.
    private static let componentAllowed: CharacterSet = {
        var set = CharacterSet.alphanumerics
        set.insert(charactersIn: "-._~")
        return set
    }()
}
