//
//  LegacyAlertStudioRedirect.Adapter.swift
//  TeslaSync — P4 feature view · 0186 · LegacyAlertStudioRedirect (Apple)
//
//  The testable projection core for the legacy Alert Studio redirect — the faithful port of
//  features/notifications/components/LegacyAlertStudioRedirect.tsx. `LegacyAlertStudioRedirectResolver`
//  reproduces the source's single behaviour VERBATIM: it appends the inbound `location.search` onto the
//  constant target `/notifications/studio` (web `` `/notifications/studio${search}` ``) with `replace`,
//  and resolves the render phase from the bound load status. Foundation-only so it is unit-tested
//  without a bundle or a rendered view.
//

import Foundation

/// The dependency-free projection from an inbound `RedirectLocation` to a resolved `RedirectDestination`
/// plus the render-phase resolver. Every value uses the same target + verbatim-search passthrough as the
/// web component, so the web and native redirects land on the identical URL for identical input.
public enum LegacyAlertStudioRedirectResolver {
    /// Builds the navigation target from the inbound location, mirroring the web
    /// `` <Navigate to={`/notifications/studio${search}`} replace /> ``: the constant target path with
    /// the inbound `search` forwarded verbatim, decomposed into the native `notifications` route +
    /// `studio` sub-path, with `replace` semantics.
    public static func destination(for location: RedirectLocation) -> RedirectDestination {
        RedirectDestination(
            path: LegacyAlertStudioRedirectConfig.targetPath,
            search: location.search,
            queryItems: location.queryItems,
            routeSlug: LegacyAlertStudioRedirectConfig.targetRouteSlug,
            subPath: LegacyAlertStudioRedirectConfig.targetSubPath,
            replace: LegacyAlertStudioRedirectConfig.replace
        )
    }

    /// The destination only when the status carries an inbound location; `nil` while resolving, when the
    /// host reported no location (`unavailable`), or on failure — so the model never auto-navigates
    /// without a resolved target.
    public static func destination(for status: RedirectLoadStatus) -> RedirectDestination? {
        if case let .resolved(location) = status {
            return destination(for: location)
        }
        return nil
    }

    /// The safe parent target for the empty-state fallback — the target route's root
    /// (`/notifications`) with no sub-path and no forwarded query, still using `replace`.
    public static func parentDestination() -> RedirectDestination {
        RedirectDestination(
            path: LegacyAlertStudioRedirectConfig.parentPath,
            search: "",
            queryItems: [],
            routeSlug: LegacyAlertStudioRedirectConfig.targetRouteSlug,
            subPath: "",
            replace: LegacyAlertStudioRedirectConfig.replace
        )
    }

    /// Resolves the render phase from the bound load status: resolving → `redirecting`, a resolved
    /// location → `resolved` (the automatic redirect fires), no location → `empty`, failure → `error`.
    public static func resolvePhase(_ status: RedirectLoadStatus) -> RedirectPhase {
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
