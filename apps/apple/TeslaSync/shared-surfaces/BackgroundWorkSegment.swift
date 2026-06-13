//
//  BackgroundWorkSegment.swift
//  TeslaSync — P4 shared surface · 0177 · BackgroundWorkSegment (Apple)
//
//  The footer status-bar background-work segment — the SwiftUI parity of
//  `components/layout/status-bar/BackgroundWorkSegment.tsx`. The web component surfaces in-flight
//  background work (CSV exports, settings saves, ad-hoc registered jobs) as a compact spinner + task-count
//  button that opens a popover listing the running jobs, and is hidden entirely while the app is quiet.
//  This surface reproduces that composition natively, binding through ``BackgroundWorkSegmentModel``
//  (P1/S8); no networking lives in the view.
//
//  States (every one renders — no hidden surface):
//    • loading — the first `/export/jobs` probe is in flight with nothing resolved → skeleton pill.
//    • empty   — resolved with no jobs running → friendly "No background work" pill (the P4 "never a blank
//                box" peer of the web `if (!hasJobs) return null`; a host can instead hide the surface via
//                ``BackgroundWorkSegmentModel/hasJobs``).
//    • error   — the first probe failed with nothing cached → danger pill with a retry affordance.
//    • active  — one or more jobs running → the spinner + summary button (+ tooltip) opening the
//                running-jobs popover (web `open` state).
//    • stale / offline — the orthogonal `connection` axis → freshness chip inside the popover with a
//                one-shot auto-refresh on the stale transition.
//
//  Positioning note: the web segment lives inside the footer status bar. Placement is a host concern in
//  SwiftUI — this surface renders its self-contained segment + popover and the host mounts it in its
//  status bar, keeping the surface layout-agnostic and reusable.
//

import SwiftUI

// MARK: - BackgroundWorkSegment (the shared surface)

/// The footer background-work segment — the SwiftUI parity of `BackgroundWorkSegment.tsx`. Renders every
/// state plus the P4 leaf freshness states, binding through ``BackgroundWorkSegmentModel``, and presents
/// the running-jobs popover on tap.
public struct BackgroundWorkSegment: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = BackgroundWorkSurface.slug

    @State private var model: BackgroundWorkSegmentModel
    private let iconOnly: Bool

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded source).
    public init(model: BackgroundWorkSegmentModel, iconOnly: Bool = false) {
        _model = State(initialValue: model)
        self.iconOnly = iconOnly
    }

    /// The production entry — the parity of the web component mounting over `useBackgroundJobs`. The host
    /// supplies the `/export/jobs` probe (a closure over its export client), the mutation-activity
    /// observer (its `useIsMutating` peer), and the custom-job registry (defaulting to the process-wide
    /// ``BackgroundCustomJobRegistry/shared`` — the web module store). Cadence + telemetry default to the
    /// web-faithful values and can be overridden.
    public init(
        exportProbe: any ExportJobsProbe,
        mutationObserver: any MutationActivityObserver,
        customObserver: any BackgroundCustomJobObserver = BackgroundCustomJobRegistry.shared,
        iconOnly: Bool = false,
        poller: any BackgroundWorkPoller = TimerBackgroundWorkPoller(),
        telemetry: any BackgroundWorkTelemetry = OSLogBackgroundWorkTelemetry()
    ) {
        let source = PollingBackgroundWorkSource(
            exportProbe: exportProbe,
            mutationObserver: mutationObserver,
            customObserver: customObserver,
            poller: poller
        )
        _model = State(initialValue: BackgroundWorkSegmentModel(source: source, telemetry: telemetry))
        self.iconOnly = iconOnly
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            BackgroundWorkLoadingView()
        case .empty:
            BackgroundWorkEmptyView()
        case let .error(message):
            BackgroundWorkErrorView(message: message) { model.refresh() }
        case .active:
            if let data = model.data {
                BackgroundWorkActiveView(
                    data: data,
                    iconOnly: iconOnly,
                    connection: model.connection,
                    isPopoverPresented: popoverBinding,
                    onToggle: { model.togglePopover() },
                    onRefresh: { model.refresh() }
                )
            }
        }
    }

    private var popoverBinding: Binding<Bool> {
        Binding(get: { model.isPopoverPresented }, set: { model.isPopoverPresented = $0 })
    }
}
