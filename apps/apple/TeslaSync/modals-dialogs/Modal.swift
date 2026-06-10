//
//  Modal.swift
//  TeslaSync — P4 modal/dialog · 0014 · Modal (Apple)
//
//  The reusable surface modal — the SwiftUI parity of components/ui/Modal.tsx and the centerpiece of
//  this surface. It renders a dimming scrim (web blurred backdrop, tap-to-close) behind a size-aware
//  dialog: a centered card at/above the `sm` (640pt) breakpoint and a full-width, top-rounded bottom
//  sheet below it, with an optional titled header + 44pt close button, the caller content as a
//  scrolling body, swipe-to-dismiss on the sheet, Esc-to-dismiss on macOS, and the full dialog
//  accessibility contract (web `role="dialog"` + `aria-modal` + `aria-labelledby`/`aria-label`).
//
//  Two entry points mirror the web's single shared `<Modal>`:
//    • `Modal(isPresented:…)`        — embed directly (previews, hosted surfaces).
//    • `.tsModal(isPresented:…)`     — present over existing content (the web caller pattern).
//    • `ModalSurface(model:)`        — the bound P4 leaf: binds `ModalModel` (P1/S8), renders every
//                                      body state, and emits the `view.opened` event (P1/S11).
//

import SwiftUI

// MARK: - Reusable container (web `<Modal>`)

/// The reusable modal overlay. Generic over the body content (web `children`) and an optional header
/// accessory (the freshness chip the bound surface injects). When `isPresented` is false it renders
/// nothing (web `if (!open) return null`).
public struct Modal<MainContent: View, HeaderTrailing: View>: View {
    private let isPresented: Bool
    private let title: String?
    private let ariaLabel: String?
    private let size: ModalSize
    private let onClose: () -> Void
    private let headerTrailing: () -> HeaderTrailing
    private let content: () -> MainContent

    init(
        isPresented: Bool,
        title: String?,
        ariaLabel: String?,
        size: ModalSize,
        onClose: @escaping () -> Void,
        @ViewBuilder headerTrailing: @escaping () -> HeaderTrailing,
        @ViewBuilder content: @escaping () -> MainContent
    ) {
        self.isPresented = isPresented
        self.title = title
        self.ariaLabel = ariaLabel
        self.size = size
        self.onClose = onClose
        self.headerTrailing = headerTrailing
        self.content = content
    }

    public var body: some View {
        if isPresented {
            GeometryReader { proxy in
                let metrics = ModalMetrics.resolve(size: size, viewport: proxy.size)
                ZStack(alignment: metrics.pinsToBottom ? .bottom : .center) {
                    ModalScrim(onTap: onClose)
                    ModalDialogSurface(
                        metrics: metrics,
                        title: title,
                        accessibilityLabel: resolvedAccessibilityLabel,
                        onClose: onClose,
                        headerTrailing: headerTrailing,
                        bodyContent: content
                    )
                    .modifier(ModalDismissGesture(enabled: metrics.pinsToBottom, onDismiss: onClose))
                    .padding(.horizontal, metrics.pinsToBottom ? 0 : ModalAdapter.cardInset)
                }
                .frame(width: proxy.size.width, height: proxy.size.height)
                .modalEscapeDismiss(onClose)
            }
            .ignoresSafeArea()
            .transition(.opacity)
        }
    }

    private var resolvedAccessibilityLabel: String {
        let label = ModalProjection.resolveLabel(title: title, ariaLabel: ariaLabel)
        return ModalAccessibility.dialogLabel(for: label, localize: ModalStrings.string)
    }
}

public extension Modal where HeaderTrailing == EmptyView {
    /// Convenience initializer with no header accessory (the common caller path).
    init(
        isPresented: Bool,
        title: String? = nil,
        ariaLabel: String? = nil,
        size: ModalSize = .medium,
        onClose: @escaping () -> Void,
        @ViewBuilder content: @escaping () -> MainContent
    ) {
        self.init(
            isPresented: isPresented,
            title: title,
            ariaLabel: ariaLabel,
            size: size,
            onClose: onClose,
            headerTrailing: { EmptyView() },
            content: content
        )
    }
}

// MARK: - Presentation modifier (web caller pattern)

public extension View {
    /// Presents a `Modal` over the receiver (web `<Modal open … />` rendered into a portal). The
    /// scrim, close button, swipe, and Esc all clear the binding.
    func tsModal(
        isPresented: Binding<Bool>,
        title: String? = nil,
        ariaLabel: String? = nil,
        size: ModalSize = .medium,
        @ViewBuilder content: @escaping () -> some View
    ) -> some View {
        overlay {
            Modal(
                isPresented: isPresented.wrappedValue,
                title: title,
                ariaLabel: ariaLabel,
                size: size,
                onClose: { isPresented.wrappedValue = false },
                content: content
            )
            .animation(.easeInOut(duration: TSMotion.normalDuration), value: isPresented.wrappedValue)
        }
    }
}

// MARK: - Bound surface (P4 leaf)

/// The bound modal surface: binds `ModalModel` (P1/S8), renders every body state (loading / empty /
/// error / data) with the freshness chip + connectivity banner, routes dismiss + retry through the
/// model, and emits the `view.opened` diagnostics event (P1/S11) on first appearance. The `.data`
/// phase renders the caller-provided content (web `children`).
public struct ModalSurfaceView<DataContent: View>: View {
    @State private var model: ModalModel
    private let dataContent: () -> DataContent

    public init(model: ModalModel, @ViewBuilder content: @escaping () -> DataContent) {
        _model = State(initialValue: model)
        dataContent = content
    }

    public var body: some View {
        Modal(
            isPresented: model.isPresented,
            title: model.title,
            ariaLabel: model.ariaLabel,
            size: model.size,
            onClose: { model.close() },
            headerTrailing: { headerTrailing },
            content: {
                ModalBody(
                    phase: model.bodyPhase,
                    connection: model.connection,
                    onRetry: { model.refresh() },
                    content: dataContent
                )
            }
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    @ViewBuilder private var headerTrailing: some View {
        if model.connection != .live {
            ModalFreshnessChip(connection: model.connection)
        }
    }
}

public extension ModalSurfaceView {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        ModalSurface.slug
    }
}

// MARK: - Swipe-to-dismiss (bottom sheet)

/// Swipe-down dismissal for the compact bottom sheet — the native affordance for the web full-screen
/// mobile sheet. Tracks a downward drag and dismisses past a threshold; no-op for the centered card.
private struct ModalDismissGesture: ViewModifier {
    let enabled: Bool
    let onDismiss: () -> Void
    @State private var dragOffset: CGFloat = 0

    func body(content: Content) -> some View {
        if enabled {
            content
                .offset(y: max(0, dragOffset))
                .gesture(dragGesture)
                .animation(.interactiveSpring(response: 0.3), value: dragOffset)
        } else {
            content
        }
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                dragOffset = max(0, value.translation.height)
            }
            .onEnded { value in
                if value.translation.height > 120 {
                    onDismiss()
                }
                dragOffset = 0
            }
    }
}

// MARK: - Esc dismissal (macOS)

private extension View {
    /// Wires Esc-to-dismiss on macOS (web Esc handler). A no-op on iOS, where the swipe + scrim +
    /// close button provide dismissal.
    @ViewBuilder
    func modalEscapeDismiss(_ onClose: @escaping () -> Void) -> some View {
        #if os(macOS)
            onExitCommand(perform: onClose)
        #else
            self
        #endif
    }
}
