//
//  NewVersionBanner.swift
//  TeslaSync — P4 shared surface · 0129 · NewVersionBanner (Apple)
//
//  The "new version available" banner — the SwiftUI parity of `components/feedback/NewVersionBanner.tsx`.
//  The web component reads `useVersionWatcher` (which polls `/system/version` for the deployed
//  `app_version`) and surfaces a soft "Reload" nudge once the backend has been redeployed since the
//  app booted, with a per-version "Later" dismissal. This surface reproduces that composition natively,
//  binding through ``NewVersionBannerModel`` (P1/S8); no networking lives in the view.
//
//  States (every one renders — no hidden surface):
//    • loading  — the boot probe of `/system/version` is in flight → skeleton banner chrome.
//    • empty    — up to date, still baselining, or dismissed for the current version (web `return
//                 null`) → friendly "you're on the latest version" card, never a blank box.
//    • error    — the boot probe failed with nothing cached (web swallows to null) → retryable error.
//    • available — a new version was detected and not dismissed → the Sparkles banner with the
//                 "Later" / "Reload" affordances (web `handleLater` / `handleReload`).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the surface with a
//                 one-shot auto-refresh on the stale transition.
//
//  Positioning note: the web banner is a `position: fixed` bottom-trailing toast. Placement is a host
//  concern in SwiftUI — this surface renders its self-contained banner content and the host mounts it
//  where the web `fixed bottom-4 right-4` would sit (e.g. `.overlay(alignment: .bottomTrailing)`),
//  keeping the surface itself layout-agnostic and reusable.
//

import SwiftUI

// MARK: - NewVersionBanner (the shared surface)

/// The "new version available" banner — the SwiftUI parity of `NewVersionBanner.tsx`. Renders every
/// state plus the P4 leaf freshness states, binding through ``NewVersionBannerModel``.
public struct NewVersionBanner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = NewVersionBannerSurface.slug

    @State private var model: NewVersionBannerModel

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded source).
    public init(model: NewVersionBannerModel) {
        _model = State(initialValue: model)
    }

    /// The production entry — the parity of the web component mounting over `useVersionWatcher`. The
    /// host supplies the `probe` (a closure that calls its `/system/version` client and maps the
    /// `app_version` into a ``NewVersionProbeOutcome``) and the `onReload` handler (the native peer of
    /// `window.location.reload()`). The poll cadence + dismissal store default to the web-faithful
    /// values and can be overridden for tests.
    public init(
        probe: any VersionProbe,
        poller: any NewVersionPoller = TimerNewVersionPoller(),
        pollInterval: TimeInterval = NewVersionBannerSurface.pollInterval,
        dismissalStore: any NewVersionDismissalStore = InMemoryNewVersionDismissalStore(),
        telemetry: any NewVersionBannerTelemetry = OSLogNewVersionBannerTelemetry(),
        onReload: (@MainActor () -> Void)? = nil
    ) {
        let source = PollingNewVersionBannerSource(probe: probe, poller: poller, interval: pollInterval)
        _model = State(initialValue: NewVersionBannerModel(
            source: source,
            dismissalStore: dismissalStore,
            telemetry: telemetry,
            onReload: onReload
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                NewVersionBannerFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            NewVersionBannerLoadingView()
        case .empty:
            NewVersionBannerUpToDateView()
        case let .error(message):
            NewVersionBannerErrorView(message: message) { model.refresh() }
        case .available:
            if let data = model.resolved.data {
                NewVersionBannerCard(
                    data: data,
                    onReload: { model.reload() },
                    onLater: { model.dismiss() }
                )
            }
        }
    }
}
