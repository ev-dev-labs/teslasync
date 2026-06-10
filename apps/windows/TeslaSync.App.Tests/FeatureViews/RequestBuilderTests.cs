using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Endpoints;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the RequestBuilder feature-view's UI-thread-free logic — the URL builder, the
/// default / body / header adapters, the destructive-send guard, the per-state projection (loading, confirm,
/// summary / description, path / query / body panels, auth), the i18n routing, the accessibility names, the
/// state-holder view-model's transitions, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/RequestBuilder.tsx). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class RequestBuilderTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static readonly IReadOnlyDictionary<string, ParsedResponse> NoResponses =
        new Dictionary<string, ParsedResponse>(StringComparer.Ordinal);

    // GET with one path param, two query params (one defaulted), no body.
    private static ParsedEndpoint GetEndpoint() => new(
        EndpointMethod.Get,
        "/vehicles/{id}/state",
        "Vehicles",
        "Vehicle state",
        "The current vehicle state",
        "vehicleState",
        new[]
        {
            new ParsedParam("id", ParamLocation.Path, true, "string", "The vehicle id"),
            new ParsedParam("limit", ParamLocation.Query, false, "integer", string.Empty, "100"),
            new ParsedParam("offset", ParamLocation.Query, true, "integer", string.Empty),
        },
        null,
        NoResponses);

    // POST with one path param and a body example (destructive).
    private static ParsedEndpoint PostEndpoint() => new(
        EndpointMethod.Post,
        "/vehicles/{id}/charging/start",
        "Charging",
        "Start charging",
        "Start charging",
        "startCharging",
        new[] { new ParsedParam("id", ParamLocation.Path, true, "string", "The vehicle id") },
        new ParsedBody("application/json", new Dictionary<string, object?> { ["amps"] = 16 }),
        NoResponses);

    // DELETE with a path param and a declared body without an example (destructive).
    private static ParsedEndpoint DeleteEndpoint() => new(
        EndpointMethod.Delete,
        "/alerts/{alertId}",
        "Alerts",
        string.Empty,
        string.Empty,
        "deleteAlert",
        new[] { new ParsedParam("alertId", ParamLocation.Path, true, "string", string.Empty) },
        new ParsedBody("application/json"),
        NoResponses);

    // GET with no parameters and no body — the minimal surface.
    private static ParsedEndpoint BareEndpoint() => new(
        EndpointMethod.Get,
        "/system/status",
        "System",
        string.Empty,
        string.Empty,
        "systemStatus",
        Array.Empty<ParsedParam>(),
        null,
        NoResponses);

    private static Dictionary<string, string> Values(params (string Key, string Value)[] pairs)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach ((string key, string value) in pairs)
        {
            map[key] = value;
        }

        return map;
    }

    // ---- BuildUrl (web `buildUrl` memo) --------------------------------------------

    [Fact]
    public void BuildUrl_substitutes_filled_path_param()
    {
        string url = RequestBuilderProjection.BuildUrl(GetEndpoint(), Values(("id", "5")));
        Assert.Equal("/vehicles/5/state", url);
    }

    [Fact]
    public void BuildUrl_keeps_token_for_blank_path_param()
    {
        string url = RequestBuilderProjection.BuildUrl(GetEndpoint(), Values());
        Assert.Equal("/vehicles/{id}/state", url);
    }

    [Fact]
    public void BuildUrl_appends_nonblank_query_params_in_declaration_order()
    {
        string url = RequestBuilderProjection.BuildUrl(
            GetEndpoint(), Values(("id", "5"), ("limit", "10"), ("offset", "20")));
        Assert.Equal("/vehicles/5/state?limit=10&offset=20", url);
    }

    [Fact]
    public void BuildUrl_skips_blank_query_params()
    {
        string url = RequestBuilderProjection.BuildUrl(
            GetEndpoint(), Values(("id", "5"), ("limit", "10")));
        Assert.Equal("/vehicles/5/state?limit=10", url);
    }

    [Fact]
    public void BuildUrl_url_encodes_query_values()
    {
        string url = RequestBuilderProjection.BuildUrl(
            GetEndpoint(), Values(("id", "5"), ("limit", "a b&c")));
        Assert.Equal("/vehicles/5/state?limit=a%20b%26c", url);
    }

    [Fact]
    public void BuildUrl_rejects_null_endpoint() =>
        Assert.Throws<ArgumentNullException>(() => RequestBuilderProjection.BuildUrl(null!, Values()));

    [Fact]
    public void BuildUrl_rejects_null_values() =>
        Assert.Throws<ArgumentNullException>(() => RequestBuilderProjection.BuildUrl(GetEndpoint(), null!));

    // ---- BuildInitialValues (web endpoint-change `defaults`) ------------------------

    [Fact]
    public void BuildInitialValues_seeds_only_defaulted_params()
    {
        var values = RequestBuilderProjection.BuildInitialValues(GetEndpoint());
        Assert.Equal("100", Assert.Contains("limit", values));
        Assert.False(values.ContainsKey("id"));
        Assert.False(values.ContainsKey("offset"));
        Assert.Single(values);
    }

    // ---- BuildInitialBody (web endpoint-change body branch) ------------------------

    [Fact]
    public void BuildInitialBody_pretty_prints_example()
    {
        string body = RequestBuilderProjection.BuildInitialBody(PostEndpoint());
        Assert.StartsWith("{", body, StringComparison.Ordinal);
        Assert.Contains("\"amps\": 16", body, StringComparison.Ordinal);
        Assert.Contains("\n", body, StringComparison.Ordinal);
    }

    [Fact]
    public void BuildInitialBody_uses_empty_template_when_body_has_no_example()
    {
        string body = RequestBuilderProjection.BuildInitialBody(DeleteEndpoint());
        Assert.Equal(RequestBuilderProjection.EmptyBodyTemplate, body);
    }

    [Fact]
    public void BuildInitialBody_is_empty_when_no_body()
    {
        string body = RequestBuilderProjection.BuildInitialBody(GetEndpoint());
        Assert.Equal(string.Empty, body);
    }

    // ---- BuildHeaders (web `handleSend` header block) ------------------------------

    [Fact]
    public void BuildHeaders_sets_api_key_when_present()
    {
        var headers = RequestBuilderProjection.BuildHeaders("secret");
        Assert.Equal("secret", Assert.Contains(RequestBuilderProjection.ApiKeyHeader, headers));
    }

    [Fact]
    public void BuildHeaders_trims_api_key()
    {
        var headers = RequestBuilderProjection.BuildHeaders("  secret  ");
        Assert.Equal("secret", headers[RequestBuilderProjection.ApiKeyHeader]);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void BuildHeaders_blank_yields_no_headers(string? key) =>
        Assert.Empty(RequestBuilderProjection.BuildHeaders(key));

    // ---- IsDestructive / SameEndpoint ----------------------------------------------

    [Fact]
    public void IsDestructive_is_false_for_get() => Assert.False(RequestBuilderProjection.IsDestructive(GetEndpoint()));

    [Theory]
    [InlineData(EndpointMethod.Post)]
    [InlineData(EndpointMethod.Put)]
    [InlineData(EndpointMethod.Delete)]
    [InlineData(EndpointMethod.Patch)]
    public void IsDestructive_is_true_for_non_get(EndpointMethod method)
    {
        var endpoint = ParsedEndpoint.ForList(method, "/x", "Tag");
        Assert.True(RequestBuilderProjection.IsDestructive(endpoint));
    }

    [Fact]
    public void SameEndpoint_matches_on_path_and_method()
    {
        Assert.True(RequestBuilderProjection.SameEndpoint(GetEndpoint(), GetEndpoint()));
        Assert.False(RequestBuilderProjection.SameEndpoint(GetEndpoint(), PostEndpoint()));
        Assert.False(RequestBuilderProjection.SameEndpoint(
            ParsedEndpoint.ForList(EndpointMethod.Get, "/a", "T"),
            ParsedEndpoint.ForList(EndpointMethod.Post, "/a", "T")));
    }

    // ---- BuildOutgoing (web `onSend(...)`) -----------------------------------------

    [Fact]
    public void BuildOutgoing_assembles_url_method_body_and_headers()
    {
        var request = RequestBuilderProjection.BuildOutgoing(
            PostEndpoint(), Values(("id", "7")), "{\"amps\":16}", "key123");

        Assert.Equal("/vehicles/7/charging/start", request.Url);
        Assert.Equal("POST", request.Method);
        Assert.Equal("{\"amps\":16}", request.Body);
        Assert.Equal("key123", request.Headers[RequestBuilderProjection.ApiKeyHeader]);
    }

    [Fact]
    public void BuildOutgoing_null_body_for_empty_box()
    {
        var request = RequestBuilderProjection.BuildOutgoing(GetEndpoint(), Values(("id", "7")), string.Empty, null);
        Assert.Null(request.Body);
        Assert.Empty(request.Headers);
        Assert.Equal("GET", request.Method);
    }

    // ---- ConfirmMessage (web `t('confirmDestructive', { method })`) ----------------

    [Fact]
    public void ConfirmMessage_substitutes_double_brace_method()
    {
        string message = RequestBuilderProjection.ConfirmMessage(Localizer, "POST");
        Assert.Equal("This is a POST request. Are you sure you want to send it?", message);
    }

    [Fact]
    public void ConfirmMessage_substitutes_positional_resw_form()
    {
        // The resw catalog stores the indexed {0} form; both forms must resolve.
        string message = RequestBuilderProjection.ConfirmMessage(new TemplateLocalizer("Send a {0} request now"), "DELETE");
        Assert.Equal("Send a DELETE request now", message);
    }

    // ---- Projection: URL bar + send chrome -----------------------------------------

    [Fact]
    public void Project_url_bar_prefixes_api_v1_and_exposes_raw_url()
    {
        var display = Project(GetEndpoint(), Values(("id", "5")));
        Assert.Equal("GET", display.MethodLabel);
        Assert.Equal("TsColorSuccessBrush", display.MethodBrushKey);
        Assert.Equal("/vehicles/5/state", display.Url);
        Assert.Equal("/api/v1/vehicles/5/state", display.UrlText);
    }

    [Fact]
    public void Project_send_label_idle_and_loading()
    {
        var idle = Project(GetEndpoint(), Values());
        Assert.Equal("Send", idle.SendLabel);
        Assert.False(idle.SendDisabled);

        var loading = Project(GetEndpoint(), Values(), loading: true);
        Assert.Equal("Sending...", loading.SendLabel);
        Assert.True(loading.SendDisabled);
    }

    // ---- Projection: destructive confirm -------------------------------------------

    [Fact]
    public void Project_confirm_hidden_by_default()
    {
        var display = Project(PostEndpoint(), Values());
        Assert.False(display.Confirm.Visible);
    }

    [Fact]
    public void Project_confirm_visible_carries_interpolated_message_and_labels()
    {
        var display = Project(PostEndpoint(), Values(), confirmOpen: true);
        Assert.True(display.Confirm.Visible);
        Assert.Equal("This is a POST request. Are you sure you want to send it?", display.Confirm.Message);
        Assert.Equal("Yes, send", display.Confirm.ConfirmLabel);
        Assert.Equal("Cancel", display.Confirm.CancelLabel);
    }

    // ---- Projection: summary + description -----------------------------------------

    [Fact]
    public void Project_shows_summary_and_distinct_description()
    {
        var display = Project(GetEndpoint(), Values());
        Assert.Equal("Vehicle state", display.Summary);
        Assert.Equal("The current vehicle state", display.Description);
    }

    [Fact]
    public void Project_hides_description_equal_to_summary()
    {
        var endpoint = new ParsedEndpoint(
            EndpointMethod.Get, "/x", "Tag", "Same", "Same", "op",
            Array.Empty<ParsedParam>(), null, NoResponses);
        var display = Project(endpoint, Values());
        Assert.Equal("Same", display.Summary);
        Assert.Null(display.Description);
    }

    [Fact]
    public void Project_hides_blank_summary_and_description()
    {
        var display = Project(BareEndpoint(), Values());
        Assert.Null(display.Summary);
        Assert.Null(display.Description);
    }

    // ---- Projection: path / query / body / auth panels -----------------------------

    [Fact]
    public void Project_path_and_query_panels_present_body_absent_for_get()
    {
        var display = Project(GetEndpoint(), Values());

        Assert.NotNull(display.PathParams);
        Assert.Equal("Path Parameters", display.PathParams!.Title);
        Assert.Equal("id", Assert.Single(display.PathParams.Fields).Name);

        Assert.NotNull(display.QueryParams);
        Assert.Equal("Query Parameters", display.QueryParams!.Title);
        Assert.Equal(2, display.QueryParams.Fields.Count);

        Assert.Null(display.Body);
    }

    [Fact]
    public void Project_body_panel_present_for_post()
    {
        var display = Project(PostEndpoint(), Values());
        Assert.NotNull(display.Body);
        Assert.Equal("Request Body", display.Body!.Title);
        Assert.Equal("application/json", display.Body.ContentType);
        Assert.Equal(RequestBuilderProjection.BodyHint, display.Body.Hint);
    }

    [Fact]
    public void Project_bare_endpoint_hides_param_and_body_panels_but_keeps_auth()
    {
        var display = Project(BareEndpoint(), Values());
        Assert.Null(display.PathParams);
        Assert.Null(display.QueryParams);
        Assert.Null(display.Body);
        Assert.NotNull(display.Auth);
        Assert.Equal("Authentication (Optional)", display.Auth.Title);
        Assert.Equal("X-API-Key", display.Auth.FieldLabel);
        Assert.Equal("Leave empty to use session auth", display.Auth.Hint);
    }

    // ---- Projection: parameter fields (required marker + hint) ---------------------

    [Fact]
    public void Project_path_field_always_shows_required_marker()
    {
        var display = Project(GetEndpoint(), Values(("id", "9")));
        var field = Assert.Single(display.PathParams!.Fields);
        Assert.True(field.ShowRequiredMarker);
        Assert.Equal("id", field.Label);
        Assert.Equal("9", field.Value);
        Assert.Equal("The vehicle id", field.Hint); // description wins
    }

    [Fact]
    public void Project_query_field_marker_follows_required_flag_and_default_hint()
    {
        var display = Project(GetEndpoint(), Values());
        var limit = display.QueryParams!.Fields[0]; // limit: not required, default 100, no description
        var offset = display.QueryParams.Fields[1]; // offset: required, no default, no description

        Assert.False(limit.ShowRequiredMarker);
        Assert.Equal("integer (default: 100)", limit.Hint);

        Assert.True(offset.ShowRequiredMarker);
        Assert.Equal("integer", offset.Hint);
    }

    // ---- Projection: accessibility names -------------------------------------------

    [Fact]
    public void Project_region_name_reads_method_and_url()
    {
        var display = Project(GetEndpoint(), Values(("id", "5")));
        Assert.Equal("GET /api/v1/vehicles/5/state", display.AutomationName);
        Assert.Equal(display.SendLabel, display.SendAutomationName);
    }

    [Fact]
    public void Project_required_field_name_announces_required()
    {
        var display = Project(GetEndpoint(), Values());
        var id = Assert.Single(display.PathParams!.Fields);
        Assert.Equal("id, required", id.AutomationName);

        var limit = display.QueryParams!.Fields[0];
        Assert.Equal("limit", limit.AutomationName); // optional → name only
    }

    [Fact]
    public void Project_body_and_auth_carry_automation_names()
    {
        var display = Project(PostEndpoint(), Values());
        Assert.Equal("Request Body", display.Body!.AutomationName);
        Assert.Equal("X-API-Key", display.Auth.AutomationName);
    }

    // ---- Projection: i18n routing + key parity -------------------------------------

    [Fact]
    public void Project_routes_owned_strings_through_localizer()
    {
        var display = Project(GetEndpoint(), Values(), localizer: new PrefixLocalizer());

        Assert.Equal("L:translation.playground.send", display.SendLabel);
        Assert.Equal("L:translation.playground.pathParams", display.PathParams!.Title);
        Assert.Equal("L:translation.playground.queryParams", display.QueryParams!.Title);
        Assert.Equal("L:translation.playground.authHeader", display.Auth.Title);
        Assert.Equal("L:translation.playground.confirmYes", display.Confirm.ConfirmLabel);
        Assert.Equal("L:translation.playground.cancel", display.Confirm.CancelLabel);
    }

    [Fact]
    public void Projection_keys_match_the_web_source()
    {
        Assert.Equal("translation.playground.send", RequestBuilderProjection.SendKey);
        Assert.Equal("translation.playground.sending", RequestBuilderProjection.SendingKey);
        Assert.Equal("translation.playground.pathParams", RequestBuilderProjection.PathParamsKey);
        Assert.Equal("translation.playground.queryParams", RequestBuilderProjection.QueryParamsKey);
        Assert.Equal("translation.playground.requestBody", RequestBuilderProjection.RequestBodyKey);
        Assert.Equal("translation.playground.authHeader", RequestBuilderProjection.AuthHeaderKey);
        Assert.Equal("translation.playground.apiKeyPlaceholder", RequestBuilderProjection.ApiKeyHintKey); // parity:allow web-parity i18n key id mirrors web catalog key name (ADR-014)
        Assert.Equal("translation.playground.authHint", RequestBuilderProjection.AuthHintKey);
        Assert.Equal("translation.playground.confirmDestructive", RequestBuilderProjection.ConfirmDestructiveKey);
        Assert.Equal("translation.playground.confirmYes", RequestBuilderProjection.ConfirmYesKey);
        Assert.Equal("translation.playground.cancel", RequestBuilderProjection.CancelKey);
    }

    [Fact]
    public void Projection_fallbacks_match_the_web_source()
    {
        Assert.Equal("Send", RequestBuilderProjection.SendFallback);
        Assert.Equal("Sending...", RequestBuilderProjection.SendingFallback);
        Assert.Equal("Path Parameters", RequestBuilderProjection.PathParamsFallback);
        Assert.Equal("Query Parameters", RequestBuilderProjection.QueryParamsFallback);
        Assert.Equal("Request Body", RequestBuilderProjection.RequestBodyFallback);
        Assert.Equal("Authentication (Optional)", RequestBuilderProjection.AuthHeaderFallback);
        Assert.Equal("Leave empty to use session auth", RequestBuilderProjection.ApiKeyHintFallback);
        Assert.Equal("Yes, send", RequestBuilderProjection.ConfirmYesFallback);
        Assert.Equal("Cancel", RequestBuilderProjection.CancelFallback);
    }

    // ---- Projection guards ----------------------------------------------------------

    [Fact]
    public void Project_rejects_null_endpoint() =>
        Assert.Throws<ArgumentNullException>(() =>
            RequestBuilderProjection.Project(null!, Values(), null, null, false, false, Localizer));

    [Fact]
    public void Project_rejects_null_values() =>
        Assert.Throws<ArgumentNullException>(() =>
            RequestBuilderProjection.Project(GetEndpoint(), null!, null, null, false, false, Localizer));

    [Fact]
    public void Project_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() =>
            RequestBuilderProjection.Project(GetEndpoint(), Values(), null, null, false, false, null!));

    // ---- View-model: seeding -------------------------------------------------------

    [Fact]
    public void ViewModel_seeds_values_and_body_from_endpoint()
    {
        var vm = new RequestBuilderViewModel(Localizer, PostEndpoint());

        Assert.Same(PostEndpoint().Path, vm.Endpoint.Path);
        Assert.StartsWith("{", vm.Body, StringComparison.Ordinal);
        Assert.Contains("\"amps\": 16", vm.Body, StringComparison.Ordinal);
        Assert.False(vm.ConfirmOpen);
        Assert.False(vm.Loading);
    }

    [Fact]
    public void ViewModel_seeds_query_default()
    {
        var vm = new RequestBuilderViewModel(Localizer, GetEndpoint());
        Assert.Equal("100", vm.Values["limit"]);
    }

    // ---- View-model: field edits ---------------------------------------------------

    [Fact]
    public void ViewModel_set_param_updates_url_and_raises_display()
    {
        var vm = new RequestBuilderViewModel(Localizer, GetEndpoint());
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.SetParam("id", "42");

        Assert.Equal("42", vm.Values["id"]);
        Assert.Equal("/vehicles/42/state?limit=100", vm.Display.Url);
        Assert.Contains(nameof(RequestBuilderViewModel.Display), raised);
    }

    [Fact]
    public void ViewModel_set_param_unchanged_is_noop()
    {
        var vm = new RequestBuilderViewModel(Localizer, GetEndpoint());
        bool raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.SetParam("limit", "100"); // already the default

        Assert.False(raised);
    }

    [Fact]
    public void ViewModel_set_body_and_api_key_are_silent_but_stored()
    {
        var vm = new RequestBuilderViewModel(Localizer, GetEndpoint());
        bool raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.SetBody("{\"a\":1}");
        vm.SetApiKey("secret");

        Assert.False(raised);
        Assert.Equal("{\"a\":1}", vm.Body);
        Assert.Equal("secret", vm.ApiKey);
        Assert.Equal("secret", vm.Display.Auth.Value);
    }

    // ---- View-model: loading -------------------------------------------------------

    [Fact]
    public void ViewModel_set_loading_raises_and_updates_send()
    {
        var vm = new RequestBuilderViewModel(Localizer, GetEndpoint());
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.SetLoading(true);

        Assert.True(vm.Loading);
        Assert.True(vm.Display.SendDisabled);
        Assert.Equal("Sending...", vm.Display.SendLabel);
        Assert.Contains(nameof(RequestBuilderViewModel.Loading), raised);
        Assert.Contains(nameof(RequestBuilderViewModel.Display), raised);
    }

    [Fact]
    public void ViewModel_set_loading_unchanged_is_noop()
    {
        var vm = new RequestBuilderViewModel(Localizer, GetEndpoint());
        bool raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.SetLoading(false);

        Assert.False(raised);
    }

    // ---- View-model: send (web handleSend) -----------------------------------------

    [Fact]
    public void ViewModel_get_sends_immediately_without_confirm()
    {
        var sent = new List<OutgoingRequest>();
        var vm = new RequestBuilderViewModel(Localizer, GetEndpoint(), sent.Add);
        vm.SetParam("id", "5");

        vm.RequestSend();

        var request = Assert.Single(sent);
        Assert.Equal("GET", request.Method);
        Assert.StartsWith("/vehicles/5/state", request.Url, StringComparison.Ordinal);
        Assert.Null(request.Body);
        Assert.Empty(request.Headers);
        Assert.False(vm.ConfirmOpen);
    }

    [Fact]
    public void ViewModel_destructive_first_send_arms_confirm_without_sending()
    {
        var sent = new List<OutgoingRequest>();
        var vm = new RequestBuilderViewModel(Localizer, PostEndpoint(), sent.Add);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.RequestSend();

        Assert.Empty(sent);
        Assert.True(vm.ConfirmOpen);
        Assert.True(vm.Display.Confirm.Visible);
        Assert.Contains(nameof(RequestBuilderViewModel.ConfirmOpen), raised);
    }

    [Fact]
    public void ViewModel_destructive_second_send_fires_callback_and_clears_confirm()
    {
        var sent = new List<OutgoingRequest>();
        var vm = new RequestBuilderViewModel(Localizer, PostEndpoint(), sent.Add);
        vm.SetParam("id", "8");
        vm.SetApiKey("k");

        vm.RequestSend(); // arms
        vm.RequestSend(); // sends

        var request = Assert.Single(sent);
        Assert.Equal("POST", request.Method);
        Assert.Equal("/vehicles/8/charging/start", request.Url);
        Assert.NotNull(request.Body);
        Assert.Equal("k", request.Headers[RequestBuilderProjection.ApiKeyHeader]);
        Assert.False(vm.ConfirmOpen);
    }

    [Fact]
    public void ViewModel_cancel_dismisses_confirm()
    {
        var vm = new RequestBuilderViewModel(Localizer, PostEndpoint());
        vm.RequestSend(); // arms
        Assert.True(vm.ConfirmOpen);

        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);
        vm.Cancel();

        Assert.False(vm.ConfirmOpen);
        Assert.Contains(nameof(RequestBuilderViewModel.ConfirmOpen), raised);
    }

    [Fact]
    public void ViewModel_cancel_when_not_armed_is_noop()
    {
        var vm = new RequestBuilderViewModel(Localizer, PostEndpoint());
        bool raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.Cancel();

        Assert.False(raised);
    }

    // ---- View-model: endpoint change (web endpoint-change effect) ------------------

    [Fact]
    public void ViewModel_set_endpoint_resets_form_but_keeps_api_key()
    {
        var vm = new RequestBuilderViewModel(Localizer, GetEndpoint());
        vm.SetParam("id", "5");
        vm.SetApiKey("persist-me");
        vm.RequestSend(); // GET sends; confirm stays closed — arm via a destructive swap below instead

        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.SetEndpoint(PostEndpoint());

        Assert.Equal("/vehicles/{id}/charging/start", vm.Display.Url);
        Assert.False(vm.Values.ContainsKey("id")); // reseeded from the new endpoint's defaults
        Assert.StartsWith("{", vm.Body, StringComparison.Ordinal); // new endpoint's example body
        Assert.Equal("persist-me", vm.ApiKey); // preserved
        Assert.Contains(nameof(RequestBuilderViewModel.Endpoint), raised);
        Assert.Contains(nameof(RequestBuilderViewModel.Display), raised);
    }

    [Fact]
    public void ViewModel_set_endpoint_clears_confirm()
    {
        var vm = new RequestBuilderViewModel(Localizer, PostEndpoint());
        vm.RequestSend(); // arms confirm
        Assert.True(vm.ConfirmOpen);

        vm.SetEndpoint(DeleteEndpoint());

        Assert.False(vm.ConfirmOpen);
    }

    [Fact]
    public void ViewModel_set_endpoint_unchanged_is_noop()
    {
        var vm = new RequestBuilderViewModel(Localizer, GetEndpoint());
        bool raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        vm.SetEndpoint(GetEndpoint()); // same path + method

        Assert.False(raised);
    }

    [Fact]
    public void ViewModel_reload_raises_display()
    {
        var vm = new RequestBuilderViewModel(Localizer, GetEndpoint());
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Reload();

        Assert.Contains(nameof(RequestBuilderViewModel.Display), raised);
    }

    [Fact]
    public void ViewModel_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => new RequestBuilderViewModel(null!, GetEndpoint()));

    [Fact]
    public void ViewModel_rejects_null_endpoint() =>
        Assert.Throws<ArgumentNullException>(() => new RequestBuilderViewModel(Localizer, null!));

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new RequestBuilderDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RequestBuilder", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new RequestBuilderDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("RequestBuilder", RequestBuilderRegistration.Slug);

    // ---- Helpers / test doubles ----------------------------------------------------

    private static RequestBuilderDisplay Project(
        ParsedEndpoint endpoint,
        Dictionary<string, string> values,
        bool confirmOpen = false,
        bool loading = false,
        ILocalizer? localizer = null) =>
        RequestBuilderProjection.Project(
            endpoint, values, body: null, apiKey: null, confirmOpen, loading, localizer ?? Localizer);

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }

    private sealed class TemplateLocalizer : ILocalizer
    {
        private readonly string _template;

        public TemplateLocalizer(string template) => _template = template;

        public string GetString(string key, string fallback) =>
            string.Equals(key, RequestBuilderProjection.ConfirmDestructiveKey, StringComparison.Ordinal)
                ? _template
                : fallback;
    }
}
