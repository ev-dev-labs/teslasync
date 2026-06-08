//
//  AIRestorePanel.swift
//  TeslaSync — P4 feature view · 0201 · AIRestorePanel (Apple)
//
//  The "Restore previous Helix selection?" panel — the SwiftUI parity of
//  features/settings/components/AIRestorePanel.tsx. Renders the web source's regions
//  (the Sparkles header, the title + description, the archived-feature preview list,
//  and the decline / restore actions) inside a glass panel, plus the P4 leaf contract
//  states. Binds through `AIRestoreModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome (web parent `isLoading`).
//    • empty    — archive resolved, nothing enabled to restore → friendly empty state
//                 (web `archiveHasRestorableEntries` is false), never a blank surface.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the full alert (description + preview list + decline / restore).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//
//  The web source is `role="alert" aria-live="polite"`; the native surface mirrors
//  that with a contained accessibility element whose label announces the prompt.
//

import SwiftUI

// MARK: - AIRestorePanel (the feature surface)

/// The "Restore previous Helix selection?" panel — the SwiftUI parity of
/// `features/settings/components/AIRestorePanel.tsx`. Renders every state from the web
/// source plus the P4 leaf freshness states, binding through `AIRestoreModel`.
public struct AIRestorePanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIRestorePanel"

    @State private var model: AIRestoreModel

    public init(model: AIRestoreModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if model.connection != .live {
                    connectivityBanner
                }
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    /// The `role="alert"` announcement — the title alone outside the data phase, and
    /// the title + description + resolved feature names once there is a selection to
    /// restore (built through the testable `AIRestoreAccessibility` seam).
    private var accessibilitySummary: String {
        let title = AIRestoreStrings.string("ai.settings.archive.title", "Restore previous Helix selection?")
        guard case .data = model.phase else { return title }
        let description = AIRestoreStrings.string(
            "ai.settings.archive.description",
            "You previously had these features enabled. Re-enable them now?"
        )
        return AIRestoreAccessibility.summary(
            title: title,
            description: description,
            features: model.resolved.labels.map(AIRestoreStrings.label)
        )
    }
}

// MARK: - Header (web `<Sparkles/> <Subhead>{title}</Subhead>` + freshness)

private extension AIRestorePanel {
    var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: "sparkles")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesPower)
                .accessibilityHidden(true)
            Text(verbatim: AIRestoreStrings.string("ai.settings.archive.title", "Restore previous Helix selection?"))
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
        }
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = AIRestoreStrings.string("airestore.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = AIRestoreStrings.string("airestore.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = AIRestoreStrings.string("airestore.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: AIRestoreStrings.string("airestore.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? AIRestoreStrings.string("airestore.offlineBanner", "Offline — showing last known data")
            : AIRestoreStrings.string("airestore.staleBanner", "Reconnecting — data may be stale")
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIRestorePanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            AIRestoreLoadingView()
        case .empty:
            AIRestoreEmptyView()
        case let .error(message):
            AIRestoreErrorView(message: message) { model.refresh() }
        case .data:
            AIRestoreContent(
                labels: model.resolved.labels,
                onConfirm: { model.confirm() },
                onDecline: { model.decline() }
            )
        }
    }
}
