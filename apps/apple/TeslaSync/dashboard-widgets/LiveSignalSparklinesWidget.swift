//
//  LiveSignalSparklinesWidget.swift
//  TeslaSync — P4 dashboard widget · 0057 · LiveSignalSparklinesWidget (Apple)
//
//  The composable Live Signal Sparklines dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/LiveSignalSparklinesWidget.tsx. Binds through
//  LiveSignalSparklinesModel (no networking in the view) and renders every state:
//  loading / empty / error / stale / offline / content.
//

import Foundation
import SwiftUI

// MARK: - LiveSignalSparklinesWidget (the dashboard surface)

/// The configurable live-signal sparkline list — the SwiftUI parity of the web
/// `LiveSignalSparklinesWidget`. Renders a header (signal icon + title + freshness
/// chip + optional open affordance) over the resolved render state, binding through
/// `LiveSignalSparklinesModel` (P1/S8). No networking lives here.
public struct LiveSignalSparklinesWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        LiveSignalSparklinesModel.surfaceSlug
    }

    /// Canonical registry metadata (registry/telemetry.ts → "live-signal-sparklines").
    public static let registration = DashboardWidgetRegistration(
        id: "live-signal-sparklines",
        nameKey: "widget.liveSparklines",
        descriptionKey: "widget.liveSparklines.description",
        category: "telemetry",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: LiveSignalSparklinesModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: LiveSignalSparklinesModel,
        size: DashboardWidgetSize = LiveSignalSparklinesWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = LiveSignalSparklinesWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
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

extension LiveSignalSparklinesWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            LiveSignalSparklinesStrings.text("widget.liveSparklines", "Live Signal Sparklines")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            SignalFreshnessChip(
                freshness: model.freshness,
                updatedAt: model.updatedAt,
                onRefresh: { model.refresh() }
            )
            if onOpen != nil { openButton }
        }
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                LiveSignalSparklinesStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(LiveSignalSparklinesStrings.text("widget.openA11y", "Open the live signals page"))
    }
}

// MARK: - Content states

extension LiveSignalSparklinesWidget {
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
            rowsContent
        }
    }

    private var loadingChrome: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 5, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 4, height: 24, cornerRadius: TSRadius.pill)
                    VStack(alignment: .leading, spacing: 4) {
                        TSSkeleton(width: 70, height: 8)
                        TSSkeleton(width: 44, height: 10)
                    }
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 64, height: 20, cornerRadius: TSRadius.sm)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(LiveSignalSparklinesStrings.text("widget.loading", "Loading signals"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                LiveSignalSparklinesStrings.text("widget.noSignalsAvailable", "No signals available")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        } description: {
            LiveSignalSparklinesStrings.text(
                "widget.emptyHint",
                "Connect a vehicle streaming telemetry to chart its live signals."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            LiveSignalSparklinesStrings.text("widget.errorTitle", "Couldn't load signals")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            retryButton
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button {
            model.refresh()
        } label: {
            LiveSignalSparklinesStrings.text("widget.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(LiveSignalSparklinesStrings.text("widget.retry", "Retry"))
    }
}

// MARK: - Row list + connectivity

extension LiveSignalSparklinesWidget {
    private var rowsContent: some View {
        let cols = size.cols
        let wide = LiveSignalSparklinesBuilder.isWide(cols: cols)
        let twoColumns = LiveSignalSparklinesBuilder.useTwoColumns(cols: cols, rowCount: model.rows.count)
        return VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            signalList(isWide: wide, twoColumns: twoColumns)
        }
    }

    @ViewBuilder
    private func signalList(isWide: Bool, twoColumns: Bool) -> some View {
        let rows = model.rows
        if twoColumns {
            LazyVGrid(columns: twoColumnGrid, alignment: .leading, spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    SignalSparklineRow(row: row, isWide: isWide, showsDivider: index < rows.count - 1)
                }
            }
        } else {
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    SignalSparklineRow(row: row, isWide: isWide, showsDivider: index < rows.count - 1)
                }
            }
        }
    }

    private var twoColumnGrid: [GridItem] {
        [
            GridItem(.flexible(), spacing: TSSpacing.lg, alignment: .topLeading),
            GridItem(.flexible(), spacing: TSSpacing.lg, alignment: .topLeading)
        ]
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.offlineBanner" : "widget.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known values"
            : "Reconnecting — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            LiveSignalSparklinesStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
