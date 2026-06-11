//
//  BulkActionsToolbar.Adapter.swift
//  TeslaSync — P4 shared surface · 0078 · BulkActionsToolbar (Apple)
//
//  The testable, dependency-light core for the bulk-action toolbar — the SwiftUI parity of
//  `web/src/components/data-display/BulkActionsToolbar.tsx`. Everything here is pure (Foundation
//  only): the selection-id model (the native mirror of the web `Array<string | number>`), the
//  per-action descriptor's display fields (variant / confirm / disabled), the verbatim ports of the
//  web label builders (`bulk.selected`, the `itemNoun ? one/other : bulk.itemDefault` noun, and the
//  `bulk.ofTotal` suffix with their `{{count}}` / `{{total}}` interpolation), and the composed
//  VoiceOver summaries. No store, no bundle, no rendered view, so each piece is unit tested in
//  isolation.
//
//  Parity note: the web toolbar renders nothing while the selection is empty
//  (`if (count === 0) return null`), otherwise a sticky panel — a live count chip, an optional noun
//  (+ "of {total}"), one button per action (with a per-action spinner + an optional confirm gate),
//  and a Clear button. This core reproduces that exact data + the read-time label formatting; the
//  gating + chrome live in the projection (Model) and the views.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias BulkActionsResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Selection id (web `Array<string | number>`)

/// One selected row identifier — the native mirror of the web union `string | number`. Both cases
/// are carried losslessly so the action callback receives the same identities the list page holds.
public enum BulkSelectionID: Sendable, Equatable, Hashable, Identifiable, CustomStringConvertible {
    case string(String)
    case int(Int)

    /// Stable identity for `ForEach` / set membership (the web `String(id)` key).
    public var id: String {
        description
    }

    public var description: String {
        switch self {
        case let .string(value): value
        case let .int(value): String(value)
        }
    }
}

// MARK: - Action variant (web `'default' | 'danger'`)

/// An action's visual intent — the native mirror of the web `variant`. `danger` switches the button
/// to the destructive style and routes its confirm dialog through the destructive role.
public enum BulkActionVariant: String, Sendable, Equatable, CaseIterable {
    case `default`
    case danger
}

// MARK: - Confirm payload (web `confirm?: { title, description, confirmLabel? }`)

/// The confirm-before-mutate payload — the native mirror of the web action `confirm`. When present,
/// the toolbar routes the action through a confirmation dialog before invoking it (the web
/// `<ConfirmDialog>` / `useConfirm` gate). `message` is the web `description`.
public struct BulkActionConfirm: Sendable, Equatable {
    public let title: String
    public let message: String
    public let confirmLabel: String?

    public init(title: String, message: String, confirmLabel: String? = nil) {
        self.title = title
        self.message = message
        self.confirmLabel = confirmLabel
    }
}

// MARK: - Item noun (web `itemNoun?: { one, other }`)

/// The optional count-noun override (web `itemNoun`), e.g. "drive" / "drives". When absent the
/// toolbar uses the default `bulk.itemDefault` noun and renders no noun label, exactly as the web
/// source only shows the noun span when `itemNoun` is provided.
public struct BulkItemNoun: Sendable, Equatable {
    public let one: String
    public let other: String

    public init(one: String, other: String) {
        self.one = one
        self.other = other
    }
}

// MARK: - Action view-state (display projection)

/// One action button's fully-resolved display state — the projected, Equatable peer of a web
/// `BulkAction` row: the stable `id`, the already-localized `label`, an optional SF Symbol (the web
/// lucide icon), the `variant`, whether it is disabled or in-flight (the per-action spinner), whether
/// it routes through a confirm dialog, and the composed VoiceOver label + hint. The view is a pure
/// function of this value.
public struct BulkActionViewState: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let systemImage: String?
    public let variant: BulkActionVariant
    public let isDisabled: Bool
    public let isPending: Bool
    public let requiresConfirm: Bool
    public let accessibilityLabel: String
    public let accessibilityHint: String?

    public init(
        id: String,
        label: String,
        systemImage: String?,
        variant: BulkActionVariant,
        isDisabled: Bool,
        isPending: Bool,
        requiresConfirm: Bool,
        accessibilityLabel: String,
        accessibilityHint: String?
    ) {
        self.id = id
        self.label = label
        self.systemImage = systemImage
        self.variant = variant
        self.isDisabled = isDisabled
        self.isPending = isPending
        self.requiresConfirm = requiresConfirm
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityHint = accessibilityHint
    }
}

// MARK: - Label formatting (verbatim port of the web label builders)

/// The pure label core — the native port of the web component's three `t()` label calls and their
/// i18next `{{count}}` / `{{total}}` interpolation. Every function is deterministic and resolves its
/// copy through the injected `BulkActionsResolve` seam, so the rendered text is asserted without a
/// view or a bundle.
public enum BulkActionsFormat {
    /// Substitutes `{{token}}` occurrences — the native parity of i18next interpolation. Single-token
    /// templates here, so iteration order is irrelevant.
    public static func interpolate(_ template: String, _ replacements: [String: String]) -> String {
        var result = template
        for (token, value) in replacements {
            result = result.replacingOccurrences(of: "{{\(token)}}", with: value)
        }
        return result
    }

    /// The count chip — web `t('bulk.selected', { count, defaultValue: '{{count}} selected' })`.
    public static func countLabel(count: Int, strings: BulkActionsResolve) -> String {
        interpolate(strings("bulk.selected", "{{count}} selected"), ["count": String(count)])
    }

    /// The count noun — web `itemNoun ? (count === 1 ? one : other) : t('bulk.itemDefault', 'item')`.
    /// Computed unconditionally (mirroring the web), but only displayed when `itemNoun` is provided.
    public static func noun(count: Int, itemNoun: BulkItemNoun?, strings: BulkActionsResolve) -> String {
        if let itemNoun {
            return count == 1 ? itemNoun.one : itemNoun.other
        }
        return strings("bulk.itemDefault", "item")
    }

    /// The total suffix — web `t('bulk.ofTotal', { total, defaultValue: 'of {{total}}' })`.
    public static func totalLabel(total: Int, strings: BulkActionsResolve) -> String {
        interpolate(strings("bulk.ofTotal", "of {{total}}"), ["total": String(total)])
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the surface's VoiceOver strings from already-localized parts, so the spoken content is
/// asserted without rendering the view. The web count chip is `aria-live="polite"`; its native parity
/// reads the count, the noun, and the total as one sentence, and each action button reads its label
/// with a busy / confirm hint.
public enum BulkActionsAccessibility {
    /// The live selection summary spoken for the count chip: the count label followed by the noun and
    /// the total suffix when those are present.
    public static func selectionSummary(countLabel: String, nounText: String?, totalText: String?) -> String {
        var parts = [countLabel]
        if let nounText, !nounText.isEmpty { parts.append(nounText) }
        if let totalText, !totalText.isEmpty { parts.append(totalText) }
        return parts.joined(separator: " ")
    }

    /// One action button's VoiceOver hint: the busy hint while in-flight, else the confirm hint when
    /// the action gates through a dialog, else none (the visible label is the accessibility label).
    public static func actionHint(
        isPending: Bool,
        requiresConfirm: Bool,
        strings: BulkActionsResolve
    ) -> String? {
        if isPending {
            return strings("bulk.action.busyA11y", "Working…")
        }
        if requiresConfirm {
            return strings("bulk.action.confirmA11y", "Asks for confirmation")
        }
        return nil
    }
}
