//
//  RangeBarWidget.swift
//  TeslaSync — P4 dashboard widget · 0076 · RangeBarWidget (Apple)
//
//  The composable Range Bar dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/RangeBarWidget.tsx. Binds through `RangeBarModel` (no
//  networking in the view); renders every state and both layouts (compact / standard) with
//  the rated/ideal horizontal bars + the EPA-variance readout.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension RangeBarStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model
    /// file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - RangeBarWidget (the dashboard surface)

/// The composable Range Bar dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/RangeBarWidget.tsx`. Renders every state from the web source
/// (loading / empty / error / stale / offline / content) inside a glass widget shell, binding
/// through `RangeBarModel` (P1/S8). No networking lives here.
public struct RangeBarWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RangeBarSurface.slug

    /// Canonical registry metadata (registry/battery.ts → "range-bar").
    public static let registration = RangeBarSurface.registration

    @State private var model: RangeBarModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: RangeBarModel,
        size: DashboardWidgetSize = RangeBarWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = RangeBarWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// web `isCompact = size.cols === 1 && size.rows === 1`. The registry min is 1×2, so a
    /// clamped instance never enters the compact branch (the bars always render) — matching
    /// the web grid, which enforces the same minimum.
    private var isCompact: Bool {
        RangeBarLayout.isCompact(cols: size.cols, rows: size.rows)
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
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

extension RangeBarWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "gauge.medium")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                RangeBarStrings.text("widget.rangeBar", "Range")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
            if onOpen != nil { openButton }
        }
    }

    private var freshnessChip: some View {
        HStack(spacing: 4) {
            Circle().fill(freshnessTone).frame(width: 6, height: 6)
            Text(verbatim: freshnessLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if !isCompact, let updatedAt = model.updatedAt {
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(updatedAt, style: .relative)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: freshnessLabel))
    }

    private var freshnessTone: Color {
        if model.isFetching { return Color.TS.accent }
        switch model.connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.textMuted
        }
    }

    private var freshnessLabel: String {
        if model.isFetching {
            return RangeBarStrings.string("widget.rangeBar.updating", "Updating")
        }
        switch model.connection {
        case .live: return RangeBarStrings.string("widget.rangeBar.live", "Live")
        case .stale: return RangeBarStrings.string("widget.rangeBar.stale", "Stale")
        case .offline: return RangeBarStrings.string("widget.rangeBar.offline", "Offline")
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(RangeBarStrings.text("widget.rangeBar.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                RangeBarStrings.text("widget.rangeBar.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(RangeBarStrings.text("widget.rangeBar.openA11y", "Open the Range page"))
    }
}

// MARK: - Content states

extension RangeBarWidget {
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
            if let projection = model.projection {
                loadedContent(projection)
            } else {
                emptyState
            }
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    HStack {
                        TSSkeleton(width: 72, height: 8, cornerRadius: TSRadius.sm)
                        Spacer()
                        TSSkeleton(width: 48, height: 8, cornerRadius: TSRadius.sm)
                    }
                    TSSkeleton(height: 8, cornerRadius: TSRadius.pill)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement()
        .accessibilityLabel(RangeBarStrings.text("widget.rangeBar.loading", "Loading range"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                RangeBarStrings.text("widget.noRange", "No range data")
            } icon: {
                Image(systemName: "gauge.medium")
            }
        } description: {
            RangeBarStrings.text(
                "widget.rangeBar.emptyHint",
                "Range data will appear once your vehicle reports in."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            RangeBarStrings.text("widget.rangeBar.errorTitle", "Couldn't load range")
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
                RangeBarStrings.text("widget.rangeBar.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(RangeBarStrings.text("widget.rangeBar.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func loadedContent(_ projection: RangeBarProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            if isCompact {
                compactContent(projection)
            } else {
                standardContent(projection)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: RangeBarAccessibility.summary(for: projection)))
    }

    /// web compact branch: the rated value (accent) over a "{unit} rated" caption.
    private func compactContent(_ projection: RangeBarProjection) -> some View {
        VStack(spacing: 2) {
            Text(verbatim: projection.compactValueText)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(RangeBarTone.rated.color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            HStack(spacing: 4) {
                Text(verbatim: projection.distanceSymbol)
                RangeBarStrings.text("widget.rated", "rated")
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }

    /// web standard branch: rated + ideal bars and the EPA-variance readout.
    private func standardContent(_ projection: RangeBarProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            RangeBarMeter(metric: projection.rated)
            RangeBarMeter(metric: projection.ideal)
            if let variance = projection.variance {
                varianceRow(variance)
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private func varianceRow(_ variance: RangeBarVariance) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Spacer(minLength: 0)
            RangeBarStrings.text("widget.epaComparison", "EPA variance")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: variance.percentText)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.rangeBar.offlineBanner" : "widget.rangeBar.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known range"
            : "Reconnecting — range may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            RangeBarStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
