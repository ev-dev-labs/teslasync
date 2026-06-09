//
//  TripPlannerMap.States.swift
//  TeslaSync — P4 feature view · 0178 · TripPlannerMap (Apple)
//
//  The non-loaded chrome composed by `TripPlannerMap`: the stale/offline freshness
//  chip overlaid on the map, the hard-error state (web `QueryError`), the friendly
//  empty state (web `EmptyState` — "Enter origin and destination to see the route"),
//  and the loading skeleton. All consume the P1/S10 facade + the shared P1/S9 tokens
//  — never a blank box, never a literal.
//

import SwiftUI

// MARK: - Freshness chip (native chrome for stale / offline)

/// A compact chip shown over the map when the live feed is stale or offline. The
/// cached route stays visible; the chip offers a manual refresh.
struct TripPlannerMapFreshnessChip: View {
    let connection: TripPlannerMapConnection
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: (key: String, fallback: String) {
        connection == .offline
            ? ("tripPlanner.map.offlineBanner", "Offline — showing the last planned route")
            : ("tripPlanner.map.staleBanner", "Reconnecting — the planned route may be out of date")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            TripPlannerMapStrings.text(message.key, message.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRefresh) {
                TripPlannerMapStrings.text("tripPlanner.map.refresh", "Refresh")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TripPlannerMapStrings.text("tripPlanner.map.refresh", "Refresh"))
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

/// The hard-error state shown when the trip-plan query fails (web `QueryError`): an
/// icon, title, the technical message, and a retry action.
struct TripPlannerMapErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TripPlannerMapStrings.text("tripPlanner.map.errorTitle", "Couldn't load the planned route")
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
                TripPlannerMapStrings.text("tripPlanner.map.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TripPlannerMapStrings.text("tripPlanner.map.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 320)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The friendly empty state — the native parity of the web `EmptyState`, shown when
/// the plan resolves with no origin and no destination (web `!hasData`). Carries the
/// web copy verbatim ("Enter origin and destination to see the route"); never a blank
/// box.
struct TripPlannerMapEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TripPlannerMapStrings.text("tripPlanner.map.empty", "Enter origin and destination to see the route")
            } icon: {
                Image(systemName: "map")
            }
        } description: {
            TripPlannerMapStrings.text(
                "tripPlanner.map.emptyHint",
                "The route, charge stops, and waypoints appear here once you set a destination."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 320)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton

/// The initial-load skeleton chrome: a redacted map block with a pill chip so the
/// transition into the loaded map is stable.
struct TripPlannerMapSkeleton: View {
    var body: some View {
        ZStack(alignment: .bottomLeading) {
            TSSkeleton(height: 320, cornerRadius: TSRadius.lg)
            HStack(spacing: TSSpacing.xs) {
                TSSkeleton(width: 70, height: 18, cornerRadius: TSRadius.pill)
                TSSkeleton(width: 96, height: 18, cornerRadius: TSRadius.pill)
                TSSkeleton(width: 90, height: 18, cornerRadius: TSRadius.pill)
            }
            .padding(TSSpacing.md)
        }
        .accessibilityElement()
        .accessibilityLabel(TripPlannerMapStrings.text("tripPlanner.map.loading", "Loading planned route"))
    }
}
