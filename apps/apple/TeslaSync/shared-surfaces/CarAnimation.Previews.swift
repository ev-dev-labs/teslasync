//
//  CarAnimation.Previews.swift
//  TeslaSync — P4 shared surface · 0190 · CarAnimation (Apple)
//
//  Xcode previews for every real branch of the four marks: the animated forms (the Tesla silhouette, the
//  charging bolt, the battery gauge at each band, the wheel loader) and the reduced-motion variants (the
//  final resting frames with no entry / pulse / spin). DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
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
        .frame(maxWidth: 480, alignment: .leading)
        .background(Color.TS.bg)
    }

    @MainActor
    private func reduced() -> CarAnimationModel {
        CarAnimationModel(reduceMotion: true)
    }

    #Preview("Tesla silhouette — animated") {
        staged("CarAnimation · staggered entry + pulsing lights") {
            CarAnimation(size: 200)
        }
    }

    #Preview("Tesla silhouette — reduced motion") {
        staged("CarAnimation · static resting frame (Reduce Motion)") {
            CarAnimation(size: 200, model: reduced())
        }
    }

    #Preview("Charging bolt") {
        staged("ChargingBolt · rise-in + fill pulse vs. static") {
            HStack(spacing: TSSpacing.x3xl) {
                ChargingBolt(size: 64)
                ChargingBolt(size: 64, model: reduced())
            }
        }
    }

    #Preview("Battery gauge — bands") {
        staged("BatteryFillAnimation · good / warning / danger") {
            HStack(spacing: TSSpacing.x2xl) {
                BatteryFillAnimation(level: 82, size: 96)
                BatteryFillAnimation(level: 44, size: 96)
                BatteryFillAnimation(level: 12, size: 96)
            }
        }
    }

    #Preview("Battery gauge — reduced motion") {
        staged("BatteryFillAnimation · resting fill (Reduce Motion)") {
            BatteryFillAnimation(level: 80, size: 120, model: reduced())
        }
    }

    #Preview("Wheel loader") {
        staged("WheelSpin · spinning vs. static (Reduce Motion)") {
            HStack(spacing: TSSpacing.x3xl) {
                WheelSpin(size: 48)
                WheelSpin(size: 48, model: reduced())
            }
        }
    }
#endif
