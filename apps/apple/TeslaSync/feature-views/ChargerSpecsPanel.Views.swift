//
//  ChargerSpecsPanel.Views.swift
//  TeslaSync — P4 feature view · 0098 · ChargerSpecsPanel (Apple)
//
//  The presentational chrome composed by `ChargerSpecsPanel`: the freshness chip, the
//  stale/offline connectivity banner, the four-column spec grid (web `<SpecColumn>` ×4), and the
//  loading / empty / error states. All consume pre-localized strings from the P1/S10 facade and
//  the shared P1/S9 tokens + components — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Localization helper (SwiftUI side of the P1/S10 facade)

extension ChargerSpecsStrings {
    /// `Text` wrapper over `string(_:_:)` so views resolve the per-surface table without hardcoded
    /// literals (web `t(key, default)`).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Grid layout

/// The responsive column grid (web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`): adaptive columns
/// wrap from one on a narrow phone panel up to four on a wide iPad / Mac surface.
enum ChargerSpecsLayout {
    static let columns = [GridItem(.adaptive(minimum: 160, maximum: .infinity), spacing: TSSpacing.lg)]
}

// MARK: - Spec row (web `SpecColumn` line item)

/// One spec line — the SwiftUI parity of a `<SpecColumn>` row: the grouping name on the leading
/// edge and the "N sessions · metric" detail on the trailing edge.
struct ChargerSpecRowView: View {
    let row: ChargerSpecRow

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: row.name)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: row.detail)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.trailing)
                .lineLimit(2)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: row.accessibilityLabel))
    }
}

// MARK: - Spec column (web `<SpecColumn>`)

/// One spec column — the SwiftUI parity of `<SpecColumn>`: a tinted icon + label header, then the
/// rows, or the column's empty message when no rows exist (web `items.length === 0`).
struct ChargerSpecColumnView: View {
    let column: ChargerSpecColumn

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            if column.isEmpty {
                emptyMessage
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    ForEach(column.rows) { row in
                        ChargerSpecRowView(row: row)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: column.kind.iconSystemName)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            ChargerSpecsStrings.text(column.kind.labelKey, column.kind.labelFallback)
                .font(Font.TS.label)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ChargerSpecsStrings.text(column.kind.labelKey, column.kind.labelFallback))
    }

    private var emptyMessage: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "minus.circle")
                .font(.system(size: 11))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            ChargerSpecsStrings.text(column.kind.emptyKey, column.kind.emptyFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Spec grid (web grid of four columns)

/// The populated state (web `hasData`): the four spec columns in source order. Each column renders
/// its rows or its own empty message (handled per column).
struct ChargerSpecsGrid: View {
    let projection: ChargerSpecsProjection

    var body: some View {
        LazyVGrid(columns: ChargerSpecsLayout.columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(projection.columns) { column in
                ChargerSpecColumnView(column: column)
            }
        }
    }
}

// MARK: - Loading grid (web `<Skeleton>` chrome)

/// The initial-fetch skeleton grid: four redacted columns in the same layout, respecting Reduce
/// Motion through the shared `TSSkeleton`.
struct ChargerSpecsLoadingGrid: View {
    var body: some View {
        LazyVGrid(columns: ChargerSpecsLayout.columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(ChargerSpecsColumnKind.allCases, id: \.self) { _ in
                ChargerSpecsSkeletonColumn()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(ChargerSpecsStrings.text("charging.specs.loading", "Loading charger specs"))
    }
}

/// One redacted skeleton column matching the column chrome (header + three rows).
struct ChargerSpecsSkeletonColumn: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 80, height: 12)
            ForEach(0 ..< 3, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 56, height: 10)
                    Spacer(minLength: 0)
                    TSSkeleton(width: 64, height: 10)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Empty state (web `<EmptyState>`)

/// The no-data state (web `<EmptyState message="No charger specification data available yet" />`):
/// a friendly glyph plus the localized message, never a blank box.
struct ChargerSpecsEmptyState: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.slash")
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            ChargerSpecsStrings.text("charging.specs.noData", "No charger specification data available yet")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (QueryError equivalent)

/// The failure state (the P4 states contract's `QueryError` equivalent): an icon, a title, the
/// optional message, and a retry affordance wired to the model's refresh.
struct ChargerSpecsErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ChargerSpecsStrings.text("charging.specs.errorTitle", "Couldn't load charger specs")
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
                ChargerSpecsStrings.text("charging.specs.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChargerSpecsStrings.text("charging.specs.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct ChargerSpecsFreshnessChip: View {
    let connection: ChargerSpecsConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            ChargerSpecsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ChargerSpecsStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: ChargerSpecsConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "charging.specs.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "charging.specs.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "charging.specs.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not live, so cached
/// values are clearly labeled (web `DataFreshness` indicator intent).
struct ChargerSpecsConnectivityBanner: View {
    let connection: ChargerSpecsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "charging.specs.offlineBanner" : "charging.specs.staleBanner"
        let fallback = offline
            ? "Offline — showing last known charger specs"
            : "Reconnecting — charger specs may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            ChargerSpecsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
