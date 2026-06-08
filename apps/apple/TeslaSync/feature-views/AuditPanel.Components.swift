//
//  AuditPanel.Components.swift
//  TeslaSync — P4 feature view · 0026 · AuditPanel (Apple)
//
//  The Apple-idiomatic view pieces the surface composes: the result chip (web
//  `Badge` with a pre-localized token), the freshness + refresh accessory, the
//  empty / error / offline states (web `EmptyState` / `QueryError`), and the
//  loading skeleton. All strings resolve through the P1/S10 facade; all
//  colors/spacing come from the P1/S9 tokens. The data table lives in
//  `AuditPanel.Table.swift`.
//

import SwiftUI

// MARK: - Tone bridge (Foundation tone → shared TSTone)

extension AuditResultTone {
    /// Maps the Foundation-level tone onto the shared `TSTone` so the chip reuses
    /// the design-system status colors (web `Badge` variant).
    var tsTone: TSTone {
        switch self {
        case .neutral: .neutral
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        }
    }
}

// MARK: - Result chip (web `Badge variant={RESULT_VARIANT[row.result]}`)

/// A result chip styled like the shared `TSBadge`, but carrying a pre-localized
/// token label — which the shared `TSBadge` (taking a `LocalizedStringKey` only,
/// resolved against the main catalog) cannot express for a per-surface string.
struct AuditResultBadge: View {
    let label: String
    let tone: AuditResultTone

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .lineLimit(1)
            .foregroundStyle(tone.tsTone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.tsTone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.tsTone.color.opacity(0.3), lineWidth: 1))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Freshness chip + status accessory (live / stale / offline)

/// Header chip flagging live / stale / offline data (web freshness indicator).
struct AuditFreshnessChip: View {
    let freshness: AuditPanelFreshness

    private var tone: TSTone {
        switch freshness {
        case .live: .success
        case .stale: .warning
        case .offline: .neutral
        }
    }

    private var symbol: String {
        switch freshness {
        case .live: "clock"
        case .stale: "clock.badge.exclamationmark"
        case .offline: "wifi.slash"
        }
    }

    private var label: String {
        switch freshness {
        case .live: AuditPanelStrings.string("admin.dlq.audit.live", "Live")
        case .stale: AuditPanelStrings.string("admin.dlq.audit.stale", "Stale")
        case .offline: AuditPanelStrings.string("admin.dlq.audit.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: symbol).font(.caption2)
            Text(verbatim: label).font(Font.TS.caption)
        }
        .foregroundStyle(tone.color)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

/// Freshness chip + an in-flight spinner + a refresh control (web refetch).
struct AuditStatusAccessory: View {
    let freshness: AuditPanelFreshness
    let refreshing: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            AuditFreshnessChip(freshness: freshness)
            if refreshing {
                ProgressView().controlSize(.mini)
            }
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(AuditPanelStrings.text("admin.dlq.audit.refresh", "Refresh"))
        }
    }
}

// MARK: - Retry affordance (web `QueryError` retry button)

/// Capsule retry button shared by the error + offline states.
struct AuditRetryButton: View {
    let onRetry: () -> Void

    var body: some View {
        Button(action: onRetry) {
            AuditPanelStrings.text("admin.dlq.audit.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(AuditPanelStrings.text("admin.dlq.audit.retry", "Retry"))
    }
}

// MARK: - Empty state (web `EmptyState`, scoped vs global message)

/// The in-place empty state (web `EmptyState`). Built over `ContentUnavailableView`
/// with facade `Text` so the per-surface scoped/global copy resolves with its
/// English fallback (the shared `TSEmptyState` takes a main-catalog key only).
struct AuditEmptyView: View {
    let scoped: Bool

    private var message: Text {
        if scoped {
            let fallback = "This entry has not been replayed. Use the Replay action "
                + "above to send it back to its source topic."
            return AuditPanelStrings.text("admin.dlq.audit.empty.scopedMessage", fallback)
        }
        let fallback = "Replay attempts will appear here once an operator triggers one."
        return AuditPanelStrings.text("admin.dlq.audit.empty.globalMessage", fallback)
    }

    var body: some View {
        ContentUnavailableView {
            Label {
                AuditPanelStrings.text("admin.dlq.audit.empty.title", "No replay attempts yet")
            } icon: {
                Image(systemName: "tray")
            }
        } description: {
            message
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Error + offline states

/// The fetch-failure state (web `QueryError`) with a retry affordance.
struct AuditErrorView: View {
    let retryable: Bool
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            AuditPanelStrings.text("admin.dlq.audit.errorTitle", "Couldn't load replay audit log")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if retryable {
                AuditRetryButton(onRetry: onRetry)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

/// The offline-without-cache state (web offline fallback) with retry.
struct AuditOfflineView: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
            AuditPanelStrings.text("admin.dlq.audit.offlineMessage", "Offline — showing last known audit log")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            AuditRetryButton(onRetry: onRetry)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton (web `DataTable` "Loading audit log…")

/// Skeleton chrome shown during the initial fetch (web `Skeleton`); its a11y
/// label is the web `emptyMessage` "Loading audit log…".
struct AuditLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 5, id: \.self) { _ in
                TSSkeleton(height: 20, cornerRadius: TSRadius.sm)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(AuditPanelStrings.text("admin.dlq.audit.loading", "Loading audit log…"))
    }
}
