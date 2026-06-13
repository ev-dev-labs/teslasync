//
//  HelpIcon.Previews.swift
//  TeslaSync — P4 shared surface · 0215 · HelpIcon (Apple)
//
//  Xcode previews for every real branch of the field-level help primitive: the plain-`content` icon next to
//  a label, the `i18nKey`-with-fallback icon, the per-field `for` label (drives the VoiceOver "Help for …"),
//  each `side` placement, the seeded-open bubble (via an injected model), and the "absent" branch (no help
//  text → renders nothing, the web `return null`). DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    /// A faux form field label with the help icon trailing it — the canonical adoption site.
    @MainActor
    private func field(_ title: String, @ViewBuilder _ help: () -> some View) -> some View {
        HStack(spacing: 0) {
            Text(verbatim: title)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            help()
        }
    }

    #Preview("Plain content") {
        staged("content next to a label") {
            field("Battery health") {
                HelpIcon(content: "The estimated usable capacity relative to when the pack was new.")
            }
        }
    }

    #Preview("i18nKey with fallback") {
        staged("i18nKey · resolves to the content fallback in preview bundles") {
            field("Vampire drain") {
                HelpIcon(
                    i18nKey: "help.vampireDrain.body",
                    content: "Energy lost while parked, from background systems keeping the car awake."
                )
            }
        }
    }

    #Preview("Per-field label (for)") {
        staged("for: drives the VoiceOver \"Help for Drive score\" label") {
            field("Drive score") {
                HelpIcon(
                    content: "A 0–100 rating blending smoothness, efficiency, and speed compliance.",
                    for: "Drive score"
                )
            }
        }
    }

    #Preview("Placement — every side") {
        staged("side: top · bottom · leading · trailing") {
            HStack(spacing: TSSpacing.x2xl) {
                ForEach(HelpIconSide.allCases, id: \.self) { side in
                    VStack(spacing: TSSpacing.sm) {
                        HelpIcon(content: "Help shown on the \(side.rawValue) side.", side: side)
                        Text(verbatim: side.rawValue)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
    }

    #Preview("Revealed bubble") {
        @Previewable @State var model = HelpIconModel(
            input: HelpIconInput(
                content: "Tap reveals this help bubble; Escape or an outside tap dismisses it.",
                forID: "Regen"
            )
        )
        return staged("seeded open via an injected model") {
            field("Regenerative braking") {
                HelpIcon(model: model)
            }
            .task { model.present() }
        }
    }

    #Preview("Absent — renders nothing") {
        staged("no i18nKey + no content → web return null (no blank box)") {
            field("No help available") {
                HelpIcon()
            }
        }
    }
#endif
