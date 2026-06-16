import Foundation
import Observation

// MARK: - Data source seam (web hooks: useVehicles / useYearReview)

/// Supplies the two sources the story binds to. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states. Mirrors the `StatisticsDataSource`
/// seam used by the sibling analytics pages.
///
/// Method ↔ web hook map (names kept at the Swift call sites per the parity manifest):
/// `loadVehicles` ← `useVehicles`/`GET /vehicles`; `loadYearReview` ← `useYearReview`/
/// `GET /analytics/year-review [year, vehicle_id]` (web `enabled: !!vehicleId`).
public protocol YearReviewDataSource: Sendable {
    func loadVehicles() async throws -> [YearReviewStoryVehicle]
    func loadYearReview(year: Int, vehicleID: Int64) async throws -> YearReview?
}

// MARK: - Page phase (web `isLoading || !data ? loading : noData ? empty : story`, + error)

/// The story's terminal phase. `.loading` is the web spinner screen (`isLoading || !data`);
/// `.empty` is a successful load with no driving data (web `total_drives === 0 && …` → the 🚗
/// no-data screen, also used when there is no vehicle to query); `.error` is a retryable failure
/// (never a blank region); `.ready` carries the slide deck.
public enum YearReviewPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the story binds to (ADR-004 — no networking in the view). Owns the
/// vehicle list + selection (web `vehicle_id` query param), the review (driving the page phase), and
/// the current slide index with its bounded paging (web `slideIndex` + `goNext`/`goPrev`). Reads
/// everything through the injected `YearReviewDataSource`.
@MainActor
@Observable
public final class YearReviewPageModel {
    public private(set) var phase: YearReviewPhase = .loading

    /// Whether a background refetch is in flight while content is already shown (web refetch).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [YearReviewStoryVehicle] = []
    public private(set) var selectedVehicleID: Int64?
    public private(set) var review: YearReview?

    /// The active slide (web `slideIndex`); always clamped to `0 ..< slideCount`.
    public private(set) var slideIndex = 0

    /// The reviewed calendar year (web `:year` route param, default current year).
    public let year: Int

    /// The full ordered deck (web `SLIDE_DEFS`).
    public let slides = YearReviewSlideKind.allCases

    @ObservationIgnored private let dataSource: any YearReviewDataSource

    public init(
        year: Int = YearReviewPageModel.currentYear,
        dataSource: any YearReviewDataSource = SampleYearReviewDataSource()
    ) {
        self.year = year
        self.dataSource = dataSource
    }

    /// The current calendar year (web `new Date().getFullYear()`).
    public static var currentYear: Int {
        Calendar(identifier: .gregorian).component(.year, from: Date())
    }

    // MARK: Derived

    public var slideCount: Int {
        slides.count
    }

    /// The slide kind for the current index (web `slides[slideIndex]`).
    public var currentSlide: YearReviewSlideKind {
        slides[min(max(slideIndex, 0), slideCount - 1)]
    }

    /// Web vehicle `Select` shown only when there is more than one vehicle (`vehicleList.length > 1`).
    public var showsVehiclePicker: Bool {
        vehicles.count > 1
    }

    public var selectedVehicle: YearReviewStoryVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list, auto-selects the first (web effect), then the review (web query).
    public func load() async {
        phase = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    public func refresh() async {
        isRefreshing = true
        await fetchAll()
        isRefreshing = false
    }

    private func fetchAll() async {
        vehicles = await (try? dataSource.loadVehicles()) ?? []
        if selectedVehicleID == nil || !vehicles.contains(where: { $0.id == selectedVehicleID }) {
            selectedVehicleID = vehicles.first?.id
        }
        await loadReview()
    }

    /// Selects a vehicle (web `setSearchParams({ vehicle_id })`) and restarts the deck at slide 0.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        slideIndex = 0
        phase = .loading
        await loadReview()
    }

    private func loadReview() async {
        guard let id = selectedVehicleID else {
            review = nil
            phase = .empty
            return
        }
        do {
            let data = try await dataSource.loadYearReview(year: year, vehicleID: id)
            review = data
            phase = (data?.hasNoData ?? true) ? .empty : .ready
        } catch {
            review = nil
            phase = .error(error.localizedDescription)
        }
    }

    // MARK: Paging (web goNext / goPrev with clamping)

    public func goNext() {
        slideIndex = min(slideIndex + 1, slideCount - 1)
    }

    public func goPrev() {
        slideIndex = max(slideIndex - 1, 0)
    }
}
