//
//  CommandPalette.Surface.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The public API of the command palette — the SwiftUI parity of `components/ui/CommandPalette.tsx`. The web
//  component is a keyboard-driven overlay (its own primitive, not a `Modal`): a dimmed backdrop behind a
//  top-anchored card with a search field, a grouped + frecency-ranked result list, a vehicle-select step for
//  multi-vehicle commands, and a footer of shortcut + scope hints. The native surface reproduces that with a
//  HIG-native overlay (a `Material` card, spring reveal honoring Reduce Motion, full keyboard support on
//  iPadOS / macOS) and binds through ``CommandPaletteModel`` (P1/S8); no networking or navigation lives in
//  the view. ``CommandPaletteTrigger`` is the sidebar entry point (web `CommandPaletteTrigger`).
//

import SwiftUI

// MARK: - Focus target

/// The two keyboard-focus targets inside the card — the search field (search mode) and the result list (the
/// vehicle-select step, where the web removes the input but still wires arrow / Enter / Backspace keys).
public enum CommandPaletteField: Hashable {
    case search
    case list
}

// MARK: - CommandPalette (the shared surface)

/// The command palette overlay — the SwiftUI parity of `CommandPalette.tsx`. Mount it once at the app root
/// (the web mounts it in `Layout`); it renders nothing until opened, then presents the dimmed backdrop + the
/// search card. Binds through ``CommandPaletteModel``.
public struct CommandPalette: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = CommandPaletteSurface.slug

    @State private var model: CommandPaletteModel
    @FocusState private var focusedField: CommandPaletteField?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Designated initializer binding a pre-built model — the host / preview / test seam.
    public init(model: CommandPaletteModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer building the model from the P1/S8 seams — the parity of mounting
    /// `<CommandPalette onOpen />` with the production source + runner.
    public init(
        source: any CommandPaletteSource,
        runner: any CommandPaletteRunner = LoggingCommandPaletteRunner(),
        telemetry: any CommandPaletteTelemetry = OSLogCommandPaletteTelemetry(),
        onOpen: (@MainActor () -> Void)? = nil
    ) {
        _model = State(initialValue: CommandPaletteModel(
            source: source,
            runner: runner,
            telemetry: telemetry,
            onOpen: onOpen
        ))
    }

    public var body: some View {
        ZStack {
            if model.isOpen {
                CommandPaletteBackdrop { model.close() }
                    .transition(.opacity)
                CommandPaletteCard(model: model, focus: $focusedField)
                    .transition(cardTransition)
                    .padding(.horizontal, TSSpacing.lg)
                    .frame(maxWidth: 560)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .padding(.top, TSSpacing.x4xl)
            }
        }
        .animation(revealAnimation, value: model.isOpen)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: model.isOpen) { _, open in
            focusedField = open ? .search : nil
        }
        .onChange(of: model.mode) { _, mode in
            guard model.isOpen else { return }
            focusedField = mode == .search ? .search : .list
        }
    }

    /// The card reveal — the native peer of the web spring entrance (scale + drop). Collapses to a fade under
    /// Reduce Motion so nothing translates.
    private var cardTransition: AnyTransition {
        reduceMotion
            ? .opacity
            : .scale(scale: 0.96, anchor: .top).combined(with: .opacity)
            .combined(with: .move(edge: .top))
    }

    private var revealAnimation: Animation? {
        reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.85)
    }
}

// MARK: - Backdrop (web dimmed overlay)

/// The dimmed, blurred backdrop behind the card — the native peer of the web `fixed inset-0 backdrop-blur`
/// overlay. A tap dismisses the palette (web `onClick={close}`). Hidden from VoiceOver as a decorative scrim
/// (the close action is also reachable from the card's close control).
struct CommandPaletteBackdrop: View {
    let onClose: () -> Void

    var body: some View {
        Rectangle()
            .fill(.ultraThinMaterial)
            .ignoresSafeArea()
            .overlay(Color.black.opacity(0.28).ignoresSafeArea())
            .contentShape(Rectangle())
            .onTapGesture { onClose() }
            .accessibilityHidden(true)
    }
}

// MARK: - CommandPaletteTrigger (web `CommandPaletteTrigger`)

/// The sidebar entry-point button — the SwiftUI parity of the web `CommandPaletteTrigger`. Renders a
/// magnifier + the localized prompt + a `⌘K` hint, and opens the palette via the supplied callback (the
/// native peer of the web `toggle-command-palette` custom event).
public struct CommandPaletteTrigger: View {
    private let onActivate: () -> Void

    public init(onActivate: @escaping () -> Void) {
        self.onActivate = onActivate
    }

    public var body: some View {
        Button(action: onActivate) {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: CommandPaletteStrings.triggerLabel)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                CommandPaletteKbd(text: "⌘K")
            }
            .padding(.horizontal, TSSpacing.lg)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: CommandPaletteStrings.triggerLabel))
    }
}

// MARK: - Keyboard cap (web `<kbd>`)

/// A small keycap chip — the native peer of the web `<kbd>` (the `ESC` / `↑↓` / `↵` / shortcut hints). Decorative
/// to VoiceOver; the meaning is carried by the adjacent label.
struct CommandPaletteKbd: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 2)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}
