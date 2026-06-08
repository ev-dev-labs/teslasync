//
//  YearlyTrendChart.Views.swift
//  TeslaSync — P4 feature view · 0095 · YearlyTrendChart (Apple)
//
//  The presentational chrome composed by `YearlyTrendChart`: the glass section
//  panel (web `ChartContainer` — title + subtitle + aria, with the freshness
//  chip as a header accessory), the stale/offline connectivity banner, the
//  empty row (web `EmptyState`), the initial-load skeleton body, and the error
//  state (web `SectionErrorBoundary` fallback). All consume pre-localized
//  strings from the P1/S10 facade and the shared P1/S9 tokens — no networking,
//  no Tailwind ports. The composed chart itself lives in
//  `YearlyTrendChart.Chart.swift`.
//

import SwiftUI

// MARK: - Section panel (web `ChartContainer`)

/// A glass section card: a title + subtitle header row with an optional trailing
/// accessory (the freshness chip), above its body. The native parity of the web
/// `<ChartContainer title subtitle ariaLabel>` wrapper.
struct YearlyTrendPanel<Accessory: View, Content: View>: View {
    let titleKey: String
    let titleFallback: String
    let subtitleKey: String
    let subtitleFallback: String
    let ariaKey: String
    let ariaFallback: String
    @ViewBuilder var accessory: () -> Accessory
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(YearlyTrendStrings.text(ariaKey, ariaFallback))
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                YearlyTrendStrings.text(titleKey, titleFallback)
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                YearlyTrendStrings.text(subtitleKey, subtitleFallback)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: TSSpacing.sm)
            accessory()
        }
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct YearlyTrendFreshnessChip: View {
    let connection: YearlyTrendConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            YearlyTrendStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(YearlyTrendStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: YearlyTrendConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "charging.curve.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "charging.curve.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "charging.curve.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not
/// live, so a cached chart is clearly labeled while reconnecting / offline.
struct YearlyTrendConnectivityBanner: View {
    let connection: YearlyTrendConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "charging.curve.offlineBanner" : "charging.curve.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded yearly trend"
            : "Reconnecting — the yearly trend may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            YearlyTrendStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty row (web `EmptyState`)

/// The centered, muted empty row the chart body shows when there is no yearly
/// data (web `<EmptyState icon={<Activity/>} message={t('common.noData')} />`).
/// Sized so the panel never collapses to a blank box.
struct YearlyTrendEmptyRow: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            YearlyTrendStrings.text("common.noData", "No data available")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(YearlyTrendStrings.text("common.noData", "No data available"))
    }
}

// MARK: - Initial-load skeleton body (web `Spinner` chrome)

/// The initial-fetch skeleton body shown before the first payload, respecting
/// Reduce Motion (the shimmer is owned by `TSSkeleton`).
struct YearlyTrendLoadingBody: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(height: 240)
            HStack(spacing: TSSpacing.md) {
                TSSkeleton(width: 90, height: 12)
                TSSkeleton(width: 90, height: 12)
                TSSkeleton(width: 90, height: 12)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(YearlyTrendStrings.text("charging.curve.loading", "Loading yearly trend"))
    }
}

// MARK: - Error state (web `SectionErrorBoundary`)

/// The error body with a retry affordance, shown when the source failed and
/// there is no cached chart to keep on screen.
struct YearlyTrendErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            YearlyTrendStrings.text("charging.curve.errorTitle", "Couldn't load the yearly trend")
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
                YearlyTrendStrings.text("charging.curve.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(YearlyTrendStrings.text("charging.curve.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .accessibilityElement(children: .combine)
    }
}
