//
//  GeofenceWidget.swift
//  TeslaSync — P4 dashboard widget · 0053 · GeofenceWidget (Apple)
//
//  The composable Geofence Status dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/GeofenceWidget.tsx. Renders every state from the
//  web source (loading / empty / error / stale / offline / content) inside a
//  glass widget shell, binding through `GeofenceWidgetModel` (P1/S8). No
//  networking here.
//
//  Web → native mappings:
//    • WidgetShell        → the glass panel + header (icon/title/freshness/refresh)
//    • WidgetMapView      → MapKit `Map` (web Leaflet `MapContainer`)
//    • Circle (per fence) → `MapCircle` (inside = success, else muted)
//    • Marker             → `TSAnimatedMarker` at the vehicle position
//    • Badge              → `GeofenceWidgetMembershipBadge` (Inside/Outside/Disabled)
//    • EmptyState         → `ContentUnavailableView` ("No geofences configured")
//

import MapKit
import SwiftUI

// MARK: - GeofenceWidget (the dashboard surface)

/// The composable Geofence Status dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/GeofenceWidget.tsx`. Renders every state from the
/// web source inside a glass widget shell, binding through `GeofenceWidgetModel`
/// (P1/S8). No networking lives here.
public struct GeofenceWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "GeofenceWidget"

    /// Canonical registry metadata (registry/maps.ts → "geofence-status").
    public static let registration = DashboardWidgetRegistration(
        id: "geofence-status",
        nameKey: "widget.geofence.title",
        descriptionKey: "widget.geofence.description",
        category: "maps",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: GeofenceWidgetModel
    private let size: DashboardWidgetSize

    public init(
        model: GeofenceWidgetModel,
        size: DashboardWidgetSize = GeofenceWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        self.size = GeofenceWidget.registration.clamp(size)
    }

    /// Web `isCompact = size.cols <= 1` — hides the header chrome and collapses to
    /// the icon + current-zone badge.
    private var isCompact: Bool {
        size.cols <= 1
    }

    /// Web `showMap = hasCoords && size.rows >= 3`.
    private var showMap: Bool {
        model.projection.hasVehicleCoordinate && size.rows >= 3
    }

    public var body: some View {
        VStack(spacing: 0) {
            if !isCompact {
                header
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.top, TSSpacing.md)
                    .padding(.bottom, TSSpacing.sm)
            }
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

extension GeofenceWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "scope")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            GeofenceWidgetStrings.text("widget.geofence.title", "Geofence Status")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
        }
    }

    /// Live / stale / offline freshness chip — the native parity of the web
    /// `DataFreshness` indicator the shell renders from the query state.
    private var freshnessChip: some View {
        HStack(spacing: 4) {
            Circle().fill(freshnessTone).frame(width: 6, height: 6)
            Text(verbatim: freshnessLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: freshnessLabel))
    }

    private var freshnessTone: Color {
        switch model.connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var freshnessLabel: String {
        switch model.connection {
        case .live: GeofenceWidgetStrings.string("widget.geofence.live", "Live")
        case .stale: GeofenceWidgetStrings.string("widget.geofence.stale", "Stale")
        case .offline: GeofenceWidgetStrings.string("widget.geofence.offline", "Offline")
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
        .accessibilityLabel(GeofenceWidgetStrings.text("widget.geofence.refresh", "Refresh"))
    }
}

// MARK: - Content states

extension GeofenceWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingState
        case .empty:
            if isCompact { compactZone } else { emptyState }
        case let .error(message):
            if isCompact { compactError(message) } else { errorState(message) }
        case .content:
            if isCompact { compactZone } else { standardContent }
        }
    }

    /// Skeleton chrome (web shell `loading`). Compact collapses to a spinner.
    @ViewBuilder
    private var loadingState: some View {
        if isCompact {
            ProgressView()
                .controlSize(.small)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel(GeofenceWidgetStrings.text("widget.geofence.loading", "Loading geofences"))
        } else {
            VStack(spacing: TSSpacing.sm) {
                ForEach(0 ..< 3, id: \.self) { _ in
                    HStack(spacing: TSSpacing.md) {
                        VStack(alignment: .leading, spacing: 6) {
                            TSSkeleton(width: 120, height: 12)
                            TSSkeleton(width: 80, height: 9)
                        }
                        Spacer()
                        TSSkeleton(width: 56, height: 18, cornerRadius: TSRadius.pill)
                    }
                    .frame(minHeight: 44)
                }
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .frame(maxHeight: .infinity, alignment: .top)
            .accessibilityElement()
            .accessibilityLabel(GeofenceWidgetStrings.text("widget.geofence.loading", "Loading geofences"))
        }
    }

    /// Web `EmptyState` — "No geofences configured" (never a blank box).
    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                GeofenceWidgetStrings.text("widget.geofence.noFences", "No geofences configured")
            } icon: {
                Image(systemName: "scope")
            }
        } description: {
            GeofenceWidgetStrings.text(
                "widget.geofence.emptyHint",
                "Add a geofence to track when your vehicle enters or leaves a zone."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.md)
    }

    /// The mandated error state — a `QueryError` equivalent with a retry.
    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            GeofenceWidgetStrings.text("widget.geofence.errorTitle", "Couldn't load geofences")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            retryButton
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.md)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button {
            model.refresh()
        } label: {
            GeofenceWidgetStrings.text("widget.geofence.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Compact layout (web `isCompact`)

extension GeofenceWidget {
    /// Web compact body: a centered crosshair + the current-zone badge (or the
    /// "No zone" neutral badge). Shown for both `.content` and `.empty` because
    /// the web compact branch never renders the empty state.
    private var compactZone: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "scope")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            if let zone = model.projection.currentZone {
                GeofenceWidgetMembershipBadge(text: zone.name, tone: .success)
            } else {
                GeofenceWidgetMembershipBadge(
                    text: GeofenceWidgetStrings.string("widget.geofence.noZone", "No zone"),
                    tone: .neutral
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .frame(minHeight: 44)
        .padding(TSSpacing.sm)
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(freshnessTone)
                .frame(width: 7, height: 7)
                .padding(TSSpacing.sm)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: GeofenceWidgetAccessibility.zoneSummary(model.projection)))
    }

    /// Compact error: a tappable warning glyph that retries.
    private func compactError(_: String) -> some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 20))
                .foregroundStyle(Color.TS.statusDanger)
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel(GeofenceWidgetStrings.text("widget.geofence.errorTitle", "Couldn't load geofences"))
        .accessibilityHint(GeofenceWidgetStrings.text("widget.geofence.retry", "Retry"))
    }
}

// MARK: - Standard layout (web `isCompact === false`)

extension GeofenceWidget {
    /// Web standard body: an optional map section over the scrollable fence list.
    private var standardContent: some View {
        VStack(spacing: 0) {
            if showMap {
                GeofenceWidgetMapCanvas(projection: model.projection)
                    .frame(height: 160)
                    .frame(maxWidth: .infinity)
                    .clipped()
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(
                        GeofenceWidgetStrings.text("widget.geofence.mapA11y", "Map showing configured geofence zones")
                    )
                    .accessibilityValue(Text(verbatim: GeofenceWidgetAccessibility.zoneSummary(model.projection)))
            }
            fenceList
        }
    }

    private var fenceList: some View {
        ScrollView {
            VStack(spacing: 6) {
                ForEach(model.projection.fences) { fence in
                    GeofenceWidgetFenceRow(fence: fence)
                }
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
