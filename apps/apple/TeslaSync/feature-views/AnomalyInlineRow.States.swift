//
//  AnomalyInlineRow.States.swift
//  TeslaSync — P4 feature view · 0238 · AnomalyInlineRow (Apple)
//
//  The non-content states `AnomalyInlineRow` switches over — loading (a row-shaped
//  shimmer so the layout doesn't reflow), the friendly empty state (the native widening
//  of the web `return null`), the error state (web `QueryError` equivalent with a retry
//  affordance), and the live-state freshness chip. Every state renders real chrome —
//  never a blank box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (row-shaped shimmer)

/// The first-paint loading row: the status dot + activity glyph + label with a neutral
/// shimmer where the summary will resolve, so the row keeps its height and the embedding
/// health grid doesn't reflow when the payload arrives.
struct AnomalyInlineRowLoadingState: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shimmer = false

    var body: some View {
        AnomalyRowShell(dotColor: Color.TS.textMuted, label: rowLabel) {
            HStack(spacing: TSSpacing.sm) {
                Capsule(style: .continuous)
                    .fill(Color.TS.textMuted.opacity(shimmer ? 0.28 : 0.14))
                    .frame(width: 132, height: 10)
                ProgressView()
                    .controlSize(.small)
            }
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)) {
                shimmer = true
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(AnomalyInlineRowStrings.text("anomaly.loading", "Checking for anomalies…"))
    }

    private var rowLabel: String {
        AnomalyInlineRowStrings.string("anomaly.row.label", "Anomalies")
    }
}

// MARK: - Empty (native widening of the web `return null`)

/// The resolved-but-no-anomalies row. The web component renders nothing here; the Apple
/// surface contract requires every state to render, so the dormant case becomes a calm,
/// healthy-tinted "No anomalies in the last 24h" row instead of a blank box.
struct AnomalyInlineRowEmptyState: View {
    var body: some View {
        AnomalyRowShell(dotColor: AnomalyHealthStatus.healthy.tint, label: rowLabel) {
            AnomalyInlineRowStrings.text("anomaly.empty", "No anomalies in the last 24h")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: AnomalyInlineRowAccessibility
                .emptyLabel(localize: AnomalyInlineRowStrings.string)))
    }

    private var rowLabel: String {
        AnomalyInlineRowStrings.string("anomaly.row.label", "Anomalies")
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The fetch-failure row: the danger-tinted dot + label, a short error title, and a
/// retry affordance (web `QueryError` retry), so a first-load failure isn't a blank box.
struct AnomalyInlineRowErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        AnomalyRowShell(dotColor: AnomalyHealthStatus.unhealthy.tint, label: rowLabel) {
            HStack(spacing: TSSpacing.sm) {
                AnomalyInlineRowStrings.text("anomaly.error", "Couldn't load anomalies")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .lineLimit(1)
                    .truncationMode(.tail)
                retryButton
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            AnomalyInlineRowStrings.text("anomaly.retry", "Retry")
                .font(Font.TS.label)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(AnomalyInlineRowStrings.text("anomaly.retry", "Retry"))
    }

    private var rowLabel: String {
        AnomalyInlineRowStrings.string("anomaly.row.label", "Anomalies")
    }

    private var accessibilityLabel: String {
        let title = AnomalyInlineRowStrings.string("anomaly.error", "Couldn't load anomalies")
        return message.isEmpty ? title : "\(title): \(message)"
    }
}

// MARK: - Freshness chip (Stale / Offline)

/// The trailing freshness chip reflecting the bound source's live-state (ADR-013). Shown
/// only when the source is not live, so a cached row is clearly labeled.
struct AnomalyInlineRowFreshnessChip: View {
    let connection: AnomalyInlineRowConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Image(systemName: descriptor.icon)
                .font(.system(size: 9, weight: .semibold))
                .accessibilityHidden(true)
            AnomalyInlineRowStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.label)
        }
        .foregroundStyle(descriptor.tone)
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, 2)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(AnomalyInlineRowStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let icon: String
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: AnomalyInlineRowConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(
                tone: Color.TS.statusSuccess,
                icon: "dot.radiowaves.left.and.right",
                key: "anomaly.live",
                fallback: "Live"
            )
        case .stale:
            Descriptor(
                tone: Color.TS.statusWarning,
                icon: "clock.arrow.circlepath",
                key: "anomaly.stale",
                fallback: "Stale"
            )
        case .offline:
            Descriptor(tone: Color.TS.textMuted, icon: "wifi.slash", key: "anomaly.offline", fallback: "Offline")
        }
    }
}
