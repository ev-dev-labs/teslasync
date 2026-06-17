//
//  DataExportWizardComponents.swift
//  TeslaSync — P4 feature view · P7 · DataExportPage (Apple) — Wizard sub-views
//
//  The reusable wizard controls: the data-type card grid (web `ExportTypeSelector`,
//  parity panel `GlassPanel11`), the format chooser (web `FormatSelector`), and the
//  date-range presets (web `DatePresetSelector`). Each binds purely to view state /
//  callbacks — no networking (ADR-004) — and is fully localized, accessible and
//  adaptive across size classes.
//

import SwiftUI

// MARK: - Date presets (web `DATE_PRESETS`)

/// A quick date-range preset (web `{ labelKey, label, days }`). `allTime` (0 days)
/// submits with no date bounds.
enum DataExportDatePreset: Int, CaseIterable, Identifiable, Sendable {
    case last7 = 7
    case last30 = 30
    case last90 = 90
    case lastYear = 365
    case allTime = 0

    var id: Int { rawValue }
    var days: Int { rawValue }

    var localizedLabel: String {
        switch self {
        case .last7: String(localized: "dataExport.presets.last7", defaultValue: "Last 7 Days")
        case .last30: String(localized: "dataExport.presets.last30", defaultValue: "Last 30 Days")
        case .last90: String(localized: "dataExport.presets.last90", defaultValue: "Last 90 Days")
        case .lastYear: String(localized: "dataExport.presets.lastYear", defaultValue: "Last Year")
        case .allTime: String(localized: "dataExport.presets.allTime", defaultValue: "All Time")
        }
    }
}

// MARK: - Type selector (web `ExportTypeSelector` — parity `GlassPanel11`)

struct DataExportTypeSelector: View {
    let selected: DataExportType
    let onSelect: (DataExportType) -> Void

    private let columns = [GridItem(.adaptive(minimum: 220), spacing: 12)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(DataExportType.allCases) { type in
                card(type)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            Text(String(localized: "dataExport.wizard.step1", defaultValue: "STEP 1 — Select Data Type"))
        )
    }

    private func card(_ type: DataExportType) -> some View {
        let active = type == selected
        return Button {
            onSelect(type)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    Image(systemName: type.systemImage)
                        .font(.body)
                        .foregroundStyle(active ? type.tone.color : Color.secondary)
                    Text(verbatim: type.localizedLabel)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(active ? Color.primary : Color.secondary)
                    Spacer(minLength: 0)
                }
                Text(verbatim: type.localizedDescription)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.quaternary.opacity(active ? 0.5 : 0.25), in: cardShape)
            .overlay {
                cardShape.strokeBorder(active ? type.tone.color : .clear, lineWidth: 2)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: type.localizedLabel))
        .accessibilityValue(Text(verbatim: type.localizedDescription))
        .accessibilityAddTraits(active ? [.isButton, .isSelected] : .isButton)
    }

    private var cardShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
    }
}

// MARK: - Format selector (web `FormatSelector`)

struct DataExportFormatSelector: View {
    @Binding var selected: DataExportFormat

    var body: some View {
        Picker(selection: $selected) {
            ForEach(DataExportFormat.allCases) { format in
                Label(format.localizedLabel, systemImage: format.systemImage).tag(format)
            }
        } label: {
            Text(String(localized: "Format", defaultValue: "Format"))
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .accessibilityLabel(Text(String(localized: "Format", defaultValue: "Format")))
    }
}

// MARK: - Date preset selector (web `DatePresetSelector`)

struct DataExportPresetSelector: View {
    /// The selected preset days, or `-1` when a custom range is active.
    let selectedDays: Int
    let onSelect: (Int) -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { chips }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) { chips }
            }
        }
    }

    @ViewBuilder
    private var chips: some View {
        ForEach(DataExportDatePreset.allCases) { preset in
            let active = selectedDays == preset.days
            Button {
                onSelect(preset.days)
            } label: {
                Text(verbatim: preset.localizedLabel)
                    .font(.caption.weight(.medium))
                    .fixedSize()
            }
            .buttonStyle(.bordered)
            .tint(active ? .accentColor : .secondary)
            .accessibilityAddTraits(active ? [.isSelected] : [])
        }
    }
}
