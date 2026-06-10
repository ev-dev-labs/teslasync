@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.feedback

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Visual gallery of the feedback layer, used by the @Preview entry points below to prove every
 * primitive renders across the light, dark, and high-contrast themes. Sections exercise the
 * nominal, loading, empty, error, offline, stale, auth, retry, and toast/banner state families
 * required by the prompt. Dialog/overlay primitives have dedicated previews at the bottom.
 */
@Composable
private fun FeedbackGallery() {
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            BannersSection()
            CalloutsSection()
            StatesSection()
            SkeletonSection()
            PromptsSection()
            ToastSection()
            ProgressSection()
            NavSection()
        }
    }
}

@Composable
private fun Section(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionTitle(title)
        content()
    }
}

@Composable
private fun BannersSection() {
    Section("Banners") {
        AlertBanner("Information you should know.", tone = Tone.Info, title = "Heads up", onClose = {})
        AlertBanner("Saved successfully.", tone = Tone.Success, title = "Done")
        AlertBanner(
            "Battery is low.",
            tone = Tone.Warning,
            title = "Warning",
            action = BannerAction("Charge", {}),
        )
        AlertBanner("Could not sync.", tone = Tone.Danger, title = "Error", action = BannerAction("Retry", {}), onClose = {})
        OfflineBanner(onRetry = {})
        LiveStaleDataBanner(staleForLabel = "3 minutes", onReconnect = {})
        TeslaReauthBanner(onReconnect = {})
        RateLimitBanner(remaining = 12, onRetry = {}, onDismiss = {})
        RateLimitBanner(remaining = 0, upstreamDown = true, onRetry = {}, onDismiss = {})
        MaintenanceBanner()
        ImpersonationBanner(userLabel = "ada@example.com", onExit = {})
        BrowserCompatBanner(onDismiss = {})
        NewVersionBanner(current = "1.2.0", latest = "1.3.0", onUpdate = {}, onDismiss = {})
        EditConflictBanner(onReload = {}, onOverwrite = {})
        TimeMachineBanner(snapshotLabel = "Apr 24, 14:00", onExit = {})
        DraftRecoveryBanner(onRestore = {}, onDiscard = {}, savedAtLabel = "2 minutes ago")
        CookieConsentBanner(onAccept = {}, onDecline = {})
    }
}

@Composable
private fun CalloutsSection() {
    Section("Inline callouts") {
        InlineCallout(
            "1 anomaly detected in this range.",
            tone = Tone.Warning,
            icon = TeslaGlyphs.Warning,
            actionLabel = "View",
            onClick = {},
        )
        InlineCallout("All systems nominal.", tone = Tone.Success, icon = TeslaGlyphs.Check)
        InlineCallout("Read the docs for more.", tone = Tone.Info, icon = TeslaGlyphs.Info)
    }
}

@Composable
private fun StatesSection() {
    Section("Loading / empty / error") {
        Spinner(label = "Loading telemetry…")
        EmptyState(message = "No drives recorded yet.", icon = TeslaGlyphs.Info, title = "Nothing here")
        EmptyState(message = "Adjust your filters to see results.", action = EmptyStateAction("Reset filters", {}))
        EmptyStateThreshold(currentCount = 12, threshold = 30, sectionLabel = "Cost heatmap", itemNoun = "sessions")
        ErrorDisplay(message = "An unexpected error occurred.", onRetry = {})
        QueryError(kind = QueryErrorKind.NotFound, resourceName = "Drive", onBackToList = {})
        QueryError(kind = QueryErrorKind.Unauthorized, onRetry = {})
        QueryError(kind = QueryErrorKind.ServerError, onRetry = {})
        QueryError(kind = QueryErrorKind.Offline, onRetry = {})
        QueryError(kind = QueryErrorKind.Network, onRetry = {})
        QueryError(kind = QueryErrorKind.Waiting)
    }
}

