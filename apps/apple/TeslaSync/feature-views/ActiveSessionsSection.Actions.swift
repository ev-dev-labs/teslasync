//
//  ActiveSessionsSection.Actions.swift
//  TeslaSync — P4 feature view · 0197 · ActiveSessionsSection (Apple)
//
//  The two destructive confirmations the section drives — the per-row "Sign out this
//  device?" and the bulk "Sign out all other devices?" (web `ConfirmDialog` ×2). Both
//  are security primitives so they ALWAYS confirm (web: NO `silenceKey`); the upstream
//  RequireSudo gate pops the re-auth dialog when the mutation fires. Bound through
//  `ActiveSessionsModel`; copy via P1/S10.
//

import SwiftUI

// MARK: - Per-row revoke confirm (web per-row `ConfirmDialog`)

/// Confirms signing out one device. Presented while the model holds a `revokeTarget`;
/// the message names the device (web `{{device}} will be signed out…`).
private struct RevokeOneConfirmation: ViewModifier {
    @Bindable var model: ActiveSessionsModel

    func body(content: Content) -> some View {
        content.confirmationDialog(
            Text(verbatim: ActiveSessionsStrings.string("sessions.confirm.revokeTitle", "Sign out this device?")),
            isPresented: presented,
            titleVisibility: .visible,
            presenting: model.revokeTarget
        ) { _ in
            Button(role: .destructive) {
                Task { await model.confirmRevoke() }
            } label: {
                ActiveSessionsStrings.text("sessions.confirm.revokeConfirm", "Sign out")
            }
            Button(role: .cancel) {
                model.cancelRevoke()
            } label: {
                ActiveSessionsStrings.text("sessions.confirm.revokeCancel", "Keep signed in")
            }
        } message: { target in
            Text(verbatim: message(for: target))
        }
    }

    private var presented: Binding<Bool> {
        Binding(
            get: { model.revokeTarget != nil },
            set: { isPresented in if !isPresented { model.cancelRevoke() } }
        )
    }

    private func message(for target: ActiveSessionItem) -> String {
        ActiveSessionsStrings.string("sessions.confirm.revokeMessage", Self.fallback)
            .replacingOccurrences(of: "{{device}}", with: target.deviceLabel(localize: model.localize))
    }

    private static let fallback =
        "{{device}} will be signed out on its next request. Your other devices will stay signed in."
}

// MARK: - Bulk revoke confirm (web all-others `ConfirmDialog`)

/// Confirms signing out every device other than this one. Presented while the model's
/// `showAllOthersConfirm` is set; the current session is excluded server-side so the
/// user never locks themselves out of this tab.
private struct RevokeAllOthersConfirmation: ViewModifier {
    @Bindable var model: ActiveSessionsModel

    func body(content: Content) -> some View {
        content.confirmationDialog(
            Text(verbatim: ActiveSessionsStrings.string(
                "sessions.confirm.allOthersTitle",
                "Sign out all other devices?"
            )),
            isPresented: presented,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await model.confirmRevokeAllOthers() }
            } label: {
                ActiveSessionsStrings.text("sessions.confirm.allOthersConfirm", "Sign out all others")
            }
            Button(role: .cancel) {
                model.cancelRevokeAllOthers()
            } label: {
                ActiveSessionsStrings.text("sessions.confirm.allOthersCancel", "Cancel")
            }
        } message: {
            ActiveSessionsStrings.text("sessions.confirm.allOthersMessage", Self.fallback)
        }
    }

    private var presented: Binding<Bool> {
        Binding(
            get: { model.showAllOthersConfirm },
            set: { isPresented in if !isPresented { model.cancelRevokeAllOthers() } }
        )
    }

    private static let fallback =
        "Every browser other than this one will be signed out on its next request. You can sign back in "
            + "immediately."
}

// MARK: - Composition

extension View {
    /// Attaches both security confirmations (per-row + all-others) bound through the
    /// model. Applied once by `ActiveSessionsSection`.
    func activeSessionsConfirmations(model: ActiveSessionsModel) -> some View {
        modifier(RevokeOneConfirmation(model: model))
            .modifier(RevokeAllOthersConfirmation(model: model))
    }
}
