//
//  VehicleSpecsWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0109 · VehicleSpecsWidget (Apple)
//
//  The content-phase body of the surface: the compact (cols ≤ 1) headline layout
//  and the standard detail-card list (web `WidgetDetailCard`), plus the option
//  badge chip. Split from VehicleSpecsWidget.swift to keep each file focused.
//

import Foundation
import SwiftUI

// MARK: - Content body (compact + standard layouts)

extension VehicleSpecsWidget {
    @ViewBuilder
    var contentBody: some View {
        if isCompact {
            compactContent
        } else {
            standardContent
        }
    }

    /// ── Compact (1×2): doc icon + model headline + "Trim: …" (web `CompactView`) ──
    var compactContent: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "doc.text")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: projection.compact.model)
                .font(Font.TS.bodySm)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            Text(verbatim: compactTrimText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.horizontal, TSSpacing.sm)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: compactAccessibilityLabel))
    }

    /// Web ``{t('widget.specs.trim','Trim')}: {trim}``.
    private var compactTrimText: String {
        "\(SpecsStrings.string("widget.specs.trim", "Trim")): \(projection.compact.trim)"
    }

    private var compactAccessibilityLabel: String {
        let model = SpecsStrings.string("widget.specs.model", "Model")
        return "\(model): \(projection.compact.model). \(compactTrimText)"
    }

    /// ── Standard / Wide (2×4+): the full detail-card list (web `WidgetDetailCard`) ──
    var standardContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if connection != .live {
                    connectivityBanner
                        .padding(.bottom, TSSpacing.sm)
                }
                detailList
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: SpecsAccessibility.summary(for: projection)))
    }
}

// MARK: - Detail list (web `WidgetDetailCard` rows)

extension VehicleSpecsWidget {
    private var detailList: some View {
        let rows = projection.entries
        return VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, entry in
                detailRow(entry)
                if index < rows.count - 1 {
                    Rectangle()
                        .fill(Color.TS.border)
                        .frame(height: 1)
                        .accessibilityHidden(true)
                }
            }
        }
    }

    private func detailRow(_ entry: SpecEntry) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: entry.label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.5)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: entry.value)
                    .font(entry.mono ? Font.TS.bodySm.monospaced() : Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if let badge = entry.badge {
                    SpecChip(text: badge, tone: .neutral)
                }
            }
        }
        .padding(.vertical, TSSpacing.sm)
        .padding(.horizontal, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(entry.label): \(entry.value)"))
    }
}

// MARK: - SpecChip (verbatim-text capsule — web `<Badge size="sm">`)

/// A capsule chip styled with the shared `TSBadge` design tokens, but rendering a
/// *verbatim* (already-localized) string. The shared `TSBadge` accepts only a
/// `LocalizedStringKey`, which would re-localize a pre-resolved label; this chip
/// avoids that double-localization.
private struct SpecChip: View {
    let text: String
    let tone: TSTone

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: text))
    }
}
