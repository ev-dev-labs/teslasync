//
//  FSMStateDiagram.Views.swift
//  TeslaSync — P4 feature view · 0229 · FSMStateDiagram (Apple)
//
//  The presentational chrome composed by `FSMStateDiagram`: the panel header + freshness
//  chip, the connectivity banner, the phase router, the data body (node row + edge
//  summary, web non-empty render), and the loading / empty / error states. Empty maps to
//  the shared `TSEmptyState` (web `@/components/feedback` EmptyState); error maps to the
//  shared `TSQueryError`. All strings resolve through the P1/S10 facade; all colour +
//  spacing through the P1/S9 tokens.
//

import SwiftUI

// MARK: - Header + freshness chip

/// The panel header (web `<h2>State Diagram</h2>`) with the freshness chip on the trailing
/// edge when the feed is not live.
struct FSMDiagramHeader: View {
    let connection: FSMConnection

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: FSMStateDiagramStrings.string("fsm.stateDiagram", "State Diagram"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            if connection != .live {
                FSMFreshnessChip(connection: connection)
            }
        }
    }
}

/// The freshness chip — a coloured dot + label reflecting the connectivity axis.
struct FSMFreshnessChip: View {
    let connection: FSMConnection

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tint)
                .frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(tint)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Capsule().fill(tint.opacity(0.12)))
        .overlay(Capsule().strokeBorder(tint.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private var tint: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: FSMStateDiagramStrings.string("fsm.diagram.live", "Live")
        case .stale: FSMStateDiagramStrings.string("fsm.diagram.stale", "Stale")
        case .offline: FSMStateDiagramStrings.string("fsm.diagram.offline", "Offline")
        }
    }
}

// MARK: - Connectivity banner (P4 leaf stale/offline axis)

/// The stale / offline banner with a refresh affordance (shown only when not live).
struct FSMConnectivityBanner: View {
    let connection: FSMConnection
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: connection == .offline ? "wifi.slash" : "clock.arrow.circlepath")
                .foregroundStyle(tint)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .ghost, size: .small, action: onRefresh) {
                Text(verbatim: FSMStateDiagramStrings.string("fsm.diagram.refresh", "Refresh"))
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .fill(tint.opacity(0.08))
        )
        .accessibilityElement(children: .combine)
    }

    private var tint: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: String {
        switch connection {
        case .offline:
            FSMStateDiagramStrings.string("fsm.diagram.offlineBanner", "Offline — showing the last known states")
        default:
            FSMStateDiagramStrings.string("fsm.diagram.staleBanner", "Showing cached data — refreshing…")
        }
    }
}

// MARK: - Phase router

/// Routes the resolved phase to the matching body (web render branches + P4 leaf states).
struct FSMDiagramContent: View {
    let resolved: FSMStateDiagramResolved
    let onRetry: () -> Void

    var body: some View {
        switch resolved.phase {
        case .loading:
            FSMDiagramLoading()
        case .empty:
            FSMDiagramEmpty()
        case let .error(message):
            FSMDiagramError(message: message, onRetry: onRetry)
        case .data:
            FSMDiagramBody(resolved: resolved)
        }
    }
}

// MARK: - Data body (web node row + edge summary)

/// The non-empty render: the wrapping node row and, when present, the edge-summary chips.
struct FSMDiagramBody: View {
    let resolved: FSMStateDiagramResolved

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                FSMFlowLayout(horizontalSpacing: TSSpacing.sm, verticalSpacing: TSSpacing.md) {
                    ForEach(resolved.nodes) { node in
                        FSMNodeCell(node: node)
                    }
                }
                if !resolved.edgeSummary.isEmpty {
                    FSMFlowLayout(horizontalSpacing: TSSpacing.sm, verticalSpacing: TSSpacing.sm) {
                        ForEach(resolved.edgeSummary) { edge in
                            FSMEdgeChip(edge: edge)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Loading / empty / error chrome

/// The initial-fetch chrome: a wrapped row of skeleton node blocks, so the panel keeps
/// its shape while the parent query resolves.
struct FSMDiagramLoading: View {
    var body: some View {
        FSMFlowLayout(horizontalSpacing: TSSpacing.sm, verticalSpacing: TSSpacing.md) {
            ForEach(0 ..< 5, id: \.self) { _ in
                TSSkeleton(width: 76, height: 52, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: FSMStateDiagramStrings.string(
            "fsm.diagram.loadingA11y",
            "Loading state diagram"
        )))
    }
}

/// The empty render (web `EmptyState` for an unknown FSM type) — a friendly state, never a
/// blank panel. Uses the shared `TSEmptyState` (web `@/components/feedback`).
struct FSMDiagramEmpty: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(FSMStateDiagramStrings.string(
                "fsm.selectFsmType",
                "Select a specific FSM type to view its state diagram"
            )),
            systemImage: "point.3.connected.trianglepath.dotted"
        )
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct FSMDiagramError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSQueryError(message: LocalizedStringKey(displayMessage), onRetry: onRetry)
            .frame(maxWidth: .infinity)
    }

    private var displayMessage: String {
        message.isEmpty
            ? FSMStateDiagramStrings.string("fsm.diagram.errorMessage", "Couldn't load FSM transitions")
            : message
    }
}
