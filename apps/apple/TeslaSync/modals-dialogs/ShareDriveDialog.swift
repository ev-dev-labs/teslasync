//
//  ShareDriveDialog.swift
//  TeslaSync — P4 modal / dialog · 0028 · ShareDriveDialog (Apple)
//
//  The drive-sharing dialog — the SwiftUI parity of features/driving/components/ShareDriveDialog.tsx.
//  The web source is a `Modal` titled "Share Drive" wrapping a create form (title `Input`, two
//  `Toggle`s, an expiry `Select`, a "Generate Link" button) that swaps to a result panel on success
//  (the `${origin}/s/${token}` URL + Copy / open / "Create another link"), above the drive's existing
//  share links (title, views, expiry status, copy + revoke). The native surface reproduces that as an
//  Apple modal: a pinned header (icon + title + freshness chip + close), a scrolling body (the
//  create-or-result section, the connectivity banner, and the "Active Share Links" section whose every
//  sub-state renders — loading / empty / error / content — never a blank box), binding through
//  `ShareDriveModel` (P1/S8). No networking lives here. Designed to be presented in a `.sheet`; the
//  view owns dismissal, the model owns the create / revoke / copy seams.
//

import SwiftUI

/// The drive-sharing surface, binding through `ShareDriveModel` (P1/S8). Presented in a sheet by a
/// host; the header close dismisses (web `handleClose`, resetting the result panel + title), create
/// swaps to the result panel, and revoke drops a row. Dismissal funnels through the model's `didFinish`
/// signal.
public struct ShareDriveDialog: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ShareDriveSurface.slug

    @State private var model: ShareDriveModel
    @Environment(\.dismiss) private var dismiss

    public init(model: ShareDriveModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: 0) {
            ShareDriveHeader(
                connection: model.connection,
                title: model.localize("share.title", "Share Drive"),
                closeLabel: model.localize("share.closeAria", "Close"),
                onClose: close
            )
            Divider().overlay(Color.TS.border)
            ShareDriveContentView(model: model)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: model.didFinish) { _, finished in
            if finished { dismiss() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilityDialogLabel))
    }

    /// Web `handleClose` — reset the result panel + title, then dismiss via `didFinish`.
    private func close() {
        model.close()
    }
}
