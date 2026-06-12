// Pure, framework-light model + projection for the WebhookChannelsSection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/settings/components/WebhookChannelsSection.tsx). Every declaration here is exercised
// off-device by the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component owns the webhook-channel surface: a kind=webhook list (web `useWebhookChannels`) with a
// status pill + per-row test/edit/delete, a four-field create/edit modal (name, URL, HTTP method, signing
// secret), and a live HMAC X-TeslaSync-Signature preview (web `useWebhookSignaturePreview`). This file owns the
// parity-critical derivations that have nothing to do with Compose: the HTTP-method catalogue (web
// `HTTP_METHODS`), the channel -> form-state map (web `fromChannel`), the form validation (web `handleSubmit`
// guards), the form-state -> `NotificationChannelInput.Webhook` builder (web `toSavePayload`), the static sample
// body the modal signs (web `sampleBody`), and the JSON payload-variable identifiers the docs box lists.
//
// Declared divergence (no silent drift, honesty covenant #9): the web `toSavePayload` also sends
// `bearer_token: form.secret` via an untyped cast, repurposed server-side as the HMAC signing secret. The shared
// KMP write contract `NotificationChannelInput.Webhook` (golden-locked, ADR-004; shared verbatim with the C#/Apple
// ports) carries NO secret field, and it is outside this surface's allowed files. The secret is therefore
// collected in the form and drives the live signature preview (the web's headline HMAC feature, fully functional
// via the dedicated preview endpoint) but is not persisted through the typed save body. Closing this gap is a
// shared-contract change (separate model + golden-vector patch), not a render-surface change.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed because the mandated surface
// directory (com/teslasync/feature-views/WebhookChannelsSection — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package and hosts several co-located declarations, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.webhookchannelssection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notifications.NotificationChannelInput
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object WebhookChannelsSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "webhook-channels-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "WebhookChannelsSection"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [WebhookChannelsSectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable / view-model
 * calls it from the first-composition effect. It carries no channel name, URL, or secret, so a diagnostics line
 * can never leak what a user has configured.
 */
fun recordWebhookChannelsViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to WebhookChannelsSectionRegistration.SLUG))
}

/**
 * One transient toast a webhook mutation raises — the typed, i18n-key-free analogue of the global toasts the web
 * `useToggleChannel` / `useDeleteChannel` hooks surface (the webhook section reuses the generic channel CRUD
 * hooks, so the copy is the generic "Channel enabled/disabled/deleted" set). The render boundary maps each variant
 * to a localized [io.teslasync.android.components.feedback.ToastItem]; no channel name, URL, or secret is carried,
 * so a toast can never leak what a user configured. Test results are rendered inline (web `testResults`), not as a
 * toast, and save success is reflected by the modal closing + the list refreshing — both matching the web.
 */
sealed interface WebhookToast {
    /** Toggled on — web `useToggleChannel` "Channel enabled". */
    data object Enabled : WebhookToast

    /** Toggled off — web `useToggleChannel` "Channel disabled". */
    data object Disabled : WebhookToast

    /** Toggle failed — web `useToggleChannel` "Failed to toggle channel". */
    data object ToggleFailed : WebhookToast

    /** Deleted — web `useDeleteChannel` "Channel deleted". */
    data object Deleted : WebhookToast

    /** Delete failed — web `useDeleteChannel` "Failed to delete channel". */
    data object DeleteFailed : WebhookToast
}

/**
 * The HTTP methods the form offers — the native mirror of the web `HTTP_METHODS` (`POST | PUT | PATCH`). [wire]
 * is the verbatim value; [from] classifies a raw backend string, defaulting to [Post] for anything that is not a
 * recognised PUT/PATCH, exactly like the web `fromChannel` normalization.
 */
