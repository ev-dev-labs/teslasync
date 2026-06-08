//
//  LayoutManager.Adapter.swift
//  TeslaSync — P4 feature view · 0125 · LayoutManager (Apple)
//
//  The pure, testable projection core for the LayoutManager surface — every
//  branch the web source carries decided here so the XCTest suite can cover it
//  without a rendering host (the same approach the sibling feature views use):
//  the tab projection (icon fallback + active flag), the drag/keyboard reorder
//  math (web `onReorder(from, to)`), the context-menu item set (web Rename /
//  Duplicate / Settings / Delete, with Delete disabled on the default layout),
//  the `name.trim()` commit guard for inline rename + create, the New-Layout
//  intent (web `startCreate`: templates gallery vs inline field), and the
//  VoiceOver summaries. No SwiftUI and no I/O.
//

import Foundation

// MARK: - Localizer (P1/S10 facade injection)

/// A thin localization seam so the pure projections stay testable: production
/// passes the `LayoutManagerStrings` facade (real catalog + English fallback),
/// tests/previews pass `echo` (returns the fallback / formats it directly).
public struct LayoutManagerLocalizer: Sendable {
    public let string: @Sendable (String, String) -> String
    public let format: @Sendable (String, String, String) -> String

    public init(
        string: @escaping @Sendable (String, String) -> String,
        format: @escaping @Sendable (String, String, String) -> String
    ) {
        self.string = string
        self.format = format
    }

    /// Production localizer backed by the surface's `.strings` table.
    public static let bundle = LayoutManagerLocalizer(
        string: LayoutManagerStrings.string,
        format: LayoutManagerStrings.format
    )

    /// Bundle-free localizer for previews/tests: yields the English fallback.
    public static let echo = LayoutManagerLocalizer(
        string: { _, fallback in fallback },
        format: { _, fallbackFormat, argument in String(format: fallbackFormat, argument) }
    )
}

// MARK: - Tab projection (web `dashboards.map((d, i) => …)`)

/// One display-ready switcher tab: the layout's identity, its resolved icon (web
/// `d.icon ?? '📊'`), the name, the protected-default flag (drives the "default"
/// chip + the Delete gate), and whether it is the active layout (web
/// `d.id === activeId`).
public struct LayoutTab: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let icon: String
    public let isDefault: Bool
    public let isActive: Bool

    public init(id: String, name: String, icon: String, isDefault: Bool, isActive: Bool) {
        self.id = id
        self.name = name
        self.icon = icon
        self.isDefault = isDefault
        self.isActive = isActive
    }
}

/// Resolves the per-tab icon, mirroring the web `d.icon ?? '📊'` nil-coalescing
/// (an explicitly empty icon string stays empty, exactly as on the web).
public enum LayoutGlyph {
    /// The web default dashboard glyph (`d.icon ?? '📊'`).
    public static let defaultIcon = "📊"

    public static func icon(for layout: SavedLayoutData) -> String {
        layout.icon ?? defaultIcon
    }
}

/// Pure projection from the wire layouts to display tabs. Preserves order and
/// derives the active flag from `activeID` (web `d.id === activeId`).
public enum LayoutTabProjection {
    public static func tabs(from layouts: [SavedLayoutData], activeID: String) -> [LayoutTab] {
        layouts.map { layout in
            LayoutTab(
                id: layout.id,
                name: layout.name,
                icon: LayoutGlyph.icon(for: layout),
                isDefault: layout.isDefault,
                isActive: layout.id == activeID
            )
        }
    }
}

// MARK: - Reorder math (web `onReorder(fromIndex, toIndex)`)

/// One reorder move expressed as the `(from, to)` index pair the web
/// `onReorder` contract expects. Surfaced so the drag-drop and the VoiceOver
/// move actions share one tested seam.
public struct LayoutReorderMove: Equatable, Sendable {
    public let from: Int
    public let to: Int

