import SwiftUI

/// Visual emphasis for `TSButton`.
public enum TSButtonVariant { case primary, secondary, ghost, destructive }

/// Control size for `TSButton` (drives padding + font).
public enum TSButtonSize { case small, medium, large }

/// Token-driven button mirroring the web `Button`. HIG-native (uses `Button`),
/// supports a loading state, and works on macOS (pointer) + iOS (44pt targets).
public struct TSButton<Label: View>: View {
    private let variant: TSButtonVariant
    private let size: TSButtonSize
    private let isLoading: Bool
    private let action: () -> Void
    private let label: () -> Label

    public init(
        variant: TSButtonVariant = .primary,
        size: TSButtonSize = .medium,
        isLoading: Bool = false,
        action: @escaping () -> Void,
        @ViewBuilder label: @escaping () -> Label
    ) {
        self.variant = variant
        self.size = size
        self.isLoading = isLoading
        self.action = action
        self.label = label
    }

    public var body: some View {
        Button(action: action) {
            ZStack {
                label().opacity(isLoading ? 0 : 1)
                if isLoading {
                    ProgressView().controlSize(.small)
                }
            }
        }
        .buttonStyle(TSButtonStyle(variant: variant, size: size))
        .disabled(isLoading)
    }
}

public extension TSButton where Label == Text {
    /// Convenience for a plain localized title.
    init(
        _ title: LocalizedStringKey,
        variant: TSButtonVariant = .primary,
        size: TSButtonSize = .medium,
        isLoading: Bool = false,
        action: @escaping () -> Void
    ) {
        self.init(variant: variant, size: size, isLoading: isLoading, action: action) {
            Text(title)
        }
    }
}

/// Shared button styling (fill/stroke/foreground per variant, padding per size).
struct TSButtonStyle: ButtonStyle {
    let variant: TSButtonVariant
    let size: TSButtonSize

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(font)
            .fontWeight(.semibold)
            .foregroundStyle(foreground)
            .padding(.horizontal, horizontalPadding)
            .padding(.vertical, verticalPadding)
            .frame(minHeight: minHeight)
            .background(background, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: variant == .secondary ? 1 : 0)
            )
            .opacity(configuration.isPressed ? 0.85 : 1)
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }

    private var font: Font {
        size == .small ? Font.TS.caption : Font.TS.body
    }

    private var minHeight: CGFloat {
        switch size {
        case .small: 28
        case .medium: 36
        case .large: 44
        }
    }

    private var horizontalPadding: CGFloat {
        switch size {
        case .small: TSSpacing.sm
        case .medium: TSSpacing.md
        case .large: TSSpacing.lg
        }
    }

    private var verticalPadding: CGFloat {
        size == .small ? TSSpacing.xs : TSSpacing.sm
    }

    private var foreground: Color {
        switch variant {
        case .primary, .destructive: .white
        case .secondary: Color.TS.textPrimary
        case .ghost: Color.TS.accent
        }
    }

    private var background: Color {
        switch variant {
        case .primary: Color.TS.accent
        case .destructive: Color.TS.statusDanger
        case .secondary: Color.TS.surface
        case .ghost: Color.clear
        }
    }
}

#if DEBUG
    #Preview("Buttons") {
        VStack(spacing: TSSpacing.md) {
            TSButton("button.primary") {}
            TSButton("button.secondary", variant: .secondary) {}
            TSButton("button.ghost", variant: .ghost) {}
            TSButton("button.destructive", variant: .destructive) {}
            TSButton("button.loading", isLoading: true) {}
        }
        .padding()
    }
#endif