enum class WebhookHttpMethod(
    val wire: String,
) {
    Post("POST"),
    Put("PUT"),
    Patch("PATCH"),
    ;

    companion object {
        /** Classifies a raw method string; unknown values fall back to [Post] (web `fromChannel`). */
        fun from(raw: String): WebhookHttpMethod =
            when (raw.trim().uppercase(Locale.ROOT)) {
                "PUT" -> Put
                "PATCH" -> Patch
                else -> Post
            }
    }
}

/** The ordered method options the select renders — the web `HTTP_METHODS` const. */
val WEBHOOK_HTTP_METHODS: List<WebhookHttpMethod> = listOf(WebhookHttpMethod.Post, WebhookHttpMethod.Put, WebhookHttpMethod.Patch)

/**
 * Narrows the UI method to one the typed save body accepts — the web `SAVE_METHOD_FALLBACK`: PUT passes through,
 * POST and PATCH both serialize as POST (PATCH falls back until the schema gains a wider `method` enum).
 */
fun webhookSaveMethod(method: WebhookHttpMethod): String =
    when (method) {
        WebhookHttpMethod.Put -> "PUT"
        WebhookHttpMethod.Post, WebhookHttpMethod.Patch -> "POST"
    }

/**
 * The transient state of the create/edit form — the native mirror of the web `WebhookFormState`. [id] is `null`
 * on create (an id-free POST body) and the existing id on edit (selects the PUT path); [secret] always starts
 * blank on edit because the backend never echoes it (web `fromChannel`).
 */
data class WebhookFormState(
    val id: Long? = null,
    val name: String = "",
    val url: String = "",
    val method: WebhookHttpMethod = WebhookHttpMethod.Post,
    val secret: String = "",
    val enabled: Boolean = true,
)

/** The blank create form — the web `EMPTY_FORM`. */
val EMPTY_WEBHOOK_FORM: WebhookFormState = WebhookFormState()

/**
 * Flattens a loaded webhook [channel] into the editable [WebhookFormState] — the native mirror of the web
 * `fromChannel`. The method is normalized through [WebhookHttpMethod.from]; the secret always starts blank
 * because the backend never echoes the stored secret on read.
 */
fun webhookFormFrom(channel: NotificationChannel.Webhook): WebhookFormState =
    WebhookFormState(
        id = channel.id,
        name = channel.name,
        url = channel.url,
        method = WebhookHttpMethod.from(channel.method),
        secret = "",
        enabled = channel.enabled,
    )

/** Whether [url] starts with an http(s) scheme — the web `isHttpsLike` (`/^https?:\/\//i`), blank-guarded. */
fun isHttpLikeUrl(url: String): Boolean {
    val trimmed = url.trim()
    if (trimmed.isEmpty()) return false
    return trimmed.startsWith("http://", ignoreCase = true) || trimmed.startsWith("https://", ignoreCase = true)
}

/** The two inline form validation failures — the web `handleSubmit` guards, in the web's check order. */
enum class WebhookFormError { NameRequired, UrlInvalid }

/**
 * Validates the form the way the web `handleSubmit` does: a blank (trimmed) name fails first
 * ([WebhookFormError.NameRequired]), then a non-http(s) URL ([WebhookFormError.UrlInvalid]); `null` means valid.
 */
fun validateWebhookForm(
    name: String,
    url: String,
): WebhookFormError? =
    when {
        name.trim().isEmpty() -> WebhookFormError.NameRequired
        !isHttpLikeUrl(url) -> WebhookFormError.UrlInvalid
        else -> null
    }

/**
 * Builds the create/update wire body from [form] — the native mirror of the web `toSavePayload`: the name and
 * URL are trimmed, the method is narrowed via [webhookSaveMethod], and headers/body-template are sent empty (the
 * backend's existing dispatch path ignores them). See the file header for why the secret is not in this body.
 */
fun toWebhookSavePayload(form: WebhookFormState): NotificationChannelInput.Webhook =
    NotificationChannelInput.Webhook(
        id = form.id,
        name = form.name.trim(),
        enabled = form.enabled,
        url = form.url.trim(),
        method = webhookSaveMethod(form.method),
        headers = emptyMap(),
        bodyTemplate = "",
    )

