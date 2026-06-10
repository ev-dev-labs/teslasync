using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Endpoints;

/// <summary>
/// One outgoing request emitted by the <see cref="RequestBuilderViewModel"/> when the operator sends — the
/// native mirror of the web <c>onSend(url, method, body?, headers?)</c> callback in
/// web/src/features/admin/components/RequestBuilder.tsx. The <see cref="Url"/> is the built path
/// <em>without</em> the <c>/api/v1</c> prefix (the prefix is only added for the display code block, exactly
/// as the web source passes <c>buildUrl()</c> to <c>onSend</c> while rendering <c>/api/v1{buildUrl()}</c>).
/// <see cref="Body"/> is null when the body box is empty (web <c>body || undefined</c>), and
/// <see cref="Headers"/> carries <c>X-API-Key</c> only when the auth field is non-blank.
/// </summary>
/// <param name="Url">The built request path without the <c>/api/v1</c> prefix (web <c>buildUrl()</c>).</param>
/// <param name="Method">The uppercase HTTP verb (web <c>endpoint.method</c>).</param>
/// <param name="Body">The request body, or null when the box is empty (web <c>body || undefined</c>).</param>
/// <param name="Headers">The request headers (an <c>X-API-Key</c> entry when the auth field is set).</param>
public sealed record OutgoingRequest(
    string Url,
    string Method,
    string? Body,
    IReadOnlyDictionary<string, string> Headers);

/// <summary>
/// One render-ready parameter field — the native projection of a web path/query parameter row
/// (web/src/features/admin/components/RequestBuilder.tsx). Pure data (no WinUI types) so the projection is
/// asserted headlessly.
/// </summary>
/// <param name="Name">The parameter name, the form key (web <c>p.name</c>).</param>
/// <param name="Label">The visible field label (web <c>{p.name}</c>).</param>
/// <param name="ShowRequiredMarker">Whether the red required marker is shown (path: always; query: <c>p.required</c>).</param>
/// <param name="Hint">The empty-field hint (web <c>p.description || p.type</c>, with the query default suffix).</param>
/// <param name="Value">The current field value, used to seed the input on an endpoint change.</param>
/// <param name="AutomationName">The Narrator name, e.g. "vehicle_id, required".</param>
public sealed record RequestParamFieldDisplay(
    string Name,
    string Label,
    bool ShowRequiredMarker,
    string Hint,
    string Value,
    string AutomationName);

/// <summary>
/// One render-ready parameter panel — the native projection of the web "Path Parameters" / "Query Parameters"
/// <c>GlassPanel</c> (web/src/features/admin/components/RequestBuilder.tsx). Present only when the endpoint
/// declares at least one parameter of that location, mirroring the web <c>{pathParams.length > 0 &amp;&amp; …}</c>
/// guard. Pure data — no WinUI types.
/// </summary>
/// <param name="Title">The localized panel header (web <c>t('playground.pathParams' | 'playground.queryParams')</c>).</param>
/// <param name="Fields">The parameter fields, in declaration order.</param>
public sealed record RequestParamSectionDisplay(
    string Title,
    IReadOnlyList<RequestParamFieldDisplay> Fields);

/// <summary>
/// The render-ready request-body panel — the native projection of the web "Request Body" <c>GlassPanel</c>
/// (web/src/features/admin/components/RequestBuilder.tsx). Present only when the endpoint declares a request
/// body (web <c>{endpoint.requestBody &amp;&amp; …}</c>). Pure data — no WinUI types.
/// </summary>
/// <param name="Title">The localized panel header (web <c>t('playground.requestBody')</c>).</param>
/// <param name="ContentType">The body media type shown beside the header (web <c>requestBody.contentType</c>).</param>
/// <param name="Value">The current body text, used to seed the editor on an endpoint change.</param>
/// <param name="Hint">The empty-editor hint (web <c>'{ "key": "value" }'</c>).</param>
/// <param name="AutomationName">The Narrator name for the body editor.</param>
public sealed record RequestBodySectionDisplay(
    string Title,
    string ContentType,
    string Value,
    string Hint,
    string AutomationName);

