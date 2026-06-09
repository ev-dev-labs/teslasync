//
//  UpdateAvailableCallout.swift
//  TeslaSync — P4 feature view · 0259 · UpdateAvailableCallout (Apple)
//
//  The "update available" callout surface — the SwiftUI parity of
//  web/src/features/system/components/status/UpdateAvailableCallout.tsx. A cyan-tinted glass
//  callout, shown above the status chip bar when the backend's `/system/update-check`
//  reports an upgrade, pointing the operator at the GitHub release notes.
//
//  Binds through `UpdateAvailableModel` (P1/S8); no networking lives here. The phase switch
//  reproduces the web parent's `{hasUpdate && <UpdateAvailableCallout/>}` mount gate: an
//  `idle` phase renders nothing (the web absence) while `presented` renders the full callout
//  card. Every withdrawn reason is a distinct classification (loading / up-to-date / check
//  failed) so the generic P4 leaf states map explicitly — see UpdateAvailableCallout.Adapter.
//

import SwiftUI

/// The "update available" callout — the SwiftUI parity of
/// `features/system/components/status/UpdateAvailableCallout.tsx`, binding through
/// `UpdateAvailableModel` (P1/S8). No networking lives here.
public struct UpdateAvailableCallout: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = UpdateAvailableCalloutSurface.slug

    @State private var model: UpdateAvailableModel

    public init(model: UpdateAvailableModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .idle:
            // Web parent renders nothing when `!hasUpdate` — the faithful withdrawn surface.
            EmptyView()
        case let .presented(presented):
            UpdateAvailableCard(content: presented) { model.refresh() }
        }
    }
}
