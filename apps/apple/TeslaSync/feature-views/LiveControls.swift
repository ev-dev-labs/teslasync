//
//  LiveControls.swift
//  TeslaSync — P4 feature view · 0233 · LiveControls (Apple)
//
//  The Live/Freeze/Step toolbar for the FSM debugger — the SwiftUI parity of
//  features/system/components/state-machine/LiveControls.tsx. Binds through
//  `LiveControlsModel` (P1/S8); no networking lives here. Renders the web leaf's
//  controlled toolbar (Live/Freeze, step-previous/next, the Window dropdown, Clear
//  buffer, and the dual buffer counter) plus the P4 states the leaf delegates to its
//  parent: the loading skeleton, the never-a-blank-box empty counter, the query-error
//  retry, and the stale/offline status chips.
//

import SwiftUI

/// The Live/Freeze/Step toolbar for the FSM debugger — the SwiftUI parity of
/// `features/system/components/state-machine/LiveControls.tsx`, binding through
/// `LiveControlsModel` (P1/S8). No networking lives here.
public struct LiveControls: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "LiveControls"

    @State private var model: LiveControlsModel

    public init(model: LiveControlsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.isOffline {
                LiveControlsStatusChip(copy: LiveControlsCopy.offline, tone: .muted, systemImage: "wifi.slash")
            }
            if model.isStale {
                LiveControlsStatusChip(
                    copy: LiveControlsCopy.stale,
                    tone: .accent,
                    systemImage: "clock.badge.exclamationmark"
                )
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.render {
        case .loading:
            LiveControlsLoadingView()
        case .failed:
            LiveControlsErrorView(onRetry: { model.refresh() })
        case let .ready(projection):
            LiveControlsToolbar(
                projection: projection,
                onToggleLive: { model.toggleLive($0) },
                onStepPrev: { model.stepPrev() },
                onStepNext: { model.stepNext() },
                onWindowChange: { model.changeWindow($0) },
                onClearBuffer: { model.clearBuffer() }
            )
        }
    }
}
