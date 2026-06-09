//
//  SafetyHistoryWidget.swift
//  TeslaSync — P4 dashboard widget · 0084 · SafetyHistoryWidget (Apple)
//
//  The composable "Safety History" dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/SafetyHistoryWidget.tsx. Renders every state from the
//  web source (loading / empty / error / stale / offline / content) inside a glass
//  widget shell, binding through `SafetyModel` (P1/S8). No networking lives here; the
//  size-derived compact gate (web `isCompact = size.cols <= 1`) is applied here via
//  `SafetyLayout`.
//

import Foundation
import SwiftUI

// MARK: - SafetyHistoryWidget (the dashboard surface)

/// The composable Safety History dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/SafetyHistoryWidget.tsx`. Renders every state from the
/// web source inside a glass widget shell, binding through `SafetyModel` (P1/S8).
public struct SafetyHistoryWidget: View {
    @State private var model: SafetyModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SafetyModel,
        size: DashboardWidgetSize = SafetyHistoryWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = SafetyHistoryWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — the single-line summary layout.
    private var isCompact: Bool {
        SafetyLayout.isCompact(for: size)
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

extension SafetyHistoryWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.octagon.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SafetyStrings.text("widget.safetyHistory", "Safety History")
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
            label = SafetyStrings.string("widget.safetyLive", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SafetyStrings.string("widget.safetyStale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SafetyStrings.string("widget.safetyOffline", "Offline")
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
        .accessibilityLabel(SafetyStrings.text("widget.safetyRefresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                SafetyStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(SafetyStrings.text("widget.safetyOpenA11y", "Open the safety page"))
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
            if !isCompact {
                HStack(spacing: TSSpacing.sm) {
                    ForEach(0 ..< 3, id: \.self) { _ in
                        TSSkeleton(height: 44, cornerRadius: TSRadius.md)
                    }
                }
            }
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
        .accessibilityLabel(SafetyStrings.text("widget.safetyLoading", "Loading safety events"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                SafetyStrings.text("widget.noSafetyEvents", "No safety events")
            } icon: {
                Image(systemName: "exclamationmark.octagon")
            }
        } description: {
            SafetyStrings.text(
                "widget.safetyEmptyHint",
                "Safety events will appear once your vehicle reports an ADAS event."
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
            SafetyStrings.text("widget.safetyErrorTitle", "Couldn't load safety events")
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
                SafetyStrings.text("widget.safetyRetry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SafetyStrings.text("widget.safetyRetry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var loadedContent: some View {
        if isCompact {
            SafetyCompactView(stats: model.stats)
                .frame(maxHeight: .infinity, alignment: .top)
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if model.connection != .live {
                    SafetyConnectivityBanner(connection: model.connection)
                }
                SafetyStatsRow(stats: model.stats)
                SafetyEventFeed(items: model.feedItems, maxItems: SafetyLayout.feedMaxItems)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        }
    }
}
