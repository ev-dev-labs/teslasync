import SwiftUI

/// Native SwiftUI parity of `web/src/features/automations/pages/AutomationCard.tsx` as a
/// standalone, deep-linkable screen. The web source is a presentational card the `/automations`
/// page renders inline; this hosts the shared feature-view `AutomationCard` (the canonical,
/// fully-stated parity of the web component) inside an adaptive page scaffold and drives it with
/// the `@Observable` `AutomationCardPageModel` (no networking here — ADR-004).
///
/// Reproduces the single web `GlassPanel`: the header (name + status badge + live "Firing" chip +
/// description), the pin/toggle/actions-menu control cluster, the vehicle row, the run-stats row,
/// the auto-disabled warning, the conflict callouts, and the destructive delete confirmation.
/// Adaptive (ADR-002/006): compact iPhone fills the width; macOS/iPad cap the card to a readable
/// measure. Every visible string resolves from `Localizable.xcstrings`; the card's live `isFiring`
/// pulse downgrades to a stale/offline chip when the connection says so (ADR-013).
public struct AutomationCardPage: View {
    @State private var model: AutomationCardPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Readable max measure for the single card on regular-width canvases (macOS / iPad).
    private static let cardMaxWidth: CGFloat = 560

    public init(model: AutomationCardPageModel = AutomationCardPageModel()) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            TSFadeIn(delay: 0.1) {
                AutomationCard(
                    state: model.state,
                    connection: model.connection,
                    actions: model.actions,
                    localize: .catalog
                )
                .frame(maxWidth: isCompact ? .infinity : Self.cardMaxWidth)
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle("automations.title")
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .task {
                if case .loading = model.state { await model.load() }
            }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }
}

// MARK: - Catalog localizer

extension AutomationCardLocalizer {
    /// Resolves the card's strings from the app's default `Localizable.xcstrings` catalog (the web
    /// `t(key, default)` keys are mirrored there verbatim), falling back to the English default so
    /// the surface never shows a raw key. Used by the standalone page so every visible literal is
    /// catalog-sourced.
    static let catalog = AutomationCardLocalizer(
        string: { key, fallback in
            Bundle.main.localizedString(forKey: key, value: fallback, table: nil)
        },
        format: { key, fallbackFormat, argument in
            String(format: Bundle.main.localizedString(forKey: key, value: fallbackFormat, table: nil), argument)
        }
    )
}

#if DEBUG
    @MainActor
    private func previewModel(_ snapshot: AutomationCardSnapshot) -> AutomationCardPageModel {
        AutomationCardPageModel(provider: PreviewAutomationCard(snapshot))
    }

    private struct PreviewAutomationCard: AutomationCardProviding {
        let value: AutomationCardSnapshot
        init(_ value: AutomationCardSnapshot) {
            self.value = value
        }

        func snapshot() async -> AutomationCardSnapshot {
            value
        }
    }

    private let previewActive = AutomationCardData(
        id: 1,
        name: "Precondition before commute",
        description: "Warm the cabin on weekday mornings",
        enabled: true,
        lastTriggeredAt: "2026-01-05T07:00:00Z",
        executionCount: 142,
        nextFireTime: "2026-01-06T14:30:00Z",
        isFiring: true,
        vehicleName: "Model 3",
        isPinned: true
    )

    private let previewAutoDisabled = AutomationCardData(
        id: 3,
        name: "Vent when too hot",
        enabled: false,
        autoDisabled: true,
        autoDisabledReason: "Disabled after 5 consecutive command failures.",
        lastTriggeredAt: "2026-01-04T19:00:00Z",
        executionCount: 88,
        failureCount: 5,
        conflicts: [
            AutomationConflictData(
                id: 9,
                automationName: "Close windows at dusk",
                reason: "both control the windows",
                severity: "warning"
            )
        ],
        vehicleName: "Model Y"
    )

    #Preview("Active · firing (live)") {
        NavigationStack {
            AutomationCardPage(model: previewModel(
                AutomationCardSnapshot(automation: previewActive, connection: .live)
            ))
        }
        .teslaSyncTheme()
    }

    #Preview("Auto-disabled · conflicts") {
        NavigationStack {
            AutomationCardPage(model: previewModel(
                AutomationCardSnapshot(automation: previewAutoDisabled, connection: .stale)
            ))
        }
        .teslaSyncTheme()
    }

    #Preview("Loading / Empty") {
        NavigationStack {
            AutomationCardPage(model: previewModel(AutomationCardSnapshot(isLoading: true)))
        }
        .teslaSyncTheme()
    }
#endif
