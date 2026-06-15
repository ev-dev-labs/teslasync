import SwiftUI

// MARK: - Encode/decode mode (web Base64/URL `mode` toggle)

enum DevToolsCodecMode: Hashable {
    case encode, decode
}

/// Encode/decode segmented toggle shared by the Base64 + URL tools.
struct DevToolsModePicker: View {
    @Binding var mode: DevToolsCodecMode

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(
                "devtools.action.encode",
                variant: mode == .encode ? .primary : .ghost,
                size: .small
            ) { mode = .encode }
            TSButton(
                "devtools.action.decode",
                variant: mode == .decode ? .primary : .ghost,
                size: .small
            ) { mode = .decode }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Base64 (web `Base64Tool`)

struct DevToolsBase64Tool: View {
    @State private var mode: DevToolsCodecMode = .encode
    @State private var input = ""

    private var decoded: String? {
        DevToolsUtilities.base64Decode(input)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            DevToolsModePicker(mode: $mode)
            TSTextArea(text: $input, label: "devtools.field.input", minHeight: 72)
            if input.isEmpty {
                EmptyView()
            } else if mode == .encode {
                DevToolsOutputBlock(label: "devtools.field.output", value: DevToolsUtilities.base64Encode(input))
            } else if let decoded {
                DevToolsOutputBlock(label: "devtools.field.output", value: decoded)
            } else {
                TSErrorText("devtools.error.invalidInput")
            }
        }
    }
}

// MARK: - URL encoder (web `UrlEncoderTool`)

struct DevToolsUrlTool: View {
    @State private var mode: DevToolsCodecMode = .encode
    @State private var input = ""

    private var decoded: String? {
        DevToolsUtilities.urlDecode(input)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            DevToolsModePicker(mode: $mode)
            TSTextArea(text: $input, label: "devtools.field.input", minHeight: 72)
            if input.isEmpty {
                EmptyView()
            } else if mode == .encode {
                DevToolsOutputBlock(label: "devtools.field.output", value: DevToolsUtilities.urlEncode(input))
            } else if let decoded {
                DevToolsOutputBlock(label: "devtools.field.output", value: decoded)
            } else {
                TSErrorText("devtools.error.invalidInput")
            }
        }
    }
}

// MARK: - JSON formatter (web `JsonFormatterTool`)

struct DevToolsJsonTool: View {
    @State private var input = ""

    var body: some View {
        let result = DevToolsUtilities.formatJSON(input)
        return VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSTextArea(text: $input, label: "devtools.field.jsonInput", minHeight: 96)
            if !result.error.isEmpty {
                DevToolsInlineError(message: result.error)
            } else if !result.formatted.isEmpty {
                DevToolsOutputBlock(
                    label: "devtools.field.formatted",
                    value: result.formatted,
                    tone: .success
                )
            }
        }
    }
}

// MARK: - JWT decoder (web `JwtDecoderTool`)

struct DevToolsJwtTool: View {
    @State private var input = ""

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSTextArea(text: $input, label: "devtools.field.jwtInput", minHeight: 80)
            if input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                EmptyView()
            } else if let decoded = DevToolsUtilities.decodeJWT(input) {
                DevToolsOutputBlock(label: "devtools.field.jwtHeader", value: decoded.header, tone: .accent)
                DevToolsOutputBlock(label: "devtools.field.jwtPayload", value: decoded.payload, tone: .accent)
            } else {
                TSErrorText("devtools.error.invalidJwt")
            }
        }
    }
}