/// <summary>
/// The render-ready optional-authentication panel — the native projection of the web "Authentication
/// (Optional)" <c>GlassPanel</c> (web/src/features/admin/components/RequestBuilder.tsx). Always present (the
/// web source renders it unconditionally), so a screen reader and the layout never lose the panel. Pure data
/// — no WinUI types.
/// </summary>
/// <param name="Title">The localized panel header (web <c>t('playground.authHeader')</c>).</param>
/// <param name="FieldLabel">The header-name label (web literal <c>X-API-Key</c>).</param>
/// <param name="Hint">The empty-field hint for the API-key input.</param>
/// <param name="Note">The explanatory line under the field (web <c>t('playground.authHint')</c>).</param>
/// <param name="Value">The current API-key value (kept across endpoint changes, as on the web).</param>
/// <param name="AutomationName">The Narrator name for the API-key field.</param>
public sealed record RequestAuthSectionDisplay(
    string Title,
    string FieldLabel,
    string Hint,
    string Note,
    string Value,
    string AutomationName);

/// <summary>
/// The render-ready destructive-action confirmation — the native projection of the web confirm banner shown
/// when a non-GET request is armed (<c>{confirmOpen &amp;&amp; …}</c> in
/// web/src/features/admin/components/RequestBuilder.tsx). Pure data — no WinUI types.
/// </summary>
/// <param name="Visible">Whether the banner is shown (web <c>confirmOpen</c>).</param>
/// <param name="Message">The localized, method-interpolated prompt (web <c>t('playground.confirmDestructive', { method })</c>).</param>
/// <param name="ConfirmLabel">The confirm-button label (web <c>t('playground.confirmYes')</c>).</param>
/// <param name="CancelLabel">The cancel-button label (web <c>t('playground.cancel')</c>).</param>
public sealed record RequestConfirmDisplay(
    bool Visible,
    string Message,
    string ConfirmLabel,
    string CancelLabel);

/// <summary>
/// The fully projected, render-ready view of the whole RequestBuilder surface — the native analogue of the
/// web <c>RequestBuilder</c> render output (web/src/features/admin/components/RequestBuilder.tsx). Carries the
/// URL bar (method badge + <c>/api/v1</c>-prefixed path + send button), the destructive-confirm banner, the
/// optional summary / description lines, the optional path / query / body panels (each present only when the
/// endpoint declares them, mirroring the web conditional renders), and the always-present authentication
/// panel. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="MethodLabel">The uppercase verb shown in the URL-bar badge (web <c>MethodBadge</c>).</param>
/// <param name="MethodBrushKey">The design-token brush key tinting the badge (web <c>METHOD_COLORS</c>).</param>
/// <param name="UrlText">The display URL with the <c>/api/v1</c> prefix (web <c>/api/v1{buildUrl()}</c>).</param>
/// <param name="Url">The built path without the prefix (web <c>buildUrl()</c>), echoed on send.</param>
/// <param name="SendLabel">The send-button label (web <c>{loading ? t('sending') : t('send')}</c>).</param>
/// <param name="SendDisabled">Whether the send button is disabled (web <c>disabled={loading}</c>).</param>
/// <param name="SendAutomationName">The Narrator name for the send button.</param>
/// <param name="Confirm">The destructive-confirm banner projection.</param>
/// <param name="Summary">The endpoint summary line, or null when absent (web <c>{endpoint.summary &amp;&amp; …}</c>).</param>
/// <param name="Description">The endpoint description line, or null when absent or equal to the summary.</param>
/// <param name="PathParams">The path-parameter panel, or null when none are declared.</param>
/// <param name="QueryParams">The query-parameter panel, or null when none are declared.</param>
/// <param name="Body">The request-body panel, or null when the endpoint declares no body.</param>
/// <param name="Auth">The always-present authentication panel.</param>
/// <param name="AutomationName">The Narrator name for the surface region (the method + URL).</param>
public sealed record RequestBuilderDisplay(
    string MethodLabel,
    string MethodBrushKey,
    string UrlText,
    string Url,
    string SendLabel,
    bool SendDisabled,
    string SendAutomationName,
    RequestConfirmDisplay Confirm,
    string? Summary,
    string? Description,
    RequestParamSectionDisplay? PathParams,
    RequestParamSectionDisplay? QueryParams,
    RequestBodySectionDisplay? Body,
    RequestAuthSectionDisplay Auth,
    string AutomationName);

