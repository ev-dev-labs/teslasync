//
//  TeslaChargingSessionsMap.States.swift
//  TeslaSync — P4 feature view · 0120 · TeslaChargingSessionsMap (Apple)
//
//  The non-loaded chrome composed by `TeslaChargingSessionsMap`: the stale/offline
//  freshness chip, the hard-error state (web `QueryError`), the friendly empty
//  state (web `EmptyState`), and the loading skeleton. All consume the P1/S10
//  facade + the shared P1/S9 tokens — never a blank box, never a literal.
//

import SwiftUI

// MARK: - Freshness chip (native chrome for stale / offline)

/// A compact chip shown over the map when the live feed is stale or offline. The
/// cached markers stay visible; the chip offers a manual refresh.
struct TeslaChargingSessionsMapFreshnessChip: View {
    let connection: TeslaChargingSessionsMapConnection
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: (key: String, fallback: String) {
        connection == .offline
            ? ("map.offlineBanner", "Offline — showing the last known charging sessions")
            : ("map.staleBanner", "Reconnecting — these charging sessions may be out of date")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            TeslaChargingSessionsMapStrings.text(message.key, message.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRefresh) {
                TeslaChargingSessionsMapStrings.text("map.refresh", "Refresh")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TeslaChargingSessionsMapStrings.text("map.refresh", "Refresh"))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.25), lineWidth: 1)
        )
    }
}

// MARK: - Hard-error state (web `QueryError`)

/// The hard-error state shown when the slice fails with nothing cached to render
/// (web `QueryError`): an icon, title, the technical message, and a retry action.
struct TeslaChargingSessionsMapErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TeslaChargingSessionsMapStrings.text("map.errorTitle", "Couldn't load charging sessions")
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
                TeslaChargingSessionsMapStrings.text("map.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TeslaChargingSessionsMapStrings.text("map.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 280)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The friendly empty state — shown when the slice resolves with no plottable
/// session (no rows, or none with a known location), never a blank box.
struct TeslaChargingSessionsMapEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TeslaChargingSessionsMapStrings.text("map.empty.title", "No charging sessions to map")
            } icon: {
                Image(systemName: "mappin.slash")
            }
        } description: {
            TeslaChargingSessionsMapStrings.text(
                "map.empty.message",
                "Charging sessions with a known location will appear here."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 280)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton

/// The initial-load skeleton chrome: a redacted map block with two pill chips so
/// the transition into the loaded map is stable.
struct TeslaChargingSessionsMapSkeleton: View {
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            TSSkeleton(height: 320, cornerRadius: TSRadius.lg)
            HStack(spacing: TSSpacing.xs) {
                TSSkeleton(width: 110, height: 18, cornerRadius: TSRadius.pill)
                TSSkeleton(width: 70, height: 18, cornerRadius: TSRadius.pill)
            }
            .padding(TSSpacing.md)
        }
        .accessibilityElement()
        .accessibilityLabel(TeslaChargingSessionsMapStrings.text("map.loading", "Loading charging sessions"))
    }
}
