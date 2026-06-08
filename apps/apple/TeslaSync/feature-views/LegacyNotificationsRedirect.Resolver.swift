//
//  LegacyNotificationsRedirect.Resolver.swift
//  TeslaSync — P4 feature view · 0187 · LegacyNotificationsRedirect (Apple)
//
//  The pure, dependency-free parity core (the "adapter"/projection) for the legacy
//  `/notifications?tab=…` redirect. This is the exact reproduction of the web source
//  (web/src/features/notifications/components/LegacyNotificationsRedirect.tsx):
//
//      const params = new URLSearchParams(location.search);
//      const tab    = params.get('tab') ?? 'inbox';
//      params.delete('tab');
//      const target = TAB_TO_ROUTE[tab] ?? '/notifications/inbox';
//      const qs     = params.toString();
//      const to     = qs ? `${target}?${qs}` : target;
//
//  Foundation-only on purpose: it holds no SwiftUI / design-system / KMP symbols so
//  the whole parity surface (tab map, fallback, param forwarding, `tab` deletion,
//  target assembly) is host-free unit-testable.
//

import Foundation

// MARK: - Tab → route (web `TAB_TO_ROUTE`)

/// The notifications sub-routes the legacy `?tab=…` query maps onto. The raw values
/// are the web `TAB_TO_ROUTE` *keys* and ``path`` is the matching *value*; the
/// `inbox` case is the web `?? '/notifications/inbox'` fallback.
public enum NotificationsRedirectTab: String, CaseIterable, Sendable, Equatable {
    case inbox
    case archived
    case channels

    /// The base path every target shares (web `/notifications`).
    public static let basePath = "/notifications"

    /// The tab used when `tab` is absent or unrecognised — parity with the web
    /// `params.get('tab') ?? 'inbox'` *and* `TAB_TO_ROUTE[tab] ?? '…/inbox'`.
    public static let fallback: NotificationsRedirectTab = .inbox

    /// The canonical destination path (web `TAB_TO_ROUTE[tab]`).
    public var path: String {
        "\(Self.basePath)/\(rawValue)"
    }

    /// Resolves a raw `tab` query value (web `params.get('tab')`) to a tab, folding
    /// both the missing (`nil`) and the unknown-string cases onto ``fallback`` —
    /// exactly the two `??` fallbacks the web source applies.
    public init(tabParameter: String?) {
        guard let raw = tabParameter, let match = NotificationsRedirectTab(rawValue: raw) else {
            self = Self.fallback
            return
        }
        self = match
    }
}

// MARK: - Incoming location (web `useLocation()`)

/// The native analogue of the web router `location` the component reads. Only the
/// `search` string drives the redirect (the path is implied by the mounted route);
/// `path` is carried for completeness + accessibility copy.
public struct LegacyNotificationsLocation: Sendable, Equatable {
    /// The mounted path (web `location.pathname`); defaults to the legacy route.
    public var path: String
    /// The raw query string (web `location.search`, e.g. `"?tab=archived&foo=1"`).
    public var search: String

    public init(path: String = NotificationsRedirectTab.basePath, search: String = "") {
        self.path = path
        self.search = search
    }
}

// MARK: - Resolved redirect (web `to`)

/// The resolved redirect target: which tab won, the forwarded (non-`tab`) params in
/// their original order, whether the tab was defaulted, and the assembled `to` URL.
public struct ResolvedRedirect: Sendable, Equatable {
    /// The destination tab (web mapped route).
    public let tab: NotificationsRedirectTab
    /// The remaining query params, in source order, with every `tab` entry removed
    /// (web `params.delete('tab')`).
    public let forwardedItems: [URLQueryItem]
    /// `true` when `tab` was missing or unrecognised, so ``tab`` is the inbox default.
    public let usedFallback: Bool

    public init(tab: NotificationsRedirectTab, forwardedItems: [URLQueryItem], usedFallback: Bool) {
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
        LegacyNotificationsRedirectResolver.encodeQuery(forwardedItems)
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
public enum LegacyNotificationsRedirectResolver {
    /// The query key the legacy route selects the destination tab from.
    static let tabKey = "tab"

    /// Resolves a location into its redirect target (web component body).
    public static func resolve(_ location: LegacyNotificationsLocation) -> ResolvedRedirect {
        let items = parseQuery(location.search)
        // web: `params.get('tab')` → the FIRST `tab` value (or nil).
        let rawTab = items.first { $0.name == tabKey }?.value
        // web: `params.delete('tab')` → drop EVERY `tab` entry, keep source order.
        let forwarded = items.filter { $0.name != tabKey }
        let tab = NotificationsRedirectTab(tabParameter: rawTab)
        let usedFallback = rawTab.flatMap(NotificationsRedirectTab.init(rawValue:)) == nil
        return ResolvedRedirect(tab: tab, forwardedItems: forwarded, usedFallback: usedFallback)
    }

    /// Convenience overload for callers that hold the path + search separately.
    public static func resolve(path: String, search: String) -> ResolvedRedirect {
        resolve(LegacyNotificationsLocation(path: path, search: search))
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
