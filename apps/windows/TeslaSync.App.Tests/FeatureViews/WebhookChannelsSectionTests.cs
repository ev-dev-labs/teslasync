using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the WebhookChannelsSection feature-view's UI-thread-free logic — the webhook / test
/// JSON adapters, the save-payload builder and name/URL guards, the row + test + docs projection (labels, status
/// chips and Narrator names), the cache-then-network result mapper, the state-holder view-model's per-state
/// transitions (loading / loaded / empty / stale / offline / error) and its save / delete / toggle / test /
/// signature-preview actions, the registration metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/settings/components/WebhookChannelsSection.tsx). The WinUI view itself is exercised by the
/// app build.
/// </summary>
public sealed class WebhookChannelsSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    // ---- Channel adapter (web fromChannel) -------------------------------------------------------------

    [Fact]
    public void Channel_FromJson_reads_fields_and_uppercases_method()
    {
        const string json = """
        { "id": 7, "kind": "webhook", "name": "Discord #alerts", "enabled": false,
          "url": "https://discord.com/api/webhooks/abc", "method": "put" }
        """;
        using var doc = JsonDocument.Parse(json);

        var channel = WebhookChannel.FromJson(doc.RootElement);

        Assert.Equal(7, channel.Id);
        Assert.Equal("Discord #alerts", channel.Name);
        Assert.Equal("https://discord.com/api/webhooks/abc", channel.Url);
        Assert.Equal("PUT", channel.Method);
        Assert.False(channel.Enabled);
    }

    [Fact]
    public void Channel_FromJson_tolerates_numeric_string_id_and_defaults()
    {
        const string json = """{ "id": "3", "kind": "webhook", "name": "Hook" }""";
        using var doc = JsonDocument.Parse(json);

        var channel = WebhookChannel.FromJson(doc.RootElement);

        Assert.Equal(3, channel.Id);          // numeric-string id tolerated
        Assert.Equal(string.Empty, channel.Url);
        Assert.Equal("POST", channel.Method);  // missing method -> POST
        Assert.True(channel.Enabled);          // missing enabled -> true (web default)
    }

    [Fact]
    public void ChannelList_FromJson_keeps_only_webhook_rows()
    {
        const string json = """
        [
          { "id": 1, "kind": "discord", "name": "D", "enabled": true, "webhook_url": "u" },
          { "id": 2, "kind": "webhook", "name": "W", "enabled": true, "url": "https://x.co/h", "method": "POST" },
          { "id": 3, "kind": "slack",   "name": "S", "enabled": true, "webhook_url": "u" }
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var list = WebhookChannelList.FromJson(doc.RootElement);

        Assert.True(list.HasData);
        var only = Assert.Single(list.Channels);
        Assert.Equal(2, only.Id);
        Assert.Equal("W", only.Name);
    }

    [Fact]
    public void ChannelList_FromJson_non_array_and_no_webhooks_is_empty()
    {
        using var obj = JsonDocument.Parse("""{"error":"x"}""");
        Assert.False(WebhookChannelList.FromJson(obj.RootElement).HasData);

        using var others = JsonDocument.Parse("""[{"id":1,"kind":"discord","name":"D","enabled":true}]""");
        Assert.False(WebhookChannelList.FromJson(others.RootElement).HasData);

        using var empty = JsonDocument.Parse("[]");
        Assert.False(WebhookChannelList.FromJson(empty.RootElement).HasData);
    }

    // ---- Test-result adapter (web WebhookTestResult) ---------------------------------------------------

    [Fact]
    public void TestResult_FromJson_reads_full_payload()
    {
        const string json = """
        { "success": true, "status_code": 204, "latency_ms": 42,
          "signature": "sha256=abc", "body_preview": "ok", "truncated": true }
        """;
        using var doc = JsonDocument.Parse(json);

        var result = WebhookTestResult.FromJson(doc.RootElement);

        Assert.True(result.Success);
        Assert.Equal(204, result.StatusCode);
        Assert.Equal(42, result.LatencyMs);
        Assert.Equal("sha256=abc", result.Signature);
        Assert.Equal("ok", result.BodyPreview);
        Assert.True(result.Truncated);
        Assert.Null(result.Error);
    }

    [Fact]
    public void TestResult_FromJson_non_object_is_failure_shaped()
    {
        using var doc = JsonDocument.Parse("null");
        var result = WebhookTestResult.FromJson(doc.RootElement);
        Assert.False(result.Success);
        Assert.Equal(0, result.StatusCode);
        Assert.Null(result.Signature);
    }

    // ---- Form: validation + payload (web toSavePayload / isHttpsLike) ----------------------------------

    [Fact]
    public void Form_validate_name_requires_non_blank()
    {
        Assert.Equal("Name is required.", WebhookChannelForm.ValidateName("  ", Localizer));
        Assert.Null(WebhookChannelForm.ValidateName("My Hook", Localizer));
    }

    [Fact]
    public void Form_validate_url_requires_http_scheme()
    {
        Assert.Null(WebhookChannelForm.ValidateUrl("https://x.co/h", Localizer));
        Assert.Null(WebhookChannelForm.ValidateUrl("http://x.co/h", Localizer));
        Assert.Equal(
            "URL must start with http:// or https://.",
            WebhookChannelForm.ValidateUrl("ftp://x.co", Localizer));
        Assert.Equal(
            "URL must start with http:// or https://.",
            WebhookChannelForm.ValidateUrl("   ", Localizer));
    }

    [Fact]
    public void Form_method_normalize_and_save_narrowing()
    {
        Assert.Equal("POST", WebhookChannelForm.NormalizeDisplayMethod(null));
        Assert.Equal("PUT", WebhookChannelForm.NormalizeDisplayMethod("put"));
        Assert.Equal("PATCH", WebhookChannelForm.NormalizeDisplayMethod("patch"));
        Assert.Equal("POST", WebhookChannelForm.NormalizeDisplayMethod("delete")); // unsupported -> POST

        Assert.Equal("PUT", WebhookChannelForm.SaveMethod("PUT"));
        Assert.Equal("POST", WebhookChannelForm.SaveMethod("PATCH")); // PATCH narrows to POST on save
        Assert.Equal("POST", WebhookChannelForm.SaveMethod("POST"));
    }

    [Fact]
    public void Form_build_create_payload_omits_id_and_carries_secret_and_defaults()
    {
        var input = new WebhookFormInput(null, "  Hook  ", "  https://x.co/h  ", "POST", "s3cr3t", true);
        var body = WebhookChannelForm.BuildPayload(input);

        Assert.False(body.ContainsKey("id"));
        Assert.Equal("webhook", body["kind"]!.GetValue<string>());
        Assert.Equal("Hook", body["name"]!.GetValue<string>());          // trimmed
        Assert.Equal("https://x.co/h", body["url"]!.GetValue<string>()); // trimmed
        Assert.True(body["enabled"]!.GetValue<bool>());
        Assert.Equal("POST", body["method"]!.GetValue<string>());
        Assert.Equal("s3cr3t", body["bearer_token"]!.GetValue<string>());
        Assert.Empty(Assert.IsType<JsonObject>(body["headers"]));
        Assert.Equal(string.Empty, body["body_template"]!.GetValue<string>());
    }

    [Fact]
    public void Form_build_update_payload_includes_id_and_narrows_patch()
    {
        var input = new WebhookFormInput(12, "Hook", "https://x.co/h", "PATCH", string.Empty, false);
        var body = WebhookChannelForm.BuildPayload(input);

        Assert.Equal(12, body["id"]!.GetValue<long>());
        Assert.Equal("POST", body["method"]!.GetValue<string>()); // PATCH -> POST on save
        Assert.False(body["enabled"]!.GetValue<bool>());
        Assert.Equal(string.Empty, body["bearer_token"]!.GetValue<string>()); // blank clears the secret
    }

    // ---- Projection: rows (cached -> projection, status, a11y) -----------------------------------------

    [Fact]
    public void Project_sorts_rows_by_name_and_resolves_status_and_method()
    {
        var list = new WebhookChannelList(new[]
        {
            new WebhookChannel(2, "Zulip", "https://z.co", "put", true),
            new WebhookChannel(1, "Apprise", "https://a.co", "POST", false),
        });

        var display = WebhookChannelsProjection.Project(list, WebhookChannelsState.Loaded, Localizer);

        Assert.Equal(2, display.Rows.Count);
        Assert.Equal("Apprise", display.Rows[0].Name); // sorted by name
        Assert.Equal("Zulip", display.Rows[1].Name);

        Assert.Equal("Disabled", display.Rows[0].StatusLabel);
        Assert.Equal(StatusKind.Neutral, display.Rows[0].StatusKind);
        Assert.Equal("Enabled", display.Rows[1].StatusLabel);
        Assert.Equal(StatusKind.Success, display.Rows[1].StatusKind);
        Assert.Equal("PUT", display.Rows[1].MethodLabel); // upper-cased
    }

    [Fact]
    public void Project_row_a11y_names_carry_label_and_webhook_name()
    {
        var channel = new WebhookChannel(1, "Discord #alerts", "https://d.co", "POST", true);

        var row = WebhookChannelsProjection.ProjectRow(channel, Localizer);

        foreach (var name in new[] { row.ToggleAutomationName, row.TestAutomationName, row.EditAutomationName, row.DeleteAutomationName })
        {
            Assert.Contains("Discord #alerts", name, StringComparison.Ordinal);
            Assert.False(string.IsNullOrWhiteSpace(name));
        }

        Assert.Contains("Test webhook", row.TestAutomationName, StringComparison.Ordinal);
        Assert.Contains("Edit webhook", row.EditAutomationName, StringComparison.Ordinal);
        Assert.Contains("Delete webhook", row.DeleteAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_empty_uses_friendly_copy_and_docs_not_a_blank_box()
    {
        var display = WebhookChannelsProjection.Project(
            WebhookChannelList.Empty, WebhookChannelsState.Empty, Localizer);

        Assert.Empty(display.Rows);
        Assert.Equal("Webhook channels", display.Title);
        Assert.Equal("Add webhook", display.AddLabel);
        Assert.Equal("No webhooks yet", display.EmptyTitle);
        Assert.False(string.IsNullOrWhiteSpace(display.EmptyMessage));
        Assert.Equal("Add your first webhook", display.EmptyActionLabel);
        Assert.Equal("Available payload variables", display.DocsTitle);
    }

    [Fact]
    public void Project_docs_lists_the_four_payload_variables()
    {
        var variables = WebhookChannelsProjection.DocsVariables(Localizer);

        Assert.Equal(4, variables.Count);
        Assert.Equal(new[] { "title", "message", "source", "timestamp" }, variables.Select(v => v.Name).ToArray());
        Assert.All(variables, v => Assert.False(string.IsNullOrWhiteSpace(v.Description)));
    }

    // ---- Projection: inline test result (web's per-row test box) ---------------------------------------

    [Fact]
    public void Project_test_success_formats_status_latency_signature_and_body()
    {
        var result = new WebhookTestResult(true, 204, 42, "sha256=abc", "{\"ok\":true}", true, null);

        var display = WebhookChannelsProjection.ProjectTest(result, Localizer);

        Assert.True(display.Success);
        Assert.Equal(StatusKind.Success, display.StatusKind);
        Assert.Equal("Success", display.ResultLabel);
        Assert.Equal("Status 204", display.StatusText);
        Assert.Equal("42 ms", display.LatencyText);
        Assert.True(display.HasSignature);
        Assert.Equal("Signature:", display.SignatureLabel);
        Assert.Equal("sha256=abc", display.Signature);
        Assert.True(display.HasBody);
        Assert.Contains("{\"ok\":true}", display.BodyText, StringComparison.Ordinal);
        Assert.Contains("(truncated)", display.BodyText, StringComparison.Ordinal); // truncated suffix appended
        Assert.False(display.HasError);
    }

    [Fact]
    public void Project_test_failure_uses_danger_and_surfaces_error()
    {
        var result = new WebhookTestResult(false, 500, 10, null, null, false, "connection refused");

        var display = WebhookChannelsProjection.ProjectTest(result, Localizer);

        Assert.False(display.Success);
        Assert.Equal(StatusKind.Danger, display.StatusKind);
        Assert.Equal("Failed", display.ResultLabel);
        Assert.False(display.HasSignature);
        Assert.False(display.HasBody);
        Assert.True(display.HasError);
        Assert.Equal("connection refused", display.Error);
    }

    // ---- Result mapper (cached -> projection path) -----------------------------------------------------

    [Fact]
    public void MapWebhooks_preserves_status_and_filters_payload()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":1,"kind":"webhook","name":"W","enabled":true,"url":"https://x","method":"POST"}]""");

        var cached = WebhookChannelsResultMapper.MapWebhooks(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.HasData);
        Assert.Equal("W", cached.Value.Channels[0].Name);

        var display = WebhookChannelsProjection.Project(cached.Value, WebhookChannelsState.Stale, Localizer);
        Assert.Equal("W", Assert.Single(display.Rows).Name);
    }

    [Fact]
    public void MapWebhooks_maps_empty_loaded_and_failure()
    {
        Assert.Equal(LoadStatus.Empty, WebhookChannelsResultMapper.MapWebhooks(
            RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(LoadStatus.Error, WebhookChannelsResultMapper.MapWebhooks(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        using var one = JsonDocument.Parse(
            """[{"id":1,"kind":"webhook","name":"W","enabled":true,"url":"https://x"}]""");
        Assert.Equal(LoadStatus.Loaded, WebhookChannelsResultMapper.MapWebhooks(
            RepositoryResult<JsonElement>.Loaded(one.RootElement, Now)).Status);
    }

    // ---- View-model state matrix -----------------------------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<WebhookChannelList>.Loading());
        await vm.LoadAsync();

        Assert.Equal(WebhookChannelsState.Loading, vm.State);
        Assert.False(vm.HasWebhooks);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_rows()
    {
        using var vm = NewViewModel(RepositoryResult<WebhookChannelList>.Loaded(OneWebhook(), Now));
        await vm.LoadAsync();

        Assert.Equal(WebhookChannelsState.Loaded, vm.State);
        Assert.True(vm.HasWebhooks);
        Assert.Single(vm.Display.Rows);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_surface()
    {
        using var vm = NewViewModel(RepositoryResult<WebhookChannelList>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(WebhookChannelsState.Empty, vm.State);
        Assert.False(vm.HasWebhooks);
        Assert.Empty(vm.Display.Rows);
        Assert.Equal("No webhooks yet", vm.Display.EmptyTitle);
    }

    [Fact]
    public async Task ViewModel_loaded_with_no_webhooks_is_treated_as_empty()
    {
        // web parity: a successful read whose filtered webhook list is empty still renders the empty surface.
        using var vm = NewViewModel(RepositoryResult<WebhookChannelList>.Loaded(WebhookChannelList.Empty, Now));
        await vm.LoadAsync();

        Assert.Equal(WebhookChannelsState.Empty, vm.State);
        Assert.False(vm.HasWebhooks);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<WebhookChannelList>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(WebhookChannelsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<WebhookChannelList>.Cached(OneWebhook(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(WebhookChannelsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasWebhooks);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<WebhookChannelList>.OfflineCached(
            OneWebhook(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(WebhookChannelsState.Offline, vm.State);
        Assert.True(vm.HasWebhooks);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<WebhookChannelList>.Loading(),
            RepositoryResult<WebhookChannelList>.Cached(OneWebhook(), Now, stale: false),
            RepositoryResult<WebhookChannelList>.Loaded(TwoWebhooks(), Now));
        await vm.LoadAsync();

        Assert.Equal(WebhookChannelsState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Rows.Count);
    }

    // ---- View-model actions (web mutations + useToast) -------------------------------------------------

    [Fact]
    public async Task ViewModel_save_create_toasts_and_refreshes()
    {
        var source = new FakeWebhookSource(RepositoryResult<WebhookChannelList>.Empty(Now));
        using var vm = new WebhookChannelsViewModel(source, Localizer);
        var toasts = CaptureToasts(vm);

        bool ok = await vm.SaveWebhookAsync(new JsonObject { ["kind"] = "webhook" }, id: null);

        Assert.True(ok);
        Assert.Single(source.Saves);
        Assert.Null(source.Saves[0].Id);
        Assert.Contains(new WebhookChannelsToast("Webhook created", false), toasts);
        Assert.True(source.Loads >= 1); // refresh fired after the save
    }

    [Fact]
    public async Task ViewModel_save_failure_toasts_error_and_returns_false()
    {
        var source = new FakeWebhookSource(RepositoryResult<WebhookChannelList>.Empty(Now)) { ThrowOnSave = true };
        using var vm = new WebhookChannelsViewModel(source, Localizer);
        var toasts = CaptureToasts(vm);

        bool ok = await vm.SaveWebhookAsync(new JsonObject { ["kind"] = "webhook" }, id: 4);

        Assert.False(ok);
        Assert.Contains(new WebhookChannelsToast("Failed to save webhook", true), toasts);
    }

    [Fact]
    public async Task ViewModel_delete_toasts_and_refreshes()
    {
        var source = new FakeWebhookSource(RepositoryResult<WebhookChannelList>.Loaded(OneWebhook(), Now));
        using var vm = new WebhookChannelsViewModel(source, Localizer);
        var toasts = CaptureToasts(vm);

        await vm.DeleteWebhookAsync(1);

        Assert.Equal(1, Assert.Single(source.Deletes));
        Assert.Contains(new WebhookChannelsToast("Webhook deleted", false), toasts);
    }

    [Fact]
    public async Task ViewModel_toggle_enabled_webhook_announces_disabled()
    {
        var source = new FakeWebhookSource(RepositoryResult<WebhookChannelList>.Loaded(OneWebhook(), Now));
        using var vm = new WebhookChannelsViewModel(source, Localizer);
        var toasts = CaptureToasts(vm);

        await vm.ToggleWebhookAsync(new WebhookChannel(1, "W", "https://x", "POST", true));

        Assert.Equal(1, Assert.Single(source.Toggles));
        Assert.Contains(new WebhookChannelsToast("Webhook disabled", false), toasts);
    }

    [Fact]
    public async Task ViewModel_test_success_returns_inline_display_without_toast()
    {
        var source = new FakeWebhookSource(RepositoryResult<WebhookChannelList>.Loaded(OneWebhook(), Now))
        {
            TestResult = new WebhookTestResult(true, 200, 30, "sha256=x", "ok", false, null),
        };
        using var vm = new WebhookChannelsViewModel(source, Localizer);
        var toasts = CaptureToasts(vm);

        var display = await vm.TestWebhookAsync(1);

        Assert.True(display.Success);
        Assert.Equal("Status 200", display.StatusText);
        Assert.Equal(1, Assert.Single(source.Tests));
        Assert.Empty(toasts); // web renders the result inline, never a toast
    }

    [Fact]
    public async Task ViewModel_test_transport_failure_returns_failure_display()
    {
        var source = new FakeWebhookSource(RepositoryResult<WebhookChannelList>.Loaded(OneWebhook(), Now))
        {
            ThrowOnTest = true,
        };
        using var vm = new WebhookChannelsViewModel(source, Localizer);

        var display = await vm.TestWebhookAsync(1);

        Assert.False(display.Success);
        Assert.True(display.HasError);
    }

    // ---- View-model: signature preview (web SignaturePreview) ------------------------------------------

    [Fact]
    public async Task ViewModel_signature_blank_secret_short_circuits_to_empty()
    {
        var source = new FakeWebhookSource(RepositoryResult<WebhookChannelList>.Empty(Now));
        using var vm = new WebhookChannelsViewModel(source, Localizer);

        var outcome = await vm.PreviewSignatureAsync("   ");

        Assert.Equal(WebhookSignatureStatus.Empty, outcome.Status);
        Assert.Empty(source.SignaturePreviews); // no request fired for a blank secret
    }

    [Fact]
    public async Task ViewModel_signature_success_returns_ready_with_signature()
    {
        var source = new FakeWebhookSource(RepositoryResult<WebhookChannelList>.Empty(Now))
        {
            SignatureResult = "sha256=deadbeef",
        };
        using var vm = new WebhookChannelsViewModel(source, Localizer);

        var outcome = await vm.PreviewSignatureAsync("topsecret");

        Assert.Equal(WebhookSignatureStatus.Ready, outcome.Status);
        Assert.Equal("sha256=deadbeef", outcome.Signature);
        var preview = Assert.Single(source.SignaturePreviews);
        Assert.Equal("topsecret", preview.Secret);
        Assert.Equal(WebhookChannelForm.SampleBody, preview.Body);
    }

    [Fact]
    public async Task ViewModel_signature_failure_returns_failed_with_message()
    {
        var source = new FakeWebhookSource(RepositoryResult<WebhookChannelList>.Empty(Now)) { ThrowOnSignature = true };
        using var vm = new WebhookChannelsViewModel(source, Localizer);

        var outcome = await vm.PreviewSignatureAsync("topsecret");

        Assert.Equal(WebhookSignatureStatus.Failed, outcome.Status);
        Assert.Contains("Failed to compute signature", outcome.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(RepositoryResult<WebhookChannelList>.Loaded(OneWebhook(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(WebhookChannelsViewModel.State), changed);
        Assert.Contains(nameof(WebhookChannelsViewModel.Display), changed);
    }

    // ---- Registration + diagnostics --------------------------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("WebhookChannelsSection", WebhookChannelsRegistration.Slug);
        Assert.Equal("get_api_v1_notifications", WebhookChannelsRegistration.ChannelsOperation);
        Assert.Equal("post_api_v1_notifications", WebhookChannelsRegistration.CreateOperation);
        Assert.Equal("put_api_v1_notifications_channelID", WebhookChannelsRegistration.UpdateOperation);
        Assert.Equal("delete_api_v1_notifications_channelID", WebhookChannelsRegistration.DeleteOperation);
        Assert.Equal("post_api_v1_notifications_channelID_toggle", WebhookChannelsRegistration.ToggleOperation);
        Assert.Equal("post_api_v1_notifications_channelID_webhook_test", WebhookChannelsRegistration.WebhookTestOperation);
        Assert.Equal("post_api_v1_notifications_webhooks_preview_signature", WebhookChannelsRegistration.SignaturePreviewOperation);
        Assert.Equal("channelID", WebhookChannelsRegistration.ChannelIdParam);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new WebhookChannelsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WebhookChannelsSection", Assert.Single(lines));
    }

    // ---- Fakes / helpers -------------------------------------------------------------------------------

    private static WebhookChannelList OneWebhook() => new(new[]
    {
        new WebhookChannel(1, "Primary", "https://x.co/h", "POST", true),
    });

    private static WebhookChannelList TwoWebhooks() => new(new[]
    {
        new WebhookChannel(1, "Primary", "https://x.co/h", "POST", true),
        new WebhookChannel(2, "Secondary", "https://y.co/h", "PUT", false),
    });

    private static WebhookChannelsViewModel NewViewModel(params RepositoryResult<WebhookChannelList>[] emissions) =>
        new(new FakeWebhookSource(emissions), Localizer);

    private static List<WebhookChannelsToast> CaptureToasts(WebhookChannelsViewModel vm)
    {
        var toasts = new List<WebhookChannelsToast>();
        vm.ToastRequested += (_, t) => toasts.Add(t);
        return toasts;
    }

    private sealed class FakeWebhookSource : IWebhookChannelsSource
    {
        private readonly RepositoryResult<WebhookChannelList>[] _emissions;

        public FakeWebhookSource(params RepositoryResult<WebhookChannelList>[] emissions) => _emissions = emissions;

        public List<(JsonObject Body, long? Id)> Saves { get; } = new();

        public List<long> Deletes { get; } = new();

        public List<long> Toggles { get; } = new();

        public List<long> Tests { get; } = new();

        public List<(string Secret, string Body)> SignaturePreviews { get; } = new();

        public int Loads { get; private set; }

        public bool ThrowOnSave { get; init; }

        public bool ThrowOnTest { get; init; }

        public bool ThrowOnSignature { get; init; }

        public WebhookTestResult TestResult { get; init; } = new(true, 200, 10, null, null, false, null);

        public string SignatureResult { get; init; } = "sha256=fake";

        public async IAsyncEnumerable<RepositoryResult<WebhookChannelList>> StreamWebhooksAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            Loads++;
            foreach (var emission in _emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }

        public Task SaveAsync(JsonObject body, long? id, CancellationToken cancellationToken = default)
        {
            if (ThrowOnSave)
            {
                throw new InvalidOperationException("save failed");
            }

            Saves.Add((body, id));
            return Task.CompletedTask;
        }

        public Task DeleteAsync(long id, CancellationToken cancellationToken = default)
        {
            Deletes.Add(id);
            return Task.CompletedTask;
        }

        public Task ToggleAsync(long id, CancellationToken cancellationToken = default)
        {
            Toggles.Add(id);
            return Task.CompletedTask;
        }

        public Task<WebhookTestResult> TestWebhookAsync(long id, CancellationToken cancellationToken = default)
        {
            if (ThrowOnTest)
            {
                throw new InvalidOperationException("network unreachable");
            }

            Tests.Add(id);
            return Task.FromResult(TestResult);
        }

        public Task<string> PreviewSignatureAsync(string secret, string body, CancellationToken cancellationToken = default)
        {
            if (ThrowOnSignature)
            {
                throw new InvalidOperationException("bad request");
            }

            SignaturePreviews.Add((secret, body));
            return Task.FromResult(SignatureResult);
        }
    }
}
