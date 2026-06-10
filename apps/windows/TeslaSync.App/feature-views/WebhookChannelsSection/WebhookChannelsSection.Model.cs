// Webhook notification channels Settings section — native model layer.
//
// The WinUI-free read-models, projection, registration, diagnostics and form
// logic behind the WebhookChannelsSection surface (the native parity port of
// web/src/features/settings/components/WebhookChannelsSection.tsx). The web
// component layers three things on top of the generic channel CRUD already
// shipped by NotificationChannelsView:
//
//   1. A focused list limited to kind=webhook with a status pill and per-row
//      Test / Edit / Delete actions.
//   2. A wizard-style add/edit form over the four persisted fields — name,
//      URL, HTTP method and the (repurposed) signing secret.
//   3. A live HMAC X-TeslaSync-Signature preview backed by the
//      /notifications/webhooks/preview-signature utility endpoint.
//
// Everything here is UI-thread-free so the adapters, payload builder, status
// projection and Narrator names are asserted headlessly without a WinUI host.
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive freshness state the <see cref="WebhookChannelsViewModel"/> exposes for the webhook
/// collection — the native union of the loading / loaded / empty / stale / offline / error branches the P2
/// feature-view contract mandates. The web source reads its webhooks through the derived
/// <c>useWebhookChannels()</c> query (a kind=webhook filter over <c>useNotificationChannels()</c>); the native
/// surface owns the same cache-then-network read, so this state is driven by that single read.
/// </summary>
public enum WebhookChannelsState
{
    /// <summary>The read is in flight with no cached value yet — render the row skeletons.</summary>
    Loading,

    /// <summary>A fresh, non-empty webhook list arrived — render the rows.</summary>
    Loaded,

    /// <summary>The read resolved with no webhooks — render the friendly empty surface.</summary>
    Empty,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,

    /// <summary>The read failed with no cached list — render the retriable error surface.</summary>
    Error,
}

/// <summary>
/// One webhook channel — the native, cache-friendly read-model parsed from a kind=webhook row of the
/// <c>GET /notifications</c> response (the web <c>NotificationChannelWebhook</c>). Only the four fields the
/// section actually renders/persists are surfaced.
/// </summary>
/// <param name="Id">The server channel id.</param>
/// <param name="Name">The friendly channel name.</param>
/// <param name="Url">The receiver URL.</param>
/// <param name="Method">The HTTP verb (upper-cased; defaults to <c>POST</c>).</param>
/// <param name="Enabled">Whether deliveries are enabled.</param>
public sealed record WebhookChannel(long Id, string Name, string Url, string Method, bool Enabled)
{
    /// <summary>Parse one channel object into a webhook read-model (web <c>fromChannel</c> shape).</summary>
    public static WebhookChannel FromJson(JsonElement element)
    {
        long id = JsonScalars.ReadLong(element, "id");
        string name = JsonScalars.ReadString(element, "name") ?? string.Empty;
        string url = JsonScalars.ReadString(element, "url") ?? string.Empty;
        string method = WebhookChannelForm.NormalizeDisplayMethod(JsonScalars.ReadString(element, "method"));
        bool enabled = JsonScalars.ReadBool(element, "enabled", defaultValue: true);
        return new WebhookChannel(id, name, url, method, enabled);
    }
}

/// <summary>
/// A parsed snapshot of the webhook collection — the native read-model behind the web
/// <c>useWebhookChannels()</c> array. The <c>GET /notifications</c> payload carries every channel kind; only the
/// kind=webhook rows are retained (the web filter). <see cref="HasData"/> distinguishes a populated list from a
/// resolved-but-empty response (no webhooks) so the empty surface renders even when other channel kinds exist.
/// </summary>
/// <param name="Channels">The webhook channels in server order (the projection sorts them by name).</param>
public sealed record WebhookChannelList(IReadOnlyList<WebhookChannel> Channels)
{
    /// <summary>An empty webhook list.</summary>
    public static WebhookChannelList Empty { get; } = new(Array.Empty<WebhookChannel>());

    /// <summary>True when at least one webhook channel is configured.</summary>
    public bool HasData => Channels.Count > 0;

