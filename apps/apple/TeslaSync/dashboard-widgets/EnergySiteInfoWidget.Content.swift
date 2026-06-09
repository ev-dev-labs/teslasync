//
//  EnergySiteInfoWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0047 · EnergySiteInfoWidget (Apple)
//
//  The loaded-content sub-views for EnergySiteInfoWidget, split out of the surface file so each stays
//  focused. `EnergySiteInfoDetailCard` is the SwiftUI parity of the web `WidgetDetailCard`
//  (features/dashboard/widgets/shared/WidgetDetailCard.tsx): a scrollable list of label / value rows
//  with hairline separators and the monospaced treatment on the gateway-firmware row.
//

import SwiftUI

// MARK: - Detail card (web `WidgetDetailCard`)

/// A scrollable list of label / value rows, the native parity of the web `WidgetDetailCard`. Rows
/// are separated by hairline dividers (web `border-b border-white/[0.06]`) and the absent value is
/// rendered as the em-dash exactly as `{entry.value ?? '—'}` does.
struct EnergySiteInfoDetailCard: View {
    let entries: [EnergySiteInfoDetailEntry]

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 0) {
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    EnergySiteInfoDetailRow(entry: entry)
                    if index < entries.count - 1 {
                        Rectangle()
                            .fill(Color.TS.border)
                            .frame(height: 1)
                            .accessibilityHidden(true)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

// MARK: - Detail row (web `WidgetDetailCard` row)

/// One label / value row. The label is uppercased + muted (web `text-[10px] uppercase
/// text-[var(--text-muted)]`); the value is primary-colored, right-aligned, and monospaced when the
/// entry requests it (the gateway-firmware row's `mono: true`).
struct EnergySiteInfoDetailRow: View {
    let entry: EnergySiteInfoDetailEntry

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            Text(verbatim: entry.label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.4)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: TSSpacing.sm)
            valueText
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .minimumScaleFactor(0.7)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, TSSpacing.sm)
        .padding(.horizontal, 2)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(entry.label) \(entry.displayValue)"))
    }

    @ViewBuilder
    private var valueText: some View {
        if entry.mono {
            Text(verbatim: entry.displayValue).monospaced()
        } else {
            Text(verbatim: entry.displayValue)
        }
    }
}
