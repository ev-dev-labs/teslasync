//
//  CarAnimation.swift
//  TeslaSync — P4 shared surface · 0190 · CarAnimation (Apple)
//
//  The public API of the brand motion marks — the SwiftUI parity of the four web exports in
//  `components/motion/CarAnimation.tsx`: ``CarAnimation`` (the animated Tesla silhouette), ``ChargingBolt``,
//  ``BatteryFillAnimation``, and ``WheelSpin``. Each mark derives its motion from the native peer of
//  `useMotionPreference()` and honors Reduce Motion (web `prefers-reduced-motion`): when reduced, the mark
//  renders its final resting frame with no entry draw / scale-in / pulse / spin. The reduce-motion preference
//  binds through the app's `\.accessibilityReduceMotion` environment (P1/S8, the native peer of
//  `useReducedMotion()`); each surface binds through a shared ``CarAnimationModel`` for the once-only
//  `view.opened` telemetry (P1/S11) and pushes preference changes into the holder via `.onChange` so a reused
//  mark re-renders faithfully. The labeled marks carry their `role="img"` accessibility label (web
//  `aria-label`); the battery gauge is decorative (web renders it with no `role`/`aria`). No networking, no
//  Tailwind ports.
//

import SwiftUI

// MARK: - Accessibility (web `role="img"` + `aria-label`, or decorative)

/// How a mark presents to VoiceOver — a localized image label (web `role="img"` + `aria-label`) or decorative
/// (web's battery gauge has no `role`/`aria`).
enum CarMarkAccessibility {
    case labeled(String)
    case decorative
}

/// Applies the mark's accessibility presentation: a single image element with the localized label, or hidden.
struct CarMarkA11y: ViewModifier {
    let kind: CarMarkAccessibility

    func body(content: Content) -> some View {
        switch kind {
        case let .labeled(label):
            content
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: label))
                .accessibilityAddTraits(.isImage)
        case .decorative:
            content.accessibilityHidden(true)
        }
    }
}

// MARK: - Lifecycle scaffold (P1/S8 preference bind + P1/S11 view.opened)

/// The shared lifecycle for every mark — it binds the live `\.accessibilityReduceMotion` environment into the
/// ``CarAnimationModel`` (when the surface owns the preference), emits the once-only `view.opened`, and
/// applies the mark's accessibility presentation. The `mark` builder receives the current reduce-motion flag
/// so each surface derives its own projection. Extracted so the four marks share one lifecycle (DRY).
struct CarAnimationScaffold<Mark: View>: View {
    let model: CarAnimationModel
    let bindsReduceMotion: Bool
    let accessibility: CarMarkAccessibility
    @ViewBuilder let mark: (Bool) -> Mark

    @Environment(\.accessibilityReduceMotion) private var environmentReduceMotion

    var body: some View {
        mark(model.reduceMotion)
            .modifier(CarMarkA11y(kind: accessibility))
            .onAppear {
                if bindsReduceMotion {
                    model.update(reduceMotion: environmentReduceMotion)
                }
                model.start()
            }
            .onDisappear { model.stop() }
            .onChange(of: environmentReduceMotion) { _, newValue in
                guard bindsReduceMotion else { return }
                model.update(reduceMotion: newValue)
            }
    }
}

// MARK: - CarAnimation (web `CarAnimation`)

