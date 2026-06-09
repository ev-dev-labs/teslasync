//
//  RegexTester.swift
//  TeslaSync — P4 feature view · 0019 · RegexTester (Apple)
//
//  The composable regex-tester devtools surface — the SwiftUI parity of
//  features/admin/components/devtools/tools/RegexTester.tsx. Binds through
//  `RegexTesterModel` (P1/S8); renders the idle / matches / no-match states the
//  web source produces. No networking lives here — it is a pure local transform.
//

import SwiftUI

/// The composable regex tester — the SwiftUI parity of the web `RegexTesterTool`.
/// Rendered inside a ToolCard-style glass surface, binding through
/// `RegexTesterModel`.
public struct RegexTester: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RegexSurface.slug

    @State private var model: RegexTesterModel

    public init(model: RegexTesterModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: TSSpacing.md) {
            RegexToolHeader()
            RegexPatternField(pattern: $model.pattern)
            RegexFlagsSelect(flags: $model.flags)
            RegexTestStringField(text: $model.testString)
            RegexMatchCountBadge(outcome: model.outcome)
            results(for: model.outcome)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .task { model.start() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web `{matches.length > 0 && …}` branch, expanded so every state renders
    /// (never a blank box): the instructional idle hint, the no-match hint, or the
    /// list of hits.
    @ViewBuilder
    private func results(for outcome: RegexOutcome) -> some View {
        switch outcome {
        case .idle:
            RegexIdleHint()
        case let .evaluated(matches):
            if matches.isEmpty {
                RegexNoMatchHint()
            } else {
                RegexMatchList(matches: matches)
            }
        }
    }
}
