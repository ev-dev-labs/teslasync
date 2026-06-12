//
//  StickyChipBar.swift
//  TeslaSync — P4 shared surface · 0200 · StickyChipBar (Apple)
//
//  The public API of the in-page section nav — the SwiftUI parity of `components/status/StickyChipBar.tsx`.
//  Like the web component it is driven entirely by its props (`chips`, `topOffset`); there is no fetcher.
//  It renders a horizontally-scrolling row of pill chips that scroll to in-page sections, highlights the
//  active one (web `activeId`), and presents the chrome of a pinned bar — a translucent material backdrop
//  with a bottom hairline (web `bg-[var(--bg-1)]/85 backdrop-blur border-b`). The view binds through
//  ``StickyChipBarModel`` for the once-only `view.opened` telemetry (P1/S11), the active-chip state, and
//  the routed jump / scroll-spy callbacks; composes the token-driven chrome (P1/S9); and pushes prop
//  changes into the holder via `.onChange` so a reused bar re-renders faithfully. No networking, no
//  Tailwind ports.
//
//  Two browser facilities of the web component become host seams here, because SwiftUI has no document
//  -wide element observer and the sections live on the host page, not in the bar:
//    • The page scroll container (web `handleClick` scrolls `#main-content`) → the page-supplied `onSelect`
//      closure. The host wires it to its own `ScrollViewProxy.scrollTo(id)`. The bar always updates its
//      own active id (web `setActiveId`) regardless.
//    • `IntersectionObserver` (web active-section tracking) → the optional `visibleSectionID` prop. The
//      host's scroll-spy passes the topmost-visible section id and the bar restyles + scrolls that pill
//      into view, exactly as the web observer drives `activeId`.
//
//  Pinning itself is host-owned, exactly as the web `position: sticky` needs a scrolling ancestor: drop
//  the bar into a `safeAreaInset(edge: .top)` or a pinned section header. `topOffset` is the inset applied
//  above the strip so it clears a fixed header (web sticky `top`).
//

import SwiftUI

/// The in-page section nav — the SwiftUI parity of `components/status/StickyChipBar.tsx`. Renders a
/// horizontally-scrolling row of pill chips (one per section), highlights the active section, scrolls the
/// active pill into view, and routes taps out to the host so it can scroll its content. Mounted at the top
/// of a long scrolling page as a "jump to section" affordance.
public struct StickyChipBar: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = StickyChipBarSurface.slug

    private let input: StickyChipBarInput
    private let visibleSectionID: String?
    private let onSelect: (@MainActor (String) -> Void)?
    @State private var model: StickyChipBarModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The prop-style initializer — the parity of `<StickyChipBar chips topOffset>`. `chips` are the
    /// sections (each `id` + `label`); `topOffset` is the inset above the strip when pinned (web sticky
    /// `top`, default 0); `visibleSectionID` is the host scroll-spy's topmost-visible section (the native
    /// peer of the web `IntersectionObserver` feed); `onSelect` is the page's scroll-to-section closure
    /// (web `handleClick` scrolling the page container).
    public init(
        chips: [SectionChip],
        topOffset: Double = 0,
        visibleSectionID: String? = nil,
        onSelect: (@MainActor (String) -> Void)? = nil,
        telemetry: any StickyChipBarTelemetry = OSLogStickyChipBarTelemetry()
    ) {
        let resolved = StickyChipBarInput(chips: chips, topOffset: topOffset)
        input = resolved
        self.visibleSectionID = visibleSectionID
        self.onSelect = onSelect
        _model = State(initialValue: StickyChipBarModel(
            input: resolved,
            onSelect: onSelect,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded active id).
    public init(model: StickyChipBarModel) {
        input = model.input
        visibleSectionID = nil
        onSelect = nil
        _model = State(initialValue: model)
    }

    public var body: some View {
        bar
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: input) { _, newInput in
                model.update(newInput, onSelect: onSelect)
            }
            .onChange(of: visibleSectionID) { _, newID in
                if let newID {
                    model.reportVisibleSection(newID)
                }
            }
    }

    /// The pinned-bar chrome — the strip (or the friendly empty view) over a translucent material backdrop
    /// with a bottom hairline, labelled "Jump to section" as one VoiceOver group (web nav `aria-label`).
    private var bar: some View {
        Group {
            if model.projection.isEmpty {
                StickyChipBarEmptyView()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, TSSpacing.lg)
                    .padding(.vertical, TSSpacing.sm)
            } else {
                chipStrip
            }
        }
        .padding(.top, CGFloat(input.topOffset))
        .background(TSMaterial.chrome)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: StickyChipBarStrings.jumpToSection))
    }

    /// The horizontally-scrolling pill row (web `flex gap-1.5 overflow-x-auto`). Wrapped in a
    /// `ScrollViewReader` so the active pill is scrolled into view when it changes — the native-idiomatic
    /// way to keep the current section discoverable in a long chip set, honoring Reduce Motion.
    private var chipStrip: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: TSSpacing.sm) {
                    ForEach(model.projection.chips) { chip in
                        SectionChipView(
                            chip: chip,
                            isActive: model.isActive(chip.id),
                            hint: StickyChipBarStrings.chipHint
                        ) { model.select(chip.id) }
                            .id(chip.id)
                    }
                }
                .padding(.horizontal, TSSpacing.lg)
                .padding(.vertical, TSSpacing.sm)
            }
            .onAppear { scrollToActive(proxy, animated: false) }
            .onChange(of: model.activeID) { _, _ in
                scrollToActive(proxy, animated: true)
            }
        }
    }

    /// Scrolls the active pill into the center of the strip — instantly on first appear, animated on later
    /// changes (skipped under Reduce Motion).
    private func scrollToActive(_ proxy: ScrollViewProxy, animated: Bool) {
        let target = model.activeID
        guard !target.isEmpty else { return }
        if animated, let animation = TSAnimation.standard(reduceMotion: reduceMotion) {
            withAnimation(animation) {
                proxy.scrollTo(target, anchor: .center)
            }
        } else {
            proxy.scrollTo(target, anchor: .center)
        }
    }
}
