//
//  SecurityStatusWidget.swift
//  TeslaSync — P4 dashboard widget · 0085 · SecurityStatusWidget (Apple)
//
//  The composable Security dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/SecurityStatusWidget.tsx. Binds through
//  `SecurityModel` (no networking in the view); renders every state.
//

import Foundation
import SwiftUI

// MARK: - SecurityStatusWidget (the dashboard surface)

/// The composable Security dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/SecurityStatusWidget.tsx`. Renders every state from
/// the web source (loading / empty / error / stale / offline / content) inside a
/// glass widget shell, binding through `SecurityModel` (P1/S8). No networking
/// lives here.
public struct SecurityStatusWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SecurityStatusWidget"

    /// Canonical registry metadata (registry/security.ts → "security-status").
    public static let registration = DashboardWidgetRegistration(
        id: "security-status",
        nameKey: "widget.security",
        descriptionKey: "widget.security.description",
        category: "security",
        defaultSize: DashboardWidgetSize(cols: 1, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 2, rows: 40)
    )

    @State private var model: SecurityModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SecurityModel,
        size: DashboardWidgetSize = SecurityStatusWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = SecurityStatusWidget.registration.clamp(size)
        self.onOpen = onOpen
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

extension SecurityStatusWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "shield.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            SecurityStrings.text("widget.security", "Security")
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
            label = SecurityStrings.string("widget.securityLive", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SecurityStrings.string("widget.securityStale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SecurityStrings.string("widget.securityOffline", "Offline")
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
        .accessibilityLabel(SecurityStrings.text("widget.securityRefresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                SecurityStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(SecurityStrings.text("widget.securityOpenA11y", "Open the Security page"))
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
            LazyVGrid(columns: Self.gridColumns, spacing: TSSpacing.sm) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 44, cornerRadius: TSRadius.md)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(SecurityStrings.text("widget.securityLoading", "Loading security status"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                SecurityStrings.text("widget.noSecurity", "No security data")
            } icon: {
                Image(systemName: "shield.fill")
            }
        } description: {
            SecurityStrings.text(
                "widget.securityEmptyHint",
                "Security status will appear once your vehicle reports in."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SecurityStrings.text("widget.securityErrorTitle", "Couldn't load security status")
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
                SecurityStrings.text("widget.securityRetry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SecurityStrings.text("widget.securityRetry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                SecurityConnectivityBanner(connection: model.connection)
            }
            SecurityStatusGrid(cells: model.cells)
                .frame(maxHeight: .infinity, alignment: .top)
        }
    }

    /// The fixed two-column grid (web passes `cols={2}` unconditionally).
    static let gridColumns: [GridItem] = [
        GridItem(.flexible(), spacing: TSSpacing.sm),
        GridItem(.flexible(), spacing: TSSpacing.sm)
    ]
}
