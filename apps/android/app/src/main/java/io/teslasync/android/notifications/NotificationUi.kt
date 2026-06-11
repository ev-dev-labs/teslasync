package io.teslasync.android.notifications

import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.coroutines.delay

private const val BANNER_AUTO_DISMISS_MILLIS = 6_000L
private const val BANNER_TITLE_MAX_LINES = 1
private const val BANNER_BODY_MAX_LINES = 3

/**
 * Renders the most recent foreground [PushBanner] published to [sink] (P3/A6, ADR-009) as a dismissible
 * card overlay. A tap opens the banner's deep link via [onOpen]; the banner also auto-dismisses after a
 * short delay so it never lingers. Nothing renders when no banner is pending.
 */
@Composable
fun ForegroundNotificationBanner(
    sink: ForegroundBannerSink,
    onOpen: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val banner by sink.banner.collectAsStateWithLifecycle()
    val current = banner
    if (current != null) {
        LaunchedEffect(current) {
            delay(BANNER_AUTO_DISMISS_MILLIS)
            sink.dismiss()
        }
        val colors = bannerColors(current.severity)
        Card(
            colors = CardDefaults.cardColors(containerColor = colors.first, contentColor = colors.second),
            modifier =
                modifier
                    .fillMaxWidth()
                    .padding(Spacing.md)
                    .clickable {
                        current.deepLinkUri?.let(onOpen)
                        sink.dismiss()
                    },
        ) {
            Row(modifier = Modifier.fillMaxWidth().padding(Spacing.md)) {
                Column(modifier = Modifier.fillMaxWidth()) {
                    if (current.title.isNotBlank()) {
                        Text(
                            text = current.title,
                            style = MaterialTheme.typography.titleSmall,
                            maxLines = BANNER_TITLE_MAX_LINES,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (current.body.isNotBlank()) {
                        Text(
                            text = current.body,
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = BANNER_BODY_MAX_LINES,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = 2.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * Requests the runtime `POST_NOTIFICATIONS` permission once when the platform requires it and it has
 * not yet been granted (P3/A6, ADR-009). On API < 33 it is a no-op (the permission is install-time);
 * the result is honored implicitly by [NotificationDeliveryPolicy], which re-reads the live grant state.
 */
@Composable
fun NotificationPermissionEffect() {
    val context = LocalContext.current
    var asked by rememberSaveable { mutableStateOf(false) }
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { asked = true }
    LaunchedEffect(Unit) {
        if (!NotificationPermission.isRuntimePermissionRequired(Build.VERSION.SDK_INT)) {
            return@LaunchedEffect
        }
        val granted =
            ContextCompat.checkSelfPermission(context, NotificationPermission.PERMISSION) ==
                PackageManager.PERMISSION_GRANTED
        if (NotificationPermission.shouldRequest(Build.VERSION.SDK_INT, granted, asked)) {
            asked = true
            launcher.launch(NotificationPermission.PERMISSION)
        }
    }
}

@Composable
private fun bannerColors(severity: BannerSeverity): Pair<Color, Color> {
    val scheme = MaterialTheme.colorScheme
    return when (severity) {
        BannerSeverity.Critical -> scheme.errorContainer to scheme.onErrorContainer
        BannerSeverity.Warning -> scheme.tertiaryContainer to scheme.onTertiaryContainer
        BannerSeverity.Info -> scheme.secondaryContainer to scheme.onSecondaryContainer
    }
}
