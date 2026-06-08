//
//  EventTimeline.swift
//  TeslaSync — P4 feature view · 0043 · EventTimeline (Apple)
//
//  The composable "Security Event Timeline" feature view — the SwiftUI parity of
//  features/admin/components/security-access/EventTimeline.tsx. Renders every state from
//  the web source (content list / empty) plus the loading / error / stale / offline
//  chrome the Apple HIG states contract requires, bound through `EventTimelineModel`
//  (P1/S8). No networking lives here. The web `FadeIn delay={0.35}` + `GlassPanel p-4`
//  wrapper is reproduced with `TSFadeIn` + the shared glass panel.
//

import SwiftUI

/// The composable Security Event Timeline feature view — the SwiftUI parity of
/// `features/admin/components/security-access/EventTimeline.tsx`, binding through
/// `EventTimelineModel` (P1/S8). No networking lives here.
public struct EventTimeline: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = EventTimelineSurface.slug

    /// The scrollable list height cap (web `max-h-96` = 24rem).
    private static let listMaxHeight: CGFloat = 384

    @State private var model: EventTimelineModel

    public init(model: EventTimelineModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.35) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if model.connection != .live {
                    EventTimelineConnectivityBanner(connection: model.connection)
                }
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tsGlassPanel()
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: EventTimelineStrings.string("admin.security.timeline.title", "Security Event Timeline"))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            EventTimelineFreshnessChip(connection: model.connection)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            EventTimelineLoadingRows(rows: 4)
        case .empty:
            EventTimelineEmptyView()
        case let .error(message):
            EventTimelineErrorView(message: message) { model.refresh() }
        case .content:
            timelineList
        }
    }

    private var timelineList: some View {
        ScrollView {
            VStack(spacing: TSSpacing.sm) {
                ForEach(model.events) { entry in
                    EventTimelineRow(entry: entry)
                }
            }
            .padding(.trailing, TSSpacing.xs)
        }
        .frame(maxHeight: Self.listMaxHeight)
        .accessibilityElement(children: .contain)
    }
}
