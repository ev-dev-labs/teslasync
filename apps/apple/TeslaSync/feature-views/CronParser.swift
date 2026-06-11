//
//  CronParser.swift
//  TeslaSync — P4 feature view · 0014 · CronParser (Apple)
//
//  The CronParser feature view — the SwiftUI parity of
//  features/admin/components/devtools/tools/CronParser.tsx. A green ToolCard-style glass
//  panel with a cron expression field, one-tap presets, the human-readable description,
//  and the upcoming run times. Every state renders (empty / parsed-with-runs /
//  parsed-without-runs); the view binds through `CronParserModel` and performs no work of
//  its own beyond driving the model. The projection is local (web `useMemo`), so the
//  surface needs no network and works fully offline.
//

import SwiftUI

/// The composable Cron Parser devtool surface. Reproduces the web tool's data,
/// composition, and states with native primitives + the shared component library.
public struct CronParser: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = CronParserSurface.slug

    @State private var model: CronParserModel

    public init(model: CronParserModel = CronParserModel()) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        return TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                CronParserHeader()
                CronInputField(text: $model.input, example: CronInputExample.value)
                CronPresetRow(presets: model.presets, onSelect: model.apply)
                resultSection
            }
        }
        .onAppear { model.start() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web `{description && …}` + `{nextRuns.length > 0 && …}` branches, expanded so
    /// every state renders (never a blank box): a friendly empty hint, or the description
    /// panel plus the next-runs list / no-runs note.
    @ViewBuilder
    private var resultSection: some View {
        switch model.result {
        case .empty:
            CronEmptyHint()
        case let .parsed(description, _):
            CronDescriptionPanel(text: description)
            CronNextRunsSection(rows: model.runRows())
        }
    }
}
