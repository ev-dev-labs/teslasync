//
//  SignalExplorerPageViews.swift
//  TeslaSync — P4 feature view · P7 · SignalExplorerPage (Apple)
//
//  The web page's single GlassPanel control surface (GlassPanel1) plus the four
//  reusable data-state views (loading / empty / error / success) the useSignals
//  catalog renders, the two contextual empty states (no-vehicle, resting "pick
//  signals"), and the error banner. Every literal resolves through `SEText`
//  (Localizable.xcstrings); colours + spacing come from the P2 tokens.
//

import SwiftUI

// MARK: - Data-state views (loading / empty / error / success)

/// Loading state — redacted skeleton rows (ADR-011 "never a blank region").
struct ExplorerStateLoading: View {
    var rows: Int = 4

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< rows, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: 40)
            }
        }
        .redacted(reason: .privacy)
        .overlay(alignment: .center) { ProgressView() }
        .accessibilityLabel(Text(verbatim: SEText.title))
    }
}

/// Empty state — `ContentUnavailableView` (HIG-native), String-backed so it can
/// render the already-resolved `SEText` literals verbatim.
struct ExplorerStateEmpty: View {
    let title: String
    let message: String
    var systemImage: String = "tray"

    var body: some View {
        ContentUnavailableView {
            Label { Text(verbatim: title) } icon: { Image(systemName: systemImage) }
        } description: {
            Text(verbatim: message)
        }
        .accessibilityLabel(Text(verbatim: title))
    }
}

/// Error state — the `error.loadFailed` lead + message + a Retry affordance.
struct ExplorerStateError: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: SEText.loadFailed)
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill")
            }
        } description: {
            Text(verbatim: message)
        } actions: {
            Button(action: retry) {
                Label("action.retry", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.borderedProminent)
        }
        .accessibilityLabel(Text(verbatim: "\(SEText.loadFailed). \(message)"))
    }
}

// MARK: - Error banner (web `AlertBanner` over `anyError`)

/// The page-level load-failure banner (web `error.loadFailed: {message}`).
struct ExplorerErrorBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: "\(SEText.loadFailed): \(message)")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusDanger.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - GlassPanel1 · the explorer control surface

/// The web page's single `GlassPanel` (GlassPanel1): the signal multi-select (with
/// the useSignals loading / empty / error / success states), the time range, the
/// per-page size, and the Explore / Live actions + live help.
struct SignalExplorerControlPanel: View {
    @Bindable var model: SignalExplorerPageModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                SignalCatalogSelector(model: model)
                Divider().overlay(Color.TS.border)
                controlsRow
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var controlsRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .bottom, spacing: TSSpacing.md) { controls }
            VStack(alignment: .leading, spacing: TSSpacing.md) { controls }
        }
    }

    @ViewBuilder private var controls: some View {
        timeRangeField
        Spacer(minLength: 0)
        if !model.isLive {
            perPagePicker
            exploreButton
        }
        liveButton
        liveHelp
    }

    private var timeRangeField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: SEText.timeRange)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .textCase(.uppercase)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: TSSpacing.sm) { rangePickers }
                VStack(alignment: .leading, spacing: TSSpacing.sm) { rangePickers }
            }
        }
    }

    @ViewBuilder private var rangePickers: some View {
        DatePicker("", selection: $model.rangeStart, displayedComponents: [.date, .hourAndMinute])
            .labelsHidden()
            .accessibilityLabel(Text(verbatim: SEText.timeRange))
        Image(systemName: "arrow.right").foregroundStyle(Color.TS.textMuted)
        DatePicker("", selection: $model.rangeEnd, displayedComponents: [.date, .hourAndMinute])
            .labelsHidden()
            .accessibilityLabel(Text(verbatim: SEText.timeRange))
    }

    private var perPagePicker: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: SEText.perPage)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .textCase(.uppercase)
            Picker(SEText.perPage, selection: perPageBinding) {
                ForEach(model.perPageOptions, id: \.self) { option in
                    Text(verbatim: "\(option)").tag(option)
                }
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .accessibilityLabel(Text(verbatim: SEText.perPage))
        }
    }

    private var perPageBinding: Binding<Int> {
        Binding(get: { model.perPage }, set: { model.setPerPage($0) })
    }

    private var exploreButton: some View {
        Button {
            Task { await model.explore() }
        } label: {
            Label { Text(verbatim: SEText.explore) } icon: { Image(systemName: "cylinder.split.1x2") }
                .frame(minHeight: 28)
        }
        .buttonStyle(.borderedProminent)
        .disabled(!model.canExplore || model.historicalLoading)
        .accessibilityLabel(Text(verbatim: SEText.explore))
    }

    private var liveButton: some View {
        Button(role: model.isLive ? .destructive : nil) {
            model.toggleLive()
        } label: {
            Label {
                Text(verbatim: model.isLive ? SEText.stopLive : SEText.live)
            } icon: {
                Image(systemName: "dot.radiowaves.left.and.right")
            }
            .frame(minHeight: 28)
        }
        .buttonStyle(.bordered)
        .disabled(model.selectedSignals.isEmpty && !model.isLive)
        .accessibilityLabel(Text(verbatim: model.isLive ? SEText.stopLive : SEText.live))
    }

    private var liveHelp: some View {
        Image(systemName: "questionmark.circle")
            .foregroundStyle(Color.TS.textMuted)
            .help(SEText.liveHelpAria)
            .accessibilityLabel(Text(verbatim: SEText.liveHelpAria))
    }
}

