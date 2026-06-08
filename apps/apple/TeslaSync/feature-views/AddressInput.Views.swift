//
//  AddressInput.Views.swift
//  TeslaSync — P4 feature view · 0135 · AddressInput (Apple)
//
//  The presentational chrome for the "Address" autocomplete: the bordered input row (web `Combobox`
//  trigger with the lucide `MapPin` icon + spinner), the live-state freshness chip, the stale /
//  offline connectivity banner, one suggestion row (web `renderOption` — `MapPin` + the clamped
//  `display_name`), the suggestion list, and the post-select confirmation. All copy resolves through
//  the P1/S10 facade; all chrome is token-driven (P1/S9). The load-state chrome lives in
//  AddressInput.States.swift.
//

import SwiftUI

// MARK: - Input field (web `Combobox` trigger — `MapPin` + text + spinner)

/// The bordered address field: a leading `MapPin`, the free-text query field (web `allowFreeText`
/// `inputValue` bound to the parent's `value`), and a trailing spinner while searching.
struct AddressInputField: View {
    @Binding var text: String
    let isBusy: Bool
    let accessibilityLabel: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "mappin.and.ellipse")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            field
            if isBusy {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    private var field: some View {
        TextField(text: $text, prompt: AddressInputStrings.text("addressInput.prompt", "Search for an address")) {
            Text(verbatim: accessibilityLabel)
        }
        .labelsHidden()
        .textFieldStyle(.plain)
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textPrimary)
        .autocorrectionDisabled(true)
        .submitLabel(.search)
        #if os(iOS)
            .textInputAutocapitalization(.words)
        #endif
            .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013).
struct AddressInputFreshnessChip: View {
    let connection: AddressInputConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            AddressInputStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(AddressInputStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: AddressInputConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "addressInput.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "addressInput.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "addressInput.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the suggestions when the bound source is not live, so cached
/// rows are clearly labelled (web `DataFreshness` intent).
struct AddressInputConnectivityBanner: View {
    let connection: AddressInputConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "addressInput.offlineBanner" : "addressInput.staleBanner"
        let fallback = offline
            ? "Offline — showing the last address results"
            : "Reconnecting — address search may be delayed"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            AddressInputStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Suggestion row (web `renderOption` — `MapPin` + clamped `display_name`)

/// One tappable suggestion row: a `MapPin` glyph and the address line clamped to two lines (web
/// `line-clamp-2`). Choosing it confirms the selection through the bound model.
struct AddressSuggestionRow: View {
    let suggestion: AddressSuggestion
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                Text(verbatim: suggestion.title)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, TSSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: suggestion.accessibilityLabel))
        .accessibilityAddTraits(.isButton)
    }
}

/// The resolved suggestion list (web menu `options`): the rows separated by hairlines.
struct AddressSuggestionsList: View {
    let suggestions: [AddressSuggestion]
    let onSelect: (AddressSuggestion) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(suggestions.enumerated()), id: \.element.id) { index, suggestion in
                AddressSuggestionRow(suggestion: suggestion) { onSelect(suggestion) }
                if index < suggestions.count - 1 {
                    Divider().overlay(Color.TS.border)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Selected confirmation (web filled input after choosing an option)

/// The post-select confirmation row (web's collapsed menu + filled input): the chosen address with a
/// success check, shown until the query is edited again.
struct AddressInputSelectedConfirmation: View {
    let location: TripLocationDTO

    var body: some View {
        let prefix = AddressInputStrings.string("addressInput.selected", "Selected address")
        return HStack(spacing: TSSpacing.sm) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 14))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            Text(verbatim: location.name)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(prefix): \(location.name)"))
    }
}
