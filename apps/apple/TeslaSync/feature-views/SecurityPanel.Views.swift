//
//  SecurityPanel.Views.swift
//  TeslaSync — P4 feature view · 0284 · SecurityPanel (Apple)
//
//  The presentational subviews composed by `SecurityPanel`: the header (Shield +
//  "Security" + freshness chip), the lock badge (web tinted lock box), the label →
//  value rows (the sentry pill, the monospaced door / window values, and the colored
//  user-present / remote-start text), the italic detail line, the loading skeleton,
//  the empty state (web `EmptyState`), the QueryError-equivalent failure with retry,
//  and the stale / offline banner. All consume pre-localized strings from the P1/S10
//  facade and the shared P1/S9 design tokens — no networking, no Tailwind ports. Each
//  semantic tone maps to a `Color.TS` token here so the projection stays SwiftUI-free.
//

import SwiftUI

// MARK: - Tone → design-token color

extension SecurityPanelTone {
    /// The `Color.TS` token for a value's icon + text. `.primary` is the web mono
    /// value color; `.neutral` is the web muted text.
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .neutral: Color.TS.textMuted
        case .primary: Color.TS.textPrimary
        }
    }
}

// MARK: - Header (web `<h3 class="section-title"><Shield/> Security</h3>` + chip)

/// The panel header: the cyan Shield glyph, the "Security" title, and — when the bound
/// source is not live — the freshness chip pinned to the trailing edge.
struct SecurityPanelHeader: View {
    let connection: SecurityPanelConnection
    let showsFreshness: Bool

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "shield.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: SecurityPanelStrings.string("common.security", "Security"))
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if showsFreshness {
                SecurityPanelFreshnessChip(connection: connection)
            }
        }
    }
}

// MARK: - Content (web `hasData` branch: badge + rows + detail + remote start)

/// The resolved content body. The stale / offline banner appears above the rows when
/// the bound source is not live; the lock badge + event rows + detail render only when
/// a security event exists (web `{securityData && …}`); the Remote Start row always
/// renders (web places it outside the event guard).
struct SecurityPanelContentView: View {
    let content: SecurityPanelContentModel
    let connection: SecurityPanelConnection
    let onRefresh: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if connection != .live {
                SecurityPanelConnectivityBanner(connection: connection, onRefresh: onRefresh)
            }
            if let lock = content.lock {
                SecurityPanelLockBadge(lock: lock)
            }
            ForEach(content.eventRows) { row in
                SecurityPanelRow(row: row)
            }
            if let detail = content.detail {
                SecurityPanelDetail(text: detail)
            }
            SecurityPanelRow(row: content.remoteStart)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Lock badge (web tinted lock box + Locked/Unlocked + subtitle)

/// The lock-status badge: a tinted, rounded icon box beside the bold tone-colored
/// status and the muted subtitle. One VoiceOver element reading "<status>. <subtitle>".
struct SecurityPanelLockBadge: View {
    let lock: SecurityPanelLockModel

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            Image(systemName: lock.systemImage)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(lock.tone.color)
                .frame(width: 48, height: 48)
                .background(
                    lock.tone.color.opacity(0.1),
                    in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                        .strokeBorder(lock.tone.color.opacity(0.3), lineWidth: 1)
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs / 2) {
                Text(verbatim: lock.value)
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .foregroundStyle(lock.tone.color)
                Text(verbatim: lock.subtitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: lock.accessibilityLabel))
    }
}

// MARK: - Row (web label → value rows; value style varies by kind)

/// One label → value row. The label is a muted caption with an optional leading glyph;
/// the trailing value renders as the sentry pill (`chip`), a monospaced door / window
/// value (`mono`), or colored status text (`status`). One VoiceOver element per row.
struct SecurityPanelRow: View {
    let row: SecurityPanelRowModel

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                if let icon = row.labelSystemImage {
                    Image(systemName: icon)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
                Text(verbatim: row.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            value
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: row.accessibilityLabel))
    }

    @ViewBuilder
    private var value: some View {
        switch row.kind {
        case .chip:
            chip
        case .mono:
            Text(verbatim: row.value)
                .font(Font.TS.body)
                .monospaced()
                .foregroundStyle(row.tone.color)
        case .status:
            Text(verbatim: row.value)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(row.tone.color)
        }
    }

    private var chip: some View {
        HStack(spacing: TSSpacing.xs) {
            if let icon = row.valueSystemImage {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .semibold))
                    .accessibilityHidden(true)
            }
            Text(verbatim: row.value)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
        }
        .foregroundStyle(row.tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(row.tone.color.opacity(0.1), in: Capsule())
        .overlay(Capsule().strokeBorder(row.tone.color.opacity(0.2), lineWidth: 1))
    }
}

