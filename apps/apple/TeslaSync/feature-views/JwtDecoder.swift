//
//  JwtDecoder.swift
//  TeslaSync — P4 feature view · 0018 · JwtDecoder (Apple)
//
//  The JWT decoder devtool — the SwiftUI parity of
//  features/admin/components/devtools/tools/JwtDecoder.tsx. A tool card with a
//  multi-line JWT input over a live-decoded header + payload, reproducing the
//  web composition (ToolCard + Textarea + ResultPanel) with native primitives,
//  the shared design system (P1/S9 tokens + components), P1/S10 i18n and full
//  VoiceOver / Dynamic Type / Reduce Motion support. No networking lives here;
//  decoding is a pure local computation in JwtDecoderModel (P1/S8 local state).
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension JwtDecoderStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in
    /// the model file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - JwtDecoderView (the devtool surface)

/// The composable JWT decoder surface — the SwiftUI parity of
/// `features/admin/components/devtools/tools/JwtDecoder.tsx`. Renders every
/// branch from the web source (idle / invalid / decoded), binding through
/// `JwtDecoderModel`. No networking lives here.
public struct JwtDecoderView: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = JwtDecoderSurface.slug

    @State private var model: JwtDecoderModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: JwtDecoderModel = JwtDecoderModel()) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        return JwtToolCard(
            systemImage: "key.horizontal.fill",
            tint: Color.TS.chartSeriesPower,
            title: JwtDecoderStrings.string("Jwt Decoder", "JWT Decoder"),
            description: JwtDecoderStrings.string(
                "Jwt Decoder Desc",
                "Decode a JSON Web Token's header and payload."
            )
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                JwtInputField(text: $model.input)
                results
                    .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: model.result)
            }
        }
        .onAppear { model.start() }
        .accessibilityElement(children: .contain)
    }

    // MARK: Result branches (web: error / header / payload conditionals)

    @ViewBuilder
    private var results: some View {
        switch model.result {
        case .idle:
            idleHint
        case .invalid:
            invalidNotice
        case let .decoded(header, payload):
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                JwtResultPanel(
                    title: JwtDecoderStrings.string("Jwt Header", "Header"),
                    json: header
                )
                JwtResultPanel(
                    title: JwtDecoderStrings.string("Jwt Payload", "Payload"),
                    json: payload
                )
            }
            .transition(.opacity)
        }
    }

    /// Friendly idle state — the web renders nothing here, but a native surface
    /// should never show a blank box, so we explain what to do.
    private var idleHint: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "text.viewfinder")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            JwtDecoderStrings.text(
                "jwtDecoder.idleHint",
                "Paste a JWT above to decode its header and payload."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
    }

    /// The single "Invalid Jwt" error the web shows in rose text.
    private var invalidNotice: some View {
        let message = JwtDecoderStrings.string("Invalid Jwt", "Invalid JWT")
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.body)
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            Color.TS.statusDanger.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: message))
        .accessibilityAddTraits(.isStaticText)
    }
}

// MARK: - Tool card (web `ToolCard`)

/// A titled glass tool card with a tinted leading glyph — the native parity of
/// the web devtools `ToolCard` (`GlassPanel` + icon badge + title + description).
private struct JwtToolCard<Content: View>: View {
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

// MARK: - Input field (web `Textarea`)

/// A labelled multi-line JWT input with an example hint when empty — the native
/// parity of the web `Textarea` (rows 3, example token hint). Token-styled to
/// match the shared `TSTextArea` chrome; adds an accessible label + hint.
private struct JwtInputField: View {
    @Binding var text: String

    private let exampleToken = "eyJhbGciOiJSUzI1NiIs..."

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            JwtDecoderStrings.text("Jwt Input", "JWT")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(verbatim: exampleToken)
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(Color.TS.textMuted)
                        .padding(.horizontal, TSSpacing.sm + 5)
                        .padding(.vertical, TSSpacing.sm + 8)
                        .accessibilityHidden(true)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $text)
                    .font(.system(.body, design: .monospaced))
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 84)
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
                    .accessibilityLabel(JwtDecoderStrings.text("Jwt Input", "JWT"))
                    .accessibilityHint(
                        JwtDecoderStrings.text("jwtDecoder.inputHint", "Paste the JSON Web Token to decode.")
                    )
            }
        }
    }
}

// MARK: - Result panel (web `ResultPanel`)

/// A titled panel rendering pretty-printed JSON with a copy affordance — the
/// native parity of the web devtools `ResultPanel` (data variant): success-tinted
/// surface, title + copy button, scrollable monospaced JSON.
private struct JwtResultPanel: View {
    let title: String
    let json: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Text(verbatim: title)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                TSCopyButton(value: json)
            }
            ScrollView {
                Text(verbatim: json)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(TSSpacing.sm)
            }
            .frame(maxHeight: 256)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusSuccess.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: title))
    }
}
