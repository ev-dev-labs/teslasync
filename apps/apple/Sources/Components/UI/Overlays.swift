import SwiftUI

// Presentation wrappers (web Modal/Drawer/Popover/Tooltip/Lightbox). These are
// honest binding/content wrappers over native presentation — they don't assume
// app/window context.

public extension View {
    /// Presents `content` in a titled sheet (web `Modal`).
    func tsModal(
        isPresented: Binding<Bool>,
        title: LocalizedStringKey,
        @ViewBuilder content: @escaping () -> some View
    ) -> some View {
        sheet(isPresented: isPresented) {
            TSModalContainer(title: title, isPresented: isPresented, content: content)
        }
    }

    /// Presents `content` in a popover (web `Popover`). On compact iOS this
    /// adapts to a sheet automatically.
    func tsPopover(
        isPresented: Binding<Bool>,
        @ViewBuilder content: @escaping () -> some View
    ) -> some View {
        popover(isPresented: isPresented) {
            content().padding(TSSpacing.md)
        }
    }

    /// Attaches a native help tooltip (macOS hover / accessibility hint).
    func tsTooltip(_ text: LocalizedStringKey) -> some View {
        help(Text(text))
    }

    /// Slides `drawer` in from an edge over a dimming scrim (web `Drawer`).
    func tsDrawer(
        isPresented: Binding<Bool>,
        edge: TSDrawerEdge = .trailing,
        width: CGFloat = 320,
        @ViewBuilder drawer: @escaping () -> some View
    ) -> some View {
        modifier(TSDrawerModifier(isPresented: isPresented, edge: edge, width: width, drawer: drawer))
    }

    /// Presents `content` full-bleed over a dark scrim with a close affordance.
    func tsLightbox(
        isPresented: Binding<Bool>,
        @ViewBuilder content: @escaping () -> some View
    ) -> some View {
        modifier(TSLightboxModifier(isPresented: isPresented, lightContent: content))
    }
}

/// Edge a `TSDrawer` slides from.
public enum TSDrawerEdge {
    case leading, trailing

    var swiftUIEdge: Edge {
        self == .trailing ? .trailing : .leading
    }

    var alignment: Alignment {
        self == .trailing ? .trailing : .leading
    }
}

private struct TSModalContainer<ModalContent: View>: View {
    let title: LocalizedStringKey
    @Binding var isPresented: Bool
    @ViewBuilder let content: () -> ModalContent

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                TSPanelTitle(title)
                Spacer()
                Button {
                    isPresented = false
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("action.close"))
            }
            .padding(TSSpacing.lg)
            Divider().overlay(Color.TS.border)
            content().padding(TSSpacing.lg)
        }
    }
}

private struct TSDrawerModifier<Drawer: View>: ViewModifier {
    @Binding var isPresented: Bool
    let edge: TSDrawerEdge
    let width: CGFloat
    @ViewBuilder let drawer: () -> Drawer

    func body(content: Content) -> some View {
        content.overlay {
            if isPresented {
                ZStack(alignment: edge.alignment) {
                    Color.black.opacity(0.35)
                        .ignoresSafeArea()
                        .onTapGesture { isPresented = false }
                    drawer()
                        .frame(maxWidth: width, maxHeight: .infinity, alignment: .topLeading)
                        .background(Color.TS.surface)
                        .transition(.move(edge: edge.swiftUIEdge))
                }
                .animation(.easeInOut(duration: TSMotion.normalDuration), value: isPresented)
            }
        }
    }
}

private struct TSLightboxModifier<Light: View>: ViewModifier {
    @Binding var isPresented: Bool
    @ViewBuilder let lightContent: () -> Light

    func body(content: Content) -> some View {
        content.overlay {
            if isPresented {
                ZStack(alignment: .topTrailing) {
                    Color.black.opacity(0.9)
                        .ignoresSafeArea()
                        .onTapGesture { isPresented = false }
                    lightContent()
                    Button {
                        isPresented = false
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title)
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                    .padding(TSSpacing.lg)
                    .accessibilityLabel(Text("action.close"))
                }
                .transition(.opacity)
            }
        }
    }
}

/// Inline help affordance: a "?" button revealing help text in a popover.
public struct TSHelpTooltip: View {
    private let text: LocalizedStringKey
    @State private var isShowing = false

    public init(_ text: LocalizedStringKey) {
        self.text = text
    }

    public var body: some View {
        Button {
            isShowing.toggle()
        } label: {
            Image(systemName: "questionmark.circle")
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("action.help"))
        .popover(isPresented: $isShowing) {
            TSText(text)
                .padding(TSSpacing.md)
                .frame(maxWidth: 260)
        }
        .help(Text(text))
    }
}
