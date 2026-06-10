//
//  ServiceHealthSection.Views.swift
//  TeslaSync — P4 feature view · 0252 · ServiceHealthSection (Apple)
//
//  The presentational subviews composed by `ServiceHealthSection`: the i18n /
//  tone bridges, the header badge cluster (Enabled/Disabled + "{n} streaming"), the
//  freshness chip + connectivity banner, the four-tile metric grid (Mode · Vehicles
//  Connected · Total Signals · Avg Signals/s), and the loading / empty / error
//  chrome. All consume the P1/S10 facade and the shared P1/S9 tokens — no networking,
//  no Tailwind ports, no raw hex. The vehicle table lives in `.Table`.
//

import SwiftUI

// MARK: - Localization bridge (SwiftUI layer over the P1/S10 facade)

extension ServiceHealthStrings {
    /// The `LocalizedStringKey` convenience for shared components that take one
    /// (`TSBadge`, `TSColumn`, `TSStatCard`, `TSEmptyState`); the resolved string is
    /// not a main-catalog key, so SwiftUI renders it verbatim.
    static func key(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(string(key, fallback))
    }
}

// MARK: - Tone bridge (pure `ServiceHealthTone` → shared `TSTone` tokens)

extension ServiceHealthTone {
    /// Maps the view-free tone to the shared design-token tone (web semantic colour,
    /// not literal hex).
    var tsTone: TSTone {
        switch self {
        case .neutral: .neutral
        case .success: .success
        case .info: .info
        }
    }
}

// MARK: - Responsive grid (web `cols={{ default: 2, md: 4 }}`)

/// A two-or-four column metric grid — two columns on compact iPhone width, four on
/// regular width / macOS, mirroring the web `Grid` breakpoints.
private struct ServiceHealthGrid<Content: View>: View {
    @ViewBuilder let content: () -> Content

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var columnCount: Int {
            horizontalSizeClass == .compact ? 2 : 4
        }
    #else
        private var columnCount: Int {
            4
        }
    #endif

    var body: some View {
        LazyVGrid(
            columns: Array(
                repeating: GridItem(.flexible(), spacing: TSSpacing.md, alignment: .top),
                count: columnCount
            ),
            alignment: .leading,
            spacing: TSSpacing.md,
            content: content
        )
    }
}

// MARK: - Header badges (web Enabled/Disabled + "{n} streaming" cluster)

/// The accordion header badges — the Enabled / Disabled state badge (web success vs
/// neutral) and the "{streamingCount} streaming" badge (web info), shown only when a
/// populated snapshot is on screen.
struct ServiceHealthHeaderBadges: View {
    let resolved: ServiceHealthResolved

    private var enabledKey: String {
        resolved.enabled ? "Enabled" : "Disabled"
    }

    private var enabledTone: TSTone {
        resolved.enabled ? .success : .neutral
    }

    private var streamingText: String {
        "\(resolved.streamingCount) \(ServiceHealthStrings.string("streaming", "streaming"))"
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            TSStatusPill(ServiceHealthStrings.key(enabledKey, enabledKey), tone: enabledTone)
                .accessibilityLabel(Text(verbatim: ServiceHealthStrings.string(enabledKey, enabledKey)))
            TSBadge(LocalizedStringKey(streamingText), tone: .info)
                .accessibilityLabel(Text(verbatim: streamingText))
        }
    }
}

// MARK: - Freshness chip + connectivity banner (P4 leaf chrome)

