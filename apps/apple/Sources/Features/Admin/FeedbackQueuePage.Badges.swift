import SwiftUI

/// The category badge (web `CategoryBadge`): a tinted pill mapping the feedback
/// category to the shared status tone + the localized `feedback.category.*` label.
/// Built on the shared `TSBadge` so it matches every other badge in the app.
struct FeedbackCategoryBadge: View {
    let category: FeedbackCategory

    var body: some View {
        TSBadge(LocalizedStringKey(category.labelKey), tone: Self.tone(category))
            .accessibilityLabel(Text(LocalizedStringKey(category.labelKey)))
    }

    /// Web variant map (`bug → danger`, `feature → info`, `other → neutral`).
    static func tone(_ category: FeedbackCategory) -> TSTone {
        switch category {
        case .bug: .danger
        case .feature: .info
        case .other: .neutral
        }
    }
}

/// The status badge (web `StatusBadge`): a tinted pill mapping the triage status to
/// the shared status tone + the localized `feedback.queue.status.*` label.
struct FeedbackStatusBadge: View {
    let status: FeedbackStatus

    var body: some View {
        TSBadge(LocalizedStringKey(status.labelKey), tone: Self.tone(status))
            .accessibilityLabel(Text(LocalizedStringKey(status.labelKey)))
    }

    /// Web variant map (`new → warning`, `triaged → success`, `closed → neutral`).
    static func tone(_ status: FeedbackStatus) -> TSTone {
        switch status {
        case .new: .warning
        case .triaged: .success
        case .closed: .neutral
        }
    }
}
