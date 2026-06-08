//
//  InfrastructureSection.Views.swift
//  TeslaSync — P4 feature view · 0006 · InfrastructureSection (Apple)
//
//  The composable sub-views for the dev-tools Infrastructure grid — native ports of
//  the web `ToolCard`, `ResultPanel`, `BackendTool`, and `MqttTestTool`. Every
//  view is token-driven (P1/S9), localizes through `InfrastructureStrings` (P1/S10),
//  reuses the shared component library (`@/components/ui`), and carries VoiceOver
//  labels on each interactive element. No view performs networking — they read the
//  bound `InfrastructureModel` and call its `run` / `refresh` seams.
//

import SwiftUI

// MARK: - Tool card shell (web `ToolCard`)

/// A frosted card with an icon box, title, description, and arbitrary content —
/// the native port of the web `ToolCard` (`GlassPanel` + icon + title + body).
struct InfraToolCard<Content: View>: View {
    let systemImage: String
    let tone: InfraTone
    let titleKey: String
    let titleFallback: String
    let descriptionKey: String
    let descriptionFallback: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    TSIconBox(systemName: systemImage, tone: tone.tsTone)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSPanelTitle(InfrastructureStrings.key(titleKey, titleFallback))
                        TSCaption(InfrastructureStrings.key(descriptionKey, descriptionFallback))
                    }
                    Spacer(minLength: 0)
                }
                content()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Status badge (web `Badge variant=success|danger dot`)

/// The run-outcome badge shown next to the run button (web success/failed badge).
struct InfraStatusBadge: View {
    let result: InfraToolResult

    var body: some View {
        if result.didSucceed {
            TSBadge(InfrastructureStrings.key("Success", "Success"), tone: .success)
                .accessibilityLabel(Text(verbatim: InfraAccessibility.statusLabel(result)))
        } else {
            TSBadge(InfrastructureStrings.key("Failed", "Failed"), tone: .danger)
                .accessibilityLabel(Text(verbatim: InfraAccessibility.statusLabel(result)))
        }
    }
}

// MARK: - Freshness chip (native connectivity chrome)

/// The surface freshness chip (online / stale / offline) — a colored dot + label,
/// mirroring the established widget connection chip.
struct InfraFreshnessChip: View {
    let connection: InfraConnection

    private var tone: Color {
        switch connection {
        case .online: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        InfraAccessibility.freshnessLabel(connection)
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Result panel (web `ResultPanel`)

/// The per-tool result panel: success → pretty JSON in a scrollable mono surface
/// with a copy button; failure → the error message; idle → a friendly empty hint.
/// A stale result also surfaces a "stale" chip (web has no live feed; this is the
/// native freshness affordance from the state matrix).
struct InfraResultPanel: View {
    let titleKey: String
    let titleFallback: String
    let phase: InfraToolPhase
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            header
            body(for: phase)
        }
        .padding(TSSpacing.md)
        .background(tint, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border.opacity(0.6), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: InfrastructureStrings.string(titleKey, titleFallback))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            if isStale, case .completed = phase {
                staleChip
            }
            Spacer(minLength: 0)
            if case let .completed(.success(json), _) = phase {
                TSCopyButton(value: json)
            }
        }
    }