    /// <summary>Parse a <c>GET /notifications</c> array, retaining only kind=webhook rows; a non-array body is empty.</summary>
    public static WebhookChannelList FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        var channels = new List<WebhookChannel>(element.GetArrayLength());
        foreach (var row in element.EnumerateArray())
        {
            if (row.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (string.Equals(JsonScalars.ReadString(row, "kind"), "webhook", StringComparison.OrdinalIgnoreCase))
            {
                channels.Add(WebhookChannel.FromJson(row));
            }
        }

        return channels.Count == 0 ? Empty : new WebhookChannelList(channels);
    }
}

/// <summary>
/// The structured outcome of a webhook test delivery — the native mirror of the web <c>WebhookTestResult</c>
/// (<c>POST /notifications/{id}/webhook-test</c>). Surfaced inline under the row so the user can debug their
/// receiver (status, latency, signature and a body preview), exactly as the web does.
/// </summary>
/// <param name="Success">True when the provider accepted the delivery.</param>
/// <param name="StatusCode">The receiver's HTTP status code.</param>
/// <param name="LatencyMs">The round-trip latency in milliseconds.</param>
/// <param name="Signature">The HMAC signature sent with the request, when a secret is configured.</param>
/// <param name="BodyPreview">A (possibly truncated) preview of the receiver's response body.</param>
/// <param name="Truncated">True when <see cref="BodyPreview"/> was truncated.</param>
/// <param name="Error">The optional client/transport error message.</param>
public sealed record WebhookTestResult(
    bool Success,
    long StatusCode,
    long LatencyMs,
    string? Signature,
    string? BodyPreview,
    bool Truncated,
    string? Error)
{
    /// <summary>A transport-failure outcome (web <c>onError</c> branch — status 0, latency 0).</summary>
    public static WebhookTestResult Failure(string error) => new(false, 0, 0, null, null, false, error);

    /// <summary>Parse a <c>POST /notifications/{id}/webhook-test</c> response object.</summary>
    public static WebhookTestResult FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new WebhookTestResult(false, 0, 0, null, null, false, null);
        }

        return new WebhookTestResult(
            JsonScalars.ReadBool(element, "success", defaultValue: false),
            JsonScalars.ReadLong(element, "status_code"),
            JsonScalars.ReadLong(element, "latency_ms"),
            NullIfEmpty(JsonScalars.ReadString(element, "signature")),
            NullIfEmpty(JsonScalars.ReadString(element, "body_preview")),
            JsonScalars.ReadBool(element, "truncated", defaultValue: false),
            NullIfEmpty(JsonScalars.ReadString(element, "error")));
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;
}

/// <summary>The lifecycle of the live signature preview (web <c>SignaturePreview</c> branches).</summary>
public enum WebhookSignatureStatus
{
    /// <summary>No secret yet — show the "add a signing secret" helper.</summary>
    Empty,

    /// <summary>The preview request is in flight.</summary>
    Computing,

    /// <summary>A signature was computed.</summary>
    Ready,

    /// <summary>The preview request failed.</summary>
    Failed,
}

/// <summary>
/// The resolved signature-preview outcome the form renders. Pure so the empty / ready / failed branches are
/// asserted headlessly (the web <c>SignaturePreview</c> render body).
/// </summary>
/// <param name="Status">The preview lifecycle branch.</param>
/// <param name="Signature">The computed signature (only meaningful when <see cref="Status"/> is Ready).</param>
/// <param name="Message">The localized helper / error message for the current branch.</param>
public sealed record WebhookSignatureOutcome(WebhookSignatureStatus Status, string Signature, string Message);

/// <summary>The editable form fields for the add/edit modal (web <c>WebhookFormState</c>).</summary>
/// <param name="Id">The channel id when editing, otherwise null (create).</param>
/// <param name="Name">The channel name.</param>
/// <param name="Url">The receiver URL.</param>
/// <param name="Method">The selected HTTP verb (POST / PUT / PATCH).</param>
/// <param name="Secret">The HMAC signing secret (blank keeps the existing one on edit).</param>
/// <param name="Enabled">Whether deliveries are enabled.</param>
public sealed record WebhookFormInput(long? Id, string Name, string Url, string Method, string Secret, bool Enabled)
{
    /// <summary>The blank create form (web <c>EMPTY_FORM</c>).</summary>
    public static WebhookFormInput Empty { get; } = new(null, string.Empty, string.Empty, "POST", string.Empty, true);
}

