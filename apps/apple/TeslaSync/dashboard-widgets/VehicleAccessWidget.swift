//
//  VehicleAccessWidget.swift
//  TeslaSync — P4 dashboard widget · 0106 · VehicleAccessWidget (Apple)
//
//  The composable Vehicle Access dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/VehicleAccessWidget.tsx. Binds through `VehicleAccessModel` (no
//  networking in the view); renders every state from the web source (loading / empty / error /
//  stale / offline / content) inside a glass widget shell, in both the compact (single-line, web
//  `CompactView`) and full (web `StandardView`) layouts the web `isCompact = size.cols <= 1`
//  selects.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension VehicleAccessStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - VehicleAccessWidget (the dashboard surface)

/// The composable Vehicle Access dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/VehicleAccessWidget.tsx`. Renders every state from the web source
/// (loading / empty / error / stale / offline / content) inside a glass widget shell, binding
/// through `VehicleAccessModel` (P1/S8). No networking lives here.
public struct VehicleAccessWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VehicleAccessSurface.slug

    /// Canonical registry metadata (registry/security.ts → "vehicle-access").
    public static let registration = VehicleAccessSurface.registration

    @State private var model: VehicleAccessModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: VehicleAccessModel,
        size: DashboardWidgetSize = VehicleAccessWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = VehicleAccessWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — swaps the full standard card for the single-line summary
    /// and hides the `WidgetShell` title + icon.
    var isCompact: Bool {
        VehicleAccessLayout.isCompact(size)
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
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("widget.vehicleAccess")
    }
}

// MARK: - Header (web `WidgetShell` chrome)

extension VehicleAccessWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "person.2.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                VehicleAccessStrings.text("widget.vehicleAccess", "Vehicle Access")
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
        HStack(spacing: 4) {
            Circle().fill(freshnessTone).frame(width: 6, height: 6)
            Text(verbatim: freshnessLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if !isCompact, let updatedAt = model.updatedAt {
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(updatedAt, style: .relative)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: freshnessLabel))
    }

    /// Freshness tone, matching the web `DataFreshness` four-state chip (fetching / error / stale /
    /// fresh) plus the P4-core offline state, in that precedence.
    private var freshnessTone: Color {
        if model.isFetching { return Color.TS.accent }
        if model.isError { return Color.TS.statusDanger }
        switch model.connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.textMuted
        }
    }

    private var freshnessLabel: String {
        if model.isFetching {
            return VehicleAccessStrings.string("widget.vehicleAccess.updating", "Updating")
        }
        if model.isError {
            return VehicleAccessStrings.string("widget.vehicleAccess.error", "Error")
        }
        switch model.connection {
        case .live: return VehicleAccessStrings.string("widget.vehicleAccess.live", "Live")
        case .stale: return VehicleAccessStrings.string("widget.vehicleAccess.stale", "Stale")
        case .offline: return VehicleAccessStrings.string("widget.vehicleAccess.offline", "Offline")
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
        .accessibilityLabel(VehicleAccessStrings.text("widget.vehicleAccess.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                VehicleAccessStrings.text("widget.vehicleAccess.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            VehicleAccessStrings.text("widget.vehicleAccess.openA11y", "Open the vehicle access page")
        )
    }
}

// MARK: - Content states (web shell `loading` / `error` + body `CompactView` / `StandardView`)

extension VehicleAccessWidget {
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
            loadedContent(model.projection)
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack {
                    TSSkeleton(width: 110, height: 9, cornerRadius: TSRadius.sm)
                    Spacer(minLength: TSSpacing.md)
                    TSSkeleton(width: 54, height: 14, cornerRadius: TSRadius.sm)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(
            VehicleAccessStrings.text("widget.vehicleAccess.loading", "Loading vehicle access")
        )
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                VehicleAccessStrings.text("widget.vehicleAccessNoData", "No access data available")
            } icon: {
                Image(systemName: "person.2.slash")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: VehicleAccessAccessibility.emptySummary()))
        .accessibilityIdentifier("widget.vehicleAccess.empty")
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            VehicleAccessStrings.text("widget.vehicleAccess.errorTitle", "Couldn't load vehicle access")
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
                VehicleAccessStrings.text("widget.vehicleAccess.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(VehicleAccessStrings.text("widget.vehicleAccess.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("widget.vehicleAccess.error")
    }

    /// The loaded body, dispatching to the web `CompactView` (single line) or `StandardView` (mobile
    /// row + driver / invitation sections) by the `isCompact = size.cols <= 1` rule. Lives in the
    /// surface file so it can read the private `model`; the leaf rows + chips are standalone structs
    /// in VehicleAccessWidget.Content.swift.
    @ViewBuilder
    private func loadedContent(_ projection: VehicleAccessProjection) -> some View {
        if isCompact {
            VehicleAccessCompactView(projection: projection)
                .accessibilityIdentifier("widget.vehicleAccess.content")
        } else {
            VehicleAccessStandardView(projection: projection, connection: model.connection)
                .accessibilityIdentifier("widget.vehicleAccess.content")
        }
    }
}
