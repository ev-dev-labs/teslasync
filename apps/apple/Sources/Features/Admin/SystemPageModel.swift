import Foundation
import Observation

/// The `@Observable` state holder the System page binds to (ADR-004 — no networking
/// in the view). The web `SystemPage` has no page-level data hook; it composes two
/// self-contained panels (`RateLimitStatusPanel`, `QueueStatusPanel`), so this model
/// simply owns each panel's model and hands it to its panel. Every loading / error /
/// empty / data state is still driven by the child models through their own source
/// seams — this page-level holder adds no business logic.
@MainActor
@Observable
public final class SystemPageModel {
    /// Rate-limit budgets panel model (web `<RateLimitStatusPanel />`).
    public let rateLimit: RateLimitModel

    /// Background-workers queue panel model (web `<QueueStatusPanel />`).
    public let queue: QueueStatusModel

    /// Builds the page model. The two sources default to the sample-seeded in-memory
    /// sources so both panels render their populated state out of the box (mirroring
    /// the sibling `SampleDiskForecastDataSource` default); production / tests inject
    /// the live KMP-backed or fixture sources.
    public init(
        rateLimitSource: (any RateLimitSource)? = nil,
        queueSource: (any QueueStatusSource)? = nil
    ) {
        rateLimit = RateLimitModel(source: rateLimitSource ?? SystemPageSampleSources.rateLimit())
        queue = QueueStatusModel(source: queueSource ?? SystemPageSampleSources.queue())
    }
}