/// <summary>
/// The pure projection + request-building helpers behind the WinUI <see cref="RequestBuilder"/> view — the
/// native port of the web <c>RequestBuilder</c> body (the <c>buildUrl</c> memo, the endpoint-change reset, the
/// destructive-send guard and the section render) in web/src/features/admin/components/RequestBuilder.tsx.
/// Every owned string resolves through the i18n facade using the web's exact keys; the URL building, default
/// seeding, header assembly and per-section render mirror the web branch-for-branch. No SI conversion applies
/// — the surface carries no measurements, only the operator's raw request fields.
/// </summary>
public static class RequestBuilderProjection
{
    /// <summary>i18n key for the send-button label (web <c>t('playground.send', 'Send')</c>).</summary>
    public const string SendKey = "translation.playground.send";

    /// <summary>English fallback for <see cref="SendKey"/>.</summary>
    public const string SendFallback = "Send";

    /// <summary>i18n key for the sending-state label (web <c>t('playground.sending', 'Sending...')</c>).</summary>
    public const string SendingKey = "translation.playground.sending";

    /// <summary>English fallback for <see cref="SendingKey"/>.</summary>
    public const string SendingFallback = "Sending...";

    /// <summary>i18n key for the path-parameters header (web <c>t('playground.pathParams', 'Path Parameters')</c>).</summary>
    public const string PathParamsKey = "translation.playground.pathParams";

    /// <summary>English fallback for <see cref="PathParamsKey"/>.</summary>
    public const string PathParamsFallback = "Path Parameters";

    /// <summary>i18n key for the query-parameters header (web <c>t('playground.queryParams', 'Query Parameters')</c>).</summary>
    public const string QueryParamsKey = "translation.playground.queryParams";

    /// <summary>English fallback for <see cref="QueryParamsKey"/>.</summary>
    public const string QueryParamsFallback = "Query Parameters";

    /// <summary>i18n key for the request-body header (web <c>t('playground.requestBody', 'Request Body')</c>).</summary>
    public const string RequestBodyKey = "translation.playground.requestBody";

    /// <summary>English fallback for <see cref="RequestBodyKey"/>.</summary>
    public const string RequestBodyFallback = "Request Body";

    /// <summary>i18n key for the auth header (web <c>t('playground.authHeader', 'Authentication (Optional)')</c>).</summary>
    public const string AuthHeaderKey = "translation.playground.authHeader";

    /// <summary>English fallback for <see cref="AuthHeaderKey"/>.</summary>
    public const string AuthHeaderFallback = "Authentication (Optional)";

    /// <summary>i18n key for the API-key field hint (the empty-input hint).</summary>
    public const string ApiKeyHintKey = "translation.playground.apiKeyPlaceholder"; // parity:allow web-parity i18n key id mirrors web catalog key name (ADR-014)

    /// <summary>English fallback for <see cref="ApiKeyHintKey"/>.</summary>
    public const string ApiKeyHintFallback = "Leave empty to use session auth";

    /// <summary>i18n key for the auth hint line (web <c>t('playground.authHint', …)</c>).</summary>
    public const string AuthHintKey = "translation.playground.authHint";

    /// <summary>English fallback for <see cref="AuthHintKey"/>.</summary>
    public const string AuthHintFallback =
        "Requests use your browser session by default. Enter an API key to test key-based auth.";

    /// <summary>i18n key for the destructive-confirm prompt (web <c>t('playground.confirmDestructive', …, { method })</c>).</summary>
    public const string ConfirmDestructiveKey = "translation.playground.confirmDestructive";

    /// <summary>English fallback for <see cref="ConfirmDestructiveKey"/> (the i18next <c>{{method}}</c> slot).</summary>
    public const string ConfirmDestructiveFallback =
        "This is a {{method}} request. Are you sure you want to send it?";

    /// <summary>i18n key for the confirm button (web <c>t('playground.confirmYes', 'Yes, send')</c>).</summary>
    public const string ConfirmYesKey = "translation.playground.confirmYes";

    /// <summary>English fallback for <see cref="ConfirmYesKey"/>.</summary>
    public const string ConfirmYesFallback = "Yes, send";

    /// <summary>i18n key for the cancel button (web <c>t('playground.cancel', 'Cancel')</c>).</summary>
    public const string CancelKey = "translation.playground.cancel";

    /// <summary>English fallback for <see cref="CancelKey"/>.</summary>
    public const string CancelFallback = "Cancel";

    /// <summary>i18n key for the required-field a11y marker (shared <c>translation.form.required</c>).</summary>
    public const string RequiredKey = "translation.form.required";

