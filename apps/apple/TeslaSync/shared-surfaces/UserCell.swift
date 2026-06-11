//
//  UserCell.swift
//  TeslaSync — P4 shared surface · 0110 · UserCell (Apple)
//
//  The shared UserCell primitive — the SwiftUI parity of `components/data-display/UserCell.tsx`. The
//  web component is a drop-in cell for user-attributed columns: it renders the shared Avatar
//  alongside the display name, with an optional muted email line beneath, and an em-dash when the
//  user carries no identifying signal so empty cells stay scannable in dense tables. This surface
//  reproduces that composition and both render branches, binding through `UserCellModel` (P1/S8);
//  the cell performs no fetch of its own (the only network is the composed avatar's remote image).
//
//  Render branches (every one renders — no hidden / blank surface):
//    • empty     — no name / email / id → the muted em-dash (web `data-testid="user-cell-empty"`).
//    • populated — the avatar + the display name, with an optional muted email line beneath.
//

import SwiftUI

// MARK: - UserCell (the shared surface)

/// The shared UserCell primitive — the SwiftUI parity of `components/data-display/UserCell.tsx`.
/// Renders the em-dash empty cell or the populated avatar + name (+ optional email), binding
/// through `UserCellModel`.
public struct UserCell: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = UserCellMeta.surfaceSlug

    @State private var model: UserCellModel

    public init(model: UserCellModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production descriptor-backed source — the parity of
    /// mounting `<UserCell … />` with its props.
    public init(_ descriptor: UserCellDescriptor) {
        _model = State(initialValue: UserCellModel(source: LiveUserCellSource(descriptor: descriptor)))
    }

    /// Convenience initializer matching the web `UserCellProps` field-for-field, so call sites read
    /// like the web component (`UserCell(user: actor, showEmail: true)`).
    public init(
        user: UserCellUser?,
        showEmail: Bool = false,
        size: AvatarSize = .sm
    ) {
        self.init(UserCellDescriptor(user: user, showEmail: showEmail, size: size))
    }

    public var body: some View {
        UserCellContent(
            resolved: model.resolved,
            label: model.accessibilityLabel,
            value: model.accessibilityValue
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }
}
