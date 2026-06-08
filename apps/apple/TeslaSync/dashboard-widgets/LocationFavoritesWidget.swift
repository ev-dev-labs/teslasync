//
//  LocationFavoritesWidget.swift
//  TeslaSync — P4 dashboard widget · 0059 · LocationFavoritesWidget (Apple)
//
//  The composable Favorite Locations dashboard surface — the SwiftUI parity of
//  features/dashboard/widgets/LocationFavoritesWidget.tsx. Binds through
//  LocationFavoritesModel (no networking in the view); renders every state and
//  honors the same 1×2…4×40 grid envelope as the web registry. A 1-column
//  instance collapses to the compact presence badge, exactly like the source.
//

import Foundation
import SwiftUI

// MARK: - LocationFavoritesWidget (the dashboard surface)

/// The Favorite Locations dashboard widget — SwiftUI parity of
/// `features/dashboard/widgets/LocationFavoritesWidget.tsx`. Renders every state
/// from the web source (loading / empty / error / stale / offline / content)
/// inside a glass widget shell, binding through `LocationFavoritesModel`
/// (P1/S8). No networking lives here.
public struct LocationFavoritesWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "LocationFavoritesWidget"

    /// Canonical registry metadata (registry/maps.ts → "location-favorites").
    public static let registration = DashboardWidgetRegistration(
        id: "location-favorites",
        nameKey: "widget.locationFavorites.title",
        descriptionKey: "widget.locationFavorites.description",
        category: "maps",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: LocationFavoritesModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: LocationFavoritesModel,
        size: DashboardWidgetSize = LocationFavoritesWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = LocationFavoritesWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// A single-column instance collapses to the compact presence badge — the
    /// web `size.cols <= 1` branch.
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

// MARK: - Header

extension LocationFavoritesWidget {
    @ViewBuilder
    private var header: some View {
        if isCompact {
            HStack(spacing: TSSpacing.xs) {
                Spacer(minLength: 0)
                if model.phase != .loading { freshnessChip }
                refreshButton
            }
        } else {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "mappin.and.ellipse")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.chartSeriesSpeed)
                    .accessibilityHidden(true)
                LocationFavoritesStrings.text("widget.locationFavorites.title", "Favorite Locations")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: TSSpacing.sm)
                if model.phase != .loading { freshnessChip }
                refreshButton
                if onOpen != nil { openButton }
            }
        }
    }

    private var freshnessChip: some View {
        LocationFreshnessChip(connection: model.connection)
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(LocationFavoritesStrings.text("widget.locationFavorites.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                LocationFavoritesStrings.text("widget.locationFavorites.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            LocationFavoritesStrings.text("widget.locationFavorites.openA11y", "Open the favorite locations page")
        )
    }
}

// MARK: - Content states

extension LocationFavoritesWidget {
    @ViewBuilder
    private var content: some View {
        if isCompact {
            compactContent
        } else {
            fullContent
        }
    }

    @ViewBuilder
    private var compactContent: some View {
        switch model.phase {
        case .loading:
            compactLoading
        case .error:
            compactError
        case .empty, .content:
            compactBadge
        }
    }

    @ViewBuilder
    private var fullContent: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case let .error(message):
            errorState(message)
        case .empty, .content:
            loadedContent
        }
    }

    // MARK: Compact

    private var compactBadge: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: model.presence.emoji)
                .font(.system(size: 28))
                .accessibilityHidden(true)
            LocationStatusChip(presence: model.presence)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: LocationFavoritesStrings.label(for: model.presence)))
    }

    private var compactLoading: some View {
        VStack(spacing: TSSpacing.xs) {
            TSSkeleton(width: 36, height: 30, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 56, height: 16, cornerRadius: TSRadius.pill)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(
            LocationFavoritesStrings.text("widget.locationFavorites.loading", "Loading favorite locations")
        )
    }

    private var compactError: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 20))
                .foregroundStyle(Color.TS.statusDanger)
            Button {
                model.refresh()
            } label: {
                LocationFavoritesStrings.text("widget.locationFavorites.retry", "Retry")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    // MARK: Full

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            badgeRow
            if model.hasFavorites {
                LocationFavoritesRankedList(items: model.favorites)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                inlineEmptyList
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var badgeRow: some View {
        HStack(spacing: TSSpacing.sm) {
            LocationStatusBadge(presence: model.presence)
            if let destination = model.destinationName {
                HStack(spacing: 2) {
                    Image(systemName: "arrow.right")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(Color.TS.textSecondary)
                        .accessibilityHidden(true)
                    Text(verbatim: destination)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: navigatingLabel(destination)))
            }
            Spacer(minLength: 0)
        }
    }

    private var inlineEmptyList: some View {
        ContentUnavailableView {
            Label {
                LocationFavoritesStrings.text("widget.locationFavorites.noData", "No favorite locations")
            } icon: {
                Image(systemName: "mappin.slash")
            }
        } description: {
            LocationFavoritesStrings.text(
                "widget.locationFavorites.emptyHint",
                "Visited places will appear here as you drive."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 28, height: 20, cornerRadius: TSRadius.sm)
                TSSkeleton(width: 64, height: 18, cornerRadius: TSRadius.pill)
            }
            ForEach(0 ..< 4, id: \.self) { _ in
                TSSkeleton(height: 36, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(
            LocationFavoritesStrings.text("widget.locationFavorites.loading", "Loading favorite locations")
        )
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            LocationFavoritesStrings.text("widget.locationFavorites.errorTitle", "Couldn't load locations")
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
                LocationFavoritesStrings.text("widget.locationFavorites.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.locationFavorites.offlineBanner" : "widget.locationFavorites.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known places"
            : "Reconnecting — places may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            LocationFavoritesStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func navigatingLabel(_ destination: String) -> String {
        LocationFavoritesStrings.string("widget.locationFavorites.navigatingTo", "Navigating to %@")
            .replacingOccurrences(of: "%@", with: destination)
    }
}
