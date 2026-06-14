//
//  Tooltip.Previews.swift
//  TeslaSync — P4 shared surface · 0231 · Tooltip (Apple)
//
//  Xcode previews for every branch of the hover / focus tooltip: the revealed bubble single-line and
//  multiline, the four placements (web `side`), a rich-content bubble (the web `content: ReactNode` escape
//  hatch), the interactive trigger (hover on a pointer / tap on touch to reveal), and the empty-body branch
//  (the P4 "never a blank box" rule) shown next to a sibling label so its zero footprint is visible. The
//  pinned previews call ``TooltipController/present()`` so the otherwise hover-gated bubble renders in the
//  static canvas. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.x3xl)
        .frame(maxWidth: 460, alignment: .leading)
        .background(Color.TS.bg)
    }

    /// A pinned controller (``TooltipController/isPresented`` already `true`) so the hover-gated bubble shows
    /// in the static preview canvas.
    @MainActor
    private func pinned(
        _ text: String,
        side: TooltipSide = .top,
        wrap: TooltipWrap = .singleLine
    ) -> TooltipController {
        let controller = TooltipController(text: text, side: side, wrap: wrap)
        controller.present()
        return controller
    }

    /// The canonical trigger — a labelled chip the tooltip explains (the web call site wraps a button / icon).
    @MainActor
    private func triggerChip(_ title: String) -> some View {
        Text(verbatim: title)
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .tsGlassPanel(cornerRadius: TSRadius.sm)
    }

    #Preview("Bubble · single-line vs multiline") {
        staged("the revealed inverted bubble — nowrap and multiline (web max-w-[260px])") {
            VStack(alignment: .leading, spacing: TSSpacing.x3xl) {
                TooltipBubble(
                    side: .top,
                    wrap: .singleLine,
                    roleDescription: TooltipStrings.roleDefault,
                    isVisible: true,
                    reduceMotion: false
                ) {
                    TooltipText(text: "Battery health", wrap: .singleLine)
                }
                TooltipBubble(
                    side: .top,
                    wrap: .multiline,
                    roleDescription: TooltipStrings.roleDefault,
                    isVisible: true,
                    reduceMotion: false
                ) {
                    TooltipText(
                        text: "Energy lost while parked — battery self-discharge plus standby electronics.",
                        wrap: .multiline
                    )
                }
            }
        }
    }

    #Preview("Bubble · placements") {
        staged("top · bottom · leading · trailing (web side)") {
            HStack(spacing: TSSpacing.x3xl) {
                ForEach(TooltipSide.allCases, id: \.self) { side in
                    TooltipBubble(
                        side: side,
                        wrap: .singleLine,
                        roleDescription: TooltipStrings.roleDefault,
                        isVisible: true,
                        reduceMotion: false
                    ) {
                        TooltipText(text: side.webSide, wrap: .singleLine)
                    }
                }
            }
        }
    }

    #Preview("Bubble · rich content") {
        staged("the web `content: ReactNode` escape hatch — a custom body view") {
            TooltipBubble(
                side: .top,
                wrap: .multiline,
                roleDescription: TooltipStrings.roleDefault,
                isVisible: true,
                reduceMotion: false
            ) {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Label("Charging", systemImage: "bolt.fill")
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                    Text(verbatim: "48 A · 11.5 kW · adds ~34 mi/hr")
                        .font(Font.TS.caption)
                }
            }
        }
    }

    #Preview("Trigger · interactive (pinned)") {
        staged("hover on a pointer or tap on touch to reveal — shown pinned here") {
            HStack(spacing: TSSpacing.x4xl) {
                Tooltip(controller: pinned("Battery health", side: .top)) {
                    triggerChip("Health")
                }
                Tooltip(controller: pinned("State of charge", side: .bottom)) {
                    triggerChip("SoC")
                }
            }
            .padding(TSSpacing.x3xl)
        }
    }

    #Preview("Empty · no bubble") {
        staged("an empty body renders no floating box (P4 never-a-blank-box) — the row stays tight") {
            HStack(spacing: TSSpacing.xs) {
                Tooltip("") {
                    triggerChip("Range")
                }
            }
            .padding(TSSpacing.md)
        }
    }
#endif
