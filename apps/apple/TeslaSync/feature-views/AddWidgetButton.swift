//
//  AddWidgetButton.swift
//  TeslaSync — P4 feature view · 0121 · AddWidgetButton (Apple)
//
//  Native, Apple-idiomatic parity of the web `AddWidgetButton`
//  (features/dashboard/components/AddWidgetButton.tsx).
//
//  A floating "+" action button that opens the widget catalogue from any
//  dashboard view. It owns no data — exactly like the web component — so the
//  data-bound states (loading / error / stale / offline) belong to the embedding
//  dashboard, not to the FAB. The only branch the web source carries is
//  `if (isEditing) return null`: the FAB hides in edit mode because the header
//  already exposes an "Add Widget" action. That branch is reproduced by
//  ``AddWidgetButtonPresentation/isVisible``.
//
//  Like the web `fixed bottom-20 right-6` wrapper, the view self-anchors to the
//  bottom-trailing safe area so a dashboard can drop it straight into its root
//  ZStack / overlay. On appear it emits the P1/S11 `view.opened` diagnostics
//  event with ``AddWidgetButtonSurface/slug``.
//

import SwiftUI

// MARK: - AddWidgetButton

public struct AddWidgetButton: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`); the canonical source.
    /// `nonisolated` because it is a compile-time constant — `View` is
    /// `@MainActor`, but the slug must be readable from any context (tests,
    /// telemetry adapters) without a main-actor hop.
    public nonisolated static let surfaceSlug = AddWidgetButtonSurface.slug

    private let presentation: AddWidgetButtonPresentation
    private let action: () -> Void
    private let telemetry: any AddWidgetButtonTelemetry

    /// Designated initialiser.
    /// - Parameters:
    ///   - isEditing: whether the dashboard is in edit mode (web `isEditing`).
    ///     When `true` the FAB renders nothing, mirroring the web
    ///     `if (isEditing) return null`.
    ///   - action: invoked on tap — typically opens the widget catalogue
    ///     (web `onClick`).
    ///   - telemetry: diagnostics sink; defaults to the `os_log` sink.
    public init(
        isEditing: Bool,
        action: @escaping () -> Void,
        telemetry: any AddWidgetButtonTelemetry = OSLogAddWidgetButtonTelemetry()
    ) {
        presentation = AddWidgetButtonPresentation(isEditing: isEditing)
        self.action = action
        self.telemetry = telemetry
    }

    public var body: some View {
        // web: `if (isEditing) return null;` — render nothing in edit mode.
        if presentation.isVisible {
            anchoredButton
        }
    }
}

// MARK: - Composition

private extension AddWidgetButton {
    /// The FAB pinned to the bottom-trailing safe area (web `fixed bottom-20
    /// right-6`). The expanding frame is transparent and non-interactive, so taps
    /// outside the circular button pass through to the dashboard below. The
    /// `view.opened` event fires here — the container exists only while the FAB
    /// is visible, so edit mode never emits a spurious open.
    var anchoredButton: some View {
        fabButton
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            .padding(.trailing, AddWidgetButtonPresentation.trailingInset)
            .padding(.bottom, AddWidgetButtonPresentation.bottomInset)
            .task { AddWidgetButtonSurface.reportOpen(to: telemetry) }
    }

    /// The circular accent FAB — the native read of the web `<Button variant=
    /// "primary" size="lg" className="h-14 w-14 rounded-full p-0 shadow-xl">` with
    /// the lucide `Plus` glyph. The pointer `.help` reproduces the web `Tooltip`;
    /// the accessible name + hint cover VoiceOver. The "+" is decorative — its
    /// meaning is carried by the label — so it is hidden from VoiceOver.
    var fabButton: some View {
        Button(action: action) {
            Image(systemName: AddWidgetButtonPresentation.iconSystemName)
                .font(.system(size: AddWidgetButtonPresentation.iconPointSize, weight: .bold))
                .accessibilityHidden(true)
        }
        .buttonStyle(AddWidgetFABStyle())
        .help(Text(verbatim: AddWidgetButtonAccessibility.label))
        .accessibilityLabel(Text(verbatim: AddWidgetButtonAccessibility.label))
        .accessibilityHint(Text(verbatim: AddWidgetButtonAccessibility.hint))
    }
}

// MARK: - FAB button style (web `Button` primary + className override)

/// Renders the circular, accent-filled FAB with a soft elevation shadow (web
/// `shadow-xl`) and a gentle press response. The white glyph on the accent fill
/// matches the web `variant="primary"` (`bg-blue-600 text-white`); the press
/// scale is suppressed under Reduce Motion.
private struct AddWidgetFABStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.white)
            .frame(
                width: AddWidgetButtonPresentation.diameter,
                height: AddWidgetButtonPresentation.diameter
            )
            .background(Color.TS.accent, in: Circle())
            .shadow(color: .black.opacity(0.28), radius: 12, x: 0, y: 6)
            .scaleEffect(scale(pressed: configuration.isPressed))
            .animation(
                reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.6),
                value: configuration.isPressed
            )
            .contentShape(Circle())
    }

    private func scale(pressed: Bool) -> CGFloat {
        guard pressed else { return 1 }
        return reduceMotion ? 1 : 0.92
    }
}
