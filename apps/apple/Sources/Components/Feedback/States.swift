import SwiftUI

/// Inline loading spinner with optional label (web `Spinner`).
public struct TSSpinner: View {
    private let label: LocalizedStringKey?

    public init(label: LocalizedStringKey? = nil) {
        self.label = label
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            if let label {
                Text(label).font(Font.TS.bodySm).foregroundStyle(Color.TS.textSecondary)
            }
        }
        .accessibilityLabel(Text(label ?? "loading"))
    }
}

/// Centered page loader (web `PageLoader`).
public struct TSPageLoader: View {
    private let label: LocalizedStringKey

    public init(label: LocalizedStringKey = "loading") {
        self.label = label
    }

    public var body: some View {
        VStack(spacing: TSSpacing.md) {
            ProgressView()
            TSCaption(label)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Empty/no-content state (web `EmptyState`) over `ContentUnavailableView`.
public struct TSEmptyState<Actions: View>: View {
    private let title: LocalizedStringKey
    private let message: LocalizedStringKey?
    private let systemImage: String
    private let actions: () -> Actions

    public init(
        title: LocalizedStringKey,
        message: LocalizedStringKey? = nil,
        systemImage: String = "tray",
        @ViewBuilder actions: @escaping () -> Actions
    ) {
        self.title = title
        self.message = message
        self.systemImage = systemImage
        self.actions = actions
    }

    public var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            if let message { Text(message) }
        } actions: {
            actions()
        }
    }
}

public extension TSEmptyState where Actions == EmptyView {
    init(title: LocalizedStringKey, message: LocalizedStringKey? = nil, systemImage: String = "tray") {
        self.init(title: title, message: message, systemImage: systemImage) { EmptyView() }
    }
}

/// Error state with an optional retry (web `ErrorDisplay`).
public struct TSErrorDisplay: View {
    private let title: LocalizedStringKey
    private let message: LocalizedStringKey?
    private let onRetry: (() -> Void)?

    public init(
        title: LocalizedStringKey = "error.title",
        message: LocalizedStringKey? = nil,
        onRetry: (() -> Void)? = nil
    ) {
        self.title = title
        self.message = message
        self.onRetry = onRetry
    }

    public var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 32))
                .foregroundStyle(Color.TS.statusDanger)
            Text(title).font(Font.TS.panel).foregroundStyle(Color.TS.textPrimary)
            if let message {
                Text(message).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            if let onRetry {
                TSButton("action.retry", variant: .secondary, size: .small, action: onRetry)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

/// Query failure state with retry (web `QueryError`).
public struct TSQueryError: View {
    private let message: LocalizedStringKey?
    private let onRetry: () -> Void

    public init(message: LocalizedStringKey? = nil, onRetry: @escaping () -> Void) {
        self.message = message
        self.onRetry = onRetry
    }

    public var body: some View {
        TSErrorDisplay(title: "error.queryTitle", message: message ?? "error.queryMessage", onRetry: onRetry)
    }
}

/// Renders a fallback error state when `hasError`, else its content
/// (web `ErrorBoundary`). SwiftUI has no render-time catch, so the error
/// condition is supplied by the caller.
public struct TSErrorBoundary<Content: View>: View {
    private let hasError: Bool
    private let onRetry: (() -> Void)?
    private let content: () -> Content

    public init(hasError: Bool, onRetry: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.hasError = hasError
        self.onRetry = onRetry
        self.content = content
    }

    public var body: some View {
        if hasError {
            TSErrorDisplay(message: "error.boundaryMessage", onRetry: onRetry)
        } else {
            content()
        }
    }
}

/// Section-scoped error boundary (web `SectionErrorBoundary`).
public struct TSSectionErrorBoundary<Content: View>: View {
    private let hasError: Bool
    private let onRetry: (() -> Void)?
    private let content: () -> Content

    public init(hasError: Bool, onRetry: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.hasError = hasError
        self.onRetry = onRetry
        self.content = content
    }

    public var body: some View {
        if hasError {
            TSInlineCallout(tone: .danger, message: "error.sectionMessage")
                .overlay(alignment: .trailing) {
                    if let onRetry {
                        TSButton("action.retry", variant: .ghost, size: .small, action: onRetry)
                    }
                }
        } else {
            content()
        }
    }
}

/// Full-page error boundary (web `PageErrorBoundary`).
public struct TSPageErrorBoundary<Content: View>: View {
    private let hasError: Bool
    private let onRetry: (() -> Void)?
    private let content: () -> Content

    public init(hasError: Bool, onRetry: (() -> Void)? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.hasError = hasError
        self.onRetry = onRetry
        self.content = content
    }

    public var body: some View {
        if hasError {
            TSErrorDisplay(title: "error.pageTitle", message: "error.pageMessage", onRetry: onRetry)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            content()
        }
    }
}

/// Authentication-required state with a sign-in action (web `RequiresAuth`).
public struct TSRequiresAuth: View {
    private let onSignIn: () -> Void

    public init(onSignIn: @escaping () -> Void) {
        self.onSignIn = onSignIn
    }

    public var body: some View {
        TSEmptyState(title: "auth.requiredTitle", message: "auth.requiredMessage", systemImage: "lock.fill") {
            TSButton("auth.signIn", action: onSignIn)
        }
    }
}

/// Indeterminate top progress bar (web `TopProgress`). Honors Reduce Motion.
public struct TSTopProgress: View {
    private let isActive: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var slide = false

    public init(isActive: Bool) {
        self.isActive = isActive
    }

    public var body: some View {
        GeometryReader { geo in
            if isActive {
                Capsule()
                    .fill(Color.TS.accent)
                    .frame(width: geo.size.width * 0.3)
                    .offset(x: reduceMotion ? 0 : (slide ? geo.size.width * 0.7 : -geo.size.width * 0.3))
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: 1).repeatForever(autoreverses: false),
                        value: slide
                    )
                    .onAppear { slide = true }
            }
        }
        .frame(height: 2)
        .accessibilityHidden(true)
    }
}

/// Accessibility "skip to content" affordance (web `SkipToContent`).
public struct TSSkipToContent: View {
    private let onActivate: () -> Void

    public init(onActivate: @escaping () -> Void) {
        self.onActivate = onActivate
    }

    public var body: some View {
        Button("a11y.skipToContent", action: onActivate)
            .buttonStyle(.plain)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.accent)
            .accessibilityHint(Text("a11y.skipToContentHint"))
    }
}

/// Floating "jump to" indicator (web `GotoIndicator`).
public struct TSGotoIndicator: View {
    private let label: LocalizedStringKey
    private let onTap: () -> Void

    public init(label: LocalizedStringKey, onTap: @escaping () -> Void) {
        self.label = label
        self.onTap = onTap
    }

    public var body: some View {
        Button(action: onTap) {
            HStack(spacing: TSSpacing.xs) {
                Text(label).font(Font.TS.caption)
                Image(systemName: "arrow.down.circle.fill")
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.accent, in: Capsule())
            .foregroundStyle(Color.white)
        }
        .buttonStyle(.plain)
    }
}