/// The feed freshness chip (stale / offline) — a coloured dot + label, invisible
/// while live so the normal header matches the web (which has no freshness concept).
struct ServiceHealthFreshnessChip: View {
    let connection: ServiceHealthConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
        let symbol: String
    }

    var body: some View {
        if let descriptor = Self.descriptor(for: connection) {
            HStack(spacing: 4) {
                Image(systemName: descriptor.symbol)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(descriptor.tone)
                Text(verbatim: ServiceHealthStrings.string(descriptor.key, descriptor.fallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(descriptor.tone.opacity(0.12), in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: ServiceHealthStrings.string(descriptor.key, descriptor.fallback)))
        }
    }

    private static func descriptor(for connection: ServiceHealthConnection) -> Descriptor? {
        switch connection {
        case .live:
            nil
        case .stale:
            Descriptor(
                tone: Color.TS.statusWarning,
                key: "serviceHealth.stale",
                fallback: "Stale",
                symbol: "clock.arrow.circlepath"
            )
        case .offline:
            Descriptor(
                tone: Color.TS.textMuted,
                key: "serviceHealth.offline",
                fallback: "Offline",
                symbol: "wifi.slash"
            )
        }
    }
}

/// The stale / offline banner shown above the content when the bound source is not
/// live, so a cached telemetry snapshot stays visible and clearly labeled.
struct ServiceHealthConnectivityBanner: View {
    let connection: ServiceHealthConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var label: String {
        isOffline
            ? ServiceHealthStrings.string(
                "serviceHealth.offlineBanner",
                "Offline — showing last known telemetry"
            )
            : ServiceHealthStrings.string(
                "serviceHealth.staleBanner",
                "Reconnecting — telemetry may be out of date"
            )
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content (web non-loading render: metric grid + vehicle table)

/// The resolved panel body — the four-tile metric grid over the streaming-vehicle
/// table (web `space-y-4`).
struct ServiceHealthContent: View {
    let resolved: ServiceHealthResolved

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ServiceHealthMetricGrid(resolved: resolved)
            ServiceHealthVehicleTable(vehicles: resolved.vehicles)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The four metric tiles (web `MetricCard`s: Mode · Vehicles Connected · Total
/// Signals · Avg Signals/s), each carrying the web lucide icon as its SF Symbol.
struct ServiceHealthMetricGrid: View {
    let resolved: ServiceHealthResolved

    private var modeValue: String {
        resolved.mode.isEmpty ? ServiceHealthDisplay.emDash : resolved.mode
    }

    var body: some View {
        ServiceHealthGrid {
            TSStatCard(
                title: ServiceHealthStrings.key("Mode", "Mode"),
                value: modeValue,
                systemImage: "dot.radiowaves.left.and.right"
            )
            TSStatCard(
                title: ServiceHealthStrings.key("Vehicles Connected", "Vehicles Connected"),
                value: "\(resolved.streamingCount)",
                systemImage: "antenna.radiowaves.left.and.right"
            )
            TSStatCard(
                title: ServiceHealthStrings.key("Total Signals", "Total Signals"),
                value: ServiceHealthFormat.int(resolved.totalSignals),
                systemImage: "bolt.fill"
            )
            TSStatCard(
                title: ServiceHealthStrings.key("Avg Signals/s", "Avg Signals/s"),
                value: resolved.avgSignalsPerSecond,
                systemImage: "chart.line.uptrend.xyaxis"
            )
        }
    }
}

// MARK: - Loading / empty / error chrome (web Skeleton / EmptyState / QueryError)

/// The initial-fetch chrome — the web single `<Skeleton className="h-48"/>` block.
struct ServiceHealthLoadingView: View {
    var body: some View {
        TSSkeleton(height: 192, cornerRadius: TSRadius.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: ServiceHealthStrings.string(
                "serviceHealth.loadingA11y",
                "Loading service health"
            )))
    }
}

/// The resolved-but-empty state — the web `!data` `EmptyState` ("No telemetry data
/// available"). Never a blank box.
struct ServiceHealthEmptyView: View {
    var body: some View {
        TSEmptyState(
            title: ServiceHealthStrings.key("No telemetry data available", "No telemetry data available"),
            systemImage: "antenna.radiowaves.left.and.right"
        )
        .frame(maxWidth: .infinity, minHeight: 160)
    }
}

/// The fetch-failure state (web `QueryError`) with a retry affordance.
struct ServiceHealthErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: ServiceHealthStrings.string(
                "serviceHealth.errorTitle",
                "Couldn't load service health"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(
                ServiceHealthStrings.key("serviceHealth.retry", "Retry"),
                variant: .secondary,
                size: .small,
                action: onRetry
            )
            .accessibilityLabel(Text(verbatim: ServiceHealthStrings.string("serviceHealth.retry", "Retry")))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
