import SwiftUI

/// Native SwiftUI parity of `web/src/features/automations/pages/ConflictWarnings.tsx` as a
/// standalone, deep-linkable screen. The web source is an unrouted presentational leaf the
/// automation builder renders inline (a stacked list of `AlertBanner`s — one per
/// `AutomationConflict`, tinted + icon'd by severity, titled "Potential Conflict" — rendering
/// nothing when empty). This screen hosts the canonical P4 feature view `ConflictWarnings` (the
/// fully-stated parity of the web component) unchanged inside an adaptive page scaffold and drives
/// it with the `@Observable` `ConflictWarningsPageModel` (no networking here — ADR-004).
///
/// The hosted surface reproduces the web banner list and the states the inline web leaf delegates
/// to its parent: the loading skeleton, the never-a-blank-box empty state (web `return null`), the
/// query-error retry, and the stale/offline chips. Adaptive (ADR-002/006): compact iPhone fills the
/// width; macOS/iPad cap the banner column to a readable measure. Every visible string resolves
/// from the catalog (the page title) or the surface's folded i18n table.
public struct ConflictWarningsPage: View {
    @State private var model: ConflictWarningsPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Readable measure the banner column is capped to on regular width (macOS / iPad).
    private static let readableWidth: CGFloat = 640

    public init(model: ConflictWarningsPageModel = ConflictWarningsPageModel()) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            TSFadeIn(delay: 0.1) {
                ConflictWarnings(model: model.surface)
            }
            .frame(maxWidth: maxContentWidth, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(LocalizedStringKey("automations.conflicts.title"))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
            .refreshable {
                model.refresh()
            }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    private var maxContentWidth: CGFloat? {
        isCompact ? nil : Self.readableWidth
    }
}

#if DEBUG
    @MainActor
    private func previewPage(_ input: ConflictWarningsInput) -> ConflictWarningsPage {
        ConflictWarningsPage(model: ConflictWarningsPageModel(source: InMemoryConflictWarningsSource(initial: input)))
    }

    private let previewConflicts: [AutomationConflict] = [
        AutomationConflict(
            automationId: 12,
            automationName: "Morning Charge",
            reason: "Overlaps with Nightly Precondition on weekday mornings at 06:00",
            severity: .warning
        ),
        AutomationConflict(
            automationId: 34,
            automationName: "Arrive Home Climate",
            reason: "Shares the geofence trigger with Garage Lights",
            severity: .info
        )
    ]

    #Preview("Conflicts") {
        NavigationStack {
            previewPage(ConflictWarningsInput(phase: .loaded(previewConflicts)))
        }
        .teslaSyncTheme()
    }

    #Preview("Empty") {
        NavigationStack {
            previewPage(ConflictWarningsInput(phase: .loaded([])))
        }
        .teslaSyncTheme()
    }

    #Preview("Error") {
        NavigationStack {
            previewPage(ConflictWarningsInput(phase: .failed))
        }
        .teslaSyncTheme()
    }
#endif
