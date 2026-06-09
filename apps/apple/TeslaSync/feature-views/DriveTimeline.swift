//
//  DriveTimeline.swift
//  TeslaSync — P4 feature view · 0140 · DriveTimeline (Apple)
//
//  The drive-detail timeline — the SwiftUI parity of
//  features/driving/components/drive-detail/DriveTimeline.tsx. Binds through
//  `DriveTimelineModel` (P1/S8); the panel is always mounted so the loading / empty /
//  error / stale / offline chrome renders in-place rather than gating the surface.
//  Wraps its content in `TSFadeIn` + a glass panel (web `FadeIn` + `GlassPanel`) and
//  emits the P1/S11 `view.opened` diagnostics event with the surface slug
//  `DriveTimeline`. No networking lives in the view.
//

import SwiftUI

/// Native, Apple-idiomatic parity of the web `DriveTimeline`: the green start-flag /
/// muted duration / red end-flag (or "In progress") row above the emerald→cyan
/// progress bar, plus the loading / empty / error / stale / offline chrome the P4
/// surface contract requires. Binds through `DriveTimelineModel`.
public struct DriveTimeline: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public nonisolated static let surfaceSlug = "DriveTimeline"

    /// The `view.opened` diagnostics event this surface emits on appear.
    public nonisolated static var viewOpenedEvent: DashboardWidgetTelemetryEvent {
        .viewOpened(surface: surfaceSlug)
    }

    @State private var model: DriveTimelineModel
    private let telemetry: (any DashboardWidgetTelemetrySink)?

    /// Live / preview binding: the production app injects a source-backed model.
    public init(model: DriveTimelineModel, telemetry: (any DashboardWidgetTelemetrySink)? = nil) {
        _model = State(initialValue: model)
        self.telemetry = telemetry
    }

    /// Web-prop binding: the source component renders from a resolved `drive` prop
    /// (`<DriveTimeline drive={drive} />`). Builds the bound model from the prop so the
    /// call site matches the web component.
    @MainActor
    public init(drive: DriveTimelineDrive, telemetry: (any DashboardWidgetTelemetrySink)? = nil) {
        self.init(model: DriveTimelineModel(drive: drive), telemetry: telemetry)
    }

    public var body: some View {
        let presentation = DriveTimelinePresentation.resolve(state: model.state)
        return TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if Self.hasAccessory(presentation) {
                    HStack(spacing: TSSpacing.sm) {
                        Spacer(minLength: 0)
                        accessory(for: presentation)
                    }
                }
                content(for: presentation)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .task {
            telemetry?.record(DriveTimeline.viewOpenedEvent)
            model.start()
        }
        .onDisappear { model.stop() }
        .onChange(of: isStale(presentation)) { _, stale in
            if stale { model.refresh() }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Content states

extension DriveTimeline {
    @ViewBuilder
    private func content(for presentation: DriveTimelinePresentation) -> some View {
        switch presentation {
        case .loading:
            DriveTimelineLoadingView()
        case .empty:
            DriveTimelineEmptyView()
        case .offlineNoData:
            DriveTimelineOfflineView { model.refresh() }
        case let .error(retryable):
            DriveTimelineErrorView(retryable: retryable) { model.refresh() }
        case let .content(projection, _, _):
            DriveTimelineContent(projection: projection)
        }
    }
}

// MARK: - Freshness accessory

extension DriveTimeline {
    /// Whether the resolved presentation carries a trailing freshness accessory
    /// (shown for content / offline / error; omitted for the loading + empty chrome
    /// that speaks for itself).
    private static func hasAccessory(_ presentation: DriveTimelinePresentation) -> Bool {
        switch presentation {
        case .content, .offlineNoData, .error: true
        case .loading, .empty: false
        }
    }

    @ViewBuilder
    private func accessory(for presentation: DriveTimelinePresentation) -> some View {
        switch presentation {
        case let .content(_, freshness, refreshing):
            DriveTimelineStatusAccessory(freshness: freshness, refreshing: refreshing) { model.refresh() }
        case .offlineNoData:
            DriveTimelineFreshnessChip(freshness: .offline)
        case .error:
            DriveTimelineFreshnessChip(freshness: .stale)
        case .loading, .empty:
            EmptyView()
        }
    }

    /// Whether the resolved presentation is stale content (drives auto-refresh).
    private func isStale(_ presentation: DriveTimelinePresentation) -> Bool {
        if case let .content(_, freshness, _) = presentation {
            return freshness == .stale
        }
        return false
    }
}