// MARK: - Signal multi-select (the useSignals four-state surface)

/// The signal catalog selector — the always-present multi-select that layers the
/// useSignals loading / empty / error / success states beneath its label
/// (web `SignalSelector`, capped at five).
struct SignalCatalogSelector: View {
    @Bindable var model: SignalExplorerPageModel

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.sm)]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            label
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private var label: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "antenna.radiowaves.left.and.right")
                .foregroundStyle(Color.TS.accent)
            Text(verbatim: "\(SEText.title) (\(model.selectedSignals.count) / \(SignalExplorerPageModel.maxSignals))")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
        }
    }

    @ViewBuilder private var content: some View {
        switch model.catalogPhase {
        case .loading:
            ExplorerStateLoading(rows: 3)
        case .empty:
            ExplorerStateEmpty(
                title: SEText.pickSignalsTitle,
                message: SEText.exploreHint,
                systemImage: "antenna.radiowaves.left.and.right.slash"
            )
            .frame(maxWidth: .infinity, minHeight: 120)
        case let .error(message):
            ExplorerStateError(message: message) { Task { await model.retryCatalog() } }
        case .success:
            selector
        }
    }

    private var selector: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TextField(text: $model.catalogSearch) {
                Text("signalExplorer.search")
            }
            .textFieldStyle(.roundedBorder)
            .accessibilityLabel(Text(verbatim: SEText.title))
            chipGrid
        }
    }

    private var chipGrid: some View {
        ScrollView {
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(filteredSignals, id: \.self) { signal in
                    SignalChip(
                        name: signal,
                        isSelected: model.isSelected(signal),
                        isDisabled: model.isAtCapacity && !model.isSelected(signal)
                    ) {
                        model.toggleSignal(signal)
                    }
                }
            }
            .padding(.vertical, TSSpacing.xs)
        }
        .frame(maxHeight: 220)
    }

    private var filteredSignals: [String] {
        let needle = model.catalogSearch.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return model.availableSignals }
        return model.availableSignals.filter { $0.lowercased().contains(needle) }
    }
}

/// One selectable signal chip (web combobox option). Carries the cyan accent +
/// VoiceOver `isSelected` trait when active; dims when the five-cap is reached.
struct SignalChip: View {
    let name: String
    let isSelected: Bool
    let isDisabled: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: isSelected ? "checkmark.square.fill" : "square")
                    .foregroundStyle(isSelected ? Color.TS.accent : Color.TS.textMuted)
                Text(verbatim: name)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, TSSpacing.sm)
            .frame(minHeight: 32)
            .background(
                isSelected ? Color.TS.accent.opacity(0.10) : Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(
                        isSelected ? Color.TS.accent.opacity(0.5) : Color.TS.border,
                        lineWidth: 1
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.45 : 1)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
        .accessibilityLabel(Text(verbatim: name))
    }
}
