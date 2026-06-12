//
//  VersionSegment.swift
//  TeslaSync — P4 shared surface · 0181 · VersionSegment (Apple)
//
//  The footer status-bar version segment — the SwiftUI parity of
//  `components/layout/status-bar/VersionSegment.tsx`. The web component surfaces the running app version
//  + git SHA as a compact button (with an update / unseen-changelog dot and a hover tooltip) that opens
//  an "About this build" modal with full version provenance. This surface reproduces that composition
//  natively, binding through ``VersionSegmentModel`` (P1/S8); no networking lives in the view.
//
//  States (every one renders — no hidden surface):
//    • loading — the first `/system/version` probe is in flight with no version resolved → skeleton pill.
//    • empty   — resolved with no version at all → friendly "Version unavailable" pill (never a blank
//                box). Reachable only when the host bakes no build version; a normal build resolves vdev.
//    • error   — the first probe failed with nothing cached → danger pill with a retry affordance.
//    • ready   — a version resolved → the segment button (+ tooltip) opening the "About this build" modal.
//    • stale / offline — the orthogonal `connection` axis → freshness chip inside the modal with a
//                one-shot auto-refresh on the stale transition.
//
//  Positioning note: the web segment lives inside the footer status bar. Placement is a host concern in
//  SwiftUI — this surface renders its self-contained segment + modal and the host mounts it in its status
//  bar, keeping the surface layout-agnostic and reusable.
//

import SwiftUI

// MARK: - VersionSegment (the shared surface)

/// The footer version segment — the SwiftUI parity of `VersionSegment.tsx`. Renders every state plus the
/// P4 leaf freshness states, binding through ``VersionSegmentModel``, and presents the "About this build"
/// modal on tap.
public struct VersionSegment: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VersionSegmentSurface.slug

    @State private var model: VersionSegmentModel
    private let iconOnly: Bool

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded source).
    public init(model: VersionSegmentModel, iconOnly: Bool = false) {
        _model = State(initialValue: model)
        self.iconOnly = iconOnly
    }

    /// The production entry — the parity of the web component mounting over its two `useQuery` hooks +
    /// `useChangelog`. The host supplies the two probes (closures over its `/system/version` +
    /// `/system/update-check` clients) and the changelog observer; the build info defaults to the bundle
    /// (web `VITE_APP_VERSION` / `VITE_GIT_SHA`), and the "open changelog" / "open release notes" handlers
    /// default to NotificationCenter broadcasts (the native peers of the web `dispatchEvent` /
    /// `window.open`). Cadences + telemetry default to the web-faithful values and can be overridden.
    public init(
        versionProbe: any VersionInfoProbe,
        updateProbe: any UpdateCheckProbe,
        changelog: any VersionSegmentChangelogObserver,
        buildInfo: VersionSegmentBuildInfo = VersionSegmentBuildInfoProvider.bundle(),
        iconOnly: Bool = false,
        versionPoller: any VersionSegmentPoller = TimerVersionSegmentPoller(),
        updatePoller: any VersionSegmentPoller = TimerVersionSegmentPoller(),
        telemetry: any VersionSegmentTelemetry = OSLogVersionSegmentTelemetry(),
        onOpenChangelog: (@MainActor () -> Void)? = nil,
        onOpenReleaseNotes: (@MainActor () -> Void)? = nil
    ) {
        let source = PollingVersionSegmentSource(
            versionProbe: versionProbe,
            updateProbe: updateProbe,
            changelog: changelog,
            versionPoller: versionPoller,
            updatePoller: updatePoller
        )
        _model = State(initialValue: VersionSegmentModel(
            source: source,
            buildInfo: buildInfo,
            telemetry: telemetry,
            onOpenChangelog: onOpenChangelog ?? {
                NotificationCenter.default.post(
                    name: VersionSegmentSurface.openChangelogNotification, object: nil
                )
            },
            onOpenReleaseNotes: onOpenReleaseNotes ?? {
                NotificationCenter.default.post(
                    name: VersionSegmentSurface.openReleaseNotesNotification,
                    object: VersionSegmentSurface.releaseNotesURL
                )
            }
        ))
        self.iconOnly = iconOnly
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .tsModal(isPresented: modalBinding, title: modalTitle) {
                if let data = model.data {
                    VersionSegmentModalContent(
                        data: data,
                        connection: model.connection,
                        onOpenChangelog: { model.openChangelog() },
                        onOpenReleaseNotes: { model.openReleaseNotes() },
                        onClose: { model.closeModal() },
                        onRefresh: { model.refresh() }
                    )
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            VersionSegmentLoadingView()
        case .empty:
            VersionSegmentEmptyView { model.refresh() }
        case let .error(message):
            VersionSegmentErrorView(message: message) { model.refresh() }
        case .ready:
            if let data = model.data {
                VersionSegmentReadyView(data: data, iconOnly: iconOnly) { model.openModal() }
            }
        }
    }

    private var modalBinding: Binding<Bool> {
        Binding(get: { model.isModalPresented }, set: { model.isModalPresented = $0 })
    }

    private var modalTitle: LocalizedStringKey {
        LocalizedStringKey(VersionSegmentStrings.string("statusBar.version.modalTitle", "About this build"))
    }
}