    /// <summary>English fallback for <see cref="RequiredKey"/>.</summary>
    public const string RequiredFallback = "required";

    /// <summary>The literal header-name label rendered by the auth panel (web literal <c>X-API-Key</c>).</summary>
    public const string ApiKeyHeaderName = "X-API-Key";

    /// <summary>The literal request-header key set when the auth field is used (web <c>headers['X-API-Key']</c>).</summary>
    public const string ApiKeyHeader = "X-API-Key";

    /// <summary>The literal body-editor hint (web <c>'{ "key": "value" }'</c>).</summary>
    public const string BodyHint = "{ \"key\": \"value\" }";

    /// <summary>The display prefix the API gateway adds (web <c>/api/v1{buildUrl()}</c>).</summary>
    public const string ApiPrefix = "/api/v1";

    /// <summary>The body seeded when an endpoint declares a body but carries no example (web <c>'{\n  \n}'</c>).</summary>
    public const string EmptyBodyTemplate = "{\n  \n}";

    private static readonly JsonSerializerOptions IndentedJson = new() { WriteIndented = true };

    /// <summary>
    /// Build the request path from the endpoint template and the current field values — the native port of the
    /// web <c>buildUrl</c> memo. Each <c>{name}</c> path token is replaced by its value, or kept verbatim
    /// when the value is blank (web <c>params[p.name] || `{${p.name}}`</c>); each query parameter that has a
    /// non-blank value is appended as a URL-encoded <c>name=value</c> pair in declaration order. The result
    /// carries no <c>/api/v1</c> prefix (that is display-only).
    /// </summary>
    /// <param name="endpoint">The endpoint whose path + parameters drive the URL.</param>
    /// <param name="values">The current field values keyed by parameter name.</param>
    public static string BuildUrl(ParsedEndpoint endpoint, IReadOnlyDictionary<string, string> values)
    {
        ArgumentNullException.ThrowIfNull(endpoint);
        ArgumentNullException.ThrowIfNull(values);

        string url = endpoint.Path ?? string.Empty;

        foreach (ParsedParam parameter in endpoint.Parameters)
        {
            if (parameter.In != ParamLocation.Path)
            {
                continue;
            }

            string token = string.Concat("{", parameter.Name, "}");
            string value = values.GetValueOrDefault(parameter.Name, string.Empty);
            string replacement = string.IsNullOrEmpty(value) ? token : value;
            url = url.Replace(token, replacement, StringComparison.Ordinal);
        }

        var query = new List<string>();
        foreach (ParsedParam parameter in endpoint.Parameters)
        {
            if (parameter.In != ParamLocation.Query)
            {
                continue;
            }

            string value = values.GetValueOrDefault(parameter.Name, string.Empty);
            if (string.IsNullOrEmpty(value))
            {
                continue;
            }

            query.Add(string.Concat(parameter.Name, "=", Uri.EscapeDataString(value)));
        }

        return query.Count > 0 ? string.Concat(url, "?", string.Join("&", query)) : url;
    }

    /// <summary>
    /// Seed the field values from the endpoint's parameter defaults — the native port of the web endpoint-change
    /// <c>useEffect</c> that builds <c>defaults</c> from <c>p.default</c>. Only parameters with a non-null
    /// default contribute an entry (web <c>if (p.default != null) defaults[p.name] = String(p.default)</c>).
    /// </summary>
    /// <param name="endpoint">The endpoint whose parameter defaults seed the form.</param>
    public static IReadOnlyDictionary<string, string> BuildInitialValues(ParsedEndpoint endpoint)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (ParsedParam parameter in endpoint.Parameters)
        {
            if (parameter.Default is not null)
            {
                values[parameter.Name] = parameter.Default;
            }
        }