/// The animated Tesla silhouette — the SwiftUI parity of `<CarAnimation size />`. Mount it as a hero / loading
/// illustration; it draws a Tesla that strokes in, settles its wheels, and idles with pulsing head/tail-lights
/// (or a static silhouette under Reduce Motion). Announced to VoiceOver as the localized "Tesla vehicle
/// illustration" image (web `role="img"`).
public struct CarAnimation: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        CarAnimationSurface.slug
    }

    private let input: CarAnimationInput
    private let bindsReduceMotion: Bool
    @State private var model: CarAnimationModel

    /// The prop-style initializer — the parity of `<CarAnimation size />` (web default `120`). Binds the live
    /// `\.accessibilityReduceMotion` environment (web `useReducedMotion()`).
    public init(size: CGFloat = 120, telemetry: any CarAnimationTelemetry = OSLogCarAnimationTelemetry()) {
        input = CarAnimationInput(size: size)
        bindsReduceMotion = true
        _model = State(initialValue: CarAnimationModel(telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam. The host owns the preference here, so the
    /// surface does NOT sync from the get-only `\.accessibilityReduceMotion` environment.
    public init(size: CGFloat = 120, model: CarAnimationModel) {
        input = CarAnimationInput(size: size)
        bindsReduceMotion = false
        _model = State(initialValue: model)
    }

    public var body: some View {
        CarAnimationScaffold(
            model: model,
            bindsReduceMotion: bindsReduceMotion,
            accessibility: .labeled(CarAnimationStrings.tesla)
        ) { reduce in
            TeslaSilhouetteMark(projection: CarAnimationProjector.resolveCar(input, reduceMotion: reduce))
        }
    }
}

// MARK: - ChargingBolt (web `ChargingBolt`)

/// The animated charging bolt — the SwiftUI parity of `<ChargingBolt size />` (web default `32`). It rises +
/// fades in then pulses its fill; announced to VoiceOver as the localized "Charging" image (web `role="img"`).
public struct ChargingBolt: View {
    private let input: ChargingBoltInput
    private let bindsReduceMotion: Bool
    @State private var model: CarAnimationModel

    public init(size: CGFloat = 32, telemetry: any CarAnimationTelemetry = OSLogCarAnimationTelemetry()) {
        input = ChargingBoltInput(size: size)
        bindsReduceMotion = true
        _model = State(initialValue: CarAnimationModel(telemetry: telemetry))
    }

    public init(size: CGFloat = 32, model: CarAnimationModel) {
        input = ChargingBoltInput(size: size)
        bindsReduceMotion = false
        _model = State(initialValue: model)
    }

    public var body: some View {
        CarAnimationScaffold(
            model: model,
            bindsReduceMotion: bindsReduceMotion,
            accessibility: .labeled(CarAnimationStrings.charging)
        ) { reduce in
            ChargingBoltMark(projection: CarAnimationProjector.resolveBolt(input, reduceMotion: reduce))
        }
    }
}

// MARK: - BatteryFillAnimation (web `BatteryFillAnimation`)

/// The animated battery fill gauge — the SwiftUI parity of `<BatteryFillAnimation level size />` (web defaults
/// `level 80`, `size 48`). The fill grows to the level in its semantic band color. Decorative: the web source
/// gives it no `role`/`aria`, so it is hidden from VoiceOver and any readout is owned by an adjacent host
/// label (as on the web).
public struct BatteryFillAnimation: View {
    private let input: BatteryFillInput
    private let bindsReduceMotion: Bool
    @State private var model: CarAnimationModel

    public init(
        level: Double = 80,
        size: CGFloat = 48,
        telemetry: any CarAnimationTelemetry = OSLogCarAnimationTelemetry()
    ) {
        input = BatteryFillInput(level: level, size: size)
        bindsReduceMotion = true
        _model = State(initialValue: CarAnimationModel(telemetry: telemetry))
    }

    public init(level: Double = 80, size: CGFloat = 48, model: CarAnimationModel) {
        input = BatteryFillInput(level: level, size: size)
        bindsReduceMotion = false
        _model = State(initialValue: model)
    }

    public var body: some View {
        CarAnimationScaffold(
            model: model,
            bindsReduceMotion: bindsReduceMotion,
            accessibility: .decorative
        ) { reduce in
            BatteryGaugeMark(projection: CarAnimationProjector.resolveBattery(input, reduceMotion: reduce))
        }
    }
}

// MARK: - WheelSpin (web `WheelSpin`)

/// The spinning wheel loader — the SwiftUI parity of `<WheelSpin size />` (web default `24`). The spokes
/// rotate forever (frozen under Reduce Motion); announced to VoiceOver as the localized "Loading" image (web
/// `role="img"`).
public struct WheelSpin: View {
    private let input: WheelSpinInput
    private let bindsReduceMotion: Bool
    @State private var model: CarAnimationModel

    public init(size: CGFloat = 24, telemetry: any CarAnimationTelemetry = OSLogCarAnimationTelemetry()) {
        input = WheelSpinInput(size: size)
        bindsReduceMotion = true
        _model = State(initialValue: CarAnimationModel(telemetry: telemetry))
    }

    public init(size: CGFloat = 24, model: CarAnimationModel) {
        input = WheelSpinInput(size: size)
        bindsReduceMotion = false
        _model = State(initialValue: model)
    }

    public var body: some View {
        CarAnimationScaffold(
            model: model,
            bindsReduceMotion: bindsReduceMotion,
            accessibility: .labeled(CarAnimationStrings.loading)
        ) { reduce in
            WheelLoaderMark(projection: CarAnimationProjector.resolveWheel(input, reduceMotion: reduce))
        }
    }
}
