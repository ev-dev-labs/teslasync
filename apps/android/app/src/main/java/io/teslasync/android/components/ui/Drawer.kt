package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DrawerState
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Slide-in side panel mirroring web `components/ui/Drawer`, built on Material 3
 * [ModalNavigationDrawer]. The web left/right + footer maps to Material's edge drawer sheet
 * (which respects RTL); a swipe or scrim tap dismisses it. [drawerContent] fills the sheet body;
 * [content] is the screen behind. Drive [drawerState] with `rememberDrawerState`.
 */
@Composable
fun Drawer(
    drawerState: DrawerState,
    drawerContent: @Composable ColumnScope.() -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    closeLabel: String = "Close",
    gesturesEnabled: Boolean = true,
    onClose: (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    ModalNavigationDrawer(
        drawerState = drawerState,
        gesturesEnabled = gesturesEnabled,
        modifier = modifier,
        drawerContent = {
            ModalDrawerSheet {
                if (title != null) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(start = Spacing.lg, end = Spacing.sm, top = Spacing.lg),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        SectionTitle(title, modifier = Modifier.weight(1f))
                        if (onClose != null) {
                            IconButton(TeslaGlyphs.Close, contentDescription = closeLabel, onClick = onClose, size = IconSize.Md)
                        }
                    }
                }
                Column(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(Spacing.lg)
                            .verticalScroll(rememberScrollState()),
                    content = drawerContent,
                )
            }
        },
        content = content,
    )
}
