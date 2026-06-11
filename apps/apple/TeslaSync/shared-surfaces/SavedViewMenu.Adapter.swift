//
//  SavedViewMenu.Adapter.swift
//  TeslaSync — P4 shared surface · 0102 · SavedViewMenu (Apple)
//
//  The testable, dependency-light core for the saved-views menu — the SwiftUI parity of
//  `web/src/components/data-display/SavedViewMenu.tsx`. Everything here is pure (Foundation only):
//  the saved-view value model (the native mirror of the web `SavedView` API type), the patch payload
//  (the web `SavedViewUpdateInput`), the verbatim ports of the web `t()` label / announcement
//  builders (the trigger label, the `View {{name}} applied` / `Saved view cleared` announcements, the
//  `Delete saved view "{{name}}"?` confirm message, and the `No filters` query description) with
//  their i18next `{{name}}` interpolation, and the composed VoiceOver labels for every row affordance.
//  No store, no bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web menu is THREE coordinated elements — a trigger button whose label collapses
//  to the active view name, a popover of pin/default/rename/delete rows that re-apply a view's
//  querystring, and an "applied" badge that clears the URL. This core reproduces that exact data + the
//  read-time label formatting; the phase gating + chrome live in the projection (Model) and the views.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias SavedViewMenuResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Saved view (web `SavedView` API type)

/// One saved view — the native mirror of the web `SavedView` (`web/src/api/types.ts`). Carries the
/// row identity, the display `name`, the `route` it belongs to, the canonical `query` it re-applies,
/// and the `isDefault` / `isPinned` flags plus the `sortOrder` the source feed orders by. A value
/// type, so it is `Sendable`, `Equatable`, and `Identifiable` for `ForEach`.
public struct SavedView: Sendable, Equatable, Hashable, Identifiable {
    public let id: Int
    public let name: String
    public let route: String
    public let query: String
    public let isDefault: Bool
    public let isPinned: Bool
    public let sortOrder: Int

    public init(
        id: Int,
        name: String,
        route: String,
        query: String,
        isDefault: Bool = false,
        isPinned: Bool = false,
        sortOrder: Int = 0
    ) {
        self.id = id
        self.name = name
        self.route = route
        self.query = query
        self.isDefault = isDefault
        self.isPinned = isPinned
        self.sortOrder = sortOrder
    }
}

// MARK: - Patch payload (web `SavedViewUpdateInput`)

/// The partial update payload — the native mirror of the web `SavedViewUpdateInput`. Only the set
/// fields are forwarded to the mutation seam, exactly like the web `patch` object handed to
/// `useUpdateSavedView`. A pure value, so it is asserted without a network round-trip.
public struct SavedViewPatch: Sendable, Equatable {
    public var name: String?
    public var query: String?
    public var isPinned: Bool?
    public var isDefault: Bool?

    public init(
        name: String? = nil,
        query: String? = nil,
        isPinned: Bool? = nil,
        isDefault: Bool? = nil
    ) {
        self.name = name
        self.query = query
        self.isPinned = isPinned
        self.isDefault = isDefault
    }
}

// MARK: - Label formatting (verbatim port of the web label builders)

/// The pure label core — the native port of the web component's `t()` label calls and their i18next
/// `{{name}}` interpolation. Every function is deterministic and resolves its copy through the
/// injected `SavedViewMenuResolve` seam, so the rendered text is asserted without a view or a bundle.
public enum SavedViewMenuFormat {
    /// Substitutes `{{token}}` occurrences — the native parity of i18next interpolation. Single-token
    /// templates here, so iteration order is irrelevant.
    public static func interpolate(_ template: String, _ replacements: [String: String]) -> String {
        var result = template
        for (token, value) in replacements {
            result = result.replacingOccurrences(of: "{{\(token)}}", with: value)
        }
        return result
    }

    /// The trigger button label — web `activeView ? activeView.name : t('savedViews.title')`. The
    /// active view's own name when one is applied, else the generic menu title.
    public static func triggerLabel(activeName: String?, strings: SavedViewMenuResolve) -> String {
        if let activeName, !activeName.isEmpty { return activeName }
        return strings("savedViews.title", "Saved views")
    }

    /// The applied announcement — web `t('savedViews.announceApplied', 'View {{name}} applied')`.
    public static func appliedAnnouncement(name: String, strings: SavedViewMenuResolve) -> String {
        interpolate(strings("savedViews.announceApplied", "View {{name}} applied"), ["name": name])
    }

    /// The cleared announcement — web `t('savedViews.announceCleared', 'Saved view cleared')`.
    public static func clearedAnnouncement(strings: SavedViewMenuResolve) -> String {
        strings("savedViews.announceCleared", "Saved view cleared")
    }

    /// The delete confirm message — web `t('savedViews.deleteConfirm', 'Delete saved view
    /// "{{name}}"?')` with the row's name interpolated.
    public static func deleteConfirmMessage(name: String, strings: SavedViewMenuResolve) -> String {
        interpolate(
            strings("savedViews.deleteConfirm", "Delete saved view \"{{name}}\"?"),
            ["name": name]
        )
    }

    /// The manage-row title — web `v.query || t('savedViews.emptyQuery', 'No filters')`. The view's
    /// canonical querystring, or the "No filters" fallback when it carries none.
    public static func queryDescription(query: String, strings: SavedViewMenuResolve) -> String {
        query.isEmpty ? strings("savedViews.emptyQuery", "No filters") : query
    }
}

// MARK: - Accessibility labels (testable seam)

/// Builds the surface's VoiceOver labels from already-localized parts, so the spoken content is
/// asserted without rendering the view. Each row affordance in the web source carries an `aria-label`
/// that flips with the row's state (default / pinned); this core reproduces those exact strings.
public enum SavedViewMenuAccessibility {
    /// The default-toggle label — web `v.is_default ? t('savedViews.unsetDefault', 'Clear default') :
    /// t('savedViews.setDefault', 'Set as default')`.
    public static func defaultToggleLabel(isDefault: Bool, strings: SavedViewMenuResolve) -> String {
        isDefault
            ? strings("savedViews.unsetDefault", "Clear default")
            : strings("savedViews.setDefault", "Set as default")
    }

    /// The pin-toggle label — web `v.is_pinned ? t('savedViews.unpin', 'Unpin') :
    /// t('savedViews.pin', 'Pin')`.
    public static func pinToggleLabel(isPinned: Bool, strings: SavedViewMenuResolve) -> String {
        isPinned ? strings("savedViews.unpin", "Unpin") : strings("savedViews.pin", "Pin")
    }

    /// The rename affordance label — web `t('savedViews.renamePrompt', 'Rename view')`.
    public static func renameLabel(strings: SavedViewMenuResolve) -> String {
        strings("savedViews.renamePrompt", "Rename view")
    }

    /// The delete affordance label — web `t('common.delete', 'Delete')`.
    public static func deleteLabel(strings: SavedViewMenuResolve) -> String {
        strings("common.delete", "Delete")
    }

    /// The apply-row VoiceOver label — the view's name, prefixed with the default marker so VoiceOver
    /// announces it the way the web row shows the leading star (web `savedViews.defaultBadge`).
    public static func applyLabel(name: String, isDefault: Bool, strings: SavedViewMenuResolve) -> String {
        guard isDefault else { return name }
        return "\(strings("savedViews.defaultBadge", "Default")): \(name)"
    }
}
