//
//  DoorWindowStatusWidget.swift
//  TeslaSync — P4 dashboard widget · 0037 · DoorWindowStatusWidget (Apple)
//
//  The composable Door & Window dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/DoorWindowStatusWidget.tsx. Binds through
//  `DoorWindowModel` (no networking in the view); renders every state.
//

import Foundation
import SwiftUI

// MARK: - DoorWindowStatusWidget (the dashboard surface)

/// The composable Door & Window dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/DoorWindowStatusWidget.tsx`. Renders every state
/// from the web source (loading / empty / error / stale / offline / content)
/// inside a glass widget shell, binding through `DoorWindowModel` (P1/S8). No
/// networking lives here.
public struct DoorWindowStatusWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "DoorWindowStatusWidget"

    /// Canonical registry metadata (registry/security.ts → "door-window-status").
    public static let registration = DashboardWidgetRegistration(
        id: "door-window-status",
        nameKey: "widget.doorWindow.title",
        descriptionKey: "widget.doorWindow.description",
        category: "security",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: DoorWindowModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: DoorWindowModel,
        size: DashboardWidgetSize = DoorWindowStatusWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = DoorWindowStatusWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols === 1 && size.rows === 1`. With the registry's
    /// `minSize.rows == 2` the dashboard never hands the surface a 1×1 footprint,
    /// so this matches the web's effective behavior (the compact badge row stays
    /// available + tested for the smallest footprint a host could request).
    private var isCompact: Bool {
        size.cols == 1 && size.rows == 1
    }

    /// Web `isTall = size.rows >= 2` — the larger inter-section gap.
    private var isTall: Bool {
        size.rows >= 2
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

extension DoorWindowStatusWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "door.left.hand.open")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            if !isCompact {
                DoorWindowStrings.text("widget.doorWindow.title", "Door & Window Status")
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
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = DoorWindowStrings.string("widget.doorWindowLive", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = DoorWindowStrings.string("widget.doorWindowStale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = DoorWindowStrings.string("widget.doorWindowOffline", "Offline")
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
        .accessibilityLabel(DoorWindowStrings.text("widget.doorWindowRefresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                DoorWindowStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(DoorWindowStrings.text("widget.doorWindowOpenA11y", "Open the Security page"))
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            DoorWindowEmptyGrid()
        case let .error(message):
            errorState(message)
        case .content:
            loadedContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: isTall ? TSSpacing.md : TSSpacing.sm) {
            ForEach(0 ..< 2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSSkeleton(width: 56, height: 10)
                    LazyVGrid(columns: Self.gridColumns, spacing: TSSpacing.sm) {
                        ForEach(0 ..< 4, id: \.self) { _ in
                            TSSkeleton(height: 44, cornerRadius: TSRadius.md)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(DoorWindowStrings.text("widget.doorWindowLoading", "Loading door & window status"))
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            DoorWindowStrings.text("widget.doorWindowErrorTitle", "Couldn't load door & window status")
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
                DoorWindowStrings.text("widget.doorWindowRetry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(DoorWindowStrings.text("widget.doorWindowRetry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: isTall ? TSSpacing.md : TSSpacing.sm) {
            if model.connection != .live {
                DoorWindowConnectivityBanner(connection: model.connection)
            }
            if isCompact {
                DoorWindowCompactBadges(
                    openDoorCount: model.projection.openDoorCount,
                    openWindowCount: model.projection.openWindowCount
                )
            } else {
                DoorWindowSection(
                    titleKey: "widget.doorWindow.doors",
                    titleFallback: "Doors",
                    cells: model.projection.doorCells
                )
                DoorWindowSection(
                    titleKey: "widget.doorWindow.windows",
                    titleFallback: "Windows",
                    cells: model.projection.windowCells
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    /// The fixed two-column grid (web passes `cols={2}` unconditionally).
    static let gridColumns: [GridItem] = [
        GridItem(.flexible(), spacing: TSSpacing.sm),
        GridItem(.flexible(), spacing: TSSpacing.sm)
    ]
}
