//
//  RequestBuilder.Views.swift
//  TeslaSync — P4 feature view · 0040 · RequestBuilder (Apple)
//
//  Presentational subviews for the request builder — the method badge, the URL bar
//  with the send control, the destructive-confirm banner, the section panels (the web
//  `GlassPanel` material), the path/query parameter rows, the request-body editor, and
//  the authentication panel. All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9), reusing the shared `TSButton` and the `.tsGlassPanel()` material.
//

import SwiftUI

// MARK: - Accent role → token color (web METHOD_COLORS)

extension RequestAccentRole {
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .info: Color.TS.statusInfo
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .accent: Color.TS.accent
        case .neutral: Color.TS.textMuted
        }
    }
}

// MARK: - Field chrome (shared by the inputs + body editor)

/// Token surface + rounded border for the text inputs (the web `Input` chrome).
private struct RequestFieldChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
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

// MARK: - Method badge (web MethodBadge)

/// The colored monospaced method chip (web `MethodBadge`), tinted by the method's
/// accent role.
struct RequestMethodBadge: View {
    let method: RequestBuilderHTTPMethod

    private var accessibilityText: String {
        let prefix = RequestBuilderStrings.string("a11y.requestBuilder.method", "Method")
        return "\(prefix) \(method.rawValue)"
    }

    var body: some View {
        Text(verbatim: method.rawValue)
            .font(.system(size: 11, weight: .bold, design: .monospaced))
            .foregroundStyle(method.accentRole.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .frame(minWidth: 52)
            .background(
                method.accentRole.color.opacity(0.18),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - URL bar (web method badge + code + Send)

/// The top row: the method badge, the scrollable `/api/v1…` code, and the send
/// control whose label flips to "Sending…" while a request is in flight.
struct RequestURLBar: View {
    let method: RequestBuilderHTTPMethod
    let displayURL: String
    let isLoading: Bool
    let onSend: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            RequestMethodBadge(method: method)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(verbatim: displayURL)
                    .font(.system(.callout, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.sm)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
                Text(verbatim: RequestBuilderStrings.string("a11y.requestBuilder.url", "Request URL"))
            )
            .accessibilityValue(Text(verbatim: displayURL))
            sendButton
        }
    }

    private var sendButton: some View {
        TSButton(variant: .primary, size: .medium, action: onSend) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .accessibilityHidden(true)
                if isLoading {
                    RequestBuilderStrings.text("playground.sending", "Sending...")
                } else {
                    RequestBuilderStrings.text("playground.send", "Send")
                }
            }
        }
        .disabled(isLoading)
        .fixedSize()
    }
}

// MARK: - Destructive confirm banner (web confirmOpen row)

/// The amber confirmation row shown before a non-GET request is sent.
struct RequestConfirmBanner: View {
    let method: RequestBuilderHTTPMethod
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            Text(verbatim: RequestBuilderStrings.confirmMessage(method: method))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.statusWarning)
                .frame(maxWidth: .infinity, alignment: .leading)
            TSButton(variant: .primary, size: .small, action: onConfirm) {
                RequestBuilderStrings.text("playground.confirmYes", "Yes, send")
            }
            TSButton(variant: .ghost, size: .small, action: onCancel) {
                RequestBuilderStrings.text("playground.cancel", "Cancel")
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.statusWarning.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Endpoint summary + description (web summary/description copy)

/// The endpoint's summary and (when different) longer description.
struct RequestEndpointSummary: View {
    let summary: String
    let description: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if !summary.isEmpty {
                Text(verbatim: summary)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !description.isEmpty, description != summary {
                Text(verbatim: description)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

// MARK: - Section panel (web GlassPanel + uppercase header)

/// A `.tsGlassPanel()` card with an uppercase muted header (web `GlassPanel` + `h4`),
/// an optional trailing accessory (the body content-type), and arbitrary content.
struct RequestSectionPanel<Content: View>: View {
    let titleKey: String
    let titleFallback: String
    var accessory: String?
    @ViewBuilder var content: () -> Content

    init(
        titleKey: String,
        titleFallback: String,
        accessory: String? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.accessory = accessory
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                RequestBuilderStrings.text(titleKey, titleFallback)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.TS.textMuted)
                if let accessory, !accessory.isEmpty {
                    Text(verbatim: accessory)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(Color.TS.textMuted)
                }
                Spacer(minLength: 0)
            }
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
    }
}

// MARK: - Parameter row (web path/query Input row)

/// A single parameter editor: the monospaced name (with a required marker) above a
/// token text field whose prompt is the parameter description or type.
struct RequestParameterRow: View {
    let name: String
    let required: Bool
    let promptText: String
    @Binding var value: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: 3) {
                Text(verbatim: name)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
                if required {
                    Text(verbatim: "*")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.statusDanger)
                        .accessibilityLabel(
                            RequestBuilderStrings.text("a11y.requestBuilder.required", "Required")
                        )
                }
            }
            TextField("", text: $value, prompt: Text(verbatim: promptText))
                .textFieldStyle(.plain)
                .font(.system(.caption, design: .monospaced))
                .autocorrectionDisabled(true)
                .modifier(RequestFieldChrome())
                .accessibilityLabel(Text(verbatim: name))
        }
    }
}

// MARK: - Request body editor (web Textarea)

/// The monospaced body editor with a faint example overlay while empty (native
/// `TextEditor` has no prompt), mirroring the web `Textarea`.
struct RequestBodyEditor: View {
    @Binding var text: String

    private var example: String {
        RequestBuilderStrings.string("requestBuilder.bodyExample", "{ \"key\": \"value\" }")
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(verbatim: example)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
                    .padding(.horizontal, TSSpacing.sm + 4)
                    .padding(.vertical, TSSpacing.sm + 4)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            TextEditor(text: $text)
                .font(.system(.caption, design: .monospaced))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 150)
                .padding(.horizontal, TSSpacing.xs)
                .padding(.vertical, TSSpacing.xs)
                .autocorrectionDisabled(true)
        }
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityLabel(RequestBuilderStrings.text("a11y.requestBuilder.body", "Request body"))
    }
}

// MARK: - Authentication panel (web Authentication (Optional) GlassPanel)

/// The optional `X-API-Key` section: a masked field plus the session-auth hint.
struct RequestAuthPanel: View {
    @Binding var apiKey: String

    private static let apiKeyPromptKey = "playground.apiKeyPlaceholder" // parity:allow web i18n key

    private var prompt: String {
        RequestBuilderStrings.string(Self.apiKeyPromptKey, "Leave empty to use session auth")
    }

    var body: some View {
        RequestSectionPanel(titleKey: "playground.authHeader", titleFallback: "Authentication (Optional)") {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(verbatim: "X-API-Key")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
                SecureField("", text: $apiKey, prompt: Text(verbatim: prompt))
                    .textFieldStyle(.plain)
                    .font(.system(.caption, design: .monospaced))
                    .modifier(RequestFieldChrome())
                    .accessibilityLabel(Text(verbatim: "X-API-Key"))
                RequestBuilderStrings.text(
                    "playground.authHint",
                    "Requests use your browser session by default. Enter an API key to test key-based auth."
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            }
        }
    }
}