    private var staleChip: some View {
        Text(verbatim: InfrastructureStrings.string("Stale", "Stale"))
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.statusWarning)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.statusWarning.opacity(0.15), in: Capsule())
            .accessibilityLabel(InfrastructureStrings.text("Stale Result A11y", "Result may be out of date"))
    }

    @ViewBuilder
    private func body(for phase: InfraToolPhase) -> some View {
        switch phase {
        case .idle:
            Text(verbatim: InfrastructureStrings.string("No Result Yet", "No result yet"))
                .font(Font.TS.bodySm)
                .italic()
                .foregroundStyle(Color.TS.textMuted)
        case .running:
            TSSpinner(label: InfrastructureStrings.key("Running", "Running…"))
        case let .completed(.success(json), _):
            successBody(json)
        case let .completed(.failure(message), _):
            Text(verbatim: message ?? InfrastructureStrings.string("Request Failed", "Request failed"))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.statusDanger)
                .textSelection(.enabled)
                .accessibilityLabel(
                    Text(verbatim: InfrastructureStrings.string("Error A11y", "Error")
                        + ": " + (message ?? InfrastructureStrings.string("Request Failed", "Request failed")))
                )
        }
    }

    private func successBody(_ json: String) -> some View {
        ScrollView {
            Text(verbatim: json)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .frame(maxHeight: 256)
        .padding(TSSpacing.sm)
        .background(Color.TS.bg, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityLabel(InfrastructureStrings.text("Result A11y", "Result"))
        .accessibilityValue(Text(verbatim: json))
    }

    private var tint: Color {
        guard case let .completed(result, _) = phase else {
            return Color.TS.surface.opacity(0.4)
        }
        return result.didSucceed
            ? Color.TS.statusSuccess.opacity(0.08)
            : Color.TS.statusDanger.opacity(0.08)
    }
}

// MARK: - Backend tool (web `BackendTool`)

/// A one-shot backend dev-tool card: a run button, a success/failed badge, and the
/// result panel — the native port of the web `BackendTool`.
struct InfraBackendToolView: View {
    let model: InfrastructureModel
    let tool: InfraTool

    private var state: InfraToolState? {
        model.tools.first { $0.id == tool.id }
    }

    var body: some View {
        InfraToolCard(
            systemImage: tool.systemImage,
            tone: tool.tone,
            titleKey: tool.titleKey,
            titleFallback: tool.titleFallback,
            descriptionKey: tool.descriptionKey,
            descriptionFallback: tool.descriptionFallback
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    runButton
                    if let result = state?.result {
                        InfraStatusBadge(result: result)
                    }
                    Spacer(minLength: 0)
                }
                if let state, state.phase != .idle {
                    InfraResultPanel(
                        titleKey: tool.titleKey,
                        titleFallback: tool.titleFallback,
                        phase: state.phase,
                        isStale: model.isStale(state)
                    )
                }
            }
        }
    }

    private var runButton: some View {
        TSButton(
            variant: .primary,
            size: .small,
            isLoading: state?.isRunning ?? false,
            action: { model.run(toolID: tool.id) },
            label: {
                Label {
                    InfrastructureStrings.text("Run", "Run")
                } icon: {
                    Image(systemName: "play.fill")
                }
                .labelStyle(.titleAndIcon)
            }
        )
        .disabled(model.isOffline)
        .accessibilityLabel(Text(verbatim: InfraAccessibility.runLabel(tool: tool)))
        .accessibilityHint(InfrastructureStrings.text("Run Hint", "Runs this backend tool"))
    }
}

// MARK: - MQTT test tool (web `MqttTestTool`)

/// The MQTT publish tool card: topic + message inputs, a send button, and the
/// result panel — the native port of the web `MqttTestTool` (its own `useState`
/// topic/message + `useMutation`).
struct InfraMqttToolView: View {
    let model: InfrastructureModel
    let tool: InfraTool

    @State private var topic = ""
    @State private var message = ""

    private var state: InfraToolState? {
        model.tools.first { $0.id == tool.id }
    }

    var body: some View {
        InfraToolCard(
            systemImage: tool.systemImage,
            tone: tool.tone,
            titleKey: tool.titleKey,
            titleFallback: tool.titleFallback,
            descriptionKey: tool.descriptionKey,
            descriptionFallback: tool.descriptionFallback
        ) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSTextField(
                    InfrastructureStrings.key("Mqtt Topic Placeholder", "test/topic"),
                    text: $topic,
                    label: InfrastructureStrings.key("Topic", "Topic")
                )
                .accessibilityLabel(InfrastructureStrings.text("Topic", "Topic"))

                TSTextArea(
                    text: $message,
                    label: InfrastructureStrings.key("Message", "Message"),
                    minHeight: 72
                )
                .accessibilityLabel(InfrastructureStrings.text("Message", "Message"))

                HStack(spacing: TSSpacing.sm) {
                    sendButton
                    if let result = state?.result {
                        InfraStatusBadge(result: result)
                    }
                    Spacer(minLength: 0)
                }

                if let state, state.phase != .idle {
                    InfraResultPanel(
                        titleKey: tool.titleKey,
                        titleFallback: tool.titleFallback,
                        phase: state.phase,
                        isStale: model.isStale(state)
                    )
                }
            }
        }
    }

    private var sendButton: some View {
        TSButton(
            variant: .primary,
            size: .small,
            isLoading: state?.isRunning ?? false,
            action: { model.run(toolID: tool.id, inputs: InfraToolInputs(topic: topic, message: message)) },
            label: {
                Label {
                    InfrastructureStrings.text("Send Test", "Send Test")
                } icon: {
                    Image(systemName: "play.fill")
                }
                .labelStyle(.titleAndIcon)
            }
        )
        .disabled(model.isOffline)
        .accessibilityLabel(Text(verbatim: InfraAccessibility.sendLabel()))
        .accessibilityHint(InfrastructureStrings.text("Send Test Hint", "Publishes a test MQTT message"))
    }
}

// MARK: - Loading skeleton (initial-mount chrome)

/// A skeleton tool card shown while the surface resolves initial connectivity.
struct InfraToolSkeleton: View {
    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.md)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 120, height: 14)
                        TSSkeleton(width: 180, height: 10)
                    }
                    Spacer(minLength: 0)
                }
                TSSkeleton(width: 96, height: 28, cornerRadius: TSRadius.md)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityHidden(true)
    }
}
