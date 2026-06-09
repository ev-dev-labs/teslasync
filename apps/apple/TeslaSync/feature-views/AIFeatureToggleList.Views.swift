//
//  AIFeatureToggleList.Views.swift
//  TeslaSync — P4 feature view · 0199 · AIFeatureToggleList (Apple)
//
//  The presentational subviews composed by `AIFeatureToggleList`: the per-feature toggle row (web
//  `<div>` label + Caption + `<Toggle>`), the row list (web `space-y-2` stack), the freshness chip,
//  and the loading skeleton. All consume the P1/S10 facade-resolved strings carried on the projection
//  + the shared P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//
//  Layout parity (ADR-006 semantic, not literal): the web row is a flex row with the label + muted
//  description on the left and the switch on the right; the native `Toggle` renders its label leading
//  and the switch trailing, so the same composition falls out of a single switch-styled Toggle.
//

import SwiftUI

// MARK: - Toggle row (web `flex items-start justify-between` label + Caption + Toggle)

/// One feature toggle row: the bold label over a muted description, with the opt-in switch trailing.
/// The switch writes through `model.toggle`, the native parity of the web `onChange={(next) =>
/// onToggle(id, next)}`. The label/description are decorative (hidden from VoiceOver); the switch is the
/// interactive element and carries the label (web `aria-label={label}`) + the description as its hint +
/// its own on/off state. Binding the switch with an inline closure that captures the `@MainActor` model
/// keeps the set closure `Sendable`-clean, matching the codebase's settings-toggle pattern.
struct AIFeatureToggleRowView: View {
    let row: AIFeatureToggleRow
    let model: AIFeatureToggleListModel

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: row.label)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                if !row.description.isEmpty {
                    Text(verbatim: row.description)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityHidden(true)
            Spacer(minLength: TSSpacing.sm)
            Toggle(isOn: Binding(get: { row.isEnabled }, set: { model.toggle(id: row.id, $0) })) {
                EmptyView()
            }
            .labelsHidden()
            .toggleStyle(.switch)
            .tint(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: row.accessibilityLabel))
            .accessibilityHint(Text(verbatim: row.description))
        }
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, TSSpacing.sm)
    }
}

// MARK: - Row list (web `space-y-2` toggle stack)

/// The populated body: every feature row stacked, each wired back to the model's optimistic flip. The
/// stack contains its children as a single accessibility container so VoiceOver can navigate row by
/// row.
struct AIFeatureToggleListContent: View {
    let projection: AIFeatureToggleProjection
    let model: AIFeatureToggleListModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(projection.rows) { row in
                AIFeatureToggleRowView(row: row, model: model)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Freshness chip (P4 leaf freshness axis)

/// The header freshness affordance: a tinted dot + label shown while fetching or when the bound source
/// is stale / offline. Live + idle hides it (the surface header is then just the legend).
struct AIFeatureToggleFreshnessChip: View {
    let connection: AIFeatureConnection
    let isFetching: Bool

    private var descriptor: (tone: Color, label: String) {
        switch connection {
        case .offline:
            (Color.TS.textMuted, AIFeatureToggleStrings.string("ai.settings.feature.offline", "Offline"))
        case .stale:
            (Color.TS.statusWarning, AIFeatureToggleStrings.string("ai.settings.feature.stale", "Stale"))
        case .live:
            (Color.TS.accent, AIFeatureToggleStrings.string("ai.settings.feature.updating", "Updating"))
        }
    }

    var body: some View {
        let descriptor = descriptor
        return HStack(spacing: 4) {
            Circle()
                .fill(descriptor.tone)
                .frame(width: 6, height: 6)
            Text(verbatim: descriptor.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: descriptor.label))
    }
}

// MARK: - Loading skeleton (P4 leaf loading chrome)

/// The initial-fetch chrome: skeleton rows (a label line + a switch pill) so the surface keeps its
/// shape while the parent settings query resolves.
struct AIFeatureToggleLoadingList: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 5, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    VStack(alignment: .leading, spacing: 4) {
                        TSSkeleton(width: 160, height: 12)
                        TSSkeleton(width: 240, height: 9)
                    }
                    Spacer(minLength: TSSpacing.md)
                    TSSkeleton(width: 44, height: 24, cornerRadius: TSRadius.pill)
                }
                .padding(.vertical, TSSpacing.xs)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AIFeatureToggleStrings.string(
            "ai.settings.feature.loading", "Loading AI feature toggles"
        )))
    }
}
