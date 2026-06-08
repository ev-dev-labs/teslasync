//
//  ResultPanel.swift
//  TeslaSync — P4 feature view · 0008 · ResultPanel (Apple)
//
//  The composable ResultPanel feature view — SwiftUI parity of
//  features/admin/components/devtools/ResultPanel.tsx. Renders a titled result
//  surface whose body + background tint follow the web branch selection
//  (error → result → idle) plus the native loading / stale / offline states.
//  Binds through `ResultPanelModel` (P1/S8); no networking lives here.
//

import SwiftUI

// MARK: - ResultPanelView (the feature surface)

/// The composable ResultPanel surface — the SwiftUI parity of
/// `features/admin/components/devtools/ResultPanel.tsx`. A header (title + copy)
/// over a state-driven body, tinted by variant the way the web container is. Binds
/// through `ResultPanelModel`; the view performs no networking.
public struct ResultPanelView: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ResultPanel"

    @State private var model: ResultPanelModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(model: ResultPanelModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            ResultPanelTint.color(for: model.projection.variant),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.fastDuration), value: model.projection.variant)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web title row + `CopyButton`)

extension ResultPanelView {
    /// The web header: the title on the left, the copy affordance on the right when
    /// a result is shown. A freshness chip is interposed when the feed isn't live.
    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: model.projection.title)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: TSSpacing.sm)
            if model.connection != .live {
                ResultFreshnessChip(connection: model.connection)
            }
            if model.projection.hasData {
                ResultCopyButton(perform: { _ = model.copyResult() })
            }
        }
    }
}

// MARK: - Content states

extension ResultPanelView {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            resultContent
        }
    }

    /// Loading: a label shimmer over a code-block-shaped skeleton (web has no
    /// loading branch; this is the native in-flight chrome from the state matrix).
    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 200, height: 10)
            TSSkeleton(width: 260, height: 10)
            TSSkeleton(width: 150, height: 10)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement()
        .accessibilityLabel(ResultPanelStrings.text("devtools.resultPanel.loading", "Running…"))
    }

    /// Idle (web `idle`): a friendly muted line — `idleMessage ?? "No result yet"` —
    /// never a blank box.
    private var emptyState: some View {
        let message = model.projection.idleMessage
            ?? ResultPanelStrings.string("devtools.resultPanel.idle", "No result yet")
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: "curlybraces")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.body)
                .italic()
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// Error (web `error`): the failure message in the danger tone, with a retry
    /// affordance (the prompt's `QueryError`-equivalent).
    private func errorState(_ message: String) -> some View {
        let resolved = message.isEmpty
            ? ResultPanelStrings.string("devtools.resultPanel.genericError", "Request failed")
            : message
        return VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: resolved)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.statusDanger)
                    .multilineTextAlignment(.leading)
                    .textSelection(.enabled)
            }
            Button {
                model.refresh()
            } label: {
                Text(verbatim: ResultPanelStrings.string("devtools.resultPanel.retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.statusDanger.opacity(0.14), in: Capsule())
                    .foregroundStyle(Color.TS.statusDanger)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ResultPanelStrings.text("devtools.resultPanel.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// Result (web `hasData`): the pretty JSON inside a scrollable code block,
    /// preceded by a connectivity banner when a cached value is stale / offline.
    private var resultContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                ResultConnectivityBanner(connection: model.connection)
            }
            if let json = model.projection.prettyJSON {
                ResultCodeBlock(json: json)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
