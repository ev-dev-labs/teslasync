import SwiftUI
#if os(iOS)
    import UIKit
#elseif os(macOS)
    import AppKit
#endif

/// Cross-platform clipboard access (the only platform service this layer owns).
enum TSClipboard {
    @MainActor static func copy(_ value: String) {
        #if os(iOS)
            UIPasteboard.general.string = value
        #elseif os(macOS)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(value, forType: .string)
        #endif
    }
}

/// Copy-to-clipboard button with a transient confirmation (web `CopyButton`).
public struct TSCopyButton: View {
    private let value: String
    @State private var didCopy = false

    public init(value: String) {
        self.value = value
    }

    public var body: some View {
        Button {
            TSClipboard.copy(value)
            didCopy = true
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(1.5))
                didCopy = false
            }
        } label: {
            Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
        }
        .buttonStyle(.plain)
        .foregroundStyle(didCopy ? Color.TS.statusSuccess : Color.TS.textMuted)
        .accessibilityLabel(Text("action.copy"))
    }
}

/// Print trigger (web `PrintButton`). Printing is window/context dependent, so
/// the caller supplies the action (e.g. an injected print service).
public struct TSPrintButton: View {
    private let action: () -> Void

    public init(action: @escaping () -> Void) {
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: "printer")
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text("action.print"))
    }
}

/// Fullscreen toggle (web `FullscreenButton`). The actual window/presentation
/// change is owned by the caller via the binding.
public struct TSFullscreenButton: View {
    @Binding private var isFullscreen: Bool

    public init(isFullscreen: Binding<Bool>) {
        _isFullscreen = isFullscreen
    }

    public var body: some View {
        Button {
            isFullscreen.toggle()
        } label: {
            Image(
                systemName: isFullscreen
                    ? "arrow.down.right.and.arrow.up.left"
                    : "arrow.up.left.and.arrow.down.right"
            )
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text("action.fullscreen"))
    }
}

/// Secret value with reveal toggle (web `MaskedValue`).
public struct TSMaskedValue: View {
    private let value: String
    @State private var isRevealed: Bool

    public init(_ value: String, initiallyRevealed: Bool = false) {
        self.value = value
        _isRevealed = State(initialValue: initiallyRevealed)
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: isRevealed ? value : Self.mask(value))
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
            Button {
                isRevealed.toggle()
            } label: {
                Image(systemName: isRevealed ? "eye.slash" : "eye")
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(isRevealed ? "action.hide" : "action.reveal"))
        }
    }

    /// Replaces each character with a bullet (kept simple + testable).
    static func mask(_ value: String) -> String {
        String(repeating: "•", count: max(value.count, 1))
    }
}

/// Tap-to-edit inline text (web `EditableText`).
public struct TSEditableText: View {
    @Binding private var text: String
    private let prompt: LocalizedStringKey
    @State private var isEditing = false
    @FocusState private var isFocused: Bool

    public init(text: Binding<String>, prompt: LocalizedStringKey = "editable.prompt") {
        _text = text
        self.prompt = prompt
    }

    public var body: some View {
        Group {
            if isEditing {
                TextField(prompt, text: $text)
                    .textFieldStyle(.plain)
                    .font(Font.TS.body)
                    .focused($isFocused)
                    .onSubmit { isEditing = false }
            } else {
                Button {
                    isEditing = true
                    isFocused = true
                } label: {
                    Text(verbatim: text.isEmpty ? "—" : text)
                        .font(Font.TS.body)
                        .foregroundStyle(text.isEmpty ? Color.TS.textMuted : Color.TS.textPrimary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("action.edit"))
            }
        }
    }
}

/// Brand lockup (web `Logo`): mark + optional wordmark.
public struct TSLogo: View {
    private let showsWordmark: Bool

    public init(showsWordmark: Bool = true) {
        self.showsWordmark = showsWordmark
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "bolt.car.fill")
                .foregroundStyle(Color.TS.accent)
            if showsWordmark {
                Text(verbatim: "TeslaSync")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "TeslaSync"))
    }
}
