//
//  LegacyAlertRulesRedirect.Adapter.swift
//  TeslaSync — P4 feature view · 0184 · LegacyAlertRulesRedirect (Apple)
//
//  The testable projection core for the legacy Alert Rules redirect — the faithful port of
//  features/notifications/components/LegacyAlertRulesRedirect.tsx. `LegacyAlertRulesRedirectResolver`
//  reproduces the source's single behaviour VERBATIM: it appends the inbound `location.search` onto the
//  constant target `/notifications/rules` (web `` `/notifications/rules${search}` ``) with `replace`,
//  and resolves the render phase from the bound load status. Foundation-only so it is unit-tested
//  without a bundle or a rendered view.
//

import Foundation

/// The dependency-free projection from an inbound `AlertRulesRedirectLocation` to a resolved
/// `AlertRulesRedirectDestination` plus the render-phase resolver. Every value uses the same target +
/// verbatim-search passthrough as the web component, so the web and native redirects land on the
/// identical URL for identical input.
public enum LegacyAlertRulesRedirectResolver {
    /// Builds the navigation target from the inbound location, mirroring the web
    /// `` <Navigate to={`/notifications/rules${search}`} replace /> ``: the constant target path with
    /// the inbound `search` forwarded verbatim, decomposed into the native `notifications` route +
    /// `rules` sub-path, with `replace` semantics.
    public static func destination(for location: AlertRulesRedirectLocation) -> AlertRulesRedirectDestination {
        AlertRulesRedirectDestination(
            path: LegacyAlertRulesRedirectConfig.targetPath,
            search: location.search,
            queryItems: location.queryItems,
            routeSlug: LegacyAlertRulesRedirectConfig.targetRouteSlug,
            subPath: LegacyAlertRulesRedirectConfig.targetSubPath,
            replace: LegacyAlertRulesRedirectConfig.replace
        )
    }

    /// The destination only when the status carries an inbound location; `nil` while resolving, when the
    /// host reported no location (`unavailable`), or on failure — so the model never auto-navigates
    /// without a resolved target.
    public static func destination(for status: AlertRulesRedirectLoadStatus) -> AlertRulesRedirectDestination? {
        if case let .resolved(location) = status {
            return destination(for: location)
        }
        return nil
    }

    /// The safe parent target for the empty-state fallback — the target route's root
    /// (`/notifications`) with no sub-path and no forwarded query, still using `replace`.
    public static func parentDestination() -> AlertRulesRedirectDestination {
        AlertRulesRedirectDestination(
            path: LegacyAlertRulesRedirectConfig.parentPath,
            search: "",
            queryItems: [],
            routeSlug: LegacyAlertRulesRedirectConfig.targetRouteSlug,
            subPath: "",
            replace: LegacyAlertRulesRedirectConfig.replace
        )
    }

    /// Resolves the render phase from the bound load status: resolving → `redirecting`, a resolved
    /// location → `resolved` (the automatic redirect fires), no location → `empty`, failure → `error`.
    public static func resolvePhase(_ status: AlertRulesRedirectLoadStatus) -> AlertRulesRedirectPhase {
        switch status {
        case .idle, .resolving:
            .redirecting
        case .resolved:
            .resolved
        case .unavailable:
            .empty
        case let .failed(message):
            .error(message)
        }
    }
}