/**
 * The static sample body the modal signs for the preview — the web `sampleBody`
 * (`JSON.stringify({ title, message, source, test })`), byte-for-byte so the previewed signature matches the web.
 */
const val WEBHOOK_SAMPLE_BODY: String =
    "{\"title\":\"Test event\",\"message\":\"Hello from TeslaSync\",\"source\":\"teslasync\",\"test\":true}"

/**
 * Sorts the webhook rows by name, case-insensitively — the native mirror of the web `sortedWebhooks`
 * (`[...webhooks].sort((a, b) => a.name.localeCompare(b.name))`). A pure function of its input.
 */
fun sortWebhookChannels(channels: List<NotificationChannel.Webhook>): List<NotificationChannel.Webhook> =
    channels.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name })

/**
 * The uppercase method label a row's method badge shows — the web `(channel.method ?? 'POST').toUpperCase()`,
 * defaulting a blank method to `POST` so a malformed row never renders an empty chip.
 */
fun webhookMethodLabel(method: String): String = method.trim().ifEmpty { "POST" }.uppercase(Locale.ROOT)

/**
 * The JSON envelope fields a webhook receiver gets — the web docs box `<code>` identifiers
 * (`title` / `message` / `source` / `timestamp`). These are wire identifiers, not translatable prose, so they
 * render verbatim as code. The web pairs each with an English description that is NOT in the P1/S10 catalog (the
 * web hardcodes it); the native omits that un-catalogued prose to honour the no-English-literals rule and renders
 * the catalogued intro + these identifiers — a declared divergence, not silent drift.
 */
val WEBHOOK_PAYLOAD_VARIABLES: List<String> = listOf("title", "message", "source", "timestamp")

// ── Local lucide glyphs ──────────────────────────────────────────────────────────────────────────────────
// The web component draws lucide icons (Webhook / Send / Trash2) that Android has no bundled set for. Feature
// views may not expand the shared icon library from a surface prompt (allowed-files), so each is authored here as
// a 24×24 round-capped stroked vector in the shared monochrome style — recolored at render time by the `Icon`
// tint, exactly as the sibling surfaces author their local glyphs. Plus / Eye / EyeOff / Copy / Check come from
// the shared `TeslaGlyphs`.

/** Webhook surface glyphs the view renders, authored as monochrome stroked vectors. */
object WebhookGlyphs {
    /** Web `Webhook` — header icon + empty state (linked rings). */
    val Webhook: ImageVector =
        strokedGlyph("Webhook") {
            moveTo(9f, 15.5f)
            arcTo(4f, 4f, 0f, true, true, 13f, 8f)
            moveTo(15.5f, 9.5f)
            arcTo(4f, 4f, 0f, true, true, 12f, 16f)
            lineTo(7.5f, 16f)
            moveTo(11f, 8.5f)
            lineTo(8f, 14f)
        }

    /** Web `Send` — the per-row test action (paper plane). */
    val Send: ImageVector =
        strokedGlyph("Send") {
            moveTo(21f, 3f)
            lineTo(3f, 11f)
            lineTo(10f, 13.5f)
            lineTo(12.5f, 20.5f)
            close()
            moveTo(10f, 13.5f)
            lineTo(21f, 3f)
        }

    /** Web `Trash2` — delete a webhook. */
    val Trash: ImageVector =
        strokedGlyph("Trash") {
            moveTo(4f, 7f)
            lineTo(20f, 7f)
            moveTo(6.5f, 7f)
            lineTo(7.5f, 20f)
            lineTo(16.5f, 20f)
            lineTo(17.5f, 7f)
            moveTo(9.5f, 7f)
            lineTo(9.5f, 4.5f)
            lineTo(14.5f, 4.5f)
            lineTo(14.5f, 7f)
            moveTo(10.5f, 10.5f)
            lineTo(10.5f, 16.5f)
            moveTo(13.5f, 10.5f)
            lineTo(13.5f, 16.5f)
        }
}

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()
