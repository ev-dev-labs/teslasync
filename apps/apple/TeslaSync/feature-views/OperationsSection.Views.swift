//
//  OperationsSection.Views.swift
//  TeslaSync — P4 feature view · 0250 · OperationsSection (Apple)
//
//  The presentational subviews composed by `OperationsSection`: the header success-rate
//  badge, the freshness chip + connectivity banner, the Notification Delivery block
//  (metric grid + success radial gauge + recent-notifications table, or its empty
//  state), the Audit Log block (audit table, or the web `EmptyState`), and the loading /
//  error chrome. All consume the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Localization bridge (SwiftUI layer over the P1/S10 facade)

extension OperationsStrings {
    /// The `LocalizedStringKey` convenience for shared components that take one
    /// (`TSBadge`, `TSColumn`, `TSStatCard`, `TSEmptyState`); the resolved string is not
    /// a main-catalog key, so SwiftUI renders it verbatim.
    static func key(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(string(key, fallback))
    }
}

// MARK: - Tone bridge (pure `OperationsTone` → shared `TSTone` tokens)

extension OperationsTone {
    /// Maps the view-free status tone to the shared design-token tone (web semantic
    /// colour, not literal hex).
    var tsTone: TSTone {
        switch self {
        case .neutral: .neutral
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        }
    }
}

// MARK: - Responsive grid (web `cols={{ default: 2, md: 4 }}`)

/// A two-or-four column metric grid — two columns on compact iPhone width, four on
/// regular width / macOS, mirroring the web `Grid` breakpoints.
private struct OperationsGrid<Content: View>: View {
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

// MARK: - Header badge (web success-rate `Badge`)

/// The accordion header success-rate badge — shown only when stats are present (web
/// `{notifStats ? <Badge variant={tone}>{pct} success rate</Badge> : undefined}`).
struct OperationsHeaderBadge: View {
    let resolved: OperationsResolved

    private var text: String {
        let percent = OperationsFormat.percent(resolved.successRate)
        return OperationsAccessibility.successRateLabel(
            percent: percent,
            suffix: OperationsStrings.string("success rate", "success rate")
        )
    }

    var body: some View {
        if resolved.showStatsBadge {
            TSBadge(LocalizedStringKey(text), tone: resolved.successTone.tsTone)
                .accessibilityLabel(Text(verbatim: text))
        }
    }
}

// MARK: - Freshness chip + connectivity banner (P4 leaf chrome)

/// The feed freshness chip (live / stale / offline) — a coloured dot + label.
struct OperationsFreshnessChip: View {
    let connection: OperationsConnection

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: OperationsStrings.string("operations.live", "Live")
        case .stale: OperationsStrings.string("operations.stale", "Stale")
        case .offline: OperationsStrings.string("operations.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }
}

/// The stale / offline banner — cached data stays visible behind it.
struct OperationsConnectivityBanner: View {
    let connection: OperationsConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var label: String {
        isOffline
            ? OperationsStrings.string("operations.offlineBanner", "Offline — showing last known data")
            : OperationsStrings.string("operations.staleBanner", "Reconnecting — data may be stale")
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

// MARK: - Ready content (web non-loading render: delivery + audit)

/// The resolved panel body — the Notification Delivery block over the Audit Log block
/// (web `space-y-6`).
struct OperationsReadyContent: View {
    let resolved: OperationsResolved

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xl) {
            OperationsDeliverySection(resolved: resolved)
            OperationsAuditSection(auditLogs: resolved.auditLogs)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Delivery block (web `{notifStats && …}` — always shown native-side)

/// The Notification Delivery block — the four metric cards + the success radial gauge +
/// the recent-notifications table when stats are present, otherwise a friendly empty
/// state (the section is always rendered so no surface is hidden).
struct OperationsDeliverySection: View {
    let resolved: OperationsResolved

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSPanelTitle(OperationsStrings.key("Notification Delivery", "Notification Delivery"))
            if let stats = resolved.stats {
                metrics(stats)
                gauge
                logs
            } else {
                TSEmptyState(
                    title: OperationsStrings.key("operations.noStats", "No notification statistics yet"),
                    systemImage: "bell.slash"
                )
                .frame(maxWidth: .infinity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func metrics(_ stats: NotificationStatsSnapshot) -> some View {
        OperationsGrid {
            TSStatCard(
                title: OperationsStrings.key("Total Sent", "Total Sent"),
                value: OperationsFormat.int(stats.totalSent),
                systemImage: "paperplane.fill"
            )
            TSStatCard(
                title: OperationsStrings.key("Failed", "Failed"),
                value: OperationsFormat.int(stats.failed),
                systemImage: "xmark.circle"
            )
            TSStatCard(
                title: OperationsStrings.key("Success Rate", "Success Rate"),
                value: OperationsFormat.percent(resolved.successRate),
                systemImage: "checkmark.circle"
            )
            TSStatCard(
                title: OperationsStrings.key("Channels", "Channels"),
                value: OperationsChannels.summary(stats),
                systemImage: "bell.fill"
            )
        }
    }

    private var gauge: some View {
        HStack {
            Spacer(minLength: 0)
            TSRadialGauge(
                value: resolved.gaugeFraction,
                label: OperationsStrings.key("Success", "Success"),
                colorIndex: resolved.gaugeColorIndex
            )
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var logs: some View {
        if let notifLogs = resolved.notifLogs {
            if notifLogs.isEmpty {
                TSEmptyState(
                    title: OperationsStrings.key("operations.noRecent", "No recent notifications"),
                    systemImage: "bell.slash"
                )
                .frame(maxWidth: .infinity)
            } else {
                OperationsNotificationsTable(logs: notifLogs)
            }
        } else {
            TSEmptyState(
                title: OperationsStrings.key("common.noData", "No data available"),
                systemImage: "waveform.path.ecg"
            )
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Audit block (web audit `DataTable` / `EmptyState`)

/// The Audit Log block — the audit table when there are entries, otherwise the web
/// `EmptyState` ("No audit log entries").
struct OperationsAuditSection: View {
    let auditLogs: [AuditLogItem]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSPanelTitle(OperationsStrings.key("Audit Log", "Audit Log"))
            if auditLogs.isEmpty {
                TSEmptyState(
                    title: OperationsStrings.key("operations.noAudit", "No audit log entries"),
                    systemImage: "doc.text.magnifyingglass"
                )
                .frame(maxWidth: .infinity)
            } else {
                OperationsAuditTable(logs: auditLogs)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Loading / error chrome (web `isLoading` skeletons + `QueryError` peer)

/// The initial-fetch chrome — the web two skeleton blocks (`h-32` over `h-48`).
struct OperationsLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(height: 128, cornerRadius: TSRadius.md)
            TSSkeleton(height: 192, cornerRadius: TSRadius.md)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: OperationsStrings.string(
            "operations.loadingA11y",
            "Loading operations"
        )))
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct OperationsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: OperationsStrings.string("operations.errorTitle", "Couldn't load operations"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: OperationsStrings.string("operations.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: OperationsStrings.string("operations.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
