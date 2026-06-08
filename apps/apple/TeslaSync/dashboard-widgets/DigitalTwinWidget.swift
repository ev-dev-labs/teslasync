//
//  DigitalTwinWidget.swift
//  TeslaSync — P4 dashboard widget · 0036 · DigitalTwinWidget (Apple)
//
//  The composable Digital Twin dashboard surface — SwiftUI parity of features/dashboard/widgets/DigitalTwinWidget.tsx.
//  Binds through DigitalTwinModel (no networking in the view); renders every state.
//

import Foundation
import SwiftUI

// MARK: - DigitalTwinWidget (the dashboard surface)

/// The composable Digital Twin dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/DigitalTwinWidget.tsx`. Renders every state from
/// the web source (loading / empty / error / stale / offline / content) inside a
/// glass widget shell, binding through `DigitalTwinModel` (P1/S8). No networking
/// lives here.
public struct DigitalTwinWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "DigitalTwinWidget"

    /// Canonical registry metadata (registry/vehicle.ts → "vehicle-twin").
    public static let registration = DashboardWidgetRegistration(
        id: "vehicle-twin",
        nameKey: "widget.digitalTwin",
        descriptionKey: "widget.digitalTwin.description",
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 3, rows: 40)
    )

    @State private var model: DigitalTwinModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: DigitalTwinModel,
        size: DashboardWidgetSize = DigitalTwinWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = DigitalTwinWidget.registration.clamp(size)
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

extension DigitalTwinWidget {
    // MARK: Header

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "display")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesPower)
                .accessibilityHidden(true)
            DigitalTwinStrings.text("widget.digitalTwin", "Digital Twin")
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
            label = DigitalTwinStrings.string("widget.twin.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = DigitalTwinStrings.string("widget.twin.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = DigitalTwinStrings.string("widget.twin.offline", "Offline")
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
        .accessibilityLabel(DigitalTwinStrings.text("widget.twin.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                DigitalTwinStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(DigitalTwinStrings.text("widget.twin.openA11y", "Open the Digital Twin page"))
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
            twinContent
        }
    }

    private var loadingChrome: some View {
        VStack(spacing: TSSpacing.sm) {
            TSSkeleton(height: 8, cornerRadius: TSRadius.sm).frame(width: 90)
            TSSkeleton(height: 140, cornerRadius: TSRadius.lg)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            HStack(spacing: TSSpacing.xs) {
                ForEach(0 ..< 3, id: \.self) { _ in
                    TSSkeleton(width: 54, height: 18, cornerRadius: TSRadius.pill)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(DigitalTwinStrings.text("widget.twin.loading", "Loading vehicle state"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                DigitalTwinStrings.text("widget.noVehicle", "No vehicle data")
            } icon: {
                Image(systemName: "display")
            }
        } description: {
            DigitalTwinStrings.text("widget.twin.emptyHint", "Connect a vehicle to see its live state.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            DigitalTwinStrings.text("widget.twin.errorTitle", "Couldn't load vehicle state")
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
                DigitalTwinStrings.text("widget.twin.retry", "Retry")
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

    private var twinContent: some View {
        VStack(spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            VehicleTwinView(
                state: model.twin,
                size: DigitalTwinModel.twinSize(for: size),
                driveIn: true,
                exteriorColor: model.vehicle?.exteriorColor
            )
            .frame(maxHeight: .infinity)
            badgeRow
            if let name = model.vehicle?.primaryName, !name.isEmpty {
                Text(verbatim: name)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.twin.offlineBanner" : "widget.twin.staleBanner"
        let fallback = isOffline ? "Offline — showing last known state" : "Reconnecting — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            DigitalTwinStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    // MARK: Badge row (web `Badge` row)

    private var badgeRow: some View {
        TwinFlowLayout(spacing: 6) {
            lockBadge
            windowBadge
            if model.twin.isDriving {
                TwinBadge(tone: .info, label: DigitalTwinStrings.string("widget.driving", "Driving"), showsDot: true)
            }
            if model.twin.isCharging {
                TwinBadge(tone: .info, label: DigitalTwinStrings.string("widget.charging", "Charging"), showsDot: true)
            }
            if model.twin.sentryMode == true {
                TwinBadge(tone: .warning, label: DigitalTwinStrings.string("widget.sentryOn", "Sentry"), showsDot: true)
            }
            if model.twin.headlights == true {
                TwinBadge(
                    tone: .neutral,
                    label: DigitalTwinStrings.string("widget.headlightsOn", "Lights On"),
                    showsDot: true
                )
            }
            if model.twin.hazards == true {
                TwinBadge(
                    tone: .warning,
                    label: DigitalTwinStrings.string("widget.hazardsOn", "Hazards"),
                    showsDot: true
                )
            }
            if model.twin.openDoorCount > 0 {
                TwinBadge(
                    tone: .warning,
                    label: DigitalTwinStrings.count(
                        "widget.doorsOpenCount",
                        "%lld Doors Open",
                        model.twin.openDoorCount
                    )
                )
            }
            if model.twin.frunkOpen == true {
                TwinBadge(tone: .warning, label: DigitalTwinStrings.string("widget.frunkOpen", "Frunk Open"))
            }
            if model.twin.trunkOpen == true {
                TwinBadge(tone: .warning, label: DigitalTwinStrings.string("widget.trunkOpen", "Trunk Open"))
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var lockBadge: some View {
        let locked = model.twin.locked
        let tone: TSTone = locked == nil ? .neutral : (locked == true ? .success : .danger)
        let label: String = switch locked {
        case true?: DigitalTwinStrings.string("widget.locked", "Locked")
        case false?: DigitalTwinStrings.string("widget.unlocked", "Unlocked")
        case nil: DigitalTwinStrings.string("widget.lockUnknown", "Lock Unknown")
        }
        return TwinBadge(tone: tone, label: label, systemImage: locked == false ? "lock.open.fill" : "lock.fill")
    }

    private var windowBadge: some View {
        let twin = model.twin
        let tone: TSTone = !twin.hasWindowData ? .neutral : (twin.openWindowCount == 0 ? .success : .warning)
        let label: String = if !twin.hasWindowData {
            DigitalTwinStrings.string("widget.windowsUnknown", "Windows Unknown")
        } else if twin.openWindowCount == 0 {
            DigitalTwinStrings.string("widget.windowsClosed", "Windows Closed")
        } else {
            DigitalTwinStrings.count("widget.windowsOpenCount", "%lld Open", twin.openWindowCount)
        }
        return TwinBadge(tone: tone, label: label)
    }
}