/// <summary>
/// The pure, UI-free form logic behind the add/edit modal — the native port of the web
/// <c>toSavePayload</c> / <c>isHttpsLike</c> helpers and the name / URL guards. Kept here so the payload shape
/// and validation are asserted headlessly without a WinUI dialog.
/// </summary>
public static class WebhookChannelForm
{
    /// <summary>The display HTTP verbs the picker offers (web <c>HTTP_METHODS</c>).</summary>
    public static IReadOnlyList<string> Methods { get; } = new[] { "POST", "PUT", "PATCH" };

    /// <summary>
    /// The static sample envelope used to build a representative signature in the preview (web <c>sampleBody</c>);
    /// mirrors the JSON the backend WebhookTest handler emits, key order preserved so the signature is stable.
    /// </summary>
    public const string SampleBody =
        "{\"title\":\"Test event\",\"message\":\"Hello from TeslaSync\",\"source\":\"teslasync\",\"test\":true}";

    /// <summary>Normalize a stored/typed verb to one of POST / PUT / PATCH for display (web <c>fromChannel</c>).</summary>
    public static string NormalizeDisplayMethod(string? method)
    {
        string upper = (string.IsNullOrWhiteSpace(method) ? "POST" : method).ToUpperInvariant();
        return upper is "PUT" or "PATCH" ? upper : "POST";
    }

    /// <summary>Narrow a display verb to the POST / PUT the backend persists (web <c>SAVE_METHOD_FALLBACK</c>; PATCH → POST).</summary>
    public static string SaveMethod(string? method) =>
        string.Equals(method, "PUT", StringComparison.OrdinalIgnoreCase) ? "PUT" : "POST";

