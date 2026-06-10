package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.coroutines.delay

private const val REFRESH_INTERVAL_MS = 30_000L
private val FRESHNESS_DOT = 6.dp

/**
 * Query-result-driven freshness chip — the Android counterpart of the web `DataFreshness`. Lives
 * in a panel/page header (not next to a value); surfaces the health of a data fetch as a colored
 * dot + icon + relative time string. Map a repository's load state onto [isFetching] / [isStale] /
 * [isError] and pass [updatedAtMillis]; the relative label re-renders every 30s.
 */
@Composable
fun DataFreshness(
    updatedAtMillis: Long?,
    isFetching: Boolean,
    isStale: Boolean,
    isError: Boolean,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    fetchingLabel: String = "updating\u2026",
    errorLabel: String = "error",
    formatAge: (FreshnessAge) -> String = ::formatFreshnessAge,
) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(updatedAtMillis) {
        while (true) {
            delay(REFRESH_INTERVAL_MS)
            now = System.currentTimeMillis()
        }
    }
    val status = queryFreshness(isError, isFetching, isStale)
    val color = queryFreshnessColor(status)
    val relative =
        when (status) {
            QueryFreshness.Fetching -> fetchingLabel
            QueryFreshness.Error -> errorLabel
            else -> formatAge(relativeAge(computeAgeSeconds(updatedAtMillis, now)))
        }
    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = relative },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (status == QueryFreshness.Fetching) {
            CircularProgressIndicator(modifier = Modifier.size(FRESHNESS_DOT.times(2)), strokeWidth = 1.5.dp, color = color)
        } else {
            Box(modifier = Modifier.size(FRESHNESS_DOT).clip(CircleShape).background(color))
            Icon(freshnessIcon(status), contentDescription = null, size = IconSize.Xs, tint = color)
        }
        if (!compact) Text(relative, style = MaterialTheme.typography.labelSmall, color = color)
    }
}

private fun freshnessIcon(status: QueryFreshness) =
    when (status) {
        QueryFreshness.Error -> DataDisplayGlyphs.WifiOff
        else -> DataDisplayGlyphs.Wifi
    }
