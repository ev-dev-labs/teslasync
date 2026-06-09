//
//  LiveVehicleState.Views.swift
//  TeslaSync — P4 feature view · 0044 · LiveVehicleState (Apple)
//
//  The presentational subviews composed by `LiveVehicleState`: the responsive
//  signal grid + glass cell (web inner `GlassPanel` cells), the loading skeleton
//  grid, the friendly empty state (web `EmptyState`), the QueryError-equivalent
//  failure state with retry, the green pulsing "Live" pill (web `CircleDot`), and
//  the freshness chip + stale/offline banner. All consume pre-localized strings from
//  the P1/S10 facade and the shared P1/S9 design tokens — no networking, no Tailwind
//  ports. Each cell's active flag maps to the web cyan/white-vs-muted treatment here
//  so the projection stays SwiftUI-free.
//

import SwiftUI

// MARK: - Responsive signal grid (web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`)

/// The adaptive grid of live-signal cells. `.adaptive(minimum:)` reproduces the
/// web's 2 / 3 / 5-column responsive breakpoints across iPhone, iPad, and Mac widths.
struct LiveVehicleStateGrid: View {
    let signals: [LiveSignalViewModel]

    private let columns = [GridItem(.adaptive(minimum: 132, maximum: 260), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(signals) { signal in
                LiveSignalTile(signal: signal)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Signal cell (web inner `GlassPanel` cell)

/// One live-signal cell: a tinted SF Symbol + tiny label row over the bold value.
/// The icon + value are accent/primary when the signal is active and muted when not,
/// mirroring the web `text-cyan-400` / `text-white` vs `text-[var(--text-muted)]`
/// treatment. The whole cell is one VoiceOver element reading `label: value`.
struct LiveSignalTile: View {
    let signal: LiveSignalViewModel

    private var accent: Color {
        signal.active ? Color.TS.accent : Color.TS.textMuted
    }

    private var valueColor: Color {
        signal.active ? Color.TS.textPrimary : Color.TS.textMuted
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: signal.systemImage)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(accent)
                        .accessibilityHidden(true)
                    Text(verbatim: signal.label)
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Text(verbatim: signal.value)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(valueColor)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: signal.accessibilityLabel))
    }
}

// MARK: - Live pill (web pulsing `CircleDot` + "Live")

/// The green live indicator shown in the header when an event is present (web
/// `latest && <span><CircleDot className="animate-pulse"/> Live</span>`). The dot
/// pulses unless Reduce Motion is enabled.
struct LiveVehicleStateLivePill: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(Color.TS.statusSuccess)
                .frame(width: 8, height: 8)
                .opacity(pulsing ? 0.3 : 1)
                .accessibilityHidden(true)
            LiveVehicleStateStrings.text("admin.security.live.indicator", "Live")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.statusSuccess)
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(LiveVehicleStateStrings.text("admin.security.live.indicator", "Live"))
    }
}

// MARK: - Loading grid (web parent skeleton)

/// The in-flight skeleton grid: ten cell-height redacted blocks in the same
/// responsive grid, respecting Reduce Motion via the shared `TSSkeleton`.
struct LiveVehicleStateLoadingGrid: View {
    private let columns = [GridItem(.adaptive(minimum: 132, maximum: 260), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 10, id: \.self) { _ in
                TSSkeleton(height: 62, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(LiveVehicleStateStrings.text(
            "admin.security.live.loadingA11y",
            "Loading live vehicle state"
        ))
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The web empty branch: `<EmptyState message={t('admin.security.live.noData', 'No
/// live state data available')} />`, mapped to the native `TSEmptyState` so the
/// surface never reads as a blank panel.
struct LiveVehicleStateEmptyView: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(
                LiveVehicleStateStrings.string("admin.security.live.noData", "No live state data available")
            ),
            systemImage: "antenna.radiowaves.left.and.right.slash"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }
}

// MARK: - Error state (web `QueryError` equivalent + retry)

/// The no-cached-data failure state (the web leaf has no error branch of its own):
/// a danger glyph, the failure title, the underlying message, and a retry affordance
/// wired to the model — the QueryError peer the prompt's states contract requires.
struct LiveVehicleStateErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            LiveVehicleStateStrings.text("admin.security.live.errorTitle", "Couldn't load live vehicle state")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: onRetry) {
                LiveVehicleStateStrings.text("admin.security.live.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(LiveVehicleStateStrings.text("admin.security.live.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
/// Shown only when the source is not live, so the normal header stays as clean as
/// the web source (which shows just the green pill).
struct LiveVehicleStateFreshnessChip: View {
    let connection: LiveVehicleStateConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            LiveVehicleStateStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(LiveVehicleStateStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: LiveVehicleStateConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "admin.security.live.indicator", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "admin.security.live.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "admin.security.live.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the grid when the bound source is not
/// live, so the last-known signals are clearly labeled as cached.
struct LiveVehicleStateConnectivityBanner: View {
    let connection: LiveVehicleStateConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "admin.security.live.offlineBanner" : "admin.security.live.staleBanner"
        let fallback = offline
            ? "Offline — showing last known live state"
            : "Reconnecting — live state may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            LiveVehicleStateStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
