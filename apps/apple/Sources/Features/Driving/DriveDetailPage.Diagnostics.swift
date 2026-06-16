import SwiftUI

// MARK: - AI surfaces (web `AIDriveCoaching` / `AISpeedProfileInsights`)

/// The opt-in per-drive AI coaching surface (web `AIDriveCoaching`). Renders the pre-generation
/// state — title, AI badge, description, and the generate affordance — exactly as the web
/// component's initial state before a narrative is requested.
struct DriveAICoachingSection: View {
    @State private var requested = false

    var body: some View {
        DriveAISurface(
            title: "driveDetail.aiCoaching.title",
            badge: "driveDetail.aiCoaching.badge",
            description: "driveDetail.aiCoaching.description",
            generate: "driveDetail.aiCoaching.generateButton",
            requestedNote: "driveDetail.aiCoaching.requested",
            requested: $requested
        )
    }
}

/// The opt-in speed-profile AI insights surface (web `AISpeedProfileInsights`).
struct DriveAISpeedInsightsSection: View {
    @State private var requested = false

    var body: some View {
        DriveAISurface(
            title: "driveDetail.aiSpeedProfile.title",
            badge: "driveDetail.aiSpeedProfile.badge",
            description: "driveDetail.aiSpeedProfile.description",
            generate: "driveDetail.aiSpeedProfile.generateButton",
            requestedNote: "driveDetail.aiSpeedProfile.requested",
            requested: $requested
        )
    }
}

/// Shared layout for the two opt-in AI surfaces (web `withAiFeature` cards): icon + title +
/// badge, a description, and a generate button that reveals the on-request note.
private struct DriveAISurface: View {
    let title: LocalizedStringKey
    let badge: LocalizedStringKey
    let description: LocalizedStringKey
    let generate: LocalizedStringKey
    let requestedNote: LocalizedStringKey
    @Binding var requested: Bool

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    TSIconBox(systemName: "sparkles", tone: .accent)
                    TSPanelTitle(title)
                    TSBadge(badge, tone: .accent)
                    Spacer(minLength: TSSpacing.sm)
                }
                TSText(description, variant: .small)
                if requested {
                    TSInlineCallout(tone: .info, message: requestedNote)
                } else {
                    TSButton(generate, variant: .secondary, size: .small) { requested = true }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Why ended (web `WhyEndedPanel`)

/// The lazy "why did this drive end?" diagnostic (web `WhyEndedPanel`): a collapsed disclosure
/// that, when expanded, loads the FSM transitions + the raw signal window for the chosen window
/// size, surfacing its own loading / error / empty states.
struct DriveWhyEndedSection: View {
    @Bindable var model: DriveDetailPageModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if model.whyEndedExpanded {
                    windowPicker
                    expandedContent
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        Button {
            Task { await model.toggleWhyEnded() }
        } label: {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: model.whyEndedExpanded ? "chevron.down" : "chevron.right")
                    .font(.caption).foregroundStyle(Color.TS.textMuted)
                TSPanelTitle("driveDetail.whyEnded.title")
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isButton)
    }

    private var windowPicker: some View {
        Picker(selection: Binding(
            get: { model.whyEndedWindow },
            set: { window in Task { await model.selectWhyEndedWindow(window) } }
        )) {
            ForEach(DriveDetailDiagnosticWindow.allCases) { window in
                Text(verbatim: window.rawValue).tag(window)
            }
        } label: {
            Text("driveDetail.whyEnded.windowAria")
        }
        .pickerStyle(.segmented)
        .accessibilityLabel(Text("driveDetail.whyEnded.windowAria"))
    }

    @ViewBuilder
    private var expandedContent: some View {
        switch model.whyEndedPhase {
        case .idle, .loading:
            TSSpinner(label: "loading").frame(maxWidth: .infinity).padding(.vertical, TSSpacing.lg)
        case let .error(message):
            VStack(spacing: TSSpacing.sm) {
                TSEmptyState(
                    title: "driveDetail.whyEnded.error.title",
                    message: "driveDetail.whyEnded.error.message",
                    systemImage: "exclamationmark.triangle"
                )
                Text(verbatim: message).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                TSButton("action.retry", variant: .secondary, size: .small) { Task { await model.loadWhyEnded() } }
            }
        case .ready:
            diagnostics
        }
    }

    @ViewBuilder
    private var diagnostics: some View {
        let data = model.whyEnded
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Label("driveDetail.whyEnded.fsmTitle", systemImage: "arrow.triangle.branch")
                    .font(Font.TS.bodySm).fontWeight(.semibold).foregroundStyle(Color.TS.textSecondary)
                if let transitions = data?.transitions, !transitions.isEmpty {
                    TSTimeline(entries: transitions.map(timelineEntry))
                } else {
                    TSEmptyState(
                        title: "driveDetail.whyEnded.fsmEmpty.title",
                        message: "driveDetail.whyEnded.fsmEmpty.message",
                        systemImage: "arrow.triangle.branch"
                    )
                }
            }
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Label("driveDetail.whyEnded.signalTitle", systemImage: "dot.radiowaves.left.and.right")
                    .font(Font.TS.bodySm).fontWeight(.semibold).foregroundStyle(Color.TS.textSecondary)
                if let signals = data?.signals, !signals.isEmpty {
                    VStack(spacing: TSSpacing.sm) {
                        ForEach(signals) { signal in
                            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                                Text(verbatim: DriveDetailDateText.time(signal.timestamp))
                                    .font(.system(.caption, design: .monospaced)).foregroundStyle(Color.TS.textMuted)
                                Text(verbatim: signal.field)
                                    .font(.system(.caption, design: .monospaced)).foregroundStyle(Color.TS.textPrimary)
                                Spacer(minLength: TSSpacing.sm)
                                TSCode(signal.value)
                            }
                        }
                    }
                } else {
                    TSEmptyState(
                        title: "driveDetail.whyEnded.signalEmpty",
                        systemImage: "dot.radiowaves.left.and.right"
                    )
                }
            }
        }
    }

    private func timelineEntry(_ transition: DriveFsmTransition) -> TSTimelineEntry {
        TSTimelineEntry(
            id: transition.id,
            title: LocalizedStringKey("\(transition.fsmName): \(transition.fromState) → \(transition.toState)"),
            detail: LocalizedStringKey("trigger: \(transition.trigger.isEmpty ? "—" : transition.trigger)"),
            timestamp: DriveDetailDateText.time(transition.timestamp),
            tone: .accent,
            systemImage: "arrow.triangle.branch"
        )
    }
}
