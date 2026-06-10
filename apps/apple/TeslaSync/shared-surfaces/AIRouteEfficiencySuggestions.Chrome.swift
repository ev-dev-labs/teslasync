//
//  AIRouteEfficiencySuggestions.Chrome.swift
//  TeslaSync — P4 shared surface · 0044 · AIRouteEfficiencySuggestions (Apple)
//
//  The P4 leaf chrome composed by `AIRouteEfficiencySuggestions`: the header freshness chip, the
//  refresh button, the stale/offline connectivity banner, the availability loading skeleton, and the
//  retryable gate-error view. All consume the P1/S10 facade + the shared P1/S9 tokens — no
//  networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct RouteEfficiencySuggestionsFreshnessChip: View {
    let connection: RouteEfficiencySuggestionsConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: RouteEfficiencySuggestionsStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: RouteEfficiencySuggestionsStrings.string(descriptor.key, descriptor.fallback))
        )
    }

    private static func descriptor(for connection: RouteEfficiencySuggestionsConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "routeEfficiency.aiSuggestions.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "routeEfficiency.aiSuggestions.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "routeEfficiency.aiSuggestions.offline", fallback: "Offline")
        }
    }
}

// MARK: - Refresh button (header)

/// The header refresh affordance — re-requests the availability snapshot (web `refetch()` peer).
struct RouteEfficiencySuggestionsRefreshButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            Text(verbatim: RouteEfficiencySuggestionsStrings.string("routeEfficiency.aiSuggestions.refresh", "Refresh"))
        )
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live, so the card
/// is clearly labeled while reconnecting / offline.
struct RouteEfficiencySuggestionsConnectivityBanner: View {
    let connection: RouteEfficiencySuggestionsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline
            ? "routeEfficiency.aiSuggestions.offlineBanner"
            : "routeEfficiency.aiSuggestions.staleBanner"
        let fallback = offline
            ? "Offline — showing the last known suggestions"
            : "Reconnecting — Helix may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: RouteEfficiencySuggestionsStrings.string(key, fallback))
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

// MARK: - Loading chrome (availability resolving)

/// The initial-availability chrome: a skeleton header + description + button + output that keeps the
/// card shape while the `useAiEnabled` settings query resolves.
struct RouteEfficiencySuggestionsLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 200, height: 12)
            TSSkeleton(height: 12).frame(maxWidth: .infinity).padding(.trailing, TSSpacing.x4xl)
            HStack {
                Spacer(minLength: 0)
                TSSkeleton(width: 120, height: 28)
            }
            TSSkeleton(height: 64)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(
            Text(verbatim: RouteEfficiencySuggestionsStrings.string(
                "routeEfficiency.aiSuggestions.loadingA11y",
                "Loading route-efficiency suggestions"
            ))
        )
    }
}

// MARK: - Gate-error chrome (web `QueryError` peer)

/// The availability-failure state (the `useAiEnabled` settings query failing) with a retry
/// affordance. Surfaces the failure message under the title when present.
struct RouteEfficiencySuggestionsGateErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: RouteEfficiencySuggestionsStrings.string(
                "routeEfficiency.aiSuggestions.errorTitle",
                "Couldn't load Helix"
            ))
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
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: RouteEfficiencySuggestionsStrings.string("routeEfficiency.aiSuggestions.retry", "Retry"))
            }
            .accessibilityLabel(
                Text(verbatim: RouteEfficiencySuggestionsStrings.string("routeEfficiency.aiSuggestions.retry", "Retry"))
            )
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
