//
//  DataExportStyle.swift
//  TeslaSync — P4 feature view · P7 · DataExportPage (Apple) — Shared panel style
//
//  The web page wraps each section in a `GlassPanel`. Per ADR-005 the native peer
//  uses a system material (not hand-rolled glass) so the surface adapts across
//  light / dark / increased-contrast automatically. Centralised here so every
//  Data Export panel reads identically (DRY).
//

import SwiftUI

extension View {
    /// Wraps a section as a Data Export "glass" panel — padded, full-width, on a
    /// rounded `.regularMaterial` (web `GlassPanel`).
    func dataExportPanel(cornerRadius: CGFloat = 16) -> some View {
        padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                .regularMaterial,
                in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            )
    }
}

/// A compact status / type chip (web `<Badge>`): a toned label on a tinted capsule
/// that satisfies the repo's "neon only inside a tinted chip" rule.
struct DataExportChip: View {
    let text: String
    let systemImage: String?
    let tone: DataExportTone
    var isSpinning = false

    init(text: String, systemImage: String? = nil, tone: DataExportTone, isSpinning: Bool = false) {
        self.text = text
        self.systemImage = systemImage
        self.tone = tone
        self.isSpinning = isSpinning
    }

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
                    .symbolEffect(.rotate, options: .repeating, isActive: isSpinning)
            }
            Text(verbatim: text)
        }
        .font(.caption.weight(.medium))
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .foregroundStyle(tone.color)
        .background(tone.color.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}

/// A KPI tile (web `MetricCard`) — icon, value, label and an optional sub-label, on
/// a material panel. Used for the four export summary stats.
struct DataExportMetricCard: View {
    let label: String
    let value: String
    var subtitle: String?
    let systemImage: String
    let tone: DataExportTone

    init(
        label: String,
        value: String,
        subtitle: String? = nil,
        systemImage: String,
        tone: DataExportTone
    ) {
        self.label = label
        self.value = value
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.tone = tone
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(tone.color)
            Text(verbatim: value)
                .font(.title2.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(verbatim: label)
                .font(.caption)
                .foregroundStyle(.secondary)
            if let subtitle {
                Text(verbatim: subtitle)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .dataExportPanel(cornerRadius: 14)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(value)"))
    }
}
