package io.teslasync.android.sharedsurfaces.cookieconsentbanner

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the CookieConsentBanner shared surface across every state
 * the web component renders (web/src/components/feedback/CookieConsentBanner.tsx) plus the native-only loading /
 * error / resolved / stale / offline surfaces the platform contract adds: the active prompt with its two actions
 * and the two-category disclosure, the recorded-state panel, the skeleton chrome, and the failure/freshness
 * affordances. It asserts the rendered i18n labels, the merged TalkBack descriptions, and that the interactive
 * controls are labelled + clickable and fire their callbacks. Reduced motion keeps the FadeIn from holding the
 * test clock busy. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection.
 */
class CookieConsentBannerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun s(id: Int) = context.getString(id)

    private fun strings(): CookieConsentStrings =
        CookieConsentStrings(
            title = s(R.string.translation_consent_banner_title),
            body = s(R.string.translation_consent_banner_body),
            manage = s(R.string.translation_consent_banner_manage),
            hideDetails = s(R.string.translation_consent_banner_hideDetails),
            accept = s(R.string.translation_consent_banner_accept),
            decline = s(R.string.translation_consent_banner_decline),
            essentialTitle = s(R.string.translation_consent_category_essential_title),
            essentialBody = s(R.string.translation_consent_category_essential_body),
            alwaysOn = s(R.string.translation_consent_category_alwaysOn),
            analyticsTitle = s(R.string.translation_consent_category_analytics_title),
            analyticsBody = s(R.string.translation_consent_category_analytics_body),
            resolvedAccepted = s(R.string.translation_consent_state_accepted),
            resolvedDeclined = s(R.string.translation_consent_state_declined),
            resolvedNotRequired = s(R.string.translation_consent_section_bodyOff),
            loading = s(R.string.translation_a11y_loading),
            stale = s(R.string.translation_mqtt_stale),
            offline = s(R.string.translation_error_network_offlineTitle),
            retry = s(R.string.translation_common_retry),
            errorTitle = s(R.string.translation_error_network_title),
            errorBody = s(R.string.translation_error_loadFailed),
        )

    private fun renderBase(phase: CookieConsentPhase): CookieConsentRender =
        CookieConsentRender(
            phase = phase,
            consent = ConsentDecision.Unknown,
            requireConsent = true,
            showDetails = false,
            stale = false,
            offline = false,
            errorKind = null,
        )

    private fun setSurface(
        render: CookieConsentRender,
        onAccept: () -> Unit = {},
        onDecline: () -> Unit = {},
        onToggleDetails: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    CookieConsentBannerContent(
                        render = render,
                        strings = strings(),
                        onAccept = onAccept,
                        onDecline = onDecline,
                        onToggleDetails = onToggleDetails,
                        onRetry = onRetry,
                    )
                }
            }
        }
    }

    @Test
    fun promptShowsTitleBodyAndBothActions() {
        setSurface(renderBase(CookieConsentPhase.Prompt))

        compose.onNodeWithTag(COOKIE_CONSENT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_consent_banner_title), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(COOKIE_CONSENT_ACCEPT_TAG).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithTag(COOKIE_CONSENT_DECLINE_TAG).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithTag(COOKIE_CONSENT_TOGGLE_TAG).assertIsDisplayed().assertHasClickAction()
        // The disclosure starts collapsed (web `showDetails === false`).
        compose.onNodeWithTag(COOKIE_CONSENT_DETAILS_TAG).assertDoesNotExist()
    }

    @Test
    fun acceptAndDeclineFireTheirCallbacks() {
        var accepted = false
        var declined = false
        setSurface(renderBase(CookieConsentPhase.Prompt), onAccept = { accepted = true }, onDecline = { declined = true })

        compose.onNodeWithTag(COOKIE_CONSENT_ACCEPT_TAG).performClick()
        compose.onNodeWithTag(COOKIE_CONSENT_DECLINE_TAG).performClick()

        assertTrue("Accept all forwards to onAccept (web handleAccept)", accepted)
        assertTrue("Decline non-essential forwards to onDecline (web handleDecline)", declined)
    }

    @Test
    fun toggleFiresTheDisclosureCallbackAndShowsTheManageLabel() {
        var toggled = false
        setSurface(renderBase(CookieConsentPhase.Prompt), onToggleDetails = { toggled = true })

        compose.onNodeWithText(s(R.string.translation_consent_banner_manage), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(COOKIE_CONSENT_TOGGLE_TAG).performClick()

        assertTrue("Manage preferences toggles the disclosure (web setShowDetails)", toggled)
    }

    @Test
    fun expandedPromptShowsTheTwoCategoryDisclosure() {
        setSurface(renderBase(CookieConsentPhase.Prompt).copy(showDetails = true))

        compose.onNodeWithTag(COOKIE_CONSENT_DETAILS_TAG).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_consent_category_essential_title), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_consent_category_alwaysOn), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_consent_category_analytics_title), useUnmergedTree = true).assertIsDisplayed()
        // The toggle now offers to collapse (web "Hide details").
        compose.onNodeWithText(s(R.string.translation_consent_banner_hideDetails), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun resolvedShowsTheRecordedDecisionCopy() {
        setSurface(renderBase(CookieConsentPhase.Resolved).copy(consent = ConsentDecision.Declined))

        compose.onNodeWithTag(COOKIE_CONSENT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_consent_state_declined), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(COOKIE_CONSENT_ACCEPT_TAG).assertDoesNotExist()
    }

    @Test
    fun loadingShowsTheLoadingDescription() {
        setSurface(renderBase(CookieConsentPhase.Loading).copy(requireConsent = false))

        compose.onNodeWithContentDescription(s(R.string.translation_a11y_loading)).assertIsDisplayed()
        compose.onNodeWithTag(COOKIE_CONSENT_ACCEPT_TAG).assertDoesNotExist()
    }

    @Test
    fun errorShowsTheFailureCopyAndAClickableRetry() {
        var retried = false
        setSurface(renderBase(CookieConsentPhase.Error).copy(requireConsent = false), onRetry = { retried = true })

        compose.onNodeWithText(s(R.string.translation_error_network_title), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_error_loadFailed), useUnmergedTree = true).assertIsDisplayed()
        compose
            .onNodeWithTag(COOKIE_CONSENT_RETRY_TAG)
            .assertIsDisplayed()
            .assertHasClickAction()
            .performClick()

        assertTrue("the error surface retry re-collects the gate (web refetch)", retried)
    }

    @Test
    fun staleShowsTheStaleChipOverTheLastKnownPrompt() {
        setSurface(renderBase(CookieConsentPhase.Prompt).copy(stale = true))

        compose.onNodeWithText(s(R.string.translation_mqtt_stale), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(COOKIE_CONSENT_ACCEPT_TAG).assertIsDisplayed()
    }

    @Test
    fun offlineShowsTheOfflineChipAndRetry() {
        setSurface(renderBase(CookieConsentPhase.Prompt).copy(offline = true, errorKind = ErrorKind.Network))

        compose.onNodeWithText(s(R.string.translation_error_network_offlineTitle), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(COOKIE_CONSENT_RETRY_TAG).assertIsDisplayed().assertHasClickAction()
    }
}
