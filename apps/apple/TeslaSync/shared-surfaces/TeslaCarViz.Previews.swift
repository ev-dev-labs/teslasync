//
//  TeslaCarViz.Previews.swift
//  TeslaSync — P4 shared surface · 0106 · TeslaCarViz (Apple)
//
//  Xcode previews for every real branch of the live vehicle illustration: parked / driving, charging,
//  Sentry + climate, the five model bodies, the three sizes, the light theme, and the compact mini glyph.
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
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
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Parked — idle") {
        staged("model 3 · 72% · parked") {
            TeslaCarViz(batteryLevel: 72)
        }
    }

    #Preview("Driving") {
        staged("model Y · 54% · speed 65") {
            TeslaCarViz(batteryLevel: 54, speed: 65, size: .lg, model: .modelY)
        }
    }

    #Preview("Charging + locked") {
        staged("model S · 38% · charging + locked") {
            TeslaCarViz(batteryLevel: 38, isCharging: true, isLocked: true, model: .modelS)
        }
    }

    #Preview("Sentry + climate") {
        staged("model 3 · 20% · sentry + climate") {
            TeslaCarViz(batteryLevel: 20, isClimateOn: true, sentryMode: true)
        }
    }

    #Preview("Cybertruck — low battery") {
        staged("cybertruck · 12% · driving") {
            TeslaCarViz(batteryLevel: 12, speed: 30, size: .lg, model: .cybertruck)
        }
    }

    #Preview("Sizes") {
        staged("sm · md · lg") {
            HStack(alignment: .bottom, spacing: TSSpacing.lg) {
                TeslaCarViz(batteryLevel: 60, size: .sm)
                TeslaCarViz(batteryLevel: 60, size: .md)
                TeslaCarViz(batteryLevel: 60, size: .lg)
            }
        }
    }

    #Preview("All models") {
        staged("every silhouette · 66%") {
            VStack(spacing: TSSpacing.md) {
                ForEach(TeslaCarModel.allCases, id: \.self) { model in
                    TeslaCarViz(batteryLevel: 66, isLocked: true, size: .sm, model: model)
                }
            }
        }
    }

    #Preview("Mini row") {
        staged("compact card silhouettes") {
            HStack(spacing: TSSpacing.lg) {
                ForEach(TeslaCarModel.allCases, id: \.self) { model in
                    TeslaCarMini(batteryLevel: 48, isCharging: model == .model3, model: model)
                }
            }
        }
    }

    #Preview("Light theme") {
        staged("model X · 88% · charging") {
            TeslaCarViz(batteryLevel: 88, isCharging: true, isLocked: true, model: .modelX)
        }
        .environment(\.colorScheme, .light)
    }
#endif
