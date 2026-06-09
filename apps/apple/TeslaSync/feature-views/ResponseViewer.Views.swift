//
//  ResponseViewer.Views.swift
//  TeslaSync — P4 feature view · 0041 · ResponseViewer (Apple)
//
//  The presentational subviews composed by the response panel: the disclosure
//  toggle (shared by the headers + snippet sections), the status bar, the body
//  `<pre>` equivalent, the collapsible response headers, and the loading /
//  empty chrome. All consume the P1/S10 facade and the shared P1/S9 tokens —
//  no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Disclosure toggle (web ghost button + rotating `ChevronDown`)

/// A chevron + label toggle row. The chevron rotates 180° when open (honoring
/// Reduce Motion), and the open/closed state is announced to VoiceOver.
struct ResponseDisclosureToggle: View {
    let title: String
    let isOpen: Bool
    let action: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .rotationEffect(.degrees(isOpen ? 180 : 0))
                    .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.fastDuration), value: isOpen)
                Text(verbatim: title)
                    .font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.textMuted)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityValue(Text(verbatim: ResponseViewerStrings.string(
            isOpen ? "responseViewer.expanded" : "responseViewer.collapsed",
            isOpen ? "Expanded" : "Collapsed"
        )))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Status bar (web status + meta row)

/// The status bar: the `{code} {statusText}` line tinted by status class, and
/// the `{duration}ms · {size}` meta, inside a tinted rounded container.
struct ResponseStatusBar: View {
    let projection: ResponseProjection

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: projection.statusLine)
                .font(.system(.subheadline, design: .monospaced).weight(.bold))
                .foregroundStyle(projection.statusClass.tone)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: projection.metaLine)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.sm)
        .background(
            projection.statusClass.backgroundFill,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(projection.statusClass.borderStroke, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Body (web `<pre>` response body)

/// The selectable, scrollable monospaced response body, capped at 500pt tall.
struct ResponseBody: View {
    let text: String

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            Text(verbatim: text)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TSSpacing.md)
        }
        .frame(maxHeight: 500)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: ResponseViewerStrings.string(
            "responseViewer.responseBodyA11y", "Response body"
        )))
        .accessibilityValue(Text(verbatim: text))
    }
}

// MARK: - Response headers (web collapsible `ResponseHeaders`)

/// The collapsible response-headers list. Renders nothing when there are no
/// headers (web `if (entries.length === 0) return null`).
struct ResponseHeadersSection: View {
    let headers: [ResponseHeaderItem]

    @State private var isOpen = false

    private var toggleTitle: String {
        let label = ResponseViewerStrings.string("playground.responseHeaders", "Response Headers")
        return "\(label) (\(headers.count))"
    }

    var body: some View {
        if !headers.isEmpty {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ResponseDisclosureToggle(title: toggleTitle, isOpen: isOpen) { isOpen.toggle() }
                if isOpen {
                    headerList
                }
            }
        }
    }

    private var headerList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(headers) { item in
                    (
                        Text(verbatim: "\(item.name): ").foregroundStyle(Color.TS.textSecondary)
                            + Text(verbatim: item.value).foregroundStyle(Color.TS.textMuted)
                    )
                    .font(.system(.caption2, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityElement()
                    .accessibilityLabel(Text(verbatim: "\(item.name): \(item.value)"))
                }
            }
            .padding(TSSpacing.sm)
        }
        .frame(maxHeight: 160)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Loading + empty chrome (web `Skeleton` / `EmptyState`)

/// The loading skeleton (web `<Skeleton className="h-48" />`), labelled for
/// VoiceOver since the shimmer itself is decorative.
struct ResponseLoadingView: View {
    var body: some View {
        TSSkeleton(height: 192, cornerRadius: TSRadius.md)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: ResponseViewerStrings.string(
                "responseViewer.loadingA11y", "Loading response"
            )))
            .accessibilityAddTraits(.updatesFrequently)
    }
}

/// The transient empty state (web `EmptyState`) shown before any request runs.
struct ResponseEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: ResponseViewerStrings.string(
                    "playground.noResponse", "Send a request to see the response"
                ))
            } icon: {
                Image(systemName: "arrow.down.circle")
            }
        }
        .accessibilityLabel(Text(verbatim: ResponseViewerStrings.string(
            "playground.noResponse", "Send a request to see the response"
        )))
    }
}