    /// <summary>True when the URL starts with <c>http://</c> or <c>https://</c> (web <c>isHttpsLike</c>).</summary>
    public static bool IsHttpLike(string? url)
    {
        string trimmed = (url ?? string.Empty).Trim();
        return trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Validate the name (web <c>trimmedName === ''</c>); returns the localized error or null.</summary>
    public static string? ValidateName(string? name, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return string.IsNullOrWhiteSpace(name)
            ? localizer.GetString("webhookChannels.form.nameRequired", "Name is required.")
            : null;
    }

    /// <summary>Validate the URL (web <c>!isHttpsLike</c>); returns the localized error or null.</summary>
    public static string? ValidateUrl(string? url, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return IsHttpLike(url)
            ? null
            : localizer.GetString("webhookChannels.form.urlInvalid", "URL must start with http:// or https://.");
    }

    /// <summary>
    /// Build the create (<c>POST</c>) / update (<c>PUT</c>) request body — the native port of <c>toSavePayload</c>.
    /// Headers and body template are satisfied with empty defaults (the backend dispatch path ignores them), the
    /// method narrows to POST / PUT, and the secret rides on the repurposed <c>bearer_token</c> field.
    /// </summary>
    public static JsonObject BuildPayload(WebhookFormInput form)
    {
        ArgumentNullException.ThrowIfNull(form);

        var body = new JsonObject
        {
            ["kind"] = "webhook",
            ["name"] = form.Name.Trim(),
            ["enabled"] = form.Enabled,
            ["url"] = form.Url.Trim(),
            ["method"] = SaveMethod(form.Method),
            ["headers"] = new JsonObject(),
            ["body_template"] = string.Empty,
            ["bearer_token"] = form.Secret,
        };

        if (form.Id is { } id)
        {
            body["id"] = id;
        }

        return body;
    }
}

/// <summary>One render-ready webhook row — every label localized and the status resolved, plus Narrator names.</summary>
/// <param name="Id">The server channel id.</param>
/// <param name="Name">The channel name.</param>
/// <param name="Url">The receiver URL.</param>
/// <param name="MethodLabel">The upper-cased HTTP verb shown in the method chip.</param>
/// <param name="Enabled">Whether deliveries are enabled.</param>
/// <param name="StatusLabel">The localized Enabled / Disabled pill text.</param>
/// <param name="StatusKind">The semantic status driving the pill colour.</param>
/// <param name="ToggleAutomationName">Narrator name for the enable toggle.</param>
/// <param name="TestAutomationName">Narrator name for the test action.</param>
/// <param name="EditAutomationName">Narrator name for the edit action.</param>
/// <param name="DeleteAutomationName">Narrator name for the delete action.</param>
public sealed record WebhookRowDisplay(
    long Id,
    string Name,
    string Url,
    string MethodLabel,
    bool Enabled,
    string StatusLabel,
    StatusKind StatusKind,
    string ToggleAutomationName,
    string TestAutomationName,
    string EditAutomationName,
    string DeleteAutomationName);

/// <summary>The render-ready projection of one inline test result (web's per-row test box).</summary>
/// <param name="Success">True when the delivery succeeded.</param>
/// <param name="StatusKind">Success / danger accent for the result badge.</param>
/// <param name="ResultLabel">The localized Success / Failed badge text.</param>
/// <param name="StatusText">The localized "Status {code}" line.</param>
/// <param name="LatencyText">The localized "{ms} ms" line.</param>
/// <param name="HasSignature">True when a signature line should render.</param>
/// <param name="SignatureLabel">The localized "Signature:" label.</param>
/// <param name="Signature">The signature value.</param>
/// <param name="HasBody">True when a response-body section should render.</param>
/// <param name="BodyLabel">The localized "Response body" summary label.</param>
/// <param name="BodyText">The response body preview (with the truncated suffix appended when applicable).</param>
/// <param name="HasError">True when a client/transport error line should render.</param>
/// <param name="Error">The error message.</param>
public sealed record WebhookTestDisplay(
    bool Success,
    StatusKind StatusKind,
    string ResultLabel,
    string StatusText,
    string LatencyText,
    bool HasSignature,
    string SignatureLabel,
    string Signature,
    bool HasBody,
    string BodyLabel,
    string BodyText,
    bool HasError,
    string Error);

/// <summary>One documented payload variable shown in the "Available payload variables" box.</summary>
/// <param name="Name">The variable name (rendered as inline code).</param>
/// <param name="Description">The localized description.</param>
public sealed record WebhookDocVariable(string Name, string Description);

/// <summary>
/// The fully projected, render-ready view of the WebhookChannels surface — the header copy, the add-button label,
/// every webhook row, the empty-surface copy, the payload-variable documentation and the surface-level Narrator
/// name. Mirrors every branch the web <c>WebhookChannelsSection</c> renders.
/// </summary>
public sealed record WebhookChannelsDisplay(
    string Title,
    string Subtitle,
    string AddLabel,
    IReadOnlyList<WebhookRowDisplay> Rows,
    string EmptyTitle,
    string EmptyMessage,
    string EmptyActionLabel,
    string DocsTitle,
    string DocsIntro,
    IReadOnlyList<WebhookDocVariable> DocsVariables,
    string AutomationName);

/// <summary>
/// Projects the parsed webhook list + freshness state into a <see cref="WebhookChannelsDisplay"/>, and the test /
/// signature outcomes into their render-ready displays. Pure and UI-free (the native analogue of the web render
/// body) so the row labels, status chips, sorting and Narrator names are asserted headlessly. Mirrors
/// web/src/features/settings/components/WebhookChannelsSection.tsx.
/// </summary>
public static class WebhookChannelsProjection
{
    /// <summary>Build the render-ready surface display from the current webhook list and freshness state.</summary>
    public static WebhookChannelsDisplay Project(
        WebhookChannelList? webhooks,
        WebhookChannelsState state,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var list = webhooks ?? WebhookChannelList.Empty;

        // web parity: sortedWebhooks = [...].sort((a, b) => a.name.localeCompare(b.name)).
        var sorted = new List<WebhookChannel>(list.Channels);
        sorted.Sort((a, b) => string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));

        var rows = new List<WebhookRowDisplay>(sorted.Count);
        foreach (var channel in sorted)
        {
            rows.Add(ProjectRow(channel, localizer));
        }

        return new WebhookChannelsDisplay(
            Title: localizer.GetString("webhookChannels.title", "Webhook channels"),
            Subtitle: localizer.GetString(
                "webhookChannels.subtitle",
                "Forward TeslaSync notifications to Discord, Slack, n8n, Home Assistant, or any HTTP receiver. "
                + "Each channel can be HMAC-signed so receivers can verify authenticity."),
            AddLabel: localizer.GetString("webhookChannels.addButton", "Add webhook"),
            Rows: rows,
            EmptyTitle: localizer.GetString("webhookChannels.empty.title", "No webhooks yet"),
            EmptyMessage: localizer.GetString(
                "webhookChannels.empty.message",
                "Add a webhook to forward TeslaSync events to your favourite chat or automation tool."),
            EmptyActionLabel: localizer.GetString("webhookChannels.empty.action", "Add your first webhook"),
            DocsTitle: localizer.GetString("webhookChannels.docs.title", "Available payload variables"),
            DocsIntro: localizer.GetString(
                "webhookChannels.docs.intro", "Webhook receivers get a JSON envelope with these fields:"),
            DocsVariables: DocsVariables(localizer),
            AutomationName: AutomationName(sorted.Count, state, localizer));
    }

