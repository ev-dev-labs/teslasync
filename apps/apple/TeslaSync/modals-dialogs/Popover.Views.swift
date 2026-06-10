//
//  Popover.Views.swift
//  TeslaSync — P4 modal / dialog · 0015 · Popover (Apple)
//
//  The visual composition of the `Popover` primitive: the elevated surface chrome (the web
//  `rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)] text-[var(--text-primary)]
//  shadow-xl` card) and the inline, manually-positioned `PopoverContainer` that lays its content out
//  within a bounded coordinate space using `PopoverGeometry` — the faithful runtime analogue of the
//  web `position: fixed; top; left` portal (flip + align + viewport clamp), with backdrop / Esc
//  dismiss and a measuring (hidden) frame while it sizes. The window-level "attach to a trigger"
//  entry point is the `popoverSurface` modifier in Popover.swift. Chrome via P1/S9 tokens; copy via
//  P1/S10 (`PopoverStrings`).
//

import SwiftUI

// MARK: - Content-size measurement

/// Reports the popover content's measured size up to the container (web
/// `content.getBoundingClientRect()` feeding `compute()`).
private struct PopoverContentSizeKey: PreferenceKey {
    static let defaultValue: CGSize = .zero
    static func reduce(value: inout CGSize, nextValue: () -> CGSize) {
        let next = nextValue()
        if next != .zero { value = next }
    }
}

/// Applies the hardware-Esc dismiss on macOS (web Esc key) and is a no-op on iOS, where the VoiceOver
/// `.escape` action already covers the gesture. Keeps the surface chain platform-clean.
private struct PopoverEscapeDismiss: ViewModifier {
    let action: () -> Void

    func body(content: Content) -> some View {
        #if os(macOS)
            content.onExitCommand(perform: action)
        #else
            content
        #endif
    }
}

// MARK: - Surface chrome (web popover card)

/// The elevated popover surface — a continuous-radius card with the semantic glass border, surface
/// fill, primary text color, and an elevation shadow. Faithfully maps the web content `<div>`'s
/// classes; the high-contrast `forced-colors` arm is covered by the dynamic design tokens.
public struct PopoverSurface<Content: View>: View {
    private let cornerRadius: CGFloat
    private let content: Content

    public init(cornerRadius: CGFloat = TSRadius.md, @ViewBuilder content: () -> Content) {
        self.cornerRadius = cornerRadius
        self.content = content()
    }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    }

    public var body: some View {
        content
            .foregroundStyle(Color.TS.textPrimary)
            .background(Color.TS.surface, in: shape)
            .clipShape(shape)
            .overlay(shape.strokeBorder(Color.TS.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.18), radius: 16, x: 0, y: 8)
    }
}

/// The empty-children fallback (web renders an empty surface for empty `children`): a muted,
/// localized line so the popover is never an unlabeled blank box.
public struct PopoverEmptyContent: View {
    private let label: String

    public init(label: String) {
        self.label = label
    }

    public var body: some View {
        Text(verbatim: label)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Inline container (faithful `compute()` positioning)

/// An inline popover positioned with `PopoverGeometry` inside its own bounds. The caller supplies the
/// `anchor` rect in the container's coordinate space (e.g. from a `GeometryReader` on the trigger);
/// the container reports its bounds as the viewport, measures the surface, resolves the placement
/// (flipping + clamping like the web `compute()`), and renders a hidden frame until positioned (web
/// `pos === null` → `visibility: hidden`). Backdrop tap / Esc dismiss; the system handles focus for
/// the window-level `popoverSurface` modifier.
public struct PopoverContainer<Content: View>: View {
    @Bindable private var model: PopoverModel
    private let anchor: CGRect
    private let content: Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AccessibilityFocusState private var contentFocused: Bool

    public init(model: PopoverModel, anchor: CGRect, @ViewBuilder content: () -> Content) {
        _model = Bindable(model)
        self.anchor = anchor
        self.content = content()
    }

    public var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                if model.isPresented {
                    backdrop
                    surface
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
            .onAppear { ingest(viewport: proxy.size) }
            .onChange(of: proxy.size) { _, size in ingest(viewport: size) }
            .onChange(of: anchor) { _, rect in model.updateAnchor(rect) }
            .onChange(of: model.isPresented) { _, open in contentFocused = open }
        }
    }

    /// The transparent dismiss layer filling the container behind the surface (web click-outside →
    /// `onClose`). Hidden from VoiceOver; the surface owns the escape action.
    private var backdrop: some View {
        Color.clear
            .contentShape(Rectangle())
            .onTapGesture { model.dismiss() }
            .accessibilityHidden(true)
    }

    /// The positioned surface. Rendered transparent + non-interactive while measuring, then offset to
    /// the resolved origin and faded in (Reduce Motion → instant).
    private var surface: some View {
        let placed = model.placement != nil
        return PopoverSurface {
            content
                .frame(maxWidth: maxWidth, maxHeight: maxHeight)
        }
        .fixedSize()
        .background(sizeReader)
        .offset(x: model.placement?.left ?? 0, y: model.placement?.top ?? 0)
        .opacity(placed ? 1 : 0)
        .allowsHitTesting(placed)
        .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: model.placement)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.regionAccessibilityLabel))
        .accessibilityFocused($contentFocused)
        .accessibilityAction(.escape) { model.dismiss() }
        .modifier(PopoverEscapeDismiss(action: { model.dismiss() }))
    }

    private var sizeReader: some View {
        GeometryReader { proxy in
            Color.clear.preference(key: PopoverContentSizeKey.self, value: proxy.size)
        }
        .onPreferenceChange(PopoverContentSizeKey.self) { size in
            model.updateContent(size)
        }
    }

    /// Width cap from the engine (0 → unmeasured → no cap).
    private var maxWidth: CGFloat? {
        let width = model.contentMaxSize.width
        return width > 0 ? width : nil
    }

    /// Height cap from the engine (0 → unmeasured → no cap; content scrolls inside the cap).
    private var maxHeight: CGFloat? {
        let height = model.contentMaxSize.height
        return height > 0 ? height : nil
    }

    private func ingest(viewport: CGSize) {
        model.updateViewport(viewport)
        model.updateAnchor(anchor)
    }
}
