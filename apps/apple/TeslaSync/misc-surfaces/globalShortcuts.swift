//
//  globalShortcuts.swift
//  TeslaSync — P4 misc surface · 0002 · globalShortcuts (Apple)
//
//  The global keyboard-shortcut registry surface — the SwiftUI parity of
//  `lib/globalShortcuts.tsx`. The web component renders nothing (`return null`); it only
//  pours the universal / navigation / command shortcuts into the registry so the
//  cheat-sheet has one source of truth. The native parity surface presents that same
//  registry as the keyboard-shortcuts reference: the three groups (Actions, Navigation,
//  Commands), each row's description + key chips, plus the P4 leaf contract states.
//  Binds through `GlobalShortcutsModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton sections.
//    • empty    — resolved with no registered shortcuts → friendly empty state, never a
//                 blank box.
//    • error    — source query failure → retry affordance (web `QueryError` peer).
//    • data     — the grouped cheat-sheet.
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the
//                 list with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - GlobalShortcuts (the misc surface)

/// The global keyboard-shortcut registry surface — the SwiftUI parity of
/// `lib/globalShortcuts.tsx`. Renders every state plus the P4 leaf freshness states,
/// binding through `GlobalShortcutsModel`.
public struct GlobalShortcuts: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "globalShortcuts"

    @State private var model: GlobalShortcutsModel

    public init(model: GlobalShortcutsModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the canonical registry source — the production
    /// parity of the web `useShortcut(defs)` seeding.
    public init() {
        _model = State(initialValue: GlobalShortcutsModel(source: CanonicalGlobalShortcutsSource()))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            content
            if model.connection != .live {
                GlobalShortcutsFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: GlobalShortcutsStrings.string("shortcuts.title", "Keyboard shortcuts"))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: GlobalShortcutsStrings.string(
                "shortcuts.subtitle", "Press a key combination to jump anywhere in the app"
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case .loading:
            GlobalShortcutsLoadingView()
        case .empty:
            GlobalShortcutsEmptyView()
        case let .error(message):
            GlobalShortcutsErrorView(message: message) { model.refresh() }
        case .data:
            GlobalShortcutsList(groups: model.resolved.groups)
        }
    }
}
