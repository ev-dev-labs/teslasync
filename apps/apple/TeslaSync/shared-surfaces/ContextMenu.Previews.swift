//
//  ContextMenu.Previews.swift
//  TeslaSync — P4 shared surface · 0206 · ContextMenu (Apple)
//
//  Xcode previews for every branch of the contextual action menu: a populated menu (leading glyphs,
//  trailing shortcuts, a destructive row, a disabled row), the same menu with a keyboard-highlighted row,
//  the edge-flip placement (a menu opened near the bottom-right that flips up-and-left via the projector),
//  the friendly empty body, and a fully interactive host you can long-press in the live preview. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    private func contextMenuSampleActions() -> [ContextMenuAction] {
        [
            ContextMenuAction(id: "copy", label: "Copy", systemImage: "doc.on.doc", shortcut: "⌘C") {},
            ContextMenuAction(id: "rename", label: "Rename", systemImage: "pencil", shortcut: "⏎") {},
            ContextMenuAction(
                id: "share",
                label: "Share trip…",
                systemImage: "square.and.arrow.up",
                shortcut: "⌘⇧S"
            ) {},
            ContextMenuAction(
                id: "favorite",
                label: "Add to favorites",
                systemImage: "star",
                isDisabled: true
            ) {},
            ContextMenuAction(
                id: "delete",
                label: "Delete drive",
                systemImage: "trash",
                isDestructive: true,
                shortcut: "⌘⌫"
            ) {}
        ]
    }

    @MainActor
    private func contextMenuOpenedController(highlightFirst: Bool = false) -> ContextMenuController {
        let controller = ContextMenuController()
        controller.open(contextMenuSampleActions(), at: .zero)
        if highlightFirst { controller.focusFirst() }
        return controller
    }

    @MainActor
    private struct ContextMenuInteractivePreview: View {
        @State private var controller = ContextMenuController()

        var body: some View {
            ContextMenu(controller: controller) {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    Text(verbatim: "Drive · 14.2 km")
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: "Long-press for actions")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
                .tsGlassPanel()
                .teslaSyncContextMenu(contextMenuSampleActions(), controller: controller)
            }
            .frame(height: 320)
        }
    }

    #Preview("Populated menu") {
        staged("5 actions · icons · shortcuts · destructive · disabled") {
            ContextMenuPanel(controller: contextMenuOpenedController(), reduceMotion: false)
        }
    }

    #Preview("Keyboard highlight") {
        staged("first enabled row highlighted (Arrow Down)") {
            ContextMenuPanel(controller: contextMenuOpenedController(highlightFirst: true), reduceMotion: false)
        }
    }

    #Preview("Edge flip placement") {
        staged("opened near bottom-right · flips up-and-left") {
            GeometryReader { proxy in
                let controller = contextMenuOpenedController()
                ZStack(alignment: .topLeading) {
                    Color.TS.surface.opacity(0.3)
                    ContextMenuOverlay(controller: controller, reduceMotion: false)
                }
                .overlay(alignment: .topLeading) {
                    Circle()
                        .fill(Color.TS.accent)
                        .frame(width: 8, height: 8)
                        .offset(x: proxy.size.width - 12, y: proxy.size.height - 12)
                }
            }
            .frame(height: 300)
        }
    }

    #Preview("Empty body") {
        staged("menu asked to render with no rows") {
            ContextMenuEmptyView()
                .padding(ContextMenuLayout.containerPadding)
                .frame(minWidth: ContextMenuLayout.minWidth, alignment: .leading)
                .tsGlassPanel(cornerRadius: TSRadius.sm)
        }
    }

    #Preview("Interactive host") {
        staged("long-press the card to open the menu") {
            ContextMenuInteractivePreview()
        }
    }
#endif
