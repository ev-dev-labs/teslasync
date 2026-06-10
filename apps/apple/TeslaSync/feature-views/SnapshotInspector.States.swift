//
//  SnapshotInspector.States.swift
//  TeslaSync — P4 feature view · 0234 · SnapshotInspector (Apple)
//
//  The non-content states `SnapshotInspector` switches over: the first-paint loading
//  message (web "Loading…"), the two web empty branches (the plain "select a transition"
//  and the "outside window" jump affordance), the native error envelope (web `QueryError`
//  peer with retry), the in-detail "no signals captured" empty, and the live-state
//  freshness chip. Every state renders real chrome — never a blank box. Copy via P1/S10;
//  chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Centred message shell (web `min-h-[160px]` centred empty)

/// The shared centred container the empty / loading states use, so each keeps the web
/// `min-h-[160px]` height instead of collapsing.
struct SnapshotInspectorMessageShell<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            content()
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 160)
        .padding(TSSpacing.md)
    }
}

// MARK: - Loading (web "Loading…")

/// The first-paint loading message (web `debugger.inspector.loading`).
struct SnapshotInspectorLoadingState: View {
    var body: some View {
        SnapshotInspectorMessageShell {
            HStack(spacing: TSSpacing.sm) {
                ProgressView().controlSize(.small)
                SnapshotInspectorStrings.text("debugger.inspector.loading", "Loading…")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(SnapshotInspectorStrings.text("debugger.inspector.loading", "Loading…"))
    }
}

// MARK: - No selection (web "Select a transition…")

/// The default empty when no transition is selected and there is something to pick (web
/// `debugger.inspector.empty`).
struct SnapshotInspectorNoSelectionState: View {
    var body: some View {
        SnapshotInspectorMessageShell {
            Image(systemName: "cursorarrow.rays")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            SnapshotInspectorStrings.text("debugger.inspector.empty", "Select a transition to inspect its snapshot")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(SnapshotInspectorStrings.text(
            "debugger.inspector.empty", "Select a transition to inspect its snapshot"
        ))
    }
}

// MARK: - Outside window (web jump affordance)

/// The empty shown when the active window has no transitions but a later one exists (web
/// `inWindowCount === 0 && lastTransition`): the relative-time message + the "jump to last
/// transition" button that switches the debugger to Freeze mode.
struct SnapshotInspectorOutsideWindowState: View {
    let relative: String
    let onJump: () -> Void

    var body: some View {
        SnapshotInspectorMessageShell {
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
            TSButton(variant: .primary, size: .small, action: onJump) {
                Text(verbatim: jumpLabel)
            }
            .accessibilityLabel(Text(verbatim: jumpLabel))
        }
        .accessibilityElement(children: .contain)
    }

    private var message: String {
        SnapshotInspectorStrings.string(
            "debugger.inspector.emptyOutsideWindow",
            "Nothing in the current window. Last transition {{rel}}."
        )
        .replacingOccurrences(of: "{{rel}}", with: relative)
    }

    private var jumpLabel: String {
        SnapshotInspectorStrings.string("debugger.inspector.jumpToLast", "Jump to last transition")
    }
}

// MARK: - Error (web `QueryError` peer)

/// The fetch-failure envelope (Apple surface contract): a danger glyph, a short title, the
/// optional detail, and a retry affordance, so a first-load failure is never a blank box.
struct SnapshotInspectorErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        SnapshotInspectorMessageShell {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SnapshotInspectorStrings.text("debugger.inspector.error", "Couldn't load the snapshot")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: retryLabel)
            }
            .accessibilityLabel(Text(verbatim: retryLabel))
        }
        .accessibilityElement(children: .contain)
    }

    private var retryLabel: String {
        SnapshotInspectorStrings.string("debugger.inspector.retry", "Retry")
    }
}

// MARK: - No signals (web "No signals captured…")

/// The in-detail empty shown when a transition has a snapshot but no signal values (web
/// `debugger.inspector.noSignals`).
struct SnapshotInspectorNoSignals: View {
    var body: some View {
        SnapshotInspectorStrings.text("debugger.inspector.noSignals", "No signals captured for this transition")
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.x2xl)
            .padding(.horizontal, TSSpacing.md)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(SnapshotInspectorStrings.text(
                "debugger.inspector.noSignals", "No signals captured for this transition"
            ))
    }
}

// MARK: - Freshness chip (Stale / Offline)

/// The trailing freshness chip reflecting the bound source's live-state (ADR-013). Shown
/// only when the source is not live, so cached detail is clearly labeled.
struct SnapshotInspectorFreshnessChip: View {
    let connection: SnapshotInspectorConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Image(systemName: descriptor.icon)
                .font(.system(size: 9, weight: .semibold))
                .accessibilityHidden(true)
            SnapshotInspectorStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.label)
        }
        .foregroundStyle(descriptor.tone)
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, 2)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SnapshotInspectorStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let icon: String
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: SnapshotInspectorConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(
                tone: Color.TS.statusSuccess,
                icon: "dot.radiowaves.left.and.right",
                key: "debugger.inspector.live",
                fallback: "Live"
            )
        case .stale:
            Descriptor(
                tone: Color.TS.statusWarning,
                icon: "clock.arrow.circlepath",
                key: "debugger.inspector.stale",
                fallback: "Stale"
            )
        case .offline:
            Descriptor(
                tone: Color.TS.textMuted,
                icon: "wifi.slash",
                key: "debugger.inspector.offline",
                fallback: "Offline"
            )
        }
    }
}