    /// <summary>Project one webhook channel into its render-ready row.</summary>
    public static WebhookRowDisplay ProjectRow(WebhookChannel channel, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(channel);
        ArgumentNullException.ThrowIfNull(localizer);

        bool enabled = channel.Enabled;
        string statusLabel = enabled
            ? localizer.GetString("webhookChannels.row.enabled", "Enabled")
            : localizer.GetString("webhookChannels.row.disabled", "Disabled");

        return new WebhookRowDisplay(
            Id: channel.Id,
            Name: channel.Name,
            Url: channel.Url,
            MethodLabel: WebhookChannelForm.NormalizeDisplayMethod(channel.Method),
            Enabled: enabled,
            StatusLabel: statusLabel,
            StatusKind: enabled ? StatusKind.Success : StatusKind.Neutral,
            ToggleAutomationName: Aria(localizer.GetString("webhookChannels.row.toggle", "Active"), channel.Name),
            TestAutomationName: Aria(localizer.GetString("webhookChannels.row.test", "Test webhook"), channel.Name),
            EditAutomationName: Aria(localizer.GetString("webhookChannels.row.edit", "Edit webhook"), channel.Name),
            DeleteAutomationName: Aria(localizer.GetString("webhookChannels.row.delete", "Delete webhook"), channel.Name));
    }

    /// <summary>Project a webhook test outcome into its inline render-ready display (web's per-row test box).</summary>
    public static WebhookTestDisplay ProjectTest(WebhookTestResult result, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(result);
        ArgumentNullException.ThrowIfNull(localizer);

        string status = localizer.GetString("webhookChannels.test.status", "Status {{status}}")
            .Replace("{{status}}", result.StatusCode.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
        string latency = localizer.GetString("webhookChannels.test.latency", "{{ms}} ms")
            .Replace("{{ms}}", result.LatencyMs.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);

        bool hasBody = !string.IsNullOrEmpty(result.BodyPreview);
        string bodyText = result.BodyPreview ?? string.Empty;
        if (hasBody && result.Truncated)
        {
            bodyText += "\n" + localizer.GetString("webhookChannels.test.truncated", "\u2026 (truncated)");
        }

        return new WebhookTestDisplay(
            Success: result.Success,
            StatusKind: result.Success ? StatusKind.Success : StatusKind.Danger,
            ResultLabel: result.Success
                ? localizer.GetString("webhookChannels.test.success", "Success")
                : localizer.GetString("webhookChannels.test.failure", "Failed"),
            StatusText: status,
            LatencyText: latency,
            HasSignature: !string.IsNullOrEmpty(result.Signature),
            SignatureLabel: localizer.GetString("webhookChannels.test.signature", "Signature:"),
            Signature: result.Signature ?? string.Empty,
            HasBody: hasBody,
            BodyLabel: localizer.GetString("webhookChannels.test.body", "Response body"),
            BodyText: bodyText,
            HasError: !string.IsNullOrEmpty(result.Error),
            Error: result.Error ?? string.Empty);
    }

    /// <summary>The four documented payload variables (web's docs box list).</summary>
    public static IReadOnlyList<WebhookDocVariable> DocsVariables(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new[]
        {
            new WebhookDocVariable(
                "title", localizer.GetString("webhookChannels.docs.var.title", "short headline of the event")),
            new WebhookDocVariable(
                "message", localizer.GetString("webhookChannels.docs.var.message", "long-form body of the event")),
            new WebhookDocVariable(
                "source", localizer.GetString("webhookChannels.docs.var.source", "always \"teslasync\"")),
            new WebhookDocVariable(
                "timestamp", localizer.GetString("webhookChannels.docs.var.timestamp", "RFC3339 server-side time")),
        };
    }

    private static string Aria(string label, string name) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, name);

