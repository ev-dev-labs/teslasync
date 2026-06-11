//
//  StateTimelineWidget.swift
//  TeslaSync — P4 dashboard widget · 0096 · StateTimelineWidget (Apple)
//
//  The composable State Timeline dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/StateTimelineWidget.tsx. Binds through
//  STWModel (no networking in the view) and renders every state:
//  loading / empty / error / stale / offline / content, across the compact
//  (legend dots), standard (state list), and wide (+ 24h stripe) layouts.
//

import Foundation
import SwiftUI

// MARK: - StateTimelineWidget (the dashboard surface)

/// The composable State Timeline dashboard widget. Renders the vehicle-state
/// distribution (driving / charging / asleep / idle / offline) as a stacked bar
/// plus a legend or list — and, when wide, a 24h transition stripe — inside a
/// glass widget shell, binding through `STWModel` (P1/S8). No
/// networking lives here.
public struct StateTimelineWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "StateTimelineWidget"

    /// Canonical registry metadata (registry/analytics.ts → "state-timeline").
    public static let registration = DashboardWidgetRegistration(
        id: "state-timeline",
        nameKey: "widget.stateTimeline",
        descriptionKey: "widget.stateTimeline.description",
        category: "analytics",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: STWModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: STWModel,
        size: DashboardWidgetSize = StateTimelineWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = StateTimelineWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    private var isCompact: Bool {
        STWModel.isCompact(for: size)
    }

    private var isWide: Bool {
        STWModel.isWide(for: size)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

extension StateTimelineWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "clock")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(StateTimelinePalette.driving)
                    .accessibilityHidden(true)
                STWStrings.text("widget.stateTimeline.title", "State Timeline")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
            if onOpen != nil, !isCompact { openButton }
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = STWStrings.string("widget.stateTimeline.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = STWStrings.string("widget.stateTimeline.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = STWStrings.string("widget.stateTimeline.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(STWStrings.text("widget.stateTimeline.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                STWStrings.text("widget.stateTimeline.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(STWStrings.text(
            "widget.stateTimeline.openA11y",
            "Open the timeline page"
        ))
    }
}

// MARK: - Content states

extension StateTimelineWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            loadedContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(height: 20, cornerRadius: 10)
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 16, cornerRadius: TSRadius.sm)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(STWStrings.text(
            "widget.stateTimeline.loading",
            "Loading state timeline"
        ))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                STWStrings.text("widget.stateTimeline.noData", "No state data available")
            } icon: {
                Image(systemName: "clock")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            STWStrings.text(
                "widget.stateTimeline.errorTitle",
                "Couldn't load state timeline"
            )
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.refresh()
            } label: {
                STWStrings.text("widget.stateTimeline.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loaded content (compact + standard + wide)

extension StateTimelineWidget {
    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live, !isCompact { connectivityBanner }
            StateStackedBar(segments: model.projection.segments)
            if isCompact {
                compactLegend
            } else {
                stateList
            }
            if isWide, !model.projection.stripe.isEmpty {
                StateTimelineStripe(stripe: model.projection.stripe)
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityValue(Text(verbatim: STWAccessibility
                .summary(for: model.projection)))
    }

    private var compactLegend: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 72), spacing: TSSpacing.sm, alignment: .leading)],
            alignment: .leading,
            spacing: TSSpacing.xs
        ) {
            ForEach(Array(model.projection.segments.prefix(5))) { segment in
                StateLegendChip(segment: segment)
            }
        }
    }

    private var stateList: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: TSSpacing.xs) {
                ForEach(model.projection.segments) { segment in
                    StateRow(segment: segment)
                }
            }
        }
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.stateTimeline.offlineBanner" : "widget.stateTimeline.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known states"
            : "Reconnecting — states may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            STWStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
