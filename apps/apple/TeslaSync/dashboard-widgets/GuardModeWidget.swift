//
//  GuardModeWidget.swift
//  TeslaSync — P4 dashboard widget · 0054 · GuardModeWidget (Apple)
//
//  The composable Guard Mode dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/GuardModeWidget.tsx. Binds through `GuardModel`
//  (no networking in the view); renders every state.
//

import Foundation
import SwiftUI

// MARK: - GuardModeWidget (the dashboard surface)

/// The composable Guard Mode dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/GuardModeWidget.tsx`. Renders every state from the
/// web source (loading / empty / error / stale / offline / content) inside a glass
/// widget shell, binding through `GuardModel` (P1/S8). No networking lives here.
public struct GuardModeWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "GuardModeWidget"

    /// Canonical registry metadata (registry/security.ts → "guard-mode").
    public static let registration = DashboardWidgetRegistration(
        id: "guard-mode",
        nameKey: "widget.guardMode",
        descriptionKey: "widget.guardMode.description",
        category: "security",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: GuardModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: GuardModel,
        size: DashboardWidgetSize = GuardModeWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = GuardModeWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1`.
    private var isCompact: Bool {
        size.cols <= 1
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

extension GuardModeWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "shield.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            GuardStrings.text("widget.guardMode", "Guard Mode")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
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
            label = GuardStrings.string("widget.guardLive", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = GuardStrings.string("widget.guardStale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = GuardStrings.string("widget.guardOffline", "Offline")
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
        .accessibilityLabel(GuardStrings.text("widget.guardRefresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                GuardStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(GuardStrings.text("widget.guardOpenA11y", "Open the Guard Mode page"))
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
            HStack {
                TSSkeleton(width: 96, height: 16, cornerRadius: TSRadius.sm)
                Spacer()
                TSSkeleton(width: 48, height: 18, cornerRadius: TSRadius.pill)
            }
            ForEach(0 ..< 3, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 44, height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(GuardStrings.text("widget.guardLoading", "Loading guard status"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                GuardStrings.text("widget.noGuardData", "No guard data")
            } icon: {
                Image(systemName: "shield.fill")
            }
        } description: {
            GuardStrings.text("widget.guardEmptyHint", "Guard data will appear once your vehicle reports in.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            GuardStrings.text("widget.guardErrorTitle", "Couldn't load guard status")
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
                GuardStrings.text("widget.guardRetry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(GuardStrings.text("widget.guardRetry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                GuardConnectivityBanner(connection: model.connection)
            }
            if isCompact {
                GuardCompactRow(status: model.status)
            } else {
                GuardStatusCard(status: model.status)
                GuardEventFeed(items: model.feedItems, maxItems: 5)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        }
    }
}