    public init(from: Int, to: Int) {
        self.from = from
        self.to = to
    }
}

/// Pure reorder helpers: edge guards for the keyboard/VoiceOver "move" actions
/// and the drag-drop resolver that turns a dropped tab id + a target index into
/// the `(from, to)` pair (or `nil` when it is a no-op / unknown id).
public enum LayoutReorder {
    public static func canMoveLeft(index: Int) -> Bool {
        index > 0
    }

    public static func canMoveRight(index: Int, count: Int) -> Bool {
        index >= 0 && index < count - 1
    }

    /// Resolves a drag-drop: the dragged tab's current index becomes `from`, the
    /// drop target becomes `to`. Returns `nil` when the id is unknown or the move
    /// is a no-op (`from == to`), so the view never emits a redundant reorder.
    public static func dropMove(
        draggedID: String,
        toIndex: Int,
        tabs: [LayoutTab]
    ) -> LayoutReorderMove? {
        guard let from = tabs.firstIndex(where: { $0.id == draggedID }) else { return nil }
        guard from != toIndex, tabs.indices.contains(toIndex) else { return nil }
        return LayoutReorderMove(from: from, to: toIndex)
    }
}

// MARK: - Context menu (web Rename / Duplicate / Settings / Delete)

/// One context-menu action — the port of the web context menu items. Order and
/// glyphs mirror the web (`Pencil` / `Copy` / `Settings` / `Trash2`); Delete is
/// destructive and disabled on the protected default layout (web
/// `disabled={!!ctxDash.isDefault}`).
public enum LayoutMenuItemKind: String, Equatable, Sendable, CaseIterable {
    case rename
    case duplicate
    case settings
    case delete

    /// The ordered set the menu renders (web Rename, Duplicate, Settings, Delete).
    public static let order: [LayoutMenuItemKind] = [.rename, .duplicate, .settings, .delete]

    /// i18n key — the exact web key (`dashboard.rename` … `dashboard.delete`).
    public var labelKey: String {
        "dashboard.\(rawValue)"
    }

    /// English fallback — web `t(key, default)` default.
    public var labelFallback: String {
        switch self {
        case .rename: "Rename"
        case .duplicate: "Duplicate"
        case .settings: "Settings"
        case .delete: "Delete"
        }
    }

    /// SF Symbol parity with the web lucide icon.
    public var systemImage: String {
        switch self {
        case .rename: "pencil"
        case .duplicate: "doc.on.doc"
        case .settings: "gearshape"
        case .delete: "trash"
        }
    }

    /// Web `danger` styling on Delete → native destructive role.
    public var isDestructive: Bool {
        self == .delete
    }

    /// Web `disabled={!!ctxDash.isDefault}` — only Delete is gated, and only on
    /// the protected default layout.
    public static func isEnabled(_ kind: LayoutMenuItemKind, isDefault: Bool) -> Bool {
        kind == .delete ? !isDefault : true
    }
}

// MARK: - Inline name input (web `editName.trim()` / `newName.trim()` guard)

/// The commit guard for the inline rename + create fields. The web trims the
/// value and only fires `onRename` / `onCreate` when the trimmed string is
/// truthy; the edit/create session closes either way.
public enum LayoutNameInput {
    /// Web `name.trim()`.
    public static func sanitized(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Web `if (name.trim())` — whether the trimmed value should be committed.
    public static func isCommittable(_ raw: String) -> Bool {
        !sanitized(raw).isEmpty
    }
}

// MARK: - New-Layout intent (web `startCreate`)

/// The settled intent of tapping "New Layout" — the port of the web
/// `startCreate`: when `onOpenTemplates` is supplied the gallery opens; otherwise
/// the inline create field appears.
public enum LayoutCreateIntent: Equatable, Sendable {
    case openTemplates
    case inlineCreate

