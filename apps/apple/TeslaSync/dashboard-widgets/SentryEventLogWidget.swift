//
//  SentryEventLogWidget.swift
//  TeslaSync — P4 dashboard widget · 0086 · SentryEventLogWidget (Apple)
//
//  The composable "Sentry Event Log" dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/SentryEventLogWidget.tsx. Renders every state from the
//  web source (loading / empty / error / stale / offline / content) inside a glass
//  widget shell, binding through `SentryModel` (P1/S8). No networking lives here; the
//  size-derived event limit + subtitle visibility (web `eventLimit` / `isWide`) are
//  applied here via `SentryLayout`.
//

import Foundation
import SwiftUI

// MARK: - SentryEventLogWidget (the dashboard surface)

/// The composable Sentry Event Log dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/SentryEventLogWidget.tsx`. Renders every state from the
/// web source inside a glass widget shell, binding through `SentryModel` (P1/S8).
public struct SentryEventLogWidget: View {
    @State private var model: SentryModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SentryModel,
        size: DashboardWidgetSize = SentryEventLogWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = SentryEventLogWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `eventLimit = isWide ? 10 : isTall ? 7 : 4`.
    private var eventLimit: Int {
        SentryLayout.eventLimit(for: size)
    }

    /// Web `subtitle: isWide ? subtitle : undefined`.
    private var showsSubtitle: Bool {
        SentryLayout.showsSubtitle(for: size)
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

extension SentryEventLogWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "shield.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            SentryStrings.text("widget.sentryEventLog", "Sentry Event Log")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
            if onOpen != nil { openButton }
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = SentryStrings.string("widget.sentryLive", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SentryStrings.string("widget.sentryStale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SentryStrings.string("widget.sentryOffline", "Offline")
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
        .accessibilityLabel(SentryStrings.text("widget.sentryRefresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                SentryStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(SentryStrings.text("widget.sentryOpenA11y", "Open the security page"))
    }

    // MARK: Content states

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
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 44, height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(SentryStrings.text("widget.sentryLoading", "Loading security events"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                SentryStrings.text("widget.noSentryEvents", "No security events recorded")
            } icon: {
                Image(systemName: "shield.fill")
            }
        } description: {
            SentryStrings.text(
                "widget.sentryEmptyHint",
                "Security events will appear once your vehicle reports in."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SentryStrings.text("widget.sentryErrorTitle", "Couldn't load security events")
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
                SentryStrings.text("widget.sentryRetry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SentryStrings.text("widget.sentryRetry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                SentryConnectivityBanner(connection: model.connection)
            }
            SentryEventFeed(
                items: model.feedItems,
                maxItems: eventLimit,
                showsSubtitle: showsSubtitle
            )
            .frame(maxHeight: .infinity, alignment: .top)
        }
    }
}
