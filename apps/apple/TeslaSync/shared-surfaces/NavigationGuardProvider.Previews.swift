//
//  NavigationGuardProvider.Previews.swift
//  TeslaSync — P4 shared surface · 0128 · NavigationGuardProvider (Apple)
//
//  Xcode previews for each surface state + branch (confirm generic / custom message, stale, offline,
//  loading, idle/empty, error) plus the live provider wrapping content with a dirty guard. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope. Preview copy + sample
//  messages are local sample data, not shipped UI strings.
//

import SwiftUI

#if DEBUG
    /// Preview localizer — returns the English fallback so previews render without the bundle table.
    private let navigationGuardPreviewLocalize: NavigationGuardResolve = { _, fallback in fallback }

    private func navigationGuardSampleRequest(
        message: String? = nil,
        connection: NavigationGuardConnection = .live
    ) -> NavigationGuardConfirmRequest {
        let copy = NavigationGuardConfirmContent.build(
            customMessage: message,
            localize: navigationGuardPreviewLocalize
        )
        return NavigationGuardConfirmRequest(copy: copy, showsSilenceToggle: true, connection: connection)
    }

    private struct NavigationGuardPreviewStage<Content: View>: View {
        @ViewBuilder var content: () -> Content

        var body: some View {
            ZStack {
                Color.TS.bg.ignoresSafeArea()
                content()
                    .frame(maxWidth: 420)
                    .padding()
            }
        }
    }

    #Preview("Confirm — generic") {
        NavigationGuardPreviewStage {
            NavigationGuardConfirmSurface(resolution: .confirming(navigationGuardSampleRequest()))
        }
    }

    #Preview("Confirm — custom message") {
        NavigationGuardPreviewStage {
            NavigationGuardConfirmSurface(resolution: .confirming(navigationGuardSampleRequest(
                message: "Your alert rule has unsaved edits. Discard them?"
            )))
        }
    }

    #Preview("Confirm — stale") {
        NavigationGuardPreviewStage {
            NavigationGuardConfirmSurface(resolution: .confirming(navigationGuardSampleRequest(
                connection: .stale
            )))
        }
    }

    #Preview("Confirm — offline") {
        NavigationGuardPreviewStage {
            NavigationGuardConfirmSurface(resolution: .confirming(navigationGuardSampleRequest(
                connection: .offline
            )))
        }
    }

    #Preview("Loading") {
        NavigationGuardPreviewStage {
            NavigationGuardConfirmSurface(resolution: .loading)
        }
    }

    #Preview("Idle — nothing to confirm") {
        NavigationGuardPreviewStage {
            NavigationGuardConfirmSurface(resolution: .idle(connection: .live))
        }
    }

    #Preview("Error") {
        NavigationGuardPreviewStage {
            NavigationGuardConfirmSurface(resolution: .failed(
                message: "The silence allowlist is unavailable",
                connection: .live
            ))
        }
    }

    /// The live provider wrapping content: a "dirty" editor registers a guard, and the Leave button
    /// awaits `confirmIfDirty()` — tapping it raises the real warning prompt.
    private struct NavigationGuardProviderDemo: View {
        @State private var isDirty = true
        @State private var didLeave = false
        @Environment(\.navigationGuard) private var guardContext

        var body: some View {
            VStack(spacing: TSSpacing.lg) {
                Text(verbatim: didLeave ? "Left the editor" : "Editing (unsaved)")
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textPrimary)
                Toggle(isOn: $isDirty) {
                    Text(verbatim: "Form is dirty")
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .toggleStyle(.switch)
                .tint(Color.TS.accent)
                TSButton(variant: .primary, size: .medium, action: leave) {
                    Text(verbatim: "Leave editor")
                }
            }
            .padding(TSSpacing.x2xl)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
            .navigationGuard(id: "demo-editor", isDirty: isDirty, message: "Discard this draft automation?")
        }

        private func leave() {
            Task {
                if await (guardContext?.confirmIfDirty() ?? true) {
                    didLeave = true
                    isDirty = false
                }
            }
        }
    }

    #Preview("Provider — dirty editor") {
        NavigationGuardProvider(
            silence: InMemoryNavigationGuardSilence(),
            telemetry: OSLogNavigationGuardTelemetry()
        ) {
            NavigationGuardProviderDemo()
        }
    }
#endif
