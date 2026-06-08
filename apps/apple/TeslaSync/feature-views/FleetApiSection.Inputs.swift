//
//  FleetApiSection.Inputs.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  The surface-local input + presentation primitives the tool cards compose:
//  the labeled text field / textarea / vehicle picker (ports of `Input` /
//  `Textarea` / `Select`), the copy button + monospaced code row (ports of
//  `CopyButton` + the code rows), the amber warning callout, and the tappable
//  freshness chip (ADR-013). Token-driven + localized through the surface i18n
//  facade. Split from FleetApiSection.Chrome.swift to respect the house file length.
//

import SwiftUI

// MARK: - Labeled field / textarea (ports of `Input` / `Textarea`)

/// A labeled single-line text field with a leading icon (port of `Input`).
struct FleetField: View {
    let labelKey: String
    let labelFallback: String
    let promptKey: String
    let promptFallback: String
    var systemImage: String?
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            FleetApiStrings.text(labelKey, labelFallback)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            HStack(spacing: TSSpacing.sm) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
                TextField(text: $text, prompt: Text(verbatim: FleetApiStrings.string(promptKey, promptFallback))) {
                    FleetApiStrings.text(labelKey, labelFallback)
                }
                .labelsHidden()
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
            }
            .padding(.horizontal, TSSpacing.sm)
            .frame(minHeight: 40)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .accessibilityElement(children: .combine)
    }
}

/// A labeled multi-line text area (port of `Textarea`).
struct FleetTextArea: View {
    let labelKey: String
    let labelFallback: String
    let promptKey: String
    let promptFallback: String
    var minHeight: CGFloat = 84
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            FleetApiStrings.text(labelKey, labelFallback)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            TextField(
                text: $text,
                prompt: Text(verbatim: FleetApiStrings.string(promptKey, promptFallback)),
                axis: .vertical
            ) {
                FleetApiStrings.text(labelKey, labelFallback)
            }
            .labelsHidden()
            .textFieldStyle(.plain)
            .font(.system(size: 12, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(3 ... 8)
            .padding(TSSpacing.sm)
            .frame(minHeight: minHeight, alignment: .topLeading)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Vehicle picker (port of `Select`)

/// A labeled vehicle picker over the model's vehicle options (port of `Select`).
struct FleetVehiclePicker: View {
    let labelKey: String
    let labelFallback: String
    let options: [VehicleOption]
    @Binding var selection: String

    private var unselectedLabel: String {
        FleetApiStrings.string("devtools.fleet.selectVehicle", "Select a vehicle")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            FleetApiStrings.text(labelKey, labelFallback)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Picker(selection: $selection) {
                Text(verbatim: unselectedLabel).tag("")
                ForEach(options) { option in
                    Text(verbatim: option.label).tag(option.vin)
                }
            } label: {
                FleetApiStrings.text(labelKey, labelFallback)
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .tint(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            .padding(.horizontal, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(FleetApiStrings.text(labelKey, labelFallback))
    }
}

// MARK: - Copy button + code row (ports of `CopyButton` + the mono code rows)

/// A compact copy-to-clipboard button (port of `CopyButton`).
struct FleetCopyButton: View {
    let value: String

    var body: some View {
        Button {
            FleetClipboard.copy(value)
        } label: {
            Image(systemName: "doc.on.doc")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(FleetApiStrings.text("devtools.fleet.copy", "Copy"))
    }
}

/// A monospaced code row with a trailing copy button (port of the `code` rows).
struct FleetCodeRow: View {
    let value: String
    var tone: FleetTone = .cyan
    var systemImage: String?

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            if let systemImage {
                Image(systemName: systemImage).foregroundStyle(tone.color).accessibilityHidden(true)
            }
            Text(verbatim: value)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(tone.color)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
            FleetCopyButton(value: value)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
    }
}

// MARK: - Warning callout (port of the amber `GlassPanel` warnings)

/// An amber warning callout (port of the `Prerequisites` / `Private Key` panels).
struct FleetWarningCallout: View {
    let titleKey: String?
    let titleFallback: String?
    let bodyKey: String
    let bodyFallback: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                if let titleKey, let titleFallback {
                    FleetApiStrings.text(titleKey, titleFallback)
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                }
                FleetApiStrings.text(bodyKey, bodyFallback)
                    .font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.statusWarning)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusWarning.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.2), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (ADR-013)

/// The tappable section freshness chip: a status dot + connectivity glyph +
/// relative-time / status label. Tapping refreshes the shared queries.
struct FleetFreshnessChip: View {
    let freshness: FleetFreshness
    var updatedAt: Date?
    let onRefresh: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spin = false

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Image(systemName: symbol)
                    .font(.system(size: 9, weight: .semibold))
                    .rotationEffect(.degrees(isSpinning ? 360 : 0))
                    .animation(spinAnimation, value: spin)
                Text(verbatim: label).font(Font.TS.caption).monospacedDigit()
            }
            .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .onAppear { spin = freshness == .fetching }
        .onChange(of: freshness) { _, value in spin = value == .fetching }
        .accessibilityLabel(FleetApiStrings.text("devtools.fleet.freshness.refresh", "Refresh"))
        .accessibilityValue(Text(verbatim: FleetApiAccessibility.freshnessLabel(freshness)))
    }

    private var isSpinning: Bool {
        freshness == .fetching && !reduceMotion && spin
    }

    private var spinAnimation: Animation? {
        reduceMotion ? nil : .linear(duration: 1).repeatForever(autoreverses: false)
    }

    private var tone: Color {
        switch freshness {
        case .fresh: Color.TS.statusSuccess
        case .fetching: Color.TS.statusInfo
        case .stale: Color.TS.statusWarning
        case .error: Color.TS.statusDanger
        case .offline: Color.TS.textMuted
        }
    }

    private var symbol: String {
        switch freshness {
        case .fresh, .stale: "wifi"
        case .fetching: "arrow.triangle.2.circlepath"
        case .error, .offline: "wifi.slash"
        }
    }

    private var label: String {
        switch freshness {
        case .fetching: FleetApiStrings.string("devtools.fleet.freshness.updating", "Updating…")
        case .error: FleetApiStrings.string("devtools.fleet.freshness.error", "Error")
        case .offline: FleetApiStrings.string("devtools.fleet.freshness.offline", "Offline")
        case .fresh, .stale:
            updatedAt.map { FleetApiBuilder.relativeTime(since: $0) }
                ?? FleetApiAccessibility.freshnessLabel(freshness)
        }
    }
}
