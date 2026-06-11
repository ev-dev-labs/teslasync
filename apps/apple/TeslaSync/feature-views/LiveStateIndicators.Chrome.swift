//
//  LiveStateIndicators.Chrome.swift
//  TeslaSync — P4 feature view · 0292 · LiveStateIndicators (Apple)
//
//  The P4 leaf-contract chrome composed by `LiveStateIndicators`: the freshness chip
//  (the live pulse + the stale/offline status), the connectivity banner, and the
//  loading / empty / error states. The web source has no freshness affordance (its
//  parent owns the `!state` skeleton + the `SectionErrorBoundary`); these surfaces are
//  the Apple HIG extension that keeps every state visible — never a blank box. All
//  chrome consumes the P1/S10 facade and the shared P1/S9 tokens + shared components
//  (`TSSkeleton` / `TSButton`) — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Freshness chip (live pulse + P4 stale/offline status)

/// A status dot + short label — green and pulsing when `live` (web `animate-pulse`),
/// amber when `stale`, muted when `offline`. The pulse respects Reduce Motion. Used
/// inside the connectivity banner and exercised directly by previews/tests.
struct LiveStateIndicatorsFreshnessChip: View {
    let connection: LiveStateIndicatorsConnection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: LiveStateIndicatorsStrings.string("liveState.live", "Live")
        case .stale: LiveStateIndicatorsStrings.string("liveState.stale", "Stale")
        case .offline: LiveStateIndicatorsStrings.string("liveState.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .opacity(pulsing ? 0.35 : 1)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .onAppear {
            guard connection == .live, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Connectivity banner (P4 stale/offline — shown over the cached badges)

/// The stale/offline banner — the freshness chip (status) plus an explanatory sentence
/// in a tinted pill. Rendered above the last-known badges (which stay visible, web
/// "showing last known data"); the bound model auto-refreshes once on the stale
/// transition.
struct LiveStateIndicatorsConnectivityBanner: View {
    let connection: LiveStateIndicatorsConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var detail: String {
        isOffline
            ? LiveStateIndicatorsStrings.string("liveState.offlineBanner", "Showing last known data")
            : LiveStateIndicatorsStrings.string("liveState.staleBanner", "Reconnecting — data may be stale")
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            LiveStateIndicatorsFreshnessChip(connection: connection)
            Text(verbatim: detail)
                .font(Font.TS.caption)
                .foregroundStyle(tone)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading (P4 leaf state — skeleton chips)

/// The initial-fetch chrome: capsule skeletons in the wrapping flow, so the surface
/// keeps its shape while the parent query resolves (web parent `!state` skeleton).
struct LiveStateIndicatorsLoadingView: View {
    private let widths: [CGFloat] = [128, 96, 116, 108, 120]

    private var loadingLabel: String {
        LiveStateIndicatorsStrings.string("liveState.loadingA11y", "Loading live state")
    }

    var body: some View {
        LiveStateIndicatorsFlowLayout(spacing: TSSpacing.sm) {
            ForEach(widths.indices, id: \.self) { index in
                TSSkeleton(width: widths[index], height: 28, cornerRadius: 14)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: loadingLabel))
    }
}

// MARK: - Empty (P4 leaf state — friendly, never a blank box)

/// The empty render: a friendly state for an absent reading, never a blank surface.
struct LiveStateIndicatorsEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: LiveStateIndicatorsStrings.string("liveState.noData", "No live state available"))
            } icon: {
                Image(systemName: "car.top.radiowaves.rear.right")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (P4 leaf state — web `SectionErrorBoundary` peer + retry)

/// The fetch-failure state (web `SectionErrorBoundary` peer) with a retry affordance.
struct LiveStateIndicatorsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: LiveStateIndicatorsStrings.string("liveState.errorTitle", "Couldn't load live state"))
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
                Text(verbatim: LiveStateIndicatorsStrings.string("liveState.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: LiveStateIndicatorsStrings.string("liveState.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
