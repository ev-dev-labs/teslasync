//
//  LiveTelemetryPanels.Views.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  The live-section chrome composed by `LiveTelemetryPanels`: the live indicator dot, the
//  "Live Telemetry" header (+ freshness chip + refresh), the connectivity banner, the
//  responsive panel grid + its loading skeleton, and the surface-level empty / error
//  states. The reusable panel primitives live in LiveTelemetryPanels.Primitives.swift.
//

import SwiftUI

// MARK: - Live indicator dot (web `animate-ping` pulse)

/// The section's live indicator (web pulsing green dot). Tone tracks connectivity (live →
/// success + pulse, stale → warning, offline → muted) and the pulse honors Reduce Motion.
struct LTPLiveDot: View {
    let connection: LiveTelemetryPanelsConnection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var animates: Bool {
        connection == .live && !reduceMotion
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(tone.opacity(0.55))
                .frame(width: 12, height: 12)
                .scaleEffect(animates && pulsing ? 1.6 : 1)
                .opacity(animates && pulsing ? 0 : 0.6)
            Circle().fill(tone).frame(width: 8, height: 8)
        }
        .frame(width: 14, height: 14)
        .onAppear {
            guard animates else { return }
            withAnimation(.easeOut(duration: 1.1).repeatForever(autoreverses: false)) { pulsing = true }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Section header (web FadeIn live header)

/// The "Live Telemetry" header: the live dot + the title + (when not live / fetching) the
/// freshness chip + a refresh affordance.
struct LTPHeader: View {
    let connection: LiveTelemetryPanelsConnection
    let isFetching: Bool
    let showsChip: Bool
    let ageLabel: String
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            LTPLiveDot(connection: connection)
            LiveTelemetryPanelsStrings.text("common.liveTelemetry", "Live Telemetry")
                .font(Font.TS.title)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if showsChip {
                LTPFreshnessChip(connection: connection, isFetching: isFetching, ageLabel: ageLabel)
            }
            refreshButton
        }
    }

    private var refreshButton: some View {
        Button(action: onRefresh) {
            Image(systemName: "arrow.clockwise").font(.system(size: 12, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(LiveTelemetryPanelsStrings.text("liveTelemetry.refresh", "Refresh"))
    }
}

// MARK: - Freshness chip + connectivity banner (ADR-013 live-state)

/// The freshness chip: a tinted dot, a localized status word, and the relative age. Shown
/// only while stale / offline / fetching so the live header stays chrome-free.
struct LTPFreshnessChip: View {
    let connection: LiveTelemetryPanelsConnection
    let isFetching: Bool
    let ageLabel: String

    private var tone: Color {
        if isFetching { return Color.TS.accent }
        switch connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.statusDanger
        }
    }

    private var label: String {
        if isFetching {
            return LiveTelemetryPanelsStrings.string("liveTelemetry.updating", "Updating")
        }
        let word: String = switch connection {
        case .live: LiveTelemetryPanelsStrings.string("liveTelemetry.live", "Live")
        case .stale: LiveTelemetryPanelsStrings.string("liveTelemetry.stale", "Stale")
        case .offline: LiveTelemetryPanelsStrings.string("liveTelemetry.offline", "Offline")
        }
        return "\(word) · \(ageLabel)"
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(LiveTelemetryPanelsStrings.text("liveTelemetry.freshness.label", "Data freshness"))
        .accessibilityValue(Text(verbatim: label))
    }
}

/// The stale / offline banner above the grid (web reconnecting / offline treatment).
struct LTPConnectivityBanner: View {
    let connection: LiveTelemetryPanelsConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var label: String {
        isOffline
            ? LiveTelemetryPanelsStrings.string("liveTelemetry.offlineBanner", "Offline — showing last known data")
            : LiveTelemetryPanelsStrings.string("liveTelemetry.staleBanner", "Reconnecting — data may be stale")
    }

    var body: some View {
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: label).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Responsive grid (web `grid-cols-1 lg:grid-cols-2 gap-6`)

/// The seven-panel responsive grid: one column on compact widths, two on wider layouts.
/// Each panel fades in with a staggered delay (web per-panel `FadeIn`).
struct LTPGrid: View {
    let projection: LiveTelemetryPanelsProjection

    private let columns = [GridItem(.adaptive(minimum: 320), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
            TSFadeIn(delay: 0.02) { LTPPowertrainPanelView(projection: projection.powertrain) }
            TSFadeIn(delay: 0.04) { LTPClimatePanelView(projection: projection.climate) }
            TSFadeIn(delay: 0.06) { LTPSecurityPanelView(projection: projection.security) }
            TSFadeIn(delay: 0.08) { LTPVehicleStatePanelView(projection: projection.vehicleState) }
            TSFadeIn(delay: 0.10) { LTPTirePanelView(projection: projection.tire) }
            TSFadeIn(delay: 0.12) { LTPEnergyChargingPanelView(projection: projection.energyCharging) }
            TSFadeIn(delay: 0.14) { LTPMediaNavPanelView(projection: projection.mediaNav) }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf contract)

/// The initial-fetch skeleton: panel-shaped skeletons in the same responsive grid.
struct LTPLoadingGrid: View {
    private let columns = [GridItem(.adaptive(minimum: 320), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
            ForEach(0 ..< 7, id: \.self) { _ in
                TSSkeleton(height: 240, cornerRadius: TSRadius.lg)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(LiveTelemetryPanelsStrings.text("liveTelemetry.loading", "Loading live telemetry"))
    }
}

/// The surface-level empty state — no telemetry at all (web never shows a blank section).
struct LTPSectionEmptyView: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(LiveTelemetryPanelsStrings.string(
                "liveTelemetry.empty.title",
                "No live telemetry"
            )),
            message: LocalizedStringKey(
                LiveTelemetryPanelsStrings.string(
                    "liveTelemetry.empty.message",
                    "Live signals will appear here once the vehicle is awake"
                )
            ),
            systemImage: "antenna.radiowaves.left.and.right"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xl)
    }
}

/// The parent-query failure state with a retry affordance (web `QueryError`).
struct LTPSectionErrorView: View {
    let onRetry: () -> Void

    var body: some View {
        TSQueryError(
            message: LocalizedStringKey(LiveTelemetryPanelsStrings.string(
                "liveTelemetry.error.message",
                "Couldn't load live telemetry"
            )),
            onRetry: onRetry
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xl)
    }
}
