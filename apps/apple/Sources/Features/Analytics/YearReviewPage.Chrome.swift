import SwiftUI

// The story chrome overlays (web progress bar, vehicle selector, close button, desktop nav arrows,
// tap zones, and slide counter). Each is a small, self-contained control so the story view stays
// composable and every body stays well under the lint thresholds. All copy resolves from the
// catalog with the web key names; the controls are pure (state lives in the page model).

/// Segmented progress indicator across the deck (web top progress bar). Past + current slides read
/// filled, upcoming slides dim — a static, accessibility-hidden position cue.
struct YearReviewProgressBar: View {
    let slides: [YearReviewSlideKind]
    let currentIndex: Int

    var body: some View {
        HStack(spacing: 3) {
            ForEach(slides) { slide in
                Capsule()
                    .fill(.white.opacity(slide.rawValue <= currentIndex ? 0.9 : 0.25))
                    .frame(height: 3)
            }
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.top, TSSpacing.md)
        .accessibilityHidden(true)
    }
}

/// The vehicle selector shown only when more than one vehicle exists (web `vehicleList.length > 1`).
/// Changing it restarts the deck (handled in the model's `selectVehicle`).
struct YearReviewVehiclePicker: View {
    let vehicles: [YearReviewStoryVehicle]
    @Binding var selection: Int64

    var body: some View {
        Picker(selection: $selection) {
            ForEach(vehicles) { vehicle in
                Text(verbatim: vehicle.name).tag(vehicle.id)
            }
        } label: {
            EmptyView()
        }
        .pickerStyle(.menu)
        .tint(.white)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(.white.opacity(0.12), in: Capsule())
        .padding(.top, TSSpacing.x2xl)
        .accessibilityLabel(Text("yearReview.selectVehicle"))
    }
}

/// Round close affordance (web `X` button → `navigate(-1)`).
struct YearReviewCloseButton: View {
    let onExit: () -> Void

    var body: some View {
        Button(action: onExit) {
            Image(systemName: "xmark")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
                .padding(TSSpacing.sm)
                .background(.white.opacity(0.12), in: Circle())
        }
        .buttonStyle(.plain)
        .padding(TSSpacing.md)
        .accessibilityLabel(Text("yearReview.close"))
    }
}

/// A single circular desktop nav arrow (web md-only hover arrows). `label` carries the localized
/// prev/next name for VoiceOver.
struct YearReviewArrowButton: View {
    let systemName: String
    let label: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white.opacity(0.7))
                .padding(TSSpacing.sm)
                .background(.white.opacity(0.12), in: Circle())
        }
        .buttonStyle(.plain)
        .padding(TSSpacing.md)
        .accessibilityLabel(Text(label))
    }
}

/// Slide position counter (web `{slideIndex + 1} / {slides.length}`).
struct YearReviewCounter: View {
    let index: Int
    let count: Int

    var body: some View {
        Text(verbatim: "\(index + 1) / \(count)")
            .font(Font.TS.caption)
            .monospacedDigit()
            .foregroundStyle(.white.opacity(0.6))
            .padding(.bottom, TSSpacing.lg)
            .accessibilityHidden(true)
    }
}

/// The left/right tap zones (web third-width tap targets). These are the primary, always-present
/// accessible paging controls (the desktop arrows are decorative duplicates and stay hidden from
/// VoiceOver); the inert middle third matches the web layout.
struct YearReviewTapZones: View {
    let onPrev: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            zone("yearReview.prev", action: onPrev)
            Color.clear
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .allowsHitTesting(false)
            zone("yearReview.next", action: onNext)
        }
    }

    private func zone(_ label: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Color.clear.contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel(Text(label))
    }
}
