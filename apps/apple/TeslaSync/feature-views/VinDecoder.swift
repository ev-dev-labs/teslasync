//
//  VinDecoder.swift
//  TeslaSync — P4 feature view · 0025 · VinDecoder (Apple)
//
//  The VIN decoder devtool — the SwiftUI parity of
//  features/admin/components/devtools/tools/VinDecoder.tsx. A tool card with a
//  single-line VIN input over a live-decoded field grid, reproducing the web
//  composition (ToolCard + Input + decoded grid) with native primitives, the
//  shared design system (P1/S9 tokens + components), P1/S10 i18n and full
//  VoiceOver / Dynamic Type / Reduce Motion support. No networking lives here;
//  decoding is a pure local computation in VinDecoderModel (P1/S8 local state).
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension VinDecoderStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in
    /// the model file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - VinDecoderView (the devtool surface)

/// The composable VIN decoder surface — the SwiftUI parity of
/// `features/admin/components/devtools/tools/VinDecoder.tsx`. Renders both
/// branches from the web source (no-result when the VIN is too short, and the
/// decoded field grid), binding through `VinDecoderModel`. No networking here.
public struct VinDecoderView: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VinDecoderSurface.slug

    @State private var model: VinDecoderModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: VinDecoderModel = VinDecoderModel()) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        return VinToolCard(
            systemImage: "car.fill",
            tint: Color.TS.accent,
            title: VinDecoderStrings.string("Vin Decoder", "VIN Decoder"),
            description: VinDecoderStrings.string(
                "Vin Decoder Desc",
                "Decode a Tesla VIN into its manufacturer, model, drivetrain, model year, and assembly plant."
            )
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                VinInputField(text: $model.input)
                results
                    .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: model.result)
            }
        }
        .onAppear { model.start() }
        .accessibilityElement(children: .contain)
    }

    // MARK: Result branches (web: `{decoded && …}` conditional)

    @ViewBuilder
    private var results: some View {
        if let decoded = model.result {
            VinResultGrid(fields: decoded.fields)
                .transition(.opacity)
        } else {
            VinIdleHint()
        }
    }
}

// MARK: - Tool card (web `ToolCard`)

/// A titled glass tool card with a tinted leading glyph — the native parity of
/// the web devtools `ToolCard` (`GlassPanel` + icon badge + title + description).
private struct VinToolCard<Content: View>: View {
    let systemImage: String
    let tint: Color
    let title: String
    let description: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    Image(systemName: systemImage)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(tint)
                        .frame(width: 40, height: 40)
                        .background(
                            tint.opacity(0.10),
                            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                                .strokeBorder(tint.opacity(0.20), lineWidth: 1)
                        )
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        Text(verbatim: title)
                            .font(Font.TS.panel)
                            .foregroundStyle(Color.TS.textPrimary)
                            .accessibilityAddTraits(.isHeader)
                        Text(verbatim: description)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                content()
            }
        }
    }
}

// MARK: - Input field (web `Input` with leading icon)

/// A labelled single-line VIN input with a leading car glyph and an example VIN
/// prompt when empty — the native parity of the web `Input` (label "Vin", car
/// icon, example value). Token-styled to match the shared field chrome; adds an
/// accessible label + hint. The model upper-cases for decoding, mirroring the web
/// `toUpperCase()`, so the live grid agrees regardless of typed case.
private struct VinInputField: View {
    @Binding var text: String

    private let exampleVin = "5YJ3E1EA1NF000001"

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            VinDecoderStrings.text("Vin", "VIN")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "car.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                TextField("", text: $text, prompt: Text(verbatim: exampleVin))
                    .textFieldStyle(.plain)
                    .font(.system(.body, design: .monospaced))
                    .autocorrectionDisabled()
                    .accessibilityLabel(VinDecoderStrings.text("Vin", "VIN"))
                    .accessibilityHint(
                        VinDecoderStrings.text(
                            "vinDecoder.inputHint",
                            "Type or paste a 17-character Tesla VIN to decode."
                        )
                    )
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
    }
}

// MARK: - Result grid (web `grid sm:grid-cols-2`)

/// The decoded VIN field grid — a one-column (narrow) / two-column (wide)
/// adaptive grid of labelled value tiles, the native parity of the web
/// `grid gap-2 sm:grid-cols-2` mapping over the decoded entries.
private struct VinResultGrid: View {
    let fields: [VinField]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.sm)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(fields) { field in
                VinFieldTile(field: field)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Field tile (web decoded entry cell)

/// A single decoded VIN entry — the `devtools.utils.vin_<key>` label over the
/// value (the localized "Unknown" when the position had no table match), the
/// native parity of the web `rounded bg-[var(--surface-overlay)]` cell.
private struct VinFieldTile: View {
    let field: VinField

    private var displayValue: String {
        field.value ?? VinDecoderStrings.string("Unknown", "Unknown")
    }

    private var label: String {
        VinDecoderStrings.string(field.labelKey, VinFieldTile.fallbackLabels[field.key] ?? field.key)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: displayValue)
                .font(Font.TS.body.weight(.medium))
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityValue(Text(verbatim: displayValue))
    }

    /// English fallback labels for the web `devtools.utils.vin_<key>` keys (which
    /// the web catalog leaves unfilled). The native P1/S10 catalog supplies proper
    /// copy; these mirror the `.strings` values so the view never shows a raw key.
    private static let fallbackLabels: [String: String] = [
        "mfr": "Manufacturer",
        "model": "Model",
        "drive": "Drivetrain",
        "year": "Model Year",
        "plant": "Plant",
        "serial": "Serial"
    ]
}

// MARK: - No-result state (web renders no entry rows)

/// The friendly no-result state shown before a decodable VIN is entered — the web
/// renders nothing here, but a native surface should never show a blank box, so
/// it explains what to do.
private struct VinIdleHint: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "barcode.viewfinder")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            VinDecoderStrings.text(
                "vinDecoder.idleHint",
                "Enter at least 11 characters of a VIN to decode it."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
    }
}
