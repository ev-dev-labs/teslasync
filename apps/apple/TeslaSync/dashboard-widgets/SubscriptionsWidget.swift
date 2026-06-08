//
//  SubscriptionsWidget.swift
//  TeslaSync — P4 dashboard widget · 0097 · SubscriptionsWidget (Apple)
//
//  The composable Subscriptions dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/SubscriptionsWidget.tsx. Binds through
//  `SubscriptionsModel` (no networking in the view); renders every state across
//  the compact (cols ≤ 1) and standard layouts.
//

import Foundation
import SwiftUI

// MARK: - SubscriptionsWidget (the dashboard surface)

/// The composable Subscriptions dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/SubscriptionsWidget.tsx`. Renders every state from
/// the web source (loading / empty / error / stale / offline / content) inside a
/// glass widget shell, binding through `SubscriptionsModel` (P1/S8). No
/// networking lives here.
public struct SubscriptionsWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SubscriptionsWidget"

    /// Canonical registry metadata (registry/vehicle.ts → "subscriptions").
    public static let registration = DashboardWidgetRegistration(
        id: "subscriptions",
        nameKey: "widget.subscriptions.title",
        descriptionKey: "widget.subscriptions.description",
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: SubscriptionsModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SubscriptionsModel,
        size: DashboardWidgetSize = SubscriptionsWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = SubscriptionsWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — the headline-only 1-column layout.
    var isCompact: Bool {
        size.cols <= 1
    }

    var projection: SubscriptionsProjection {
        model.projection
    }

    /// Live freshness from the bound model (web `DataFreshness` connection state).
    var connection: SubscriptionsConnection {
        model.connection
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

// MARK: - Header (web WidgetShell header + freshness)

extension SubscriptionsWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "creditcard.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                SubscriptionsStrings.text("widget.subscriptions.title", "Subscriptions")
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
            label = SubscriptionsStrings.string("widget.subscriptions.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SubscriptionsStrings.string("widget.subscriptions.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SubscriptionsStrings.string("widget.subscriptions.offline", "Offline")
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
        .accessibilityLabel(SubscriptionsStrings.text("widget.subscriptions.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                SubscriptionsStrings.text("widget.subscriptions.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(SubscriptionsStrings.text("widget.subscriptions.openA11y", "Open the Subscriptions page"))
    }
}

// MARK: - Content states (web shell loading / empty + body)

extension SubscriptionsWidget {
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
            contentBody
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if isCompact {
                Spacer(minLength: 0)
                TSSkeleton(width: 48, height: 28, cornerRadius: TSRadius.sm)
                    .frame(maxWidth: .infinity, alignment: .center)
                TSSkeleton(width: 72, height: 10).frame(maxWidth: .infinity, alignment: .center)
                Spacer(minLength: 0)
            } else {
                ForEach(0 ..< 4, id: \.self) { _ in
                    HStack(spacing: TSSpacing.md) {
                        TSSkeleton(height: 12)
                        TSSkeleton(width: 64, height: 12)
                        TSSkeleton(width: 44, height: 16, cornerRadius: TSRadius.pill)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(SubscriptionsStrings.text("widget.subscriptions.loading", "Loading subscriptions"))
    }

    var emptyState: some View {
        ContentUnavailableView {
            Label {
                SubscriptionsStrings.text("widget.subscriptions.noData", "No subscriptions")
            } icon: {
                Image(systemName: "creditcard")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SubscriptionsStrings.text("widget.subscriptions.errorTitle", "Couldn't load subscriptions")
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
                SubscriptionsStrings.text("widget.subscriptions.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SubscriptionsStrings.text("widget.subscriptions.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    var connectivityBanner: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.subscriptions.offlineBanner" : "widget.subscriptions.staleBanner"
        let fallback = isOffline ? "Offline — showing last known data" : "Reconnecting — data may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SubscriptionsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
