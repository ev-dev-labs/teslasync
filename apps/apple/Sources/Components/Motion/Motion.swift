import SwiftUI

/// Fades + lifts content in on appear (web `FadeIn`). Honors Reduce Motion.
public struct TSFadeIn<Content: View>: View {
    private let delay: Double
    private let content: () -> Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    public init(delay: Double = 0, @ViewBuilder content: @escaping () -> Content) {
        self.delay = delay
        self.content = content
    }

    public var body: some View {
        content()
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 8)
            .onAppear {
                if reduceMotion {
                    shown = true
                } else {
                    withAnimation(.easeOut(duration: TSMotion.normalDuration).delay(delay)) { shown = true }
                }
            }
    }
}

/// Container for staggered children (web `StaggerContainer`). Children use
/// `TSStaggerItem` with their index to derive the cascade delay.
public struct TSStaggerContainer<Content: View>: View {
    private let spacing: CGFloat
    private let content: () -> Content

    public init(spacing: CGFloat = TSSpacing.md, @ViewBuilder content: @escaping () -> Content) {
        self.spacing = spacing
        self.content = content
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            content()
        }
    }
}

/// One staggered child (web `StaggerItem`): fades in with an index-based delay.
public struct TSStaggerItem<Content: View>: View {
    private let index: Int
    private let content: () -> Content

    public init(index: Int, @ViewBuilder content: @escaping () -> Content) {
        self.index = index
        self.content = content
    }

    public var body: some View {
        TSFadeIn(delay: Double(index) * 0.05, content: content)
    }
}

/// Crossfades content when its identity changes (web `RouteTransition`).
public struct TSRouteTransition<Content: View>: View {
    private let transitionID: AnyHashable
    private let content: () -> Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(id: AnyHashable, @ViewBuilder content: @escaping () -> Content) {
        transitionID = id
        self.content = content
    }

    public var body: some View {
        content()
            .id(transitionID)
            .transition(reduceMotion ? .identity : .opacity)
            .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: transitionID)
    }
}

/// Looping car glyph animation (web `CarAnimation`). Static under Reduce Motion.
public struct TSCarAnimation: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var moving = false

    public init() {}

    public var body: some View {
        Image(systemName: "car.fill")
            .font(.system(size: 28))
            .foregroundStyle(Color.TS.accent)
            .offset(x: moving && !reduceMotion ? 16 : -16)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)) {
                    moving = true
                }
            }
            .accessibilityHidden(true)
    }
}
