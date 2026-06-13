//
//  Spinner.Previews.swift
//  TeslaSync — P4 shared surface · 0140 · Spinner (Apple)
//
//  Xcode previews for every real branch of the brand loading mark: the three sizes (`sm` / `md` / `lg`), the
//  captioned variant (web `label`), the bare variant (announced as `"Loading"`), and the reduced-motion
//  variant (a static, fully-filled bolt with no draw cycle). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
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
        .padding(TSSpacing.x2xl)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Sizes — sm / md / lg") {
        staged("three sizes · animated strike draw") {
            HStack(spacing: TSSpacing.x3xl) {
                Spinner(size: .sm)
                Spinner(size: .md)
                Spinner(size: .lg)
            }
        }
    }

    #Preview("Captioned") {
        staged("label rendered under the bolt + spoken as the status") {
            Spinner(size: .lg, label: "Loading drives…")
        }
    }

    #Preview("Bare — falls back to Loading") {
        staged("no label · announced as the localized \"Loading\"") {
            Spinner(size: .md)
        }
    }

    #Preview("Reduced motion — static fill") {
        staged("reduce motion on · solid bolt · no draw cycle") {
            HStack(spacing: TSSpacing.x3xl) {
                Spinner(model: SpinnerModel(input: SpinnerInput(size: .sm), reduceMotion: true))
                Spinner(model: SpinnerModel(input: SpinnerInput(size: .md), reduceMotion: true))
                Spinner(model: SpinnerModel(
                    input: SpinnerInput(size: .lg, label: "Loading drives…"),
                    reduceMotion: true
                ))
            }
        }
    }
#endif
