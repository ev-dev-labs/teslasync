//
//  TimelineScrubber.swift
//  TeslaSync — P4 shared surface · 0107 · TimelineScrubber (Apple)
//
//  The trip-replay timeline scrubber surface — the SwiftUI parity of
//  `web/src/components/data-display/TimelineScrubber.tsx`. The web component is a CONTROLLED
//  presentational track: the host owns `progress / buffered / duration / markers` and the track calls
//  back through `onSeek`; a `getPreviewAt` sampler feeds the hover / drag preview bubble, and an
//  optional decorative `background` (typically a speed `Sparkline`) renders behind the track.
//
//  The native surface keeps that interactive track as the `content` phase and binds it through
//  `TimelineScrubberModel` (P1/S8) — no networking lives here — rendering every state so the surface
//  never collapses to a blank box: loading (skeleton track), empty (nothing to scrub), error (retry),
//  content (the track), plus the orthogonal stale / offline freshness chip + banner with a one-shot
//  auto-refresh. `view.opened` is emitted once on appear (P1/S11).
//

import SwiftUI

/// The trip-replay timeline scrubber surface. Renders every state plus the P4 leaf freshness states,
/// binding through `TimelineScrubberModel`.
public struct TimelineScrubber: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TimelineScrubberMeta.surfaceSlug

    @State private var model: TimelineScrubberModel
    private let preview: (@MainActor (Double) -> TimelineScrubberPreview?)?
    private let background: AnyView?

    /// Designated initializer — adopts a fully-formed model (a spy source / telemetry in tests, the
    /// production source in the app), the optional scrub-preview sampler (web `getPreviewAt`), and the
    /// optional decorative background (web `background`, e.g. an `AnyView(Sparkline(...))`).
    public init(
        model: TimelineScrubberModel,
        preview: (@MainActor (Double) -> TimelineScrubberPreview?)? = nil,
        background: AnyView? = nil
    ) {
        _model = State(initialValue: model)
        self.preview = preview
        self.background = background
    }

    /// Convenience initializer mirroring the web controlled-prop signature — seeds a live source with
    /// the host snapshot + binds the host's `onSeek`. The host pushes further snapshots as the replay
    /// state changes (via the `LiveTimelineScrubberSource`).
    public init(
        input: TimelineScrubberInput,
        actions: TimelineScrubberActions = TimelineScrubberActions(),
        telemetry: any TimelineScrubberTelemetry = OSLogTimelineScrubberTelemetry(),
        preview: (@MainActor (Double) -> TimelineScrubberPreview?)? = nil,
        background: AnyView? = nil
    ) {
        let source = LiveTimelineScrubberSource(snapshot: input)
        _model = State(initialValue: TimelineScrubberModel(
            source: source,
            actions: actions,
            telemetry: telemetry
        ))
        self.preview = preview
        self.background = background
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                phaseContent
                freshnessBanner
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(alignment: .topTrailing) { freshnessChip }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var phaseContent: some View {
        switch model.resolved.phase {
        case .loading:
            TimelineScrubberLoadingTrack()
        case .empty:
            TimelineScrubberEmptyState()
        case let .error(message):
            TimelineScrubberErrorState(message: message) { model.refresh() }
        case .content:
            TimelineScrubberTrack(
                progress: model.resolved.progress,
                buffered: model.resolved.buffered,
                valueText: model.resolved.scrubberValueText,
                markers: model.resolved.markers,
                preview: preview,
                durationSeconds: model.resolved.durationSeconds,
                onSeek: model.seek,
                background: background
            )
        }
    }

    @ViewBuilder
    private var freshnessBanner: some View {
        if model.connection != .live {
            TimelineScrubberFreshnessBanner(connection: model.connection) { model.refresh() }
        }
    }

    @ViewBuilder
    private var freshnessChip: some View {
        if model.connection != .live {
            TimelineScrubberFreshnessChip(connection: model.connection) { model.refresh() }
                .padding(TSSpacing.sm)
        }
    }
}
