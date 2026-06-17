//
//  ChatbotPage.swift
//  TeslaSync — P4-APPLE P7 · page:system/Chatbot (Apple)
//
//  Native SwiftUI parity of `web/src/features/system/pages/ChatbotPage.tsx` (route `/chatbot`,
//  the "Helix" assistant). The web page is a `PageContainer` (title + subtitle + a History
//  toggle action) hosting a two-pane chat surface: an optional `SessionList` sidebar and the
//  conversation `GlassPanel` (the scrollable transcript + the composer). This page reproduces
//  that exactly, adaptive across macOS / iPad (regular — the sidebar is an inline column) and
//  iPhone (compact — the sidebar is a slide-over sheet, web's mobile dialog). It composes the
//  already-shipped `ChatSessionList`, `SuggestedPrompts`, and per-row `ChatMessageItem` feature
//  views, binds through the `@Observable` `ChatbotPageModel` (no networking in the view,
//  ADR-004), styles with the P2 tokens + P3 components (ADR-005), and renders every data state
//  with full Dark Mode / Dynamic Type / VoiceOver support (ADR-015). Every visible string
//  resolves from `Localizable.xcstrings` under the web key names — zero hardcoded literals.
//

import SwiftUI

public struct ChatbotPage: View {
    @State private var model: ChatbotPageModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: ChatbotPageModel = ChatbotPageModel()) {
        _model = State(initialValue: model)
    }

    /// Compact (iPhone) shows the history as a sheet; regular (macOS / iPad) as an inline column
    /// — the native parity of the web `isMobile` dialog-vs-sidebar branch.
    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            header
            conversationArea
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            model.reduceMotion = reduceMotion
            await model.load()
        }
        .onChange(of: reduceMotion) { _, newValue in model.reduceMotion = newValue }
        .sheet(isPresented: sessionsSheetBinding) {
            ChatSessionList(model: model.sessionList)
                .frame(minWidth: 280, minHeight: 360)
                .presentationDetents([.large, .medium])
        }
    }

    // MARK: - Header (web PageContainer: title + subtitle + History action)

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSPageTitle(model.titleKey)
                Text(model.subtitleKey)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            historyToggle
        }
        .accessibilityElement(children: .contain)
    }

    /// Web `actions` slot: the History toggle (`aria-pressed={showSessions}`).
    private var historyToggle: some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { model.showSessions.toggle() },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "clock.arrow.circlepath")
                        .imageScale(.small)
                        .accessibilityHidden(true)
                    Text(model.historyKey)
                }
            }
        )
        .accessibilityLabel(Text(model.historyKey))
        .accessibilityAddTraits(model.showSessions ? [.isSelected] : [])
    }

    // MARK: - Conversation area (sidebar column + GlassPanel1)

    private var conversationArea: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            if model.showSessions, !isCompact {
                ChatSessionList(model: model.sessionList)
                    .frame(width: 300)
                    .frame(maxHeight: .infinity)
                    .transition(.move(edge: .leading).combined(with: .opacity))
            }
            conversationPanel
        }
        .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: model.showSessions)
    }

    /// GlassPanel1 — the conversation container: the scrollable transcript over the composer
    /// (web `<GlassPanel className="flex flex-col flex-1 ...">`).
    private var conversationPanel: some View {
        VStack(spacing: 0) {
            ChatbotConversationLog(model: model, reduceMotion: reduceMotion)
            Divider().overlay(Color.TS.border)
            ChatbotComposer(model: model)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .tsGlassPanel()
        .accessibilityIdentifier("GlassPanel1")
    }

    private var sessionsSheetBinding: Binding<Bool> {
        Binding(
            get: { isCompact && model.showSessions },
            set: { presented in if !presented { model.showSessions = false } }
        )
    }
}

#if DEBUG
    #Preview("Populated") {
        ChatbotPage(model: ChatbotPageModel(source: SampleChatbotSource(variant: .populated)))
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        ChatbotPage(model: ChatbotPageModel(source: SampleChatbotSource(variant: .empty)))
            .teslaSyncTheme()
    }
#endif
