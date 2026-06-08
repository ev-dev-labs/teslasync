//
//  EndpointSidebar.Views.swift
//  TeslaSync — P4 feature view · 0029 · EndpointSidebar (Apple)
//
//  The composable sub-views of the sidebar, each the native idiom of a web
//  sub-component:
//    • EndpointMethodBadge  — web `MethodBadge` (mono, fixed-width, tinted by verb)
//    • EndpointRow          — web endpoint `UiButton` row (badge + mono path)
//    • EndpointTagGroupView — web `TagGroup` (collapsible, chevron + count chip)
//    • EndpointSearchField  — web `UiInput` with the search icon + prompt text
//    • EndpointFreshnessChip / EndpointConnectivityBanner — native freshness chrome
//
//  All colour/spacing/typography comes from the P1/S9 design tokens; no Tailwind
//  classes are ported and no raw hex/inline colours are used.
//

import SwiftUI

// MARK: - Method → semantic tone (web METHOD_COLORS map)

/// Maps an HTTP verb to a design-token tone, the native equivalent of the web
/// `METHOD_COLORS` table (`GET`→green, `POST`→blue, `PUT`→amber, `DELETE`→red,
/// `PATCH`→purple) with the same neutral fallback for unknown verbs.
func endpointMethodTone(_ method: HTTPMethod) -> TSTone {
    switch method {
    case .get: .success
    case .post: .info
    case .put: .warning
    case .delete: .danger
    case .patch: .accent
    case .other: .neutral
    }
}

// MARK: - Method badge (web `MethodBadge`)

/// Compact, fixed-width monospaced verb chip — the native `MethodBadge`. Tinted
/// `tone.opacity(0.2)` fill + solid tone text reproduces the web
/// `bg-{c}-500/20 text-{c}-400` styling without inline colours.
struct EndpointMethodBadge: View {
    let method: HTTPMethod

    var body: some View {
        let tone = endpointMethodTone(method)
        Text(verbatim: method.token)
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .foregroundStyle(tone.color)
            .frame(width: 50)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.2), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .accessibilityHidden(true)
    }
}

// MARK: - Endpoint row (web endpoint `UiButton`)

/// One selectable endpoint row: the method badge + the monospaced path, with the
/// web selected treatment (a leading accent rule + a subtle surface wash). Tapping
/// forwards to `onSelect`; the whole row is one VoiceOver element.
struct EndpointRowView: View {
    let endpoint: ParsedEndpoint
    let isSelected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: TSSpacing.sm) {
                EndpointMethodBadge(method: endpoint.method)
                Text(verbatim: endpoint.path)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? Color.TS.surface.opacity(0.6) : Color.clear)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(isSelected ? Color.TS.accent : Color.clear)
                    .frame(width: 2)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: EndpointSidebarAccessibility.rowLabel(
            for: endpoint,
            isSelected: isSelected
        )))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Collapsible tag group (web `TagGroup`)

/// A collapsible group of endpoints under one tag — the native `TagGroup`. The
/// header (rotating chevron + upper-cased tag + count chip) toggles the rows; the
/// initial open state comes from the projection's `defaultOpen` heuristic.
struct EndpointTagGroupView: View {
    let group: EndpointTagGroup
    let isSelected: (ParsedEndpoint) -> Bool
    let onSelect: (ParsedEndpoint) -> Void

    @State private var isExpanded: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        group: EndpointTagGroup,
        isSelected: @escaping (ParsedEndpoint) -> Bool,
        onSelect: @escaping (ParsedEndpoint) -> Void
    ) {
        self.group = group
        self.isSelected = isSelected
        self.onSelect = onSelect
        _isExpanded = State(initialValue: group.isInitiallyExpanded)
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if isExpanded {
                ForEach(group.endpoints) { endpoint in
                    EndpointRowView(
                        endpoint: endpoint,
                        isSelected: isSelected(endpoint),
                        onSelect: { onSelect(endpoint) }
                    )
                }
            }
        }
    }

    private var header: some View {
        Button {
            withAnimation(TSAnimation.standard(reduceMotion: reduceMotion)) {
                isExpanded.toggle()
            }
        } label: {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .rotationEffect(.degrees(isExpanded ? 0 : -90))
                Text(verbatim: group.tag.uppercased())
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: "\(group.count)")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: EndpointSidebarAccessibility.groupLabel(tag: group.tag, count: group.count)))
        .accessibilityValue(Text(isExpanded ? "playground.a11yExpanded" : "playground.a11yCollapsed"))
        .accessibilityHint(Text("playground.a11yToggleHint"))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Search field (web `UiInput` with icon)

/// The search box — a leading magnifying-glass icon, the prompt text, and a clear
/// affordance once text is present. The native idiom of the web `UiInput`.
struct EndpointSearchField: View {
    @Binding var text: String

    var body: some View {
        let promptText = EndpointSidebarStrings.string("playground.search", "Search endpoints...")
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField("", text: $text, prompt: Text(verbatim: promptText))
                .textFieldStyle(.plain)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .autocorrectionDisabled()
                .accessibilityLabel(Text(verbatim: promptText))
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("playground.searchClear"))
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
}

// MARK: - Freshness chrome (native states the web parent owns)

/// A small connection dot + label (Live / Stale / Offline) for the sidebar header.
struct EndpointFreshnessChip: View {
    let connection: EndpointConnection

    var body: some View {
        let display = connectionDisplay
        HStack(spacing: 4) {
            Circle().fill(display.tone).frame(width: 6, height: 6)
            Text(verbatim: display.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(display.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: display.label))
    }

    private var connectionDisplay: (tone: Color, label: String) {
        switch connection {
        case .live:
            (Color.TS.statusSuccess, EndpointSidebarStrings.string("playground.live", "Live"))
        case .stale:
            (Color.TS.statusWarning, EndpointSidebarStrings.string("playground.stale", "Stale"))
        case .offline:
            (Color.TS.textMuted, EndpointSidebarStrings.string("playground.offline", "Offline"))
        }
    }
}

/// The stale/offline banner shown above the list when the catalogue is not live.
struct EndpointConnectivityBanner: View {
    let connection: EndpointConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "playground.offlineBanner" : "playground.staleBanner"
        let fallback = isOffline
            ? "Offline — showing cached endpoints"
            : "Reconnecting — endpoints may be out of date"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            EndpointSidebarStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
