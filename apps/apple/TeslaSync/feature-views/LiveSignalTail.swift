//
//  LiveSignalTail.swift
//  TeslaSync — P4 feature view · 0263 · LiveSignalTail (Apple)
//
//  The live SSE signal tail — SwiftUI parity of
//  features/telemetry/components/LiveSignalTail.tsx. A pure-render panel: an
//  optional title with a pulsing live indicator, a name filter, the pause /
//  auto-scroll / clear controls, the four header stats, and a scrolling,
//  newest-first Time / Signal / Value / Type / Freshness table. Binds through
//  `LiveSignalTailModel` (P1/S8); the production source streams over SSE. Every
//  state from the web source is reproduced — the "Waiting for signals…" and
//  "No signals match filter" messages — plus the native error / stale / offline
//  chrome the web delegates to its host page. No networking lives here.
//

import SwiftUI

// MARK: - LiveSignalTail (the feature surface)

/// The live signal tail surface. Shows the incoming SSE signal buffer as a
/// filterable, auto-scrolling table with live stats and pause / clear controls,
/// formatted per the web source. Binds through `LiveSignalTailModel`.
public struct LiveSignalTail: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "LiveSignalTail"

    @State private var model: LiveSignalTailModel
    private let title: String?
    private let showsStats: Bool

    @State private var appeared = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameters:
    ///   - model: the bound state holder (P1/S8).
    ///   - title: optional panel title with the pulsing live indicator (web `title`).
    ///   - showsStats: whether to show the four header stat cards (web `showStats`).
    public init(model: LiveSignalTailModel, title: String? = nil, showsStats: Bool = true) {
        _model = State(initialValue: model)
        self.title = title
        self.showsStats = showsStats
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if showsStats {
                LiveSignalTailStatsGrid(stats: model.stats)
            }
            content
                .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared || reduceMotion ? 0 : 8)
        .onAppear {
            model.start()
            if reduceMotion {
                appeared = true
            } else {
                withAnimation(.easeOut(duration: TSMotion.normalDuration)) { appeared = true }
            }
        }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var isCompact: Bool {
            horizontalSizeClass == .compact
        }
    #else
        private var isCompact: Bool {
            false
        }
    #endif
}

// MARK: - Header (title + status chip + filter + controls)

extension LiveSignalTail {
    @ViewBuilder
    private var header: some View {
        if isCompact {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    titleLabel
                    Spacer(minLength: TSSpacing.sm)
                    LiveSignalTailStatusChip(connection: model.connection, paused: model.paused)
                }
                LiveSignalTailFilterField(text: $model.filterText)
                controls
            }
        } else {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                titleLabel
                LiveSignalTailFilterField(text: $model.filterText)
                    .frame(maxWidth: 280)
                Spacer(minLength: TSSpacing.sm)
                LiveSignalTailStatusChip(connection: model.connection, paused: model.paused)
                controls
            }
        }
    }

    @ViewBuilder
    private var titleLabel: some View {
        if let title, !title.isEmpty {
            HStack(spacing: TSSpacing.xs) {
                LiveSignalTailPulseDot(active: !model.paused)
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            .accessibilityElement(children: .combine)
        }
    }

    private var controls: some View {
        HStack(spacing: TSSpacing.sm) {
            pauseButton
            autoScrollButton
            clearButton
        }
    }

    private var pauseButton: some View {
        let label = model.paused ? LiveSignalTailStrings.resume : LiveSignalTailStrings.pause
        return LiveSignalTailControlButton(
            title: label,
            systemImage: model.paused ? "play.fill" : "pause.fill",
            tone: .neutral,
            isActive: false
        ) {
            model.togglePause()
        }
        .accessibilityLabel(Text(verbatim: label))
    }

    private var autoScrollButton: some View {
        LiveSignalTailControlButton(
            title: LiveSignalTailStrings.autoScroll,
            systemImage: "arrow.down",
            tone: .neutral,
            isActive: model.autoScroll
        ) {
            model.toggleAutoScroll()
        }
        .accessibilityLabel(Text(verbatim: LiveSignalTailStrings.autoScroll))
        .accessibilityAddTraits(model.autoScroll ? .isSelected : [])
    }

    private var clearButton: some View {
        LiveSignalTailControlButton(
            title: LiveSignalTailStrings.clear,
            systemImage: "trash",
            tone: .danger,
            isActive: false
        ) {
            model.clear()
        }
        .accessibilityLabel(Text(verbatim: LiveSignalTailStrings.clear))
    }
}

// MARK: - Content (state branches for the tail area)

extension LiveSignalTail {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingState
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            LiveSignalTailTable(model: model)
        }
    }

    /// Subscribed but no event buffered yet — the web `DataTable` "Waiting for
    /// signals…" empty message, with a spinner while the stream connects.
    private var loadingState: some View {
        VStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            Text(verbatim: LiveSignalTailStrings.waiting)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, TSSpacing.x2xl)
        .accessibilityElement(children: .combine)
    }

    /// Settled with an empty buffer — the web "Waiting for signals…" state.
    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: LiveSignalTailStrings.waiting)
            } icon: {
                Image(systemName: "dot.radiowaves.left.and.right")
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// The stream failed with nothing buffered — native error chrome with retry.
    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: LiveSignalTailStrings.errorTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.refresh()
            } label: {
                Text(verbatim: LiveSignalTailStrings.retry)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: LiveSignalTailStrings.retry))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xl)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Filter field (web search `Input` with leading icon + aria-label)

/// The name filter — a search field with a leading magnifying-glass icon and the
/// web aria-label. Mirrors the web search `<Input>` (prompt "Filter by signal
/// name...", aria-label "Filter signals").
struct LiveSignalTailFilterField: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField(
                text: $text,
                prompt: Text(verbatim: LiveSignalTailStrings.filterPrompt)
            ) {
                Text(verbatim: LiveSignalTailStrings.filterAria)
            }
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .labelsHidden()
            .accessibilityLabel(Text(verbatim: LiveSignalTailStrings.filterAria))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Pulsing live indicator (web `<Radio className="animate-pulse">`)

/// The small pulsing red dot next to the title — the web Radio glyph. The pulse is
/// disabled when the stream is paused or Reduce Motion is on.
struct LiveSignalTailPulseDot: View {
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Image(systemName: "dot.radiowaves.left.and.right")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Color.TS.statusDanger)
            .symbolEffect(.pulse, isActive: active && !reduceMotion)
            .accessibilityHidden(true)
    }
}
