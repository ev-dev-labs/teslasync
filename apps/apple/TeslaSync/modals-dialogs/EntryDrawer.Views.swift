//
//  EntryDrawer.Views.swift
//  TeslaSync — P4 modal / dialog · 0018 · EntryDrawer (Apple)
//
//  The populated content + chrome for `EntryDrawer`: the modal header (envelope glyph + title +
//  freshness chip + close), the summary KVList panel (web `<KVList>`), the payload panel (the
//  inner / raw tab bar + the CopyButton + the monospace `<pre>` viewer), and the footer actions
//  (Close + Replay). All copy resolves through the P1/S10 facade; all chrome is token-driven
//  (P1/S9). No web Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (web Drawer title + close)

/// The dialog header: the envelope glyph, the "DLQ entry #{{id}}" title + freshness chip, and the
/// trailing close button that dismisses the surface.
struct EntryDrawerHeader: View {
    let title: String
    let connection: EntryDrawerConnection
    let closeLabel: String
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
            }
            EntryDrawerFreshnessChip(connection: connection)
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "envelope.badge")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 32, height: 32)
            .background(Color.TS.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: closeLabel))
    }
}

// MARK: - Content (web `head ? <panels> : null`)

/// The resolved content body: the optional inline reload error, the summary KVList panel, and the
/// payload panel. Bound through `EntryDrawerModel`.
struct EntryDrawerContent: View {
    @Bindable var model: EntryDrawerModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let message = model.inlineErrorMessage {
                EntryDrawerInlineError(message: message)
            }
            EntryDrawerSummaryPanel(rows: model.rows)
            EntryDrawerPayloadPanel(model: model)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Summary panel (web `<GlassPanel><KVList /></GlassPanel>`)

/// The summary KVList in a glass panel — the parity of the web summary card (ID, Arrived, DLQ
/// topic, Reason, VIN, Source topic, Redeliveries, Parse error).
struct EntryDrawerSummaryPanel: View {
    let rows: [EntryDrawerKVRow]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(rows) { row in
                    EntryDrawerKVRowView(row: row)
                    if row.id != rows.last?.id {
                        Divider().overlay(Color.TS.border.opacity(0.6))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// One KVList row: the muted label and the value (monospace for the topic / id columns, de-emphased
/// for the parse-error row).
struct EntryDrawerKVRowView: View {
    let row: EntryDrawerKVRow

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            Text(verbatim: row.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: row.value)
                .font(valueFont)
                .foregroundStyle(row.muted ? Color.TS.textMuted : Color.TS.textPrimary)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(row.label), \(row.value)"))
    }

    private var valueFont: Font {
        row.monospace ? Font.system(.caption, design: .monospaced) : Font.TS.body
    }
}

// MARK: - Payload panel (web tabs + CopyButton + `<pre>`)

/// The payload panel: the inner / raw tab bar, the trailing CopyButton, and the monospace `<pre>`
/// viewer (decoded UTF-8 or the binary-fallback message).
struct EntryDrawerPayloadPanel: View {
    @Bindable var model: EntryDrawerModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                EntryDrawerTabBar(model: model)
                HStack {
                    Spacer(minLength: 0)
                    EntryDrawerCopyButton(model: model)
                }
                EntryDrawerPayloadText(text: model.payloadDisplayText, label: model.payloadAccessibilityLabel)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// The two-segment tab bar (web `<Tabs>`): inner payload / raw envelope.
struct EntryDrawerTabBar: View {
    @Bindable var model: EntryDrawerModel

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(model.tabs) { tab in
                let selected = tab == model.activeTab
                Button { model.selectTab(tab) } label: {
                    Text(verbatim: model.tabLabel(tab))
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(selected ? Color.white : Color.TS.textSecondary)
                        .padding(.horizontal, TSSpacing.md)
                        .padding(.vertical, TSSpacing.xs)
                        .background(
                            selected ? Color.TS.accent : Color.clear,
                            in: Capsule()
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: model.tabLabel(tab)))
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
            }
        }
    }
}

/// The CopyButton parity: an icon + "Copy" / "Copied" label that writes the active payload to the
/// clipboard and flips back after a brief confirmation window.
struct EntryDrawerCopyButton: View {
    @Bindable var model: EntryDrawerModel

    var body: some View {
        Button {
            model.copyActivePayload()
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(2))
                model.resetCopied()
            }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: model.copied ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: model.copyAccessibilityLabel)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
            }
            .foregroundStyle(model.copied ? Color.TS.statusSuccess : Color.TS.accent)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(model.copied ? 0 : 0.10), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.copyAccessibilityLabel))
        .accessibilityAddTraits(.isButton)
    }
}

/// The monospace payload viewer (web `<pre>`): a bordered, scrollable, selectable block.
struct EntryDrawerPayloadText: View {
    let text: String
    let label: String

    var body: some View {
        ScrollView {
            Text(verbatim: text)
                .font(Font.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TSSpacing.md)
        }
        .frame(maxHeight: 320)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityValue(Text(verbatim: text))
    }
}

// MARK: - Footer (web Drawer `footer`)

/// The footer actions: a secondary Close button and the primary Replay button (disabled per the
/// four gates, with an in-flight spinner + the paper-plane glyph).
struct EntryDrawerFooter: View {
    @Bindable var model: EntryDrawerModel
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            closeButton
            replayButton
        }
        .frame(maxWidth: .infinity)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Text(verbatim: EntryDrawerStrings.string("common.close", "Close"))
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.lg)
                .padding(.vertical, TSSpacing.sm)
                .background(Color.TS.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.closeAccessibilityLabel))
    }

    private var replayButton: some View {
        Button { model.replay() } label: {
            HStack(spacing: TSSpacing.xs) {
                if model.replayInFlight {
                    ProgressView().controlSize(.mini).tint(Color.white)
                } else {
                    Image(systemName: "paperplane.fill").font(.system(size: 12, weight: .semibold))
                }
                Text(verbatim: model.replayAccessibilityLabel)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
            }
            .foregroundStyle(Color.white)
            .padding(.horizontal, TSSpacing.lg)
            .padding(.vertical, TSSpacing.sm)
            .background(
                model.replayDisabled ? Color.TS.accent.opacity(0.35) : Color.TS.accent,
                in: Capsule()
            )
        }
        .buttonStyle(.plain)
        .disabled(model.replayDisabled)
        .accessibilityLabel(Text(verbatim: model.replayAccessibilityLabel))
        .accessibilityAddTraits(.isButton)
    }
}