    /// Web `if (onOpenTemplates) { onOpenTemplates(); return; }` else inline field.
    public static func resolve(hasTemplates: Bool) -> LayoutCreateIntent {
        hasTemplates ? .openTemplates : .inlineCreate
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Pure VoiceOver string builders so the switcher announces as coherent elements
/// and the tests can assert label presence without a rendering host.
public enum LayoutManagerAccessibility {
    /// A tab's VoiceOver label: the name, plus the localized "default" word for
    /// the protected layout. Selection is conveyed by the `.isSelected` trait, not
    /// the label, so it is not duplicated here.
    public static func tabLabel(_ tab: LayoutTab, localize: LayoutManagerLocalizer) -> String {
        var parts = [tab.name]
        if tab.isDefault {
            parts.append(localize.string("dashboard.default", "default"))
        }
        return parts.joined(separator: ", ")
    }

    /// The VoiceOver name for the "move left" reorder action.
    public static func moveLeftLabel(_ localize: LayoutManagerLocalizer) -> String {
        localize.string("dashboard.layouts.a11y.moveLeft", "Move left")
    }

    /// The VoiceOver name for the "move right" reorder action.
    public static func moveRightLabel(_ localize: LayoutManagerLocalizer) -> String {
        localize.string("dashboard.layouts.a11y.moveRight", "Move right")
    }
}

// MARK: - Copy catalog (native chrome — every non-menu string the surface resolves)

/// One localizable string: its catalog key plus the web/native English fallback.
/// Keeping the pair as a value lets the view resolve through the P1/S10 facade
/// while tests assert the key set without a bundle.
public struct LayoutText: Sendable, Equatable {
    public let key: String
    public let fallback: String

    public init(_ key: String, _ fallback: String) {
        self.key = key
        self.fallback = fallback
    }

    public func resolved(_ localize: LayoutManagerLocalizer) -> String {
        localize.string(key, fallback)
    }
}

/// The surface's native-chrome copy catalog — the strings the P4 states contract
/// requires beyond the web menu/inline keys (loading, empty, error, retry, the
/// stale/offline chips, and the inline field prompts/affordances). The
/// `.strings` table carries the same key set plus the web `dashboard.*` keys.
public enum LayoutManagerCopy {
    public static let confirmRename = LayoutText("dashboard.confirmRename", "Confirm rename")
    public static let cancelRename = LayoutText("dashboard.cancelRename", "Cancel rename")
    public static let defaultBadge = LayoutText("dashboard.default", "default")
    public static let newName = LayoutText("dashboard.newName", "Layout name...")
    public static let confirmCreate = LayoutText("dashboard.confirmCreate", "Confirm create")
    public static let cancelCreate = LayoutText("dashboard.cancelCreate", "Cancel create")
    public static let newLayout = LayoutText("dashboard.newLayout", "New Layout")
    public static let renameField = LayoutText("dashboard.layouts.a11y.renameField", "Layout name")
    public static let loading = LayoutText("dashboard.layouts.loading", "Loading layouts…")
    public static let emptyTitle = LayoutText("dashboard.layouts.empty.title", "No saved layouts")
    public static let emptyMessage = LayoutText(
        "dashboard.layouts.empty.message",
        "Create your first dashboard layout to get started."
    )
    public static let errorMessage = LayoutText(
        "dashboard.layouts.error.message",
        "Couldn’t load your saved layouts."
    )
    public static let retry = LayoutText("dashboard.layouts.retry", "Retry")
    public static let stale = LayoutText("dashboard.layouts.freshness.stale", "Layouts may be out of date")
    public static let offline = LayoutText("dashboard.layouts.freshness.offline", "Offline — showing saved layouts")

    /// Every catalog entry — used by the keys-coverage unit test.
    public static let all: [LayoutText] = [
        confirmRename, cancelRename, defaultBadge, newName, confirmCreate, cancelCreate,
        newLayout, renameField, loading, emptyTitle, emptyMessage, errorMessage, retry,
        stale, offline
    ]
}
