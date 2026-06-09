//
//  SignalChartPanel.Views.swift
//  TeslaSync — P4 feature view · 0266 · SignalChartPanel (Apple)
//
//  The presentational chrome composed by `SignalChartPanel`: the panel header (the
//  live `Radio` / historical `BarChart3` glyph + title + the web counter annotation
//  + freshness chip), the stale/offline connectivity banner, and the loading /
//  empty / error states. The empty branch reproduces both web variants — the live
//  "Waiting for signal data…" pulse and the historical "No data for this time
//  range". All copy resolves through the P1/S10 facade; all chrome is token-driven
//  (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Header annotation (web right-aligned counter)

/// The header's right-aligned annotation: the live event/point counter, the
/// historical points-loaded line, or nothing (web `data.length === 0`).
enum SignalChartHeaderAnnotation: Equatable {
    case live(String)
    case points(String)
    case hidden
}

// MARK: - Header (web `<div className="flex items-center gap-2">`)

/// The panel header: the mode glyph (live broadcast vs bar chart), the resolved
/// title, the web counter annotation, and the live-state freshness chip.
struct SignalChartHeader: View {
    let title: String
    let isLive: Bool
    let connection: SignalChartConnection
    let annotation: SignalChartHeaderAnnotation

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            glyph
            Text(verbatim: title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: TSSpacing.sm)
            annotationView
            SignalChartFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var glyph: some View {
        if isLive {
            SignalChartPulseIcon(systemName: "dot.radiowaves.left.and.right", color: Color.TS.statusDanger)
                .accessibilityHidden(true)
        } else {
            Image(systemName: "chart.bar.xaxis")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private var annotationView: some View {
        switch annotation {
        case let .live(text):
            HStack(spacing: TSSpacing.xs) {
                SignalChartPulseDot(color: Color.TS.statusDanger)
                Text(verbatim: text)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .monospacedDigit()
            }
            .accessibilityElement(children: .combine)
        case let .points(text):
            Text(verbatim: text)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
        case .hidden:
            EmptyView()
        }
    }
}

// MARK: - Live pulse (web `animate-pulse`)

/// A small red dot that pulses its opacity (web `animate-pulse`), static under
/// Reduce Motion.
struct SignalChartPulseDot: View {
    let color: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 6, height: 6)
            .opacity(reduceMotion || !pulsing ? 1 : 0.3)
            .onAppear(perform: animate)
            .accessibilityHidden(true)
    }

    private func animate() {
        guard !reduceMotion else { return }
        withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { pulsing = true }
    }
}

/// The live broadcast glyph that pulses its opacity (web `Radio animate-pulse`).
struct SignalChartPulseIcon: View {
    let systemName: String
    let color: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(color)
            .opacity(reduceMotion || !pulsing ? 1 : 0.4)
            .onAppear(perform: animate)
    }

    private func animate() {
        guard !reduceMotion else { return }
        withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { pulsing = true }
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct SignalChartFreshnessChip: View {
    let connection: SignalChartConnection

    private struct Descriptor {
        let tone: Color
        let label: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: descriptor.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: descriptor.label))
    }

    private static func descriptor(for connection: SignalChartConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, label: SignalChartStrings.live)
        case .stale: Descriptor(tone: Color.TS.statusWarning, label: SignalChartStrings.stale)
        case .offline: Descriptor(tone: Color.TS.textMuted, label: SignalChartStrings.offline)
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not
/// live, so the cached trace is clearly labeled while reconnecting / offline.
struct SignalChartConnectivityBanner: View {
    let connection: SignalChartConnection

    var body: some View {
        let offline = connection == .offline
        let label = offline ? SignalChartStrings.offlineBanner : SignalChartStrings.staleBanner
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: label).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web `<Skeleton>` at chart height)

/// The initial-fetch skeleton chrome — the native parity of the web
/// `loading && !isLive` `<Skeleton className="h-full w-full" />` at the panel
/// height, via the shared `TSChartSkeleton` (Reduce Motion respected).
struct SignalChartLoadingView: View {
    let height: CGFloat

    var body: some View {
        TSChartSkeleton(height: height)
            .frame(maxWidth: .infinity)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: SignalChartStrings.loadingLabel))
    }
}

// MARK: - Empty state (web waiting / no-data branches)

/// The resolved-but-empty state. In live mode it is the web "Waiting for signal
/// data…" line with the pulsing broadcast glyph; historically it is the "No data
/// for this time range" line with the activity glyph. Never a blank box.
struct SignalChartEmptyView: View {
    let isLive: Bool
    let height: CGFloat

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            if isLive {
                SignalChartPulseIcon(systemName: "dot.radiowaves.left.and.right", color: Color.TS.statusDanger)
                Text(verbatim: SignalChartStrings.waiting)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
            } else {
                Image(systemName: "waveform.path.ecg")
                    .font(.system(size: 22))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: SignalChartStrings.noData)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct SignalChartErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: SignalChartStrings.errorTitle)
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
                Text(verbatim: SignalChartStrings.retry)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: SignalChartStrings.retry))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xl)
        .accessibilityElement(children: .combine)
    }
}
