//
//  ChargingSessionCard.States.swift
//  TeslaSync — P4 feature view · 0107 · ChargingSessionCard (Apple)
//
//  The non-loaded chrome composed by `ChargingSessionCard`: the stale/offline
//  freshness chip, the hard-error state (web `QueryError`), the friendly empty
//  state (web `EmptyState`), and the loading skeleton. All consume the P1/S10
//  facade + the shared P1/S9 tokens — never a blank box, never a literal.
//

import SwiftUI

// MARK: - Freshness chip (native chrome for stale / offline)

/// A compact chip shown above the row when the live feed is stale or offline. The
/// cached session stays visible; the chip offers a manual refresh.
struct ChargingSessionFreshnessChip: View {
    let connection: ChargingSessionCardConnection
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: (key: String, fallback: String) {
        connection == .offline
            ? ("card.offlineBanner", "Offline — showing the last known charging session")
            : ("card.staleBanner", "Reconnecting — this charging session may be out of date")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            ChargingSessionCardStrings.text(message.key, message.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRefresh) {
                ChargingSessionCardStrings.text("card.refresh", "Refresh")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChargingSessionCardStrings.text("card.refresh", "Refresh"))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.25), lineWidth: 1)
        )
    }
}

// MARK: - Hard-error state (web `QueryError`)

/// The hard-error state shown when the slice fails with nothing cached to render
/// (web `QueryError`): an icon, title, the technical message, and a retry action.
struct ChargingSessionCardErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ChargingSessionCardStrings.text("card.errorTitle", "Couldn't load this charging session")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                ChargingSessionCardStrings.text("card.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChargingSessionCardStrings.text("card.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The friendly empty state — shown when the slice resolves to no session, never a
/// blank box.
struct ChargingSessionCardEmptyState: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.slash")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            ChargingSessionCardStrings.text("card.empty", "No charging session to show")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton

/// The initial-load skeleton chrome: a redacted row matching the loaded layout so
/// the transition is stable.
struct ChargingSessionCardSkeleton: View {
    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            TSSkeleton(width: 28, height: 24)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSSkeleton(width: 200, height: 12)
                TSSkeleton(width: 150, height: 10)
                TSSkeleton(height: 10)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .tsGlassPanel()
        .accessibilityElement()
        .accessibilityLabel(ChargingSessionCardStrings.text("card.loading", "Loading charging session"))
    }
}
