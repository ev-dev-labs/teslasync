//
//  EnergySiteInfoWidget.swift
//  TeslaSync — P4 dashboard widget · 0047 · EnergySiteInfoWidget (Apple)
//
//  The composable Energy Site dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/EnergySiteInfoWidget.tsx. Binds through `EnergySiteInfoModel` (no
//  networking in the view); renders every state from the web source (loading / empty / error /
//  stale / offline / content) inside a glass widget shell, in both the compact (title-less) and full
//  layouts the web `isCompact = size.cols <= 1` selects.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension EnergySiteInfoStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - EnergySiteInfoWidget (the dashboard surface)

/// The composable Energy Site dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/EnergySiteInfoWidget.tsx`. Renders every state from the web source
/// (loading / empty / error / stale / offline / content) inside a glass widget shell, binding
/// through `EnergySiteInfoModel` (P1/S8). No networking lives here.
public struct EnergySiteInfoWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = EnergySiteInfoSurface.slug

    /// Canonical registry metadata (registry/energy.ts → "energy-site-info").
    public static let registration = EnergySiteInfoSurface.registration

    @State private var model: EnergySiteInfoModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: EnergySiteInfoModel,
        size: DashboardWidgetSize = EnergySiteInfoWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = EnergySiteInfoWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — hides the `WidgetShell` title + icon.
    private var isCompact: Bool {
        EnergySiteInfoLayout.isCompact(size)
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
        .accessibilityIdentifier("widget.energySiteInfo")
    }
}

// MARK: - Header (web `WidgetShell` chrome)

extension EnergySiteInfoWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "house.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                EnergySiteInfoStrings.text("widget.energySiteInfo.title", "Energy Site")
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
            return EnergySiteInfoStrings.string("widget.energySiteInfo.updating", "Updating")
        }
        switch model.connection {
        case .live: return EnergySiteInfoStrings.string("widget.energySiteInfo.live", "Live")
        case .stale: return EnergySiteInfoStrings.string("widget.energySiteInfo.stale", "Stale")
        case .offline: return EnergySiteInfoStrings.string("widget.energySiteInfo.offline", "Offline")
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
        .accessibilityLabel(EnergySiteInfoStrings.text("widget.energySiteInfo.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                EnergySiteInfoStrings.text("widget.energySiteInfo.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            EnergySiteInfoStrings.text("widget.energySiteInfo.openA11y", "Open the Energy page")
        )
    }
}

// MARK: - Content states (web shell `loading` / `error` + body `WidgetDetailCard`)

extension EnergySiteInfoWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            emptyState(hasSites: model.projection?.hasSites ?? false)
        case let .error(message):
            errorState(message)
        case .content:
            if let projection = model.projection, !projection.entries.isEmpty {
                loadedContent(projection)
            } else {
                emptyState(hasSites: model.projection?.hasSites ?? false)
            }
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack {
                    TSSkeleton(width: 90, height: 9, cornerRadius: TSRadius.sm)
                    Spacer(minLength: TSSpacing.md)
                    TSSkeleton(width: 70, height: 12, cornerRadius: TSRadius.sm)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(
            EnergySiteInfoStrings.text("widget.energySiteInfo.loading", "Loading energy site")
        )
    }

    private func emptyState(hasSites: Bool) -> some View {
        let messageKey = hasSites ? "widget.energySiteInfo.noData" : "widget.energySiteInfo.noSite"
        let messageFallback = hasSites ? "No site info available" : "No Tesla Energy site linked"
        return ContentUnavailableView {
            Label {
                EnergySiteInfoStrings.text(messageKey, messageFallback)
            } icon: {
                Image(systemName: "house")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: EnergySiteInfoAccessibility.emptySummary(hasSites: hasSites)))
        .accessibilityIdentifier("widget.energySiteInfo.empty")
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            EnergySiteInfoStrings.text("widget.energySiteInfo.errorTitle", "Couldn't load energy site")
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
                EnergySiteInfoStrings.text("widget.energySiteInfo.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(EnergySiteInfoStrings.text("widget.energySiteInfo.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("widget.energySiteInfo.error")
    }

    private func loadedContent(_ projection: EnergySiteInfoProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            EnergySiteInfoDetailCard(entries: projection.entries)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: EnergySiteInfoAccessibility.summary(for: projection)))
        .accessibilityIdentifier("widget.energySiteInfo.content")
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline
            ? "widget.energySiteInfo.offlineBanner"
            : "widget.energySiteInfo.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known site info"
            : "Reconnecting — site info may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            EnergySiteInfoStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
