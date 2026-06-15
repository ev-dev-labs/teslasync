import SwiftUI
#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Shared DevTools view primitives (web `ToolCard` + chips/rows)

/// Card surface for a tool/section (web `ToolCard`): a glass panel with an icon box,
/// localized title + description, and caller content below.
struct DevToolsToolCard<Content: View>: View {
    let title: LocalizedStringKey
    let detail: LocalizedStringKey
    let systemImage: String
    let tone: TSTone
    @ViewBuilder var content: () -> Content

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    TSIconBox(systemName: systemImage, tone: tone)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .font(Font.TS.panel)
                            .foregroundStyle(Color.TS.textPrimary)
                        Text(detail)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                    Spacer(minLength: 0)
                }
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// HTTP-verb badge tinted by method (web `Badge` GET=info / POST=warning).
struct DevToolsMethodBadge: View {
    let method: String

    private var tone: TSTone {
        switch method.uppercased() {
        case "GET": .info
        case "POST": .warning
        case "DELETE": .danger
        default: .accent
        }
    }

    var body: some View {
        Text(verbatim: method.uppercased())
            .font(Font.TS.label)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: method.uppercased()))
    }
}

/// Monospaced chip for a verbatim technical token (web telemetry field chip).
struct DevToolsTokenChip: View {
    let token: String

    var body: some View {
        Text(verbatim: token)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(Text(verbatim: token))
    }
}

/// Labeled key/value row: a localized label with a verbatim, selectable value
/// (web tool result rows — label localized, computed value rendered as data).
struct DevToolsResultRow: View {
    let label: LocalizedStringKey
    let value: String
    var tone: TSTone = .neutral

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: value)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(tone == .neutral ? Color.TS.textPrimary : tone.color)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}

/// Inline error for a dynamic (non-localizable) tool message — e.g. a JSON parser's
/// own message (web renders `e.message` verbatim). The leading label is localized.
struct DevToolsInlineError: View {
    let message: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 11))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.statusDanger)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("devtools.error.label"))
        .accessibilityValue(Text(verbatim: message))
    }
}

/// Cross-platform copy-to-clipboard button (web `CopyButton`).
struct DevToolsCopyButton: View {
    let value: String

    var body: some View {
        Button(action: copy) {
            Image(systemName: "doc.on.doc")
                .font(.system(size: 12))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.accent)
        .accessibilityLabel(Text("devtools.action.copy"))
    }

    private func copy() {
        #if canImport(UIKit)
            UIPasteboard.general.string = value
        #elseif canImport(AppKit)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(value, forType: .string)
        #endif
    }
}

/// A copyable monospaced output block (web tool `<pre>` + CopyButton).
struct DevToolsOutputBlock: View {
    let label: LocalizedStringKey
    let value: String
    var tone: TSTone = .info

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Text(label)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: 0)
                DevToolsCopyButton(value: value)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                Text(verbatim: value)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(tone.color)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
    }
}
