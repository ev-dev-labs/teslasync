//
//  PageContainer.Views.swift
//  TeslaSync — P4 shared surface · 0171 · PageContainer (Apple)
//
//  The presentational subviews composed by `PageContainer`'s header: the title / subtitle block (web
//  `<h1>` + muted subtitle), the data-freshness chip (the native parity of the web
//  `DataFreshnessAuto` → `DataFreshness`: a status dot + a connectivity glyph + a relative-age label),
//  and the copy-link button (web `CopyLinkButton`: a ghost button that flips to a transient "Copied"
//  state). All colour comes from the shared P1/S9 tokens — no Tailwind ports, no raw hex — and all
//  copy resolves through the P1/S10 facade.
//
//  Accessibility note: the freshness chip is one combined VoiceOver element (web `aria-atomic`) with a
//  spoken label that is "Refresh" when actionable or "Data freshness: {state}" otherwise; the spinning
//  / pulsing motion is suppressed under Reduce Motion. The copy-link button carries its own label.
//

import SwiftUI

// MARK: - Title block (web `<h1>` + subtitle)

/// The page heading — the bold title (web `text-2xl font-bold tracking-tight`, marked as a VoiceOver
/// header) and the optional muted subtitle (web `text-sm text-[var(--text-muted)]`).
struct PageContainerTitleBlock: View {
    let title: String
    let subtitle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: title)
                .font(Font.TS.title)
                .tracking(TSTypeMetrics.titleTracking)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let subtitle, !subtitle.isEmpty {
                Text(verbatim: subtitle)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Freshness chip (web `DataFreshnessAuto` → `DataFreshness`)

/// The data-freshness chip — the native parity of the web `DataFreshness`. A coloured status dot, a
/// connectivity glyph (Wi-Fi for fresh / stale, a refresh glyph that spins while fetching, Wi-Fi-slash
/// for offline), and the relative-age label, tinted by the band. Actionable (a button that re-requests
/// the data, web `onRefresh`) when `refetchable`. The fetching spin respects Reduce Motion.
struct PageContainerFreshnessChip: View {
    let readout: PageContainerFreshnessReadout
    let refetchable: Bool
    let onRefresh: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var rotating = false

    private var status: PageContainerFreshnessStatus {
        readout.status
    }

    private var tone: Color {
        switch status {
        case .fresh: Color.TS.statusSuccess
        case .fetching: Color.TS.statusInfo
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.statusDanger
        }
    }

    private var symbol: String {
        switch status {
        case .fresh, .stale: "wifi"
        case .fetching: "arrow.triangle.2.circlepath"
        case .offline: "wifi.slash"
        }
    }

    private var accessibilityLabelText: String {
        PageContainerAccessibility.freshnessLabel(
            status: status,
            refetchable: refetchable,
            strings: PageContainerStrings.string
        )
    }

    var body: some View {
        Group {
            if refetchable {
                Button(action: onRefresh) { chip }
                    .buttonStyle(.plain)
            } else {
                chip
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
        .accessibilityAddTraits(refetchable ? .isButton : .isStaticText)
    }

    private var chip: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
            Image(systemName: symbol)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(tone)
                .rotationEffect(.degrees(rotating ? 360 : 0))
                .accessibilityHidden(true)
            if !readout.ageLabel.isEmpty {
                Text(verbatim: readout.ageLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(tone.opacity(0.8))
                    .monospacedDigit()
                    .frame(minWidth: 56, alignment: .leading)
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: Capsule())
        .onAppear { syncSpin() }
        .onChange(of: status) { _, _ in syncSpin() }
    }

    /// Starts a continuous rotation while fetching (off under Reduce Motion), and stops it otherwise —
    /// the native parity of the web `RefreshCw` `animate-spin`.
    private func syncSpin() {
        if status == .fetching, !reduceMotion {
            withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) {
                rotating = true
            }
        } else {
            withAnimation(.default) {
                rotating = false
            }
        }
    }
}

// MARK: - Copy-link button (web `CopyLinkButton`)

/// The copy-link affordance — the native parity of the web `CopyLinkButton`: a ghost button showing a
/// link glyph + "Copy link" that, on tap, copies the page's deep link and flips to a checkmark +
/// "Copied" for two seconds (web `setCopied(true)` + the 2s `setTimeout`). `onCopy` performs the copy
/// and reports whether it happened, so a no-op copy (no link wired) leaves the button idle.
struct PageContainerCopyLinkButton: View {
    let onCopy: () -> Bool

    @State private var copied = false

    private var label: String {
        copied
            ? PageContainerStrings.string("common.copyLink.copied", "Copied")
            : PageContainerStrings.string("common.copyLink.action", "Copy link")
    }

    var body: some View {
        TSButton(variant: .ghost, size: .small, action: handleTap) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: copied ? "checkmark" : "link")
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: label)
            }
        }
        .accessibilityLabel(Text(verbatim: PageContainerStrings.string(
            "common.copyLink.label", "Copy link to this view"
        )))
        // Reset the transient "Copied" state after two seconds (web `setTimeout(…, 2000)`). Driven by
        // `.task(id:)` so the timer lives on the view's main-actor lifecycle and is cancelled if the
        // button is re-tapped or removed — no manual `Task` capture of the non-Sendable view.
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(2))
            copied = false
        }
    }

    private func handleTap() {
        guard onCopy() else { return }
        copied = true
    }
}