        return values;
    }

    /// <summary>
    /// Seed the request-body editor for an endpoint — the native port of the web endpoint-change
    /// <c>useEffect</c> body branch: the pretty-printed example when one exists
    /// (web <c>JSON.stringify(example, null, 2)</c>), the two-line empty template when a body is declared with
    /// no example (web <c>'{\n  \n}'</c>), or an empty string when the endpoint declares no body.
    /// </summary>
    /// <param name="endpoint">The endpoint whose request body seeds the editor.</param>
    public static string BuildInitialBody(ParsedEndpoint endpoint)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        if (endpoint.RequestBody is not { } body)
        {
            return string.Empty;
        }

        if (body.Example is { } example)
        {
            return PrettyPrint(example);
        }

        return EmptyBodyTemplate;
    }

    /// <summary>
    /// Assemble the outgoing request headers — the native port of the web <c>handleSend</c> header block: an
    /// <c>X-API-Key</c> entry only when the auth field has a non-blank, trimmed value
    /// (web <c>if (apiKey.trim()) headers['X-API-Key'] = apiKey.trim()</c>).
    /// </summary>
    /// <param name="apiKey">The raw API-key field value.</param>
    public static IReadOnlyDictionary<string, string> BuildHeaders(string? apiKey)
    {
        var headers = new Dictionary<string, string>(StringComparer.Ordinal);
        string trimmed = (apiKey ?? string.Empty).Trim();
        if (trimmed.Length > 0)
        {
            headers[ApiKeyHeader] = trimmed;
        }

        return headers;
    }

    /// <summary>
    /// Whether the endpoint is destructive — the native port of the web <c>isDestructive = endpoint.method !==
    /// 'GET'</c>. A destructive request arms the confirm banner before it is sent.
    /// </summary>
    /// <param name="endpoint">The endpoint to classify.</param>
    public static bool IsDestructive(ParsedEndpoint endpoint)
    {
        ArgumentNullException.ThrowIfNull(endpoint);
        return endpoint.Method != EndpointMethod.Get;
    }

    /// <summary>
    /// Whether two endpoints are the same selection — the path + method identity (mirroring the sibling
    /// <see cref="EndpointSidebarProjection.IsSameEndpoint"/>). Used by the view-model to decide whether an
    /// endpoint change should reset the form, the native analogue of the web <c>useEffect([endpoint])</c>
    /// dependency comparison.
    /// </summary>
    /// <param name="a">The first endpoint.</param>
    /// <param name="b">The second endpoint.</param>
    public static bool SameEndpoint(ParsedEndpoint a, ParsedEndpoint b)
    {
        ArgumentNullException.ThrowIfNull(a);
        ArgumentNullException.ThrowIfNull(b);
        return string.Equals(a.Path, b.Path, StringComparison.Ordinal) && a.Method == b.Method;
    }

    /// <summary>
    /// Assemble the request the view-model echoes to the <c>onSend</c> callback — the native port of the web
    /// <c>onSend(buildUrl(), endpoint.method, body || undefined, headers)</c>. The body is null when the editor
    /// is empty and the headers carry <c>X-API-Key</c> only when the auth field is set.
    /// </summary>
    /// <param name="endpoint">The endpoint being sent.</param>
    /// <param name="values">The current field values.</param>
    /// <param name="body">The current body text.</param>
    /// <param name="apiKey">The current API-key value.</param>
    public static OutgoingRequest BuildOutgoing(
        ParsedEndpoint endpoint,
        IReadOnlyDictionary<string, string> values,
        string? body,
        string? apiKey)
    {
        ArgumentNullException.ThrowIfNull(endpoint);
        ArgumentNullException.ThrowIfNull(values);

        string url = BuildUrl(endpoint, values);
        string method = EndpointMethods.Label(endpoint.Method);
        string? payload = string.IsNullOrEmpty(body) ? null : body;
        return new OutgoingRequest(url, method, payload, BuildHeaders(apiKey));
    }

    /// <summary>
    /// Interpolate the destructive-confirm prompt with the verb — the native port of the web
    /// <c>t('playground.confirmDestructive', …, { method })</c>. Substitutes both the i18next <c>{{method}}</c>
    /// slot (the English fallback / headless form) and the resw catalog's positional <c>{0}</c> form so the
    /// prompt is correct in both production and tests.
    /// </summary>
    /// <param name="localizer">The i18n facade resolving the template.</param>
    /// <param name="method">The uppercase verb to interpolate.</param>
    public static string ConfirmMessage(ILocalizer localizer, string method)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return localizer.GetString(ConfirmDestructiveKey, ConfirmDestructiveFallback)
            .Replace("{{method}}", method, StringComparison.Ordinal)
            .Replace("{0}", method, StringComparison.Ordinal);
    }

    /// <summary>
    /// Project the surface inputs into the render-ready <see cref="RequestBuilderDisplay"/>, resolving every
    /// owned string through <paramref name="localizer"/> and reproducing every web conditional render branch
    /// (summary, description, path / query / body panels) plus the loading and destructive-confirm chrome.
    /// </summary>
    /// <param name="endpoint">The selected endpoint (web <c>endpoint</c> prop).</param>
    /// <param name="values">The current field values keyed by parameter name.</param>
    /// <param name="body">The current request-body text.</param>
    /// <param name="apiKey">The current API-key value.</param>
    /// <param name="confirmOpen">Whether the destructive-confirm banner is armed (web <c>confirmOpen</c>).</param>
    /// <param name="loading">Whether a send is in flight (web <c>loading</c> prop).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public static RequestBuilderDisplay Project(
        ParsedEndpoint endpoint,
        IReadOnlyDictionary<string, string> values,
        string? body,
        string? apiKey,
        bool confirmOpen,
        bool loading,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(endpoint);
        ArgumentNullException.ThrowIfNull(values);
        ArgumentNullException.ThrowIfNull(localizer);

        string methodLabel = EndpointMethods.Label(endpoint.Method);
        string url = BuildUrl(endpoint, values);
        string urlText = string.Concat(ApiPrefix, url);

        string requiredWord = localizer.GetString(RequiredKey, RequiredFallback);

        RequestConfirmDisplay confirm = new(
            Visible: confirmOpen,
            Message: ConfirmMessage(localizer, methodLabel),
            ConfirmLabel: localizer.GetString(ConfirmYesKey, ConfirmYesFallback),
            CancelLabel: localizer.GetString(CancelKey, CancelFallback));

        string? summary = string.IsNullOrEmpty(endpoint.Summary) ? null : endpoint.Summary;
        string? description =
            !string.IsNullOrEmpty(endpoint.Description) &&
            !string.Equals(endpoint.Description, endpoint.Summary, StringComparison.Ordinal)
                ? endpoint.Description
                : null;

        RequestParamSectionDisplay? pathParams = ProjectParamSection(
            endpoint,
            ParamLocation.Path,
            localizer.GetString(PathParamsKey, PathParamsFallback),
            values,
            requiredWord);

        RequestParamSectionDisplay? queryParams = ProjectParamSection(
            endpoint,
            ParamLocation.Query,
            localizer.GetString(QueryParamsKey, QueryParamsFallback),
            values,
            requiredWord);

        RequestBodySectionDisplay? bodySection = endpoint.RequestBody is { } requestBody
            ? new RequestBodySectionDisplay(
                Title: localizer.GetString(RequestBodyKey, RequestBodyFallback),
                ContentType: requestBody.ContentType ?? string.Empty,
                Value: body ?? string.Empty,
                Hint: BodyHint,
                AutomationName: localizer.GetString(RequestBodyKey, RequestBodyFallback))
            : null;

        string authTitle = localizer.GetString(AuthHeaderKey, AuthHeaderFallback);
        RequestAuthSectionDisplay auth = new(
            Title: authTitle,
            FieldLabel: ApiKeyHeaderName,
            Hint: localizer.GetString(ApiKeyHintKey, ApiKeyHintFallback),
            Note: localizer.GetString(AuthHintKey, AuthHintFallback),
            Value: apiKey ?? string.Empty,
            AutomationName: ApiKeyHeaderName);

        string sendLabel = loading
            ? localizer.GetString(SendingKey, SendingFallback)
            : localizer.GetString(SendKey, SendFallback);

        string regionName = string.Create(CultureInfo.InvariantCulture, $"{methodLabel} {urlText}");

        return new RequestBuilderDisplay(
            MethodLabel: methodLabel,
            MethodBrushKey: EndpointMethods.BrushKey(endpoint.Method),
            UrlText: urlText,
            Url: url,
            SendLabel: sendLabel,
            SendDisabled: loading,
            SendAutomationName: sendLabel,
            Confirm: confirm,
            Summary: summary,
            Description: description,
            PathParams: pathParams,
            QueryParams: queryParams,
            Body: bodySection,
            Auth: auth,
            AutomationName: regionName);
    }

    /// <summary>
    /// Project one parameter panel for a location, or null when the endpoint declares no parameter there — the
    /// native port of the web <c>{pathParams.length > 0 &amp;&amp; …}</c> / <c>{queryParams.length > 0 &amp;&amp; …}</c>
    /// guards.
    /// </summary>
    /// <param name="endpoint">The endpoint whose parameters are projected.</param>
    /// <param name="location">The parameter location to project (path or query).</param>
    /// <param name="title">The localized panel header.</param>
    /// <param name="values">The current field values.</param>
    /// <param name="requiredWord">The localized "required" a11y word.</param>
    public static RequestParamSectionDisplay? ProjectParamSection(
        ParsedEndpoint endpoint,
        ParamLocation location,
        string title,
        IReadOnlyDictionary<string, string> values,
        string requiredWord)
    {
        ArgumentNullException.ThrowIfNull(endpoint);
        ArgumentNullException.ThrowIfNull(values);

        var fields = new List<RequestParamFieldDisplay>();
        foreach (ParsedParam parameter in endpoint.Parameters)
        {
            if (parameter.In != location)
            {
                continue;
            }

            fields.Add(ProjectField(parameter, location, values, requiredWord));
        }

        return fields.Count > 0 ? new RequestParamSectionDisplay(title, fields) : null;
    }

    /// <summary>
    /// Project one parameter field — the native port of a web path/query parameter row. A path parameter always
    /// shows the required marker (web unconditional <c>*</c>); a query parameter shows it only when
    /// <see cref="ParsedParam.Required"/> (web <c>{p.required &amp;&amp; *}</c>). The hint mirrors the web
    /// <c>p.description || p.type</c> with the query default suffix.
    /// </summary>
    /// <param name="parameter">The parameter to project.</param>
    /// <param name="location">The parameter location (drives the required marker and hint).</param>
    /// <param name="values">The current field values.</param>
    /// <param name="requiredWord">The localized "required" a11y word.</param>
    public static RequestParamFieldDisplay ProjectField(
        ParsedParam parameter,
        ParamLocation location,
        IReadOnlyDictionary<string, string> values,
        string requiredWord)
    {
        ArgumentNullException.ThrowIfNull(parameter);
        ArgumentNullException.ThrowIfNull(values);

        bool showMarker = location == ParamLocation.Path || parameter.Required;
        string value = values.GetValueOrDefault(parameter.Name, string.Empty);
        string hint = BuildHint(parameter, location);

        string automationName = showMarker
            ? string.Create(CultureInfo.InvariantCulture, $"{parameter.Name}, {requiredWord}")
            : parameter.Name;

        return new RequestParamFieldDisplay(
            Name: parameter.Name,
            Label: parameter.Name,
            ShowRequiredMarker: showMarker,
            Hint: hint,
            Value: value,
            AutomationName: automationName);
    }

    /// <summary>
    /// The empty-field hint — the native port of the web <c>p.description || p.type</c> (path) and
    /// <c>p.description || `${p.type}${p.default != null ? ` (default: ${p.default})` : ''}`</c> (query).
    /// </summary>
    private static string BuildHint(ParsedParam parameter, ParamLocation location)
    {
        if (!string.IsNullOrEmpty(parameter.Description))
        {
            return parameter.Description;
        }

        string type = parameter.Type ?? string.Empty;
        if (location == ParamLocation.Query && parameter.Default is { } def)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{type} (default: {def})");
        }

        return type;
    }

    /// <summary>
    /// Pretty-print a request-body example the way the web seed does (<c>JSON.stringify(example, null, 2)</c>) —
    /// a two-space-indented JSON document. A value that cannot be serialized falls back to its string form so
    /// the editor is never seeded blank when an example exists.
    /// </summary>
    /// <param name="example">The example payload carried by the endpoint's request body.</param>
    public static string PrettyPrint(object example)
    {
        ArgumentNullException.ThrowIfNull(example);

        try
        {
            return JsonSerializer.Serialize(example, IndentedJson);
        }
        catch (NotSupportedException)
        {
            return example.ToString() ?? string.Empty;
        }
    }
}

/// <summary>
/// Canonical metadata for the RequestBuilder surface — the native anchor for the web component at
/// web/src/features/admin/components/RequestBuilder.tsx. The diagnostics <see cref="Slug"/> is the stable
/// surface name emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract).
/// </summary>
public static class RequestBuilderRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "RequestBuilder";
}

/// <summary>
/// PII-safe diagnostics for the RequestBuilder surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the endpoint path, the request body, the
/// API key or any field value — so a diagnostics line can never leak an API surface detail or an operator
/// secret. Thread-safe.
/// </summary>
public sealed class RequestBuilderDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public RequestBuilderDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RequestBuilder</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RequestBuilderRegistration.Slug}");
    }
}