@Composable
private fun SkeletonSection() {
    Section("Skeletons") {
        SkeletonLines(lines = 3)
        StatGridSkeleton(count = 3)
        ChartSkeleton()
        TableSkeleton(rows = 3, columns = 3)
    }
}

@Composable
private fun PromptsSection() {
    Section("Prompts") {
        DraftRestorePrompt(onRestore = {}, onDiscard = {}, savedAtLabel = "5 minutes ago")
        ReloadPrompt(onReload = {}, onDismiss = {})
        InstallPrompt(onInstall = {}, onDismiss = {})
    }
}

@Composable
private fun ToastSection() {
    Section("Toasts") {
        ToastHost(
            toasts =
                listOf(
                    ToastItem(1, "Settings saved.", Tone.Success),
                    ToastItem(2, "Export ready.", Tone.Info, actionLabel = "Download"),
                    ToastItem(3, "Could not delete rule.", Tone.Danger),
                ),
            onDismiss = {},
            onAction = {},
        )
    }
}

@Composable
private fun ProgressSection() {
    Section("Progress + jobs") {
        TopProgress()
        TopProgress(progress = 0.4f)
        var visibility by remember { mutableStateOf(DrawerVisibility.Open) }
        JobProgressDrawer(
            jobs = sampleJobs,
            visibility = visibility,
            onVisibilityChange = { visibility = it },
        )
    }
}

@Composable
private fun NavSection() {
    Section("Navigation + auth") {
        SkipToContent(onSkip = {})
        GotoIndicator(buffer = "g")
        RequiresAuth(authorized = false) { }
    }
}

private val sampleJobs =
    listOf(
        JobSummary("1", "Drives export", JobStatus.Processing, format = "CSV"),
        JobSummary("2", "Account backup", JobStatus.Ready, format = "ZIP", sizeBytes = 2_400_000L),
        JobSummary("3", "Charging export", JobStatus.Failed, errorMessage = "Upstream timed out"),
    )

private val sampleSteps =
    listOf(
        OnboardingStep("Welcome", "TeslaSync keeps your fleet in sync.", icon = FeedbackGlyphs.Rocket),
        OnboardingStep("Live data", "Watch telemetry stream in real time."),
        OnboardingStep("All set", "You're ready to go."),
    )

@Preview(name = "Feedback \u00b7 Light", showBackground = true, heightDp = 3600)
@Composable
private fun FeedbackGalleryLightPreview() {
    TeslaSyncTheme(darkTheme = false) { FeedbackGallery() }
}

@Preview(name = "Feedback \u00b7 Dark", showBackground = true, heightDp = 3600)
@Composable
private fun FeedbackGalleryDarkPreview() {
    TeslaSyncTheme(darkTheme = true) { FeedbackGallery() }
}

@Preview(name = "Feedback \u00b7 High contrast", showBackground = true, heightDp = 3600)
@Composable
private fun FeedbackGalleryHighContrastPreview() {
    TeslaSyncTheme(highContrast = true) { FeedbackGallery() }
}

@Preview(name = "Feedback \u00b7 Session expiring", showBackground = true)
@Composable
private fun SessionExpiringPreview() {
    TeslaSyncTheme(darkTheme = true) {
        SessionExpiringModal(
            remainingSeconds = 45,
            onStay = {},
            onSignOut = {},
            drafts = listOf(DraftSummary("alertstudio:rule:42", 1L), DraftSummary("settings:profile", 2L)),
        )
    }
}

@Preview(name = "Feedback \u00b7 Onboarding", showBackground = true)
@Composable
private fun OnboardingPreview() {
    TeslaSyncTheme(darkTheme = true) {
        OnboardingWizard(steps = sampleSteps, currentIndex = 0, onIndexChange = {}, onFinish = {}, onSkip = {})
    }
}

@Preview(name = "Feedback \u00b7 Tour", showBackground = true, heightDp = 480)
@Composable
private fun TourPreview() {
    TeslaSyncTheme(darkTheme = true) {
        TourOverlay(steps = sampleSteps, currentIndex = 1, onIndexChange = {}, onFinish = {})
    }
}
