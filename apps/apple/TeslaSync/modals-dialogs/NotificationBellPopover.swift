//
//  NotificationBellPopover.swift
//  TeslaSync — P4 modal / dialog · 0010 · NotificationBellPopover (Apple)
//
//  The notification bell popover — the SwiftUI parity of components/layout/NotificationBellPopover
//  .tsx. The web source is a header bell button + unread-count badge that opens an in-place triage
//  panel (latest 10 unread, "Mark all read", "View all"); on a narrow viewport (web `useIsMobile`)
//  it falls back to navigating straight to the full inbox instead of anchoring a popover. The
//  native surface reproduces that exactly: a bell `Button` with a badge overlay that, in a compact
//  size class, navigates to the inbox (the web mobile fallback) and, in a regular size class, opens
//  a native `.popover` presenting the triage panel. All data + presentation lives in
//  `NotificationBellModel` (P1/S8); no networking here.
//

import SwiftUI

/// The notification bell trigger + triage popover, binding through `NotificationBellModel` (P1/S8).
public struct NotificationBellPopover: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = NotificationBellSurface.slug

    @State private var model: NotificationBellModel
    @State private var isOpen = false

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: NotificationBellModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        NotificationBellTrigger(model: model, onActivate: activate)
            .popover(isPresented: $isOpen, arrowEdge: .top) {
                NotificationBellPanel(model: model, onClose: { isOpen = false })
            }
            .onChange(of: isOpen) { _, open in
                if open { model.open() } else { model.close() }
            }
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    /// Tap behaviour. A compact size class reproduces the web mobile fallback — navigate to the full
    /// inbox rather than anchoring a popover that would clip on a narrow viewport (web
    /// `useIsMobile` → `navigate('/notifications/inbox')`); a regular size class toggles the popover.
    private func activate() {
        if isCompact {
            model.openInbox()
        } else {
            isOpen.toggle()
        }
    }

    /// Whether the surface is in a compact horizontal size class (web `useIsMobile`, viewport
    /// ≤ 640 px). macOS has no compact size class, so it is always `false` there (always a popover).
    private var isCompact: Bool {
        #if os(iOS)
            return horizontalSizeClass == .compact
        #else
            return false
        #endif
    }
}