// MARK: - Detail (web `<div italic>{securityData.detail}</div>`)

/// The optional italic note rendered under the rows (web `securityData.detail`).
struct SecurityPanelDetail: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .italic()
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Loading skeleton (native chrome — initial fetch)

/// The in-flight skeleton: a lock-badge block over five row blocks, mirroring the
/// resolved panel layout. Respects Reduce Motion via the shared `TSSkeleton`.
struct SecurityPanelLoadingContent: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(height: 48, cornerRadius: TSRadius.lg)
            ForEach(0 ..< 5, id: \.self) { _ in
                TSSkeleton(height: 16, cornerRadius: TSRadius.sm)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(
            SecurityPanelStrings.text("telemetry.security.loadingA11y", "Loading security status")
        )
    }
}

// MARK: - Empty state (web `<EmptyState message="No security data available" />`)

/// The friendly empty state shown when neither a security event nor remote-start
/// access is known (web `EmptyState`). Uses the Apple-idiomatic `ContentUnavailableView`
/// so the surface never reads as a blank panel.
struct SecurityPanelEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: SecurityPanelStrings.string(
                    "telemetry.noSecurityData",
                    "No security data available"
                ))
            } icon: {
                Image(systemName: "shield.slash")
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x2xl)
    }
}

// MARK: - Error state (web `QueryError` equivalent + retry)

/// The no-cached-data failure state (web `QueryError`): a danger glyph, the failure
/// title, the underlying message, and a retry affordance wired to the model.
struct SecurityPanelErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SecurityPanelStrings.text("telemetry.security.errorTitle", "Couldn't load security data")
                .font(Font.TS.panel)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                SecurityPanelStrings.text("telemetry.security.retry", "Retry")
            }
            .accessibilityLabel(SecurityPanelStrings.text("telemetry.security.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013). Shown only
/// when the source is not live, so the normal panel stays as clean as the web source.
struct SecurityPanelFreshnessChip: View {
    let connection: SecurityPanelConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: SecurityPanelStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: SecurityPanelStrings.string(descriptor.key, descriptor.fallback)))
    }

    private static func descriptor(for connection: SecurityPanelConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "telemetry.security.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "telemetry.security.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "telemetry.security.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the rows when the bound source is not live,
/// so the last-known snapshot is clearly labeled as cached. A manual refresh affordance
/// accompanies the stale state (offline has no connectivity to retry over).
struct SecurityPanelConnectivityBanner: View {
    let connection: SecurityPanelConnection
    let onRefresh: () -> Void

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: descriptor.systemImage)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(descriptor.tone)
                .accessibilityHidden(true)
            Text(verbatim: SecurityPanelStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            if connection == .stale {
                TSButton(variant: .ghost, size: .small, action: onRefresh) {
                    SecurityPanelStrings.text("telemetry.security.refresh", "Refresh")
                }
                .accessibilityLabel(SecurityPanelStrings.text("telemetry.security.refresh", "Refresh"))
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            descriptor.tone.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
        let systemImage: String
    }

    private static func descriptor(for connection: SecurityPanelConnection) -> Descriptor {
        switch connection {
        case .offline:
            Descriptor(
                tone: Color.TS.textMuted,
                key: "telemetry.security.offlineBanner",
                fallback: "Offline — showing last known security status",
                systemImage: "wifi.slash"
            )
        case .stale:
            Descriptor(
                tone: Color.TS.statusWarning,
                key: "telemetry.security.staleBanner",
                fallback: "Reconnecting — security status may be stale",
                systemImage: "clock.arrow.circlepath"
            )
        case .live:
            Descriptor(
                tone: Color.TS.statusSuccess,
                key: "telemetry.security.live",
                fallback: "Live",
                systemImage: "checkmark.circle"
            )
        }
    }
}
