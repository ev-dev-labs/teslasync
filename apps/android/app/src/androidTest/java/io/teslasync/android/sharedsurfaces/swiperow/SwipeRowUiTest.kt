package io.teslasync.android.sharedsurfaces.swiperow

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the SwipeRow surface across its real states: the closed
 * rest (no action revealed, the wrapped row still shown — never a blank box), the peeked-open right action
 * ("Delete" exposed as a Button-role node and tappable), the peeked-open left action ("Archive"), the fire path (a
 * tap on the peeked action invokes its callback), and the inactive passthrough (a fine pointer renders the
 * children straight through with no wrapper). Asserts each revealed action's localized accessible label + click
 * action and that the wrapped content always renders. The offline gate's `testReleaseUnitTest` covers the pure
 * gesture logic; this covers render + a11y. Mirrors the web spec (web/src/components/mobile/SwipeRow.tsx).
 */
class SwipeRowUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val archiveLabel = "Archive"
    private val deleteLabel = "Delete"
    private val contentText = "Morning commute"

    /** A no-op logger so the inactive passthrough test needs no LocalDataContainer provider. */
    private val silentLogger =
        object : Logger {
            override fun log(
                level: LogLevel,
                event: String,
                fields: Map<String, String>,
            ) = Unit
        }

    private fun setScaffold(
        offsetPx: Float,
        leftAction: SwipeAction? = null,
        rightAction: SwipeAction? = null,
        onFireLeft: () -> Unit = {},
        onFireRight: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SwipeRowScaffold(
                    offsetPx = offsetPx,
                    leftAction = leftAction,
                    rightAction = rightAction,
                    onFireLeft = onFireLeft,
                    onFireRight = onFireRight,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    BodyText(contentText)
                }
            }
        }
    }

    @Test
    fun closedHidesBothActionsButKeepsContent() {
        setScaffold(
            offsetPx = 0f,
            leftAction = SwipeAction(label = archiveLabel, onAction = {}),
            rightAction = SwipeAction(label = deleteLabel, onAction = {}, tone = SwipeTone.Danger),
        )
        compose.onNodeWithText(contentText).assertIsDisplayed()
        // At rest both underlays are removed from the a11y tree (web aria-hidden + tabIndex=-1).
        compose.onNodeWithContentDescription(archiveLabel).assertDoesNotExist()
        compose.onNodeWithContentDescription(deleteLabel).assertDoesNotExist()
    }

    @Test
    fun rightActionPeekExposesADeleteButton() {
        setScaffold(
            offsetPx = -ACTION_WIDTH_PX,
            rightAction = SwipeAction(label = deleteLabel, onAction = {}, tone = SwipeTone.Danger),
        )
        compose.onNodeWithContentDescription(deleteLabel).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(contentText).assertIsDisplayed()
    }

    @Test
    fun leftActionPeekExposesAnArchiveButton() {
        setScaffold(
            offsetPx = ACTION_WIDTH_PX,
            leftAction = SwipeAction(label = archiveLabel, onAction = {}),
        )
        compose.onNodeWithContentDescription(archiveLabel).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun tappingThePeekedActionFiresIt() {
        var fired = false
        setScaffold(
            offsetPx = -ACTION_WIDTH_PX,
            rightAction = SwipeAction(label = deleteLabel, onAction = {}, tone = SwipeTone.Danger),
            onFireRight = { fired = true },
        )
        compose.onNodeWithContentDescription(deleteLabel).performClick()
        assert(fired) { "expected the peeked right action's onFire callback to run on tap" }
    }

    @Test
    fun inactivePointerRendersChildrenStraightThrough() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SwipeRow(
                    rightAction = SwipeAction(label = deleteLabel, onAction = {}, tone = SwipeTone.Danger),
                    enabled = false,
                    logger = silentLogger,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    BodyText(contentText)
                }
            }
        }
        compose.onNodeWithText(contentText).assertIsDisplayed()
        // No wrapper is composed when inactive, so neither the swipe-row root nor the action surfaces.
        compose.onNodeWithTag(SWIPE_ROW_TEST_TAG).assertDoesNotExist()
        compose.onNodeWithContentDescription(deleteLabel).assertDoesNotExist()
    }
}
