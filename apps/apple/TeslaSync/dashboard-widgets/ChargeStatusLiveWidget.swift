//
//  ChargeStatusLiveWidget.swift
//  TeslaSync — P4 dashboard widget · 0020 · ChargeStatusLiveWidget (Apple)
//
//  The composable Charge Status Live dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/ChargeStatusLiveWidget.tsx. Binds through `ChargeStatusLiveModel`
//  (no networking in the view); renders every state and every layout branch from the web source
//  (loading / empty / error / stale / offline, then charging vs idle in compact + full forms).
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension ChargeStatusLiveStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - ChargeStatusLiveWidget (the dashboard surface)

/// The composable Charge Status Live dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/ChargeStatusLiveWidget.tsx`. Renders every state from the web source
/// (loading / empty / error / stale / offline / content) inside a glass widget shell, binding
/// through `ChargeStatusLiveModel` (P1/S8). No networking lives here.
public struct ChargeStatusLiveWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ChargeStatusLiveSurface.slug

    /// Canonical registry metadata (registry/charging.ts → "charge-status-live").
    public static let registration = ChargeStatusLiveSurface.registration

    @State private var model: ChargeStatusLiveModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: ChargeStatusLiveModel,
        size: DashboardWidgetSize = ChargeStatusLiveWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = ChargeStatusLiveWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1 && size.rows <= 1`.
    private var isCompact: Bool {
        ChargeStatusLayout.isCompact(size)
    }

    /// Web `isTall = size.rows >= 2`.
    private var isTall: Bool {
        ChargeStatusLayout.isTall(size)
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
        .accessibilityIdentifier("widget.chargeStatusLive")
    }
}

// MARK: - Header (web `WidgetShell` chrome)

extension ChargeStatusLiveWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                ChargeStatusLiveStrings.text("widget.chargeStatusLive", "Charge Status")
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
            return ChargeStatusLiveStrings.string("widget.chargeStatusLive.updating", "Updating")
        }
        switch model.connection {
        case .live: return ChargeStatusLiveStrings.string("widget.chargeStatusLive.live", "Live")
        case .stale: return ChargeStatusLiveStrings.string("widget.chargeStatusLive.stale", "Stale")
        case .offline: return ChargeStatusLiveStrings.string("widget.chargeStatusLive.offline", "Offline")
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
        .accessibilityLabel(ChargeStatusLiveStrings.text("widget.chargeStatusLive.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                ChargeStatusLiveStrings.text("widget.chargeStatusLive.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            ChargeStatusLiveStrings.text("widget.chargeStatusLive.openA11y", "Open the Charging page")
        )
    }
}

// MARK: - Content states (web shell `loading` + body `state ? … : <EmptyState/>`)

extension ChargeStatusLiveWidget {
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
            TSSkeleton(width: 120, height: 26, cornerRadius: TSRadius.sm)
                .frame(maxWidth: .infinity, alignment: .center)
            LazyVGrid(columns: metricColumns, alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 44, height: 8, cornerRadius: TSRadius.sm)
                        TSSkeleton(width: 64, height: 14, cornerRadius: TSRadius.sm)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement()
        .accessibilityLabel(
            ChargeStatusLiveStrings.text("widget.chargeStatusLive.loading", "Loading charge status")
        )
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                ChargeStatusLiveStrings.text("widget.noChargeData", "No charge data")
            } icon: {
                Image(systemName: "bolt.slash")
            }
        } description: {
            ChargeStatusLiveStrings.text(
                "widget.chargeStatusLive.emptyHint",
                "Charge status will appear once your vehicle reports in."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("widget.chargeStatusLive.empty")
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            ChargeStatusLiveStrings.text("widget.chargeStatusLive.errorTitle", "Couldn't load charge status")
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
                ChargeStatusLiveStrings.text("widget.chargeStatusLive.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChargeStatusLiveStrings.text("widget.chargeStatusLive.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("widget.chargeStatusLive.error")
    }

    private func loadedContent(_ projection: ChargeStatusProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            body(for: projection)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ChargeStatusAccessibility.summary(for: projection)))
        .accessibilityIdentifier("widget.chargeStatusLive.content")
    }

    /// Web body dispatch: `state.is_charging ? (compact|full charging) : (compact|full idle)`.
    @ViewBuilder
    private func body(for projection: ChargeStatusProjection) -> some View {
        if projection.isCharging {
            if isCompact {
                ChargeStatusCompactChargingView(projection: projection)
            } else {
                ChargeStatusFullChargingView(projection: projection, isTall: isTall)
            }
        } else {
            if isCompact {
                ChargeStatusCompactIdleView(projection: projection)
            } else {
                ChargeStatusIdleView(projection: projection)
            }
        }
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline
            ? "widget.chargeStatusLive.offlineBanner"
            : "widget.chargeStatusLive.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known charge status"
            : "Reconnecting — charge status may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            ChargeStatusLiveStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    /// Two flexible columns for the metric grids (web `grid-cols-2`).
    private var metricColumns: [GridItem] {
        [
            GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .leading),
            GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .leading)
        ]
    }
}
