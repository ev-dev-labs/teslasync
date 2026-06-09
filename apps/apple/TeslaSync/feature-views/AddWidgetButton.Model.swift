//
//  AddWidgetButton.Model.swift
//  TeslaSync — P4 feature view · 0121 · AddWidgetButton (Apple)
//
//  Pure, host-free projection layer for the AddWidgetButton surface — SwiftUI
//  parity of features/dashboard/components/AddWidgetButton.tsx.
//
//  AddWidgetButton is a *presentational* floating action button: the web source
//  fetches nothing (its only dependencies are `useTranslation` + the shared
//  `@/components/ui` Button + Tooltip). So, exactly like the sibling `ToolCard`
//  (0010) and `HighlightCard` (0076) surfaces, the remote phases (loading /
//  empty / error / stale / offline) belong to whatever data-bound dashboard
//  embeds the FAB, not to the button itself. The single branch the web source
//  owns — `if (isEditing) return null` (the FAB hides in edit mode because the
//  header already exposes an "Add Widget" action) — is modelled here as an
//  equatable value type so it is unit-testable without a render host, alongside
//  the layout constants the web `Button` className override encodes.
//

import SwiftUI

// MARK: - Surface identity (P1/S11 view.opened)

/// Stable, non-identifying identity for the `AddWidgetButton` feature view. The
/// slug is the value emitted with the P1/S11 `view.opened` diagnostics contract;
/// the view and its tests both read it from here so the two never drift.
public enum AddWidgetButtonSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "AddWidgetButton"

    /// Reports the surface becoming visible. Factored out of the view's `.task`
    /// so it is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any AddWidgetButtonTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Presentation (pure projection of inputs → render decisions)

/// The pure, `Equatable` projection of the FAB's inputs into the structural
/// decision the view renders. The web component has exactly one branch —
/// `if (isEditing) return null` — so the projection's job is to answer "is the
/// FAB visible?". Holding it in a value type lets the XCTest suite cover the
/// branch (and pin the layout constants) without a snapshot library, the same
/// approach the `ToolCard` / `HighlightCard` surfaces use.
public struct AddWidgetButtonPresentation: Equatable, Sendable {
    /// Whether the dashboard is in edit mode (web `isEditing` prop). When `true`
    /// the FAB hides because the edit-mode header already exposes an
    /// "Add Widget" action.
    public let isEditing: Bool

    public init(isEditing: Bool) {
        self.isEditing = isEditing
    }

    /// Whether the FAB renders. Parity with the web `if (isEditing) return null`:
    /// visible exactly when the dashboard is NOT in edit mode.
    public var isVisible: Bool {
        !isEditing
    }

    /// The diagnostics slug this presentation belongs to.
    public var surfaceSlug: String {
        AddWidgetButtonSurface.slug
    }

    // MARK: Layout constants (web `Button` className override)

    /// SF Symbol for the glyph — the native analogue of the web lucide `Plus`
    /// (`Icons.add`).
    public static let iconSystemName = "plus"

    /// FAB diameter in points — web `h-14 w-14` (56px) circular override.
    public static let diameter: CGFloat = 56

    /// Glyph point size — web renders the `Plus` at `h-8 w-8` (≈32px) with a
    /// bumped `strokeWidth` so the "+" reads as ~50% of the 56pt FAB rather than
    /// a thin mark floating in the circle (the web source's own rationale).
    public static let iconPointSize: CGFloat = 28

    /// Trailing inset from the safe area — web `right-6` (24px).
    public static let trailingInset: CGFloat = TSSpacing.x2xl

    /// Bottom inset from the safe area — the native read of web `bottom-20`. The
    /// web's extra height clears its in-DOM StatusBar + BottomTabBar stack; on
    /// Apple that bottom chrome lives inside the safe area, so the FAB anchors a
    /// comfortable 24pt above the safe-area inset (the host owns any tab bar).
    public static let bottomInset: CGFloat = TSSpacing.x2xl
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literal (web `t('dashboard.addWidget', 'Add Widget')`).
/// Keys live in the per-surface "AddWidgetButton" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time (kept separate so parallel
/// surface prompts never collide on the shared catalog).
public enum AddWidgetButtonStrings {
    public static let table = "AddWidgetButton"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver / tooltip phrasing for the FAB. Kept pure + key-driven so
/// the a11y contract can be asserted without rendering. The `label` backs both
/// the web `aria-label` and the `Tooltip content`; the `hint` is native-only
/// chrome that tells VoiceOver what activating the button does.
public enum AddWidgetButtonAccessibility {
    /// The button's accessible name + pointer tooltip — web `t('dashboard.addWidget')`.
    public static var label: String {
        AddWidgetButtonStrings.string("dashboard.addWidget", "Add Widget")
    }

    /// The spoken hint describing the action (native a11y chrome; the web tooltip
    /// carries no separate hint).
    public static var hint: String {
        AddWidgetButtonStrings.string("dashboard.addWidget.a11yHint", "Opens the widget catalogue")
    }
}
