//
//  WidgetComparisonCard.Views.swift
//  TeslaSync — P4 widget primitive · 0003 · WidgetComparisonCard (Apple)
//
//  The presentational pieces of the comparison card — the native peers of the web elements: the metric row
//  (web `MetricRow` — the leading label + formatted value + optional unit, and the trailing direction-aware
//  change indicator) and the friendly empty leaf (the native "never a blank box" peer of the web
//  `<p>No comparison data</p>`). The per-row change indicator is the shared ``Delta`` surface (0081), the
//  native peer of the web `<Delta metric={{ direction }} display="percent" size="sm" />`. All chrome is
//  token-driven (P1/S9); no raw hex, no Tailwind ports. The leading label/value column is folded into a
//  single VoiceOver element; the indicator keeps its own spoken "{current} vs {previous}" reading.
//

import SwiftUI

// MARK: - ComparisonMetricRow (web `MetricRow`)

/// A single comparison row — the native peer of the web `MetricRow`: a leading column (the muted, truncated
/// label over the semibold formatted value with its optional muted unit affix) and a trailing ``Delta``
/// that renders the direction-aware percent change against the previous period. A hairline separator sits
/// below every row except the last (web `border-b … last:border-b-0`). A pure function of its
/// ``ComparisonRow``, so it composes in every branch for snapshot / preview / test.
struct ComparisonMetricRow: View {
    let row: ComparisonRow

    /// Web `py-2.5` — the row's vertical breathing room (10pt).
    private let verticalPadding: CGFloat = 10
    /// Web `gap-0.5` — the label-to-value gap (2pt).
    private let labelValueGap: CGFloat = 2

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                leadingColumn
                Spacer(minLength: TSSpacing.sm)
                Delta(
                    metric: .inline(direction: row.direction, unit: nil),
                    current: row.current,
                    previous: row.previous,
                    display: .percent,
                    size: .sm
                )
            }
            .padding(.vertical, verticalPadding)
            if !row.isLast {
                Rectangle()
                    .fill(Color.TS.border)
                    .frame(height: 1)
            }
        }
        .accessibilityElement(children: .contain)
    }

    /// The leading label + value column (web `flex min-w-0 flex-col gap-0.5`). Combined into one VoiceOver
    /// element reading "{label}, {value}{unit}" so the row is scanned as a unit before the indicator.
    private var leadingColumn: some View {
        VStack(alignment: .leading, spacing: labelValueGap) {
            Text(verbatim: row.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
            valueLine
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    /// The formatted current value with its optional unit affix (web `text-base font-semibold` + the
    /// `ml-0.5 text-xs font-normal` unit span).
    private var valueLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: labelValueGap) {
            Text(verbatim: row.formattedCurrent)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            if let unit = row.unit, !unit.isEmpty {
                Text(verbatim: unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .lineLimit(1)
        .truncationMode(.tail)
    }

    private var accessibilityLabel: String {
        WidgetComparisonCardStrings.rowAccessibilityLabel(
            label: row.label,
            value: WidgetComparisonCardStrings.valueWithUnit(value: row.formattedCurrent, unit: row.unit)
        )
    }
}

// MARK: - WidgetComparisonCardEmptyState (web `<p>No comparison data</p>`)

/// The friendly empty leaf — the native "never a blank box" peer of the web `<p>No comparison data</p>`. A
/// centered icon over the headline (the verbatim web copy) and a supporting hint, combined into a single
/// VoiceOver element. Token-driven (P1/S9); copy via the P1/S10 facade.
struct WidgetComparisonCardEmptyState: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "arrow.up.arrow.down")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: WidgetComparisonCardStrings.emptyMessage)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: WidgetComparisonCardStrings.emptyHint)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: "\(WidgetComparisonCardStrings.emptyMessage). \(WidgetComparisonCardStrings.emptyHint)")
        )
    }
}