    private static string AutomationName(int count, WebhookChannelsState state, ILocalizer localizer)
    {
        if (state == WebhookChannelsState.Empty || count == 0)
        {
            return localizer.GetString("webhookChannels.empty.title", "No webhooks yet");
        }

        return localizer.GetString("webhookChannels.summaryAria", "{{count}} webhook channels")
            .Replace("{{count}}", count.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
    }
}

/// <summary>
/// Maps the raw cache-then-network <see cref="JsonElement"/> emissions to the typed
/// <see cref="WebhookChannelList"/> read-model while preserving the freshness status — the native analogue of
/// the web query <c>select</c>. Asserted directly (cached → projection) in the headless tests.
/// </summary>
public static class WebhookChannelsResultMapper
{
    /// <summary>Map a raw channels emission to a typed (kind=webhook-filtered) <see cref="WebhookChannelList"/> result.</summary>
    public static RepositoryResult<WebhookChannelList> MapWebhooks(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);
        WebhookChannelList Parse() => raw.HasValue ? WebhookChannelList.FromJson(raw.Value) : WebhookChannelList.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<WebhookChannelList>.Loading(),
            LoadStatus.Cached => RepositoryResult<WebhookChannelList>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<WebhookChannelList>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<WebhookChannelList>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<WebhookChannelList>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<WebhookChannelList>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<WebhookChannelList>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>A localized transient message raised for the in-app toast surface (web <c>useToast</c>).</summary>
/// <param name="Message">The localized toast body.</param>
/// <param name="IsError">True for an error toast (rendered with the danger severity).</param>
public sealed record WebhookChannelsToast(string Message, bool IsError);

/// <summary>
/// Canonical metadata for the WebhookChannelsSection surface — the native anchor for the web component at
/// web/src/features/settings/components/WebhookChannelsSection.tsx. Centralises the diagnostics
/// <see cref="Slug"/> emitted with the <c>view.opened</c> event (P1/S11) and the generated OpenAPI operation ids
/// the source reads and mutates.
/// </summary>
public static class WebhookChannelsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "WebhookChannelsSection";

    /// <summary>The web component this surface mirrors.</summary>
    public const string WebSource = "features/settings/components/WebhookChannelsSection.tsx";

    /// <summary>Operation id for <c>GET /notifications</c> — the channel list filtered to kind=webhook.</summary>
    public const string ChannelsOperation = "get_api_v1_notifications";

    /// <summary>Operation id for <c>POST /notifications</c> — create a channel (web <c>useSaveChannel</c>).</summary>
    public const string CreateOperation = "post_api_v1_notifications";

    /// <summary>Operation id for <c>PUT /notifications/{channelID}</c> — update a channel (web <c>useSaveChannel</c>).</summary>
    public const string UpdateOperation = "put_api_v1_notifications_channelID";

    /// <summary>Operation id for <c>DELETE /notifications/{channelID}</c> (web <c>useDeleteChannel</c>).</summary>
    public const string DeleteOperation = "delete_api_v1_notifications_channelID";

    /// <summary>Operation id for <c>POST /notifications/{channelID}/toggle</c> (web <c>useToggleChannel</c>).</summary>
    public const string ToggleOperation = "post_api_v1_notifications_channelID_toggle";

    /// <summary>Operation id for <c>POST /notifications/{channelID}/webhook-test</c> (web <c>useTestWebhookChannel</c>).</summary>
    public const string WebhookTestOperation = "post_api_v1_notifications_channelID_webhook_test";

    /// <summary>Operation id for <c>POST /notifications/webhooks/preview-signature</c> (web <c>useWebhookSignaturePreview</c>).</summary>
    public const string SignaturePreviewOperation = "post_api_v1_notifications_webhooks_preview_signature";

    /// <summary>The path-parameter name shared by the per-channel mutation endpoints.</summary>
    public const string ChannelIdParam = "channelID";
}

/// <summary>
/// PII-safe diagnostics for the WebhookChannelsSection surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a channel name, URL, secret or count — so a
/// diagnostics line can never leak user configuration. Thread-safe.
/// </summary>
public sealed class WebhookChannelsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional line sink (the host's diagnostics pipeline).</summary>
    public WebhookChannelsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of <c>view.opened</c> events recorded.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WebhookChannelsSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WebhookChannelsRegistration.Slug}");
    }
}
