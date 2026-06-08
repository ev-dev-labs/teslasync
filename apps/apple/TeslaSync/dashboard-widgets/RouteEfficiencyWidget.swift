//
//  RouteEfficiencyWidget.swift
//  TeslaSync — P4 dashboard widget · 0082 · RouteEfficiencyWidget (Apple)
//
//  The composable Route Efficiency dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/RouteEfficiencyWidget.tsx. Renders every state from the
//  web source (loading / empty / error / stale / offline / content) inside a glass
//  widget shell, binding through `RouteEfficiencyModel` (P1/S8). No networking lives
//  here; the size-responsive ranked rows are derived from the model's cached routes via
//  the pure `RouteEfficiencyProjection`.
//

import Foundation
import SwiftUI

// MARK: - RouteEfficiencyWidget (the dashboard surface)

/// The composable Route Efficiency dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/RouteEfficiencyWidget.tsx`. Ranks a vehicle's recurring
/// routes by energy efficiency, tier-badged, with a wide (cols ≥ 3) best/worst suffix.
public struct RouteEfficiencyWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "RouteEfficiencyWidget"

    /// Canonical registry metadata (registry/driving.ts → "route-efficiency").
    public static let registration = DashboardWidgetRegistration(
        id: "route-efficiency",
        nameKey: "widget.routeEfficiency.title",
        descriptionKey: "widget.routeEfficiency.description",
        category: "driving",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: RouteEfficiencyModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: RouteEfficiencyModel,
        size: DashboardWidgetSize = RouteEfficiencyWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = RouteEfficiencyWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isWide = size.cols >= 3` — drives the best/worst label suffix.
    private var isWide: Bool {
        size.cols >= 3
    }

    /// The size-responsive ranked rows, re-derived from the model's cached routes (web
    /// `useMemo` + `WidgetRankedList`). Kept in the view so a resize updates the suffix.
    private var rows: [RouteEfficiencyRow] {
        RouteEfficiencyProjection.build(
            routes: model.routes,
            unit: model.unit,
            isWide: isWide,
            localize: RouteEfficiencyStrings.string
        )
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

extension RouteEfficiencyWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            RouteEfficiencyStrings.text("widget.routeEfficiency.title", "Route Efficiency")
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
            label = RouteEfficiencyStrings.string("widget.routeEfficiency.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = RouteEfficiencyStrings.string("widget.routeEfficiency.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = RouteEfficiencyStrings.string("widget.routeEfficiency.offline", "Offline")
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
        .accessibilityLabel(RouteEfficiencyStrings.text("widget.routeEfficiency.refresh", "Refresh"))
    }

    private var openButton: some View {
        let openLabel = RouteEfficiencyStrings.text("widget.routeEfficiency.openA11y", "Open the Route Efficiency page")
        return Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                RouteEfficiencyStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(openLabel)
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            RouteEfficiencyEmpty()
        case let .error(message):
            errorState(message)
        case .content:
            loadedContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 18, height: 14, cornerRadius: TSRadius.sm)
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 56, height: 18, cornerRadius: TSRadius.pill)
                    TSSkeleton(width: 64, height: 12)
                }
                .frame(minHeight: 44)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(RouteEfficiencyStrings.text("widget.routeEfficiency.loading", "Loading route efficiency"))
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                RouteEfficiencyConnectivityBanner(connection: model.connection)
            }
            let visible = rows
            if visible.isEmpty {
                RouteEfficiencyEmpty()
            } else {
                RouteEfficiencyRankedList(rows: visible)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        }
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            RouteEfficiencyStrings.text("widget.routeEfficiency.errorTitle", "Couldn't load route efficiency")
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
                RouteEfficiencyStrings.text("widget.routeEfficiency.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(RouteEfficiencyStrings.text("widget.routeEfficiency.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
