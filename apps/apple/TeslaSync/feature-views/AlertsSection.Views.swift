//
//  AlertsSection.Views.swift
//  TeslaSync — P4 feature view · 0071 · AlertsSection (Apple)
//
//  Presentational chrome composed by `AlertsSection`: the panel header + total
//  badge + freshness chip, the stale/offline connectivity banner, the two-column
//  content (the "Alerts by Severity" rows + the "Alert Distribution" donut, web
//  Recharts `PieChart` → native `Chart { SectorMark }`), and the loading / empty /
//  error states. All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import Charts
import SwiftUI

// MARK: - Severity palette (web static hex → adaptive semantic tokens)

/// The severity → color / glyph / badge-tone mapping. The web uses static hex
/// (`STATUS_COLORS.critical` #ef4444, `STATUS_COLORS.warning` #f59e0b, info via
/// `CHART_COLORS[0]`); native uses the adaptive semantic tokens so light / dark /
/// high-contrast all resolve correctly.
enum AlertsPalette {
    static func color(for kind: AlertSeverityKind) -> Color {
        switch kind {
        case .critical: Color.TS.statusDanger
        case .warning: Color.TS.statusWarning
        case .info: Color.TS.statusInfo
        case .other: Color.TS.textMuted
        }
    }

    /// The SF Symbol per severity (web lucide `AlertCircle` / `AlertTriangle` /
    /// `Info`, with a bell for unknown severities).
    static func symbol(for kind: AlertSeverityKind) -> String {
        switch kind {
        case .critical: "exclamationmark.octagon.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .info: "info.circle.fill"
        case .other: "bell.fill"
        }
    }
}

// MARK: - Header (title + total badge + freshness chip)

/// The panel header: the web `<span>` with the amber `AlertTriangle`, the "Alerts"
/// title, the warning total `Badge` (shown only when there are alerts), and the
/// live-state freshness chip.
struct AlertsHeader: View {
    let total: Int
    let connection: AlertsConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            AlertsStrings.text("analytics.weeklyDigest.alertsSection", "Alerts")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            if total > 0 {
                AlertsCountBadge(count: total, kind: .warning)
            }
            Spacer(minLength: TSSpacing.sm)
            AlertsFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Count badge (web `Badge`)

/// A compact tinted count pill — the native parity of the web `Badge` (severity
/// `danger` / `warning` / `info` variants). The count is caller-formatted and
/// rendered verbatim with monospaced digits.
struct AlertsCountBadge: View {
    let count: Int
    let kind: AlertSeverityKind

    var body: some View {
        let tint = AlertsPalette.color(for: kind)
        return Text(verbatim: AlertsFormat.count(count))
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .monospacedDigit()
            .foregroundStyle(tint)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tint.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tint.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct AlertsFreshnessChip: View {
    let connection: AlertsConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            AlertsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(AlertsStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: AlertsConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "analytics.weeklyDigest.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "analytics.weeklyDigest.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "analytics.weeklyDigest.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not
/// live, so cached counts are clearly labeled (web `DataFreshness` intent).
struct AlertsConnectivityBanner: View {
    let connection: AlertsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "analytics.weeklyDigest.offlineBanner" : "analytics.weeklyDigest.staleBanner"
        let fallback = offline
            ? "Offline — showing last known alerts"
            : "Reconnecting — alert counts may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            AlertsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content (web `grid-cols-1 lg:grid-cols-2`)

/// The populated two-column body: the severity rows beside the distribution donut
/// on a wide layout (web `lg:grid-cols-2`), stacking vertically when compact.
struct AlertsContent: View {
    let data: [AlertSeverityDatum]
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var isWide: Bool {
        horizontalSizeClass != .compact
    }

    var body: some View {
        Group {
            if isWide {
                HStack(alignment: .top, spacing: TSSpacing.x2xl) {
                    AlertsSeverityList(data: data).frame(maxWidth: .infinity, alignment: .leading)
                    AlertDistribution(data: data).frame(maxWidth: .infinity)
                }
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                    AlertsSeverityList(data: data)
                    AlertDistribution(data: data)
                }
            }
        }
    }
}

// MARK: - Alerts by severity (left column)

/// The "Alerts by Severity" column: a labeled stack of one row per severity (web
/// `Object.entries(metrics.alertsByType).map(...)`).
struct AlertsSeverityList: View {
    let data: [AlertSeverityDatum]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            AlertsStrings.text("analytics.weeklyDigest.alertsBySeverity", "Alerts by Severity")
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
            VStack(spacing: TSSpacing.md) {
                ForEach(data) { datum in
                    AlertsSeverityRow(datum: datum)
                }
            }
        }
    }
}

/// One severity row (web inner `<GlassPanel>`): severity glyph + label on the left,
/// the count badge on the right.
struct AlertsSeverityRow: View {
    let datum: AlertSeverityDatum

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: AlertsPalette.symbol(for: datum.kind))
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(AlertsPalette.color(for: datum.kind))
                .accessibilityHidden(true)
            Text(verbatim: datum.label(localize: AlertsStrings.string))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            AlertsCountBadge(count: datum.count, kind: datum.kind)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: AlertsAccessibility.rowLabel(datum, localize: AlertsStrings.string)))
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a stack of muted severity-row blocks beside
/// a circular donut skeleton, respecting Reduce Motion (via `TSSkeleton`).
struct AlertsLoading: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var rows: some View {
        VStack(spacing: TSSpacing.md) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(height: 48, cornerRadius: TSRadius.md)
            }
        }
    }

    private var donut: some View {
        TSSkeleton(width: 160, height: 160, cornerRadius: 80)
            .frame(maxWidth: .infinity)
    }

    var body: some View {
        Group {
            if horizontalSizeClass != .compact {
                HStack(alignment: .top, spacing: TSSpacing.x2xl) {
                    rows.frame(maxWidth: .infinity)
                    donut.frame(maxWidth: .infinity)
                }
            } else {
                VStack(spacing: TSSpacing.x2xl) {
                    rows
                    donut
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(AlertsStrings.text("analytics.weeklyDigest.loading", "Loading alerts"))
    }
}

// MARK: - Empty state (web `EmptyState` — "No alerts this week …")

/// The resolved-but-empty state: the web `<EmptyState message={t('…noAlerts')}>`
/// over a native `ContentUnavailableView` with the alert glyph. Never a blank box.
struct AlertsEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                AlertsStrings.text(
                    "analytics.weeklyDigest.noAlerts",
                    "No alerts this week — everything looks great!"
                )
            } icon: {
                Image(systemName: "checkmark.shield.fill")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct AlertsError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            AlertsStrings.text("analytics.weeklyDigest.errorTitle", "Couldn't load alerts")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                AlertsStrings.text("analytics.weeklyDigest.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(AlertsStrings.text("analytics.weeklyDigest.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
