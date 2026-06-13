//
//  EditConflictBanner.Adapter.swift
//  TeslaSync — P4 shared surface · 0118 · EditConflictBanner (Apple)
//
//  The testable, dependency-light core for the edit-conflict banner — the SwiftUI parity of
//  `components/feedback/EditConflictBanner.tsx`. Everything here is pure (Foundation only): the peer
//  value type (the web `useEditLease` `otherTab` — `tabId` / `claimedAt`), the `{{token}}`
//  interpolation (the web i18next `{{resource}}` substitution), the title / body / take-over /
//  switch-hint copy builders (the web `t('editConflict.banner.*', …)` calls including the
//  `resourceLabel ? bodyWithLabel : body` branch), and the VoiceOver label builder. No lease bus, no
//  bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web surface wraps `useEditLease(resourceKey)` and renders an `AlertBanner` only
//  when this tab does NOT own the lease AND a peer tab has announced ownership (`!isOwner && otherTab`).
//  It exposes two affordances: "Take over editing" (calls `claim()`, which promotes this tab to owner)
//  and an informational "switch to your other tab" hint. This core reproduces those pure derivations as
//  values and functions; the SwiftUI chrome layers on top in the sibling view files, and the lease
//  state arrives through the P1/S8 source seam (never read directly by the view).
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias EditConflictResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Peer tab (web `OtherTabInfo`)

/// One peer that holds the edit lease — the native mirror of the web `useEditLease` `otherTab`: the
/// stable per-peer identifier (`tabId`) and the wall-clock instant it claimed the lease (`claimedAt`).
/// On Apple the "peer" is another scene / window / device editing the same resource; the identity and
/// claim instant carry through unchanged so the banner copy and the `data-other-tab-id` parity hold.
public struct EditConflictPeer: Sendable, Equatable {
    /// Web `tabId` — the stable identifier of the peer holding the lease.
    public let tabID: String
    /// Web `claimedAt` — when the peer claimed the lease (drives the deterministic take-over tiebreak).
    public let claimedAt: Date

    public init(tabID: String, claimedAt: Date) {
        self.tabID = tabID
        self.claimedAt = claimedAt
    }
}

// MARK: - i18next interpolation (web `t(key, { resource })`)

/// Replaces `{{token}}` markers with their values — the native parity of the web i18next interpolation
/// the banner relies on for the `{{resource}}` substitution in the label-qualified body copy. Pure +
/// public so the substitution is asserted directly.
public enum EditConflictInterpolation {
    public static func apply(_ template: String, _ values: [String: String]) -> String {
        var output = template
        for (token, value) in values {
            output = output.replacingOccurrences(of: "{{\(token)}}", with: value)
        }
        return output
    }
}

// MARK: - Copy (web `t('editConflict.banner.*', …)`)

/// Builds the banner's copy — the native port of the web render's `t()` calls:
///
///     const title = t('editConflict.banner.title', 'Another browser tab is editing this')
///     const body = resourceLabel
///       ? t('editConflict.banner.bodyWithLabel', '{{resource}} is open in another tab …', { resource })
///       : t('editConflict.banner.body', 'This resource is open in another tab …')
///     t('editConflict.banner.takeOver', 'Take over editing')
///     t('editConflict.banner.switchHint', 'Or switch to your other tab to keep editing there.')
///
/// A non-empty `resourceLabel` selects the label-qualified key (web truthiness: an empty string falls
/// back to the plain key). Pure + public so every branch is unit tested.
public enum EditConflictMessage {
    /// Web `t('editConflict.banner.title', …)` — the constant banner headline.
    public static func title(strings: EditConflictResolve = EditConflictStrings.string) -> String {
        strings("editConflict.banner.title", "Another browser tab is editing this")
    }

    /// Web body branch: the label-qualified copy when `resourceLabel` is present, else the generic copy.
    public static func body(
        resourceLabel: String?,
        strings: EditConflictResolve = EditConflictStrings.string
    ) -> String {
        guard let label = resourceLabel, !label.isEmpty else {
            return strings(
                "editConflict.banner.body",
                "This resource is open in another tab of this browser. Saving here will overwrite changes made there."
            )
        }
        let template = strings(
            "editConflict.banner.bodyWithLabel",
            "{{resource}} is open in another tab of this browser. Saving here will overwrite changes made there."
        )
        return EditConflictInterpolation.apply(template, ["resource": label])
    }

    /// Web `t('editConflict.banner.takeOver', …)` — the "Take over editing" action label.
    public static func takeOver(strings: EditConflictResolve = EditConflictStrings.string) -> String {
        strings("editConflict.banner.takeOver", "Take over editing")
    }

    /// Web `t('editConflict.banner.switchHint', …)` — the informational switch-to-other-tab hint.
    public static func switchHint(strings: EditConflictResolve = EditConflictStrings.string) -> String {
        strings("editConflict.banner.switchHint", "Or switch to your other tab to keep editing there.")
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the banner's VoiceOver label from the already-localised title + body, so the spoken content
/// is asserted without rendering. Mirrors the web `AlertBanner` (`role="status"`, `aria-live="polite"`)
/// announcing its title + body in one pass, with the "Take over editing" control staying individually
/// focusable.
public enum EditConflictAccessibility {
    /// Joins the title + body into one spoken sentence and normalises whitespace — each part is
    /// collapsed (a wrapped body never reads a double space, the ends are trimmed) before they are
    /// joined with a sentence break, and an empty part is dropped so no stray separator is spoken.
    public static func bannerLabel(title: String, body: String) -> String {
        [collapse(title), collapse(body)]
            .filter { !$0.isEmpty }
            .joined(separator: ". ")
    }

    private static func collapse(_ text: String) -> String {
        text
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
