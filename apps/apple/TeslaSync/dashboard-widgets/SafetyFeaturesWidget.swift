//
//  SafetyFeaturesWidget.swift
//  TeslaSync — P4 dashboard widget · 0083 · SafetyFeaturesWidget (Apple)
//
//  The composable Safety Features dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/SafetyFeaturesWidget.tsx. Binds through
//  `SafetyModel` (no networking in the view); renders every state and both the
//  full grid and the compact active-feature hero.
//

import Foundation
import SwiftUI

// MARK: - SafetyFeaturesWidget (the dashboard surface)

/// The composable Safety Features dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/SafetyFeaturesWidget.tsx`. Renders every state from
/// the web source (loading / empty / error / stale / offline / content) inside a
/// glass widget shell, binding through `SafetyModel` (P1/S8). The body switches
/// between the ADAS status grid (2 or 4 columns) and the compact active-feature
/// hero exactly like the web `size.cols` branches. No networking lives here.
public struct SafetyFeaturesWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SafetyFeaturesWidget"

    /// Canonical registry metadata (registry/security.ts → "safety-features").
    public static let registration = DashboardWidgetRegistration(
        id: "safety-features",
        nameKey: "widget.safety.title",
        descriptionKey: "widget.safety.description",
        category: "security",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: SafetyModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SafetyModel,
        size: DashboardWidgetSize = SafetyFeaturesWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = SafetyFeaturesWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — drives the title-less header + the
    /// active-feature hero in place of the status grid.
    private var isCompact: Bool {
        size.cols <= 1
    }

    /// Web `cols={size.cols >= 3 ? 4 : 2}` — the status-grid column count.
    private var gridColumnCount: Int {
        size.cols >= 3 ? 4 : 2
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

extension SafetyFeaturesWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.shield.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            if !isCompact {
                SafetyStrings.text("widget.safety.title", "Safety Features")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
            }
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
            label = SafetyStrings.string("widget.safety.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SafetyStrings.string("widget.safety.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SafetyStrings.string("widget.safety.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            if !isCompact {
                Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .ignore)
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
        .accessibilityLabel(SafetyStrings.text("widget.safety.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                if !isCompact {
                    SafetyStrings.text("widget.safety.open", "Open").font(Font.TS.caption)
                }
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(SafetyStrings.text("widget.safety.openA11y", "Open the Safety page"))
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
        Group {
            if isCompact {
                VStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 48, height: 34, cornerRadius: TSRadius.md)
                    TSSkeleton(width: 88, height: 10)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                LazyVGrid(columns: skeletonColumns, spacing: TSSpacing.sm) {
                    ForEach(0 ..< skeletonCount, id: \.self) { _ in
                        TSSkeleton(height: 44, cornerRadius: TSRadius.md)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(SafetyStrings.text("widget.safety.loading", "Loading safety features"))
    }

    private var skeletonColumns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.sm),
            count: gridColumnCount
        )
    }

    /// One skeleton row per eventual cell (8), rounded up to the column count.
    private var skeletonCount: Int {
        let cells = 8
        let remainder = cells % gridColumnCount
        return remainder == 0 ? cells : cells + (gridColumnCount - remainder)
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                SafetyStrings.text("widget.safety.noData", "No safety data")
            } icon: {
                Image(systemName: "exclamationmark.shield.fill")
            }
        } description: {
            SafetyStrings.text(
                "widget.safety.emptyHint",
                "Safety feature status will appear once your vehicle reports in."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SafetyStrings.text("widget.safety.errorTitle", "Couldn't load safety features")
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
                SafetyStrings.text("widget.safety.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SafetyStrings.text("widget.safety.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var loadedContent: some View {
        if isCompact {
            SafetyActiveCountHero(count: model.activeCount)
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if model.connection != .live {
                    SafetyConnectivityBanner(connection: model.connection)
                }
                SafetyStatusGrid(cells: model.cells, columnCount: gridColumnCount)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        }
    }
}
