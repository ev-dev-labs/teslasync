import SwiftUI

/// The success-phase story (web deck): the animated current slide, the always-present tap-zone
/// paging, the swipe gesture, the desktop keyboard paging, and the chrome overlays. Pure view over
/// the page model — paging mutates `slideIndex` on the `@Observable` model, never local state.
struct YearReviewStory: View {
    let model: YearReviewPageModel
    let units: UnitPreferences
    let isCompact: Bool
    let onExit: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        slideLayer
            .overlay(YearReviewTapZones(onPrev: goPrev, onNext: goNext))
            .overlay(alignment: .top) { YearReviewProgressBar(slides: model.slides, currentIndex: model.slideIndex) }
            .overlay(alignment: .top) { pickerOverlay }
            .overlay(alignment: .topTrailing) { YearReviewCloseButton(onExit: onExit) }
            .overlay(alignment: .leading) { leadingArrow }
            .overlay(alignment: .trailing) { trailingArrow }
            .overlay(alignment: .bottom) { YearReviewCounter(index: model.slideIndex, count: model.slideCount) }
            .contentShape(Rectangle())
            .gesture(swipe)
            .modifier(YearReviewKeyboardPaging(onPrev: goPrev, onNext: goNext, onExit: onExit))
            .accessibilityElement(children: .contain)
    }

    // MARK: - Slide layer (web `SlideRenderer` with the framer-motion slide transition)

    private var slideLayer: some View {
        ZStack {
            if let review = model.review {
                YearReviewSlideView(slide: model.currentSlide, review: review, units: units)
                    .id(model.slideIndex)
                    .transition(slideTransition)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(pageAnimation, value: model.slideIndex)
        .clipped()
    }

    private var slideTransition: AnyTransition {
        if reduceMotion { return .opacity }
        return .asymmetric(
            insertion: .move(edge: .trailing).combined(with: .opacity),
            removal: .move(edge: .leading).combined(with: .opacity)
        )
    }

    // MARK: - Chrome fragments

    @ViewBuilder private var pickerOverlay: some View {
        if model.showsVehiclePicker {
            YearReviewVehiclePicker(vehicles: model.vehicles, selection: vehicleBinding)
        }
    }

    @ViewBuilder private var leadingArrow: some View {
        if !isCompact, model.slideIndex > 0 {
            YearReviewArrowButton(systemName: "chevron.left", label: "yearReview.prev", action: goPrev)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder private var trailingArrow: some View {
        if !isCompact, model.slideIndex < model.slideCount - 1 {
            YearReviewArrowButton(systemName: "chevron.right", label: "yearReview.next", action: goNext)
                .accessibilityHidden(true)
        }
    }

    // MARK: - Paging

    private var vehicleBinding: Binding<Int64> {
        Binding(
            get: { model.selectedVehicleID ?? 0 },
            set: { id in Task { await model.selectVehicle(id) } }
        )
    }

    private var pageAnimation: Animation? {
        reduceMotion ? nil : .easeInOut(duration: 0.35)
    }

    private func goPrev() {
        withAnimation(pageAnimation) { model.goPrev() }
    }

    private func goNext() {
        withAnimation(pageAnimation) { model.goNext() }
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 24).onEnded { value in
            if value.translation.width < -40 {
                goNext()
            } else if value.translation.width > 40 {
                goPrev()
            }
        }
    }
}

/// Desktop keyboard paging (web `keydown`: ←/→/Space/Escape). Hardware-keyboard idioms apply on
/// macOS; on iOS the tap zones + swipe carry paging, so this is a no-op passthrough there.
struct YearReviewKeyboardPaging: ViewModifier {
    let onPrev: () -> Void
    let onNext: () -> Void
    let onExit: () -> Void

    func body(content: Content) -> some View {
        #if os(macOS)
            content
                .focusable()
                .focusEffectDisabled()
                .onKeyPress(.leftArrow) {
                    onPrev()
                    return .handled
                }
                .onKeyPress(.rightArrow) {
                    onNext()
                    return .handled
                }
                .onKeyPress(.space) {
                    onNext()
                    return .handled
                }
                .onKeyPress(.escape) {
                    onExit()
                    return .handled
                }
        #else
            content
        #endif
    }
}
