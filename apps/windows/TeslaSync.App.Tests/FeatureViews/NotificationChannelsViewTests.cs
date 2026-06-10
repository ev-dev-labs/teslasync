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
/// Headless verification of the NotificationChannelsView feature-view's UI-thread-free logic — the channel/stats
/// JSON adapters, the per-kind form payload builder and name guard, the metric-card + channel-card projection
/// (labels, credential masking, status chips and Narrator names), the cache-then-network result mappers, the
/// state-holder view-model's per-state transitions (loading / loaded / empty / stale / offline / error) and its
/// save / delete / toggle / test actions (toast + refresh), the registration metadata and the PII-safe
/// diagnostics. Mirrors the web spec
/// (web/src/features/notifications/components/NotificationChannelsView.tsx). The WinUI view itself is exercised
/// by the app build.
/// </summary>
public sealed class NotificationChannelsViewTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    // ---- Channel-type catalog (web CHANNEL_TYPES + getChannelMeta) --------------------------------------

    [Fact]
    public void Catalog_orders_the_seven_types_in_web_order()
    {
        var wires = new List<string>();
        foreach (var type in ChannelTypeCatalog.Ordered)
        {
            wires.Add(type.Wire);
        }

        Assert.Equal(new[] { "discord", "slack", "telegram", "email", "webhook", "ntfy", "pushover" }, wires);
    }

    [Fact]
    public void Catalog_unknown_kind_falls_back_to_webhook()
    {
        Assert.Equal(NotificationChannelKind.Webhook, ChannelTypeCatalog.ParseKind("carrier-pigeon"));
        Assert.Equal("webhook", ChannelTypeCatalog.For("carrier-pigeon").Wire);
        Assert.Equal(NotificationChannelKind.Discord, ChannelTypeCatalog.ParseKind("discord"));
    }

    // ---- Channel adapter (web channelToFormConfig) -----------------------------------------------------

    [Fact]
    public void Channel_FromJson_flattens_email_fields_in_field_order()
    {
        const string json = """
        { "id": 7, "kind": "email", "name": "Ops Mail", "enabled": false,
          "smtp_host": "smtp.gmail.com", "smtp_port": 587, "smtp_username": "a@b.co",
          "smtp_password": "secret", "from_address": "a@b.co",
          "to_addresses": ["you@x.co", "ops@x.co"] }
        """;
        using var doc = JsonDocument.Parse(json);

        var channel = NotificationChannel.FromJson(doc.RootElement);

        Assert.Equal(7, channel.Id);
        Assert.Equal("email", channel.Kind);
        Assert.Equal(NotificationChannelKind.Email, channel.ResolvedKind);
        Assert.Equal("Ops Mail", channel.Name);
        Assert.False(channel.Enabled);
        Assert.Equal("smtp.gmail.com", channel.Config["smtp_host"]);
        Assert.Equal("587", channel.Config["smtp_port"]);          // number -> string
        Assert.Equal("you@x.co, ops@x.co", channel.Config["to_addresses"]); // array -> comma join
    }

    [Fact]
    public void Channel_FromJson_defaults_enabled_true_and_serializes_webhook_headers()
    {
        const string json = """
        { "id": "3", "kind": "webhook", "name": "Hook",
          "url": "https://x.co/h", "method": "POST",
          "headers": { "Authorization": "Bearer abc" }, "body_template": "{}" }
        """;
        using var doc = JsonDocument.Parse(json);

        var channel = NotificationChannel.FromJson(doc.RootElement);

        Assert.Equal(3, channel.Id);                 // numeric string id tolerated
        Assert.True(channel.Enabled);                // missing enabled -> true (web default)
        Assert.Equal("https://x.co/h", channel.Config["url"]);
        Assert.Contains("Authorization", channel.Config["headers"], StringComparison.Ordinal); // object -> JSON
    }

    [Fact]
    public void ChannelList_FromJson_parses_array_and_treats_non_array_as_empty()
    {
        using var list = JsonDocument.Parse("""[{"id":1,"kind":"discord","name":"D","enabled":true,"webhook_url":"u"}]""");
        var parsed = NotificationChannelList.FromJson(list.RootElement);
        Assert.True(parsed.HasData);
        Assert.Single(parsed.Channels);

        using var obj = JsonDocument.Parse("""{"error":"x"}""");
        Assert.False(NotificationChannelList.FromJson(obj.RootElement).HasData);

        using var empty = JsonDocument.Parse("[]");
        Assert.False(NotificationChannelList.FromJson(empty.RootElement).HasData);
    }

    // ---- Stats adapter (web NotificationStats) ----------------------------------------------------------

    [Fact]
    public void Stats_FromJson_reads_counts_and_tolerates_strings()
    {
        using var doc = JsonDocument.Parse(
            """{"total_sent":40,"sent":"38","failed":2,"pending":1,"total_channels":5,"enabled_channels":4}""");

        var stats = NotificationChannelStats.FromJson(doc.RootElement);

        Assert.Equal(38, stats.Sent);
        Assert.Equal(2, stats.Failed);
        Assert.Equal(1, stats.Pending);
        Assert.Equal(5, stats.TotalChannels);
        Assert.Equal(4, stats.EnabledChannels);
    }

    [Fact]
    public void Stats_FromJson_non_object_is_zeroed()
    {
        using var doc = JsonDocument.Parse("null");
        Assert.Equal(NotificationChannelStats.Empty, NotificationChannelStats.FromJson(doc.RootElement));
    }

    // ---- Form: validation + payload (web buildChannelPayload) ------------------------------------------

    [Fact]
    public void Form_validate_name_requires_non_blank()
    {
        Assert.Equal("Name is required", NotificationChannelForm.ValidateName("  ", Localizer));
        Assert.Null(NotificationChannelForm.ValidateName("My Discord", Localizer));
    }

    [Fact]
    public void Form_build_create_payload_omits_id()
    {
        var config = new Dictionary<string, string>(StringComparer.Ordinal) { ["webhook_url"] = "https://d" };
        var body = NotificationChannelForm.BuildPayload(NotificationChannelKind.Discord, "D", true, config, id: null);

        Assert.False(body.ContainsKey("id"));
        Assert.Equal("discord", body["kind"]!.GetValue<string>());
        Assert.Equal("D", body["name"]!.GetValue<string>());
        Assert.True(body["enabled"]!.GetValue<bool>());
        Assert.Equal("https://d", body["webhook_url"]!.GetValue<string>());
    }

    [Fact]
    public void Form_build_update_payload_includes_id()
    {
        var config = new Dictionary<string, string>(StringComparer.Ordinal) { ["bot_token"] = "t", ["chat_id"] = "c" };
        var body = NotificationChannelForm.BuildPayload(NotificationChannelKind.Telegram, "T", false, config, id: 12);

        Assert.Equal(12, body["id"]!.GetValue<long>());
        Assert.Equal("telegram", body["kind"]!.GetValue<string>());
        Assert.Equal("t", body["bot_token"]!.GetValue<string>());
        Assert.Equal("c", body["chat_id"]!.GetValue<string>());
    }

    [Fact]
    public void Form_build_email_payload_defaults_port_splits_recipients_and_sets_tls()
    {
        var config = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["smtp_host"] = "h",
            ["smtp_port"] = "",
            ["to_addresses"] = "a@x.co, b@x.co , ",
        };
        var body = NotificationChannelForm.BuildPayload(NotificationChannelKind.Email, "E", true, config, id: null);

        Assert.Equal(587, body["smtp_port"]!.GetValue<int>());
        Assert.True(body["use_tls"]!.GetValue<bool>());
        var recipients = Assert.IsType<JsonArray>(body["to_addresses"]);
        Assert.Equal(2, recipients.Count); // empty entries dropped
        Assert.Equal("a@x.co", recipients[0]!.GetValue<string>());
        Assert.Equal("b@x.co", recipients[1]!.GetValue<string>());
    }

    [Fact]
    public void Form_build_webhook_payload_normalizes_method_and_parses_headers()
    {
        var config = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["url"] = "https://x",
            ["method"] = "delete",
            ["headers"] = "{\"A\":\"B\"}",
        };
        var body = NotificationChannelForm.BuildPayload(NotificationChannelKind.Webhook, "W", true, config, id: null);

        Assert.Equal("POST", body["method"]!.GetValue<string>()); // unsupported verb -> POST
        var headers = Assert.IsType<JsonObject>(body["headers"]);
        Assert.Equal("B", headers["A"]!.GetValue<string>());
    }

    [Fact]
    public void Form_build_webhook_payload_recovers_from_invalid_headers()
    {
        var config = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["url"] = "https://x",
            ["method"] = "PUT",
            ["headers"] = "not json",
        };
        var body = NotificationChannelForm.BuildPayload(NotificationChannelKind.Webhook, "W", true, config, id: null);

        Assert.Equal("PUT", body["method"]!.GetValue<string>());
        var headers = Assert.IsType<JsonObject>(body["headers"]);
        Assert.Empty(headers);
    }

    [Fact]
    public void Form_build_ntfy_payload_defaults_server_and_priority()
    {
        var config = new Dictionary<string, string>(StringComparer.Ordinal) { ["topic"] = "teslasync" };
        var body = NotificationChannelForm.BuildPayload(NotificationChannelKind.Ntfy, "N", true, config, id: null);

        Assert.Equal("https://ntfy.sh", body["server_url"]!.GetValue<string>());
        Assert.Equal(3, body["priority"]!.GetValue<int>());
    }

    // ---- Projection: stats cards (web MetricCard row) --------------------------------------------------

    [Fact]
    public void Project_stats_builds_four_cards_with_values_accents_and_a11y()
    {
        var stats = new NotificationChannelStats(TotalSent: 99, Sent: 38, Failed: 2, Pending: 1, TotalChannels: 5, EnabledChannels: 4);

        var cards = NotificationChannelsProjection.ProjectStats(stats, Localizer);

        Assert.Equal(4, cards.Count);
        Assert.Equal("Total Sent", cards[0].Label);
        Assert.Equal("38", cards[0].Value);
        Assert.Equal("TsColorSuccessBrush", cards[0].AccentBrushKey);
        Assert.Equal("Failed", cards[1].Label);
        Assert.Equal("2", cards[1].Value);
        Assert.Equal("Pending", cards[2].Label);
        Assert.Equal("Active Channels", cards[3].Label);
        Assert.Equal("4/5", cards[3].Value); // enabled/total
        Assert.All(cards, c => Assert.Contains(c.Label, c.AutomationName, StringComparison.Ordinal));
        Assert.All(cards, c => Assert.Contains(c.Value, c.AutomationName, StringComparison.Ordinal));
    }

    [Fact]
    public void Project_stats_null_yields_no_cards_so_the_skeleton_shows()
    {
        Assert.Empty(NotificationChannelsProjection.ProjectStats(null, Localizer));
    }

    // ---- Projection: channel cards (cached -> projection, masking, a11y) -------------------------------

    [Fact]
    public void Project_channel_card_masks_secrets_and_resolves_status_and_a11y()
    {
        var channel = new NotificationChannel(
            3, "telegram", "Alerts Bot", true,
            new Dictionary<string, string>(StringComparer.Ordinal) { ["bot_token"] = "123:ABC", ["chat_id"] = "-100" });
        var list = new NotificationChannelList(new[] { channel });

        var display = NotificationChannelsProjection.Project(list, null, NotificationChannelsState.Loaded, Localizer);

        var card = Assert.Single(display.Channels);
        Assert.Equal("Alerts Bot", card.Name);
        Assert.Equal("Telegram", card.KindLabel);
        Assert.Equal("Active", card.StatusLabel);
        Assert.Equal(StatusKind.Success, card.StatusKind);

        var tokenLine = Assert.Single(card.ConfigPreview, l => l.Label == "bot_token");
        Assert.Equal("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", tokenLine.Value); // secret masked
        var chatLine = Assert.Single(card.ConfigPreview, l => l.Label == "chat_id");
        Assert.Equal("-100", chatLine.Value); // non-secret shown

        // a11y: every interactive affordance has a Narrator name carrying the channel name.
        Assert.Contains("Alerts Bot", card.ToggleAutomationName, StringComparison.Ordinal);
        Assert.Contains("Alerts Bot", card.TestAutomationName, StringComparison.Ordinal);
        Assert.Contains("Alerts Bot", card.EditAutomationName, StringComparison.Ordinal);
        Assert.Contains("Alerts Bot", card.DeleteAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_disabled_channel_uses_neutral_status()
    {
        var channel = new NotificationChannel(
            1, "discord", "Off", false,
            new Dictionary<string, string>(StringComparer.Ordinal) { ["webhook_url"] = "https://d" });

        var display = NotificationChannelsProjection.Project(
            new NotificationChannelList(new[] { channel }), null, NotificationChannelsState.Loaded, Localizer);

        var card = Assert.Single(display.Channels);
        Assert.Equal("Disabled", card.StatusLabel);
        Assert.Equal(StatusKind.Neutral, card.StatusKind);
    }

    [Fact]
    public void Project_preview_caps_at_three_lines()
    {
        var config = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["smtp_host"] = "h",
            ["smtp_port"] = "587",
            ["smtp_username"] = "u",
            ["smtp_password"] = "p",
            ["from_address"] = "f",
            ["to_addresses"] = "t",
        };
        var channel = new NotificationChannel(1, "email", "Mail", true, config);

        var display = NotificationChannelsProjection.Project(
            new NotificationChannelList(new[] { channel }), null, NotificationChannelsState.Loaded, Localizer);

        Assert.Equal(3, Assert.Single(display.Channels).ConfigPreview.Count);
    }

    [Fact]
    public void Project_empty_uses_friendly_copy_not_a_blank_box()
    {
        var display = NotificationChannelsProjection.Project(
            NotificationChannelList.Empty, null, NotificationChannelsState.Empty, Localizer);

        Assert.Empty(display.Channels);
        Assert.Equal("No channels configured", display.EmptyTitle);
        Assert.False(string.IsNullOrWhiteSpace(display.EmptyMessage));
        Assert.Equal("Add Channel", display.AddLabel);
    }

    // ---- Result mappers (cached -> projection path) ----------------------------------------------------

    [Fact]
    public void MapChannels_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"kind":"discord","name":"D","enabled":true,"webhook_url":"u"}]""");

        var cached = NotificationChannelsResultMapper.MapChannels(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.HasData);
        Assert.Equal("D", cached.Value.Channels[0].Name);

        // cached -> projection end to end
        var display = NotificationChannelsProjection.Project(cached.Value, null, NotificationChannelsState.Stale, Localizer);
        Assert.Equal("D", Assert.Single(display.Channels).Name);
    }

    [Fact]
    public void MapChannels_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Equal(LoadStatus.Empty, NotificationChannelsResultMapper.MapChannels(
            RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(LoadStatus.Error, NotificationChannelsResultMapper.MapChannels(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);

        using var one = JsonDocument.Parse("""[{"id":1,"kind":"slack","name":"S","enabled":true,"webhook_url":"u"}]""");
        Assert.Equal(LoadStatus.Loaded, NotificationChannelsResultMapper.MapChannels(
            RepositoryResult<JsonElement>.Loaded(one.RootElement, Now)).Status);
    }

    [Fact]
    public void MapStats_parses_offline_cached_value()
    {
        using var doc = JsonDocument.Parse("""{"sent":5,"failed":0,"pending":0,"total_channels":1,"enabled_channels":1}""");

        var offline = NotificationChannelsResultMapper.MapStats(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));

        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(5, offline.Value!.Sent);
    }

    // ---- View-model state matrix -----------------------------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(Channels(RepositoryResult<NotificationChannelList>.Loading()));
        await vm.LoadAsync();

        Assert.Equal(NotificationChannelsState.Loading, vm.State);
        Assert.False(vm.HasChannels);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_channel_cards()
    {
        var source = new FakeChannelsSource(
            new[] { RepositoryResult<NotificationChannelList>.Loaded(OneChannel(), Now) },
            new[] { RepositoryResult<NotificationChannelStats>.Loaded(SomeStats(), Now) });
        using var vm = new NotificationChannelsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(NotificationChannelsState.Loaded, vm.State);
        Assert.True(vm.HasChannels);
        Assert.True(vm.HasStats);
        Assert.Single(vm.Display.Channels);
        Assert.Equal(4, vm.Display.StatCards.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty_surface()
    {
        using var vm = NewViewModel(Channels(RepositoryResult<NotificationChannelList>.Empty(Now)));
        await vm.LoadAsync();

        Assert.Equal(NotificationChannelsState.Empty, vm.State);
        Assert.False(vm.HasChannels);
        Assert.Empty(vm.Display.Channels);
        Assert.Equal("No channels configured", vm.Display.EmptyTitle);
    }

    [Fact]
    public async Task ViewModel_stats_pending_keeps_skeleton()
    {
        // channels loaded, but the stats read never resolves a value -> the cards stay a skeleton (HasStats=false).
        var source = new FakeChannelsSource(
            new[] { RepositoryResult<NotificationChannelList>.Loaded(OneChannel(), Now) },
            new[] { RepositoryResult<NotificationChannelStats>.Loading() });
        using var vm = new NotificationChannelsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(NotificationChannelsState.Loaded, vm.State);
        Assert.False(vm.HasStats);
        Assert.False(vm.Display.HasStats);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(Channels(
            RepositoryResult<NotificationChannelList>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))));
        await vm.LoadAsync();

        Assert.Equal(NotificationChannelsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(Channels(
            RepositoryResult<NotificationChannelList>.Cached(OneChannel(), Now, stale: true)));
        await vm.LoadAsync();

        Assert.Equal(NotificationChannelsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasChannels);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(Channels(RepositoryResult<NotificationChannelList>.OfflineCached(
            OneChannel(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline"))));
        await vm.LoadAsync();

        Assert.Equal(NotificationChannelsState.Offline, vm.State);
        Assert.True(vm.HasChannels);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(Channels(
            RepositoryResult<NotificationChannelList>.Loading(),
            RepositoryResult<NotificationChannelList>.Cached(OneChannel(), Now, stale: false),
            RepositoryResult<NotificationChannelList>.Loaded(TwoChannels(), Now)));
        await vm.LoadAsync();

        Assert.Equal(NotificationChannelsState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Channels.Count);
    }

    // ---- View-model actions (web mutations + useToast) -------------------------------------------------

    [Fact]
    public async Task ViewModel_save_create_toasts_and_refreshes()
    {
        var source = new FakeChannelsSource(new[] { RepositoryResult<NotificationChannelList>.Empty(Now) });
        using var vm = new NotificationChannelsViewModel(source, Localizer);
        var toasts = CaptureToasts(vm);

        bool ok = await vm.SaveChannelAsync(new JsonObject { ["kind"] = "discord" }, id: null);

        Assert.True(ok);
        Assert.Single(source.Saves);
        Assert.Null(source.Saves[0].Id);
        Assert.Contains(new NotificationChannelsToast("Channel created", false), toasts);
        Assert.True(source.ChannelLoads >= 1); // refresh after save
    }

    [Fact]
    public async Task ViewModel_save_failure_toasts_error_and_returns_false()
    {
        var source = new FakeChannelsSource(new[] { RepositoryResult<NotificationChannelList>.Empty(Now) })
        {
            ThrowOnSave = true,
        };
        using var vm = new NotificationChannelsViewModel(source, Localizer);
        var toasts = CaptureToasts(vm);

        bool ok = await vm.SaveChannelAsync(new JsonObject { ["kind"] = "discord" }, id: 4);

        Assert.False(ok);
        Assert.Contains(new NotificationChannelsToast("Failed to save channel", true), toasts);
    }

    [Fact]
    public async Task ViewModel_delete_toasts_and_refreshes()
    {
        var source = new FakeChannelsSource(new[] { RepositoryResult<NotificationChannelList>.Loaded(OneChannel(), Now) });
        using var vm = new NotificationChannelsViewModel(source, Localizer);
        var toasts = CaptureToasts(vm);

        await vm.DeleteChannelAsync(1);

        Assert.Equal(1, Assert.Single(source.Deletes));
        Assert.Contains(new NotificationChannelsToast("Channel deleted", false), toasts);
    }

    [Fact]
    public async Task ViewModel_toggle_enabled_channel_announces_disabled()
    {
        var source = new FakeChannelsSource(new[] { RepositoryResult<NotificationChannelList>.Loaded(OneChannel(), Now) });
        using var vm = new NotificationChannelsViewModel(source, Localizer);
        var toasts = CaptureToasts(vm);

        var channel = new NotificationChannel(1, "discord", "D", true,
            new Dictionary<string, string>(StringComparer.Ordinal));
        await vm.ToggleChannelAsync(channel);

        Assert.Equal(1, Assert.Single(source.Toggles));
        Assert.Contains(new NotificationChannelsToast("Channel disabled", false), toasts);
    }

    [Fact]
    public async Task ViewModel_test_success_returns_outcome_and_toasts_short_cue()
    {
        var source = new FakeChannelsSource(new[] { RepositoryResult<NotificationChannelList>.Loaded(OneChannel(), Now) })
        {
            TestResult = new ChannelTestResponse(true, null),
        };
        using var vm = new NotificationChannelsViewModel(source, Localizer);
        var toasts = CaptureToasts(vm);

        var outcome = await vm.TestChannelAsync(1);

        Assert.True(outcome.Success);
        Assert.Equal("Test notification sent successfully!", outcome.Message);
        Assert.Contains(new NotificationChannelsToast("Test sent!", false), toasts);
    }

    [Fact]
    public async Task ViewModel_test_failure_surfaces_server_error()
    {
        var source = new FakeChannelsSource(new[] { RepositoryResult<NotificationChannelList>.Loaded(OneChannel(), Now) })
        {
            TestResult = new ChannelTestResponse(false, "bad webhook"),
        };
        using var vm = new NotificationChannelsViewModel(source, Localizer);
        var toasts = CaptureToasts(vm);

        var outcome = await vm.TestChannelAsync(1);

        Assert.False(outcome.Success);
        Assert.Equal("bad webhook", outcome.Message);
        Assert.Contains(new NotificationChannelsToast("Test failed", true), toasts);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Channels(RepositoryResult<NotificationChannelList>.Loaded(OneChannel(), Now)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(NotificationChannelsViewModel.State), changed);
        Assert.Contains(nameof(NotificationChannelsViewModel.Display), changed);
    }

    // ---- Registration + diagnostics --------------------------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("NotificationChannelsView", NotificationChannelsRegistration.Slug);
        Assert.Equal("get_api_v1_notifications", NotificationChannelsRegistration.ChannelsOperation);
        Assert.Equal("get_api_v1_notifications_stats", NotificationChannelsRegistration.StatsOperation);
        Assert.Equal("post_api_v1_notifications", NotificationChannelsRegistration.CreateOperation);
        Assert.Equal("put_api_v1_notifications_channelID", NotificationChannelsRegistration.UpdateOperation);
        Assert.Equal("delete_api_v1_notifications_channelID", NotificationChannelsRegistration.DeleteOperation);
        Assert.Equal("post_api_v1_notifications_channelID_toggle", NotificationChannelsRegistration.ToggleOperation);
        Assert.Equal("post_api_v1_notifications_channelID_test", NotificationChannelsRegistration.TestOperation);
        Assert.Equal("channelID", NotificationChannelsRegistration.ChannelIdParam);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new NotificationChannelsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=NotificationChannelsView", Assert.Single(lines));
    }

    // ---- Fakes / helpers -------------------------------------------------------------------------------

    private static NotificationChannelList OneChannel() => new(new[]
    {
        new NotificationChannel(1, "discord", "Primary", true,
            new Dictionary<string, string>(StringComparer.Ordinal) { ["webhook_url"] = "https://d" }),
    });

    private static NotificationChannelList TwoChannels() => new(new[]
    {
        new NotificationChannel(1, "discord", "Primary", true,
            new Dictionary<string, string>(StringComparer.Ordinal) { ["webhook_url"] = "https://d" }),
        new NotificationChannel(2, "slack", "Secondary", false,
            new Dictionary<string, string>(StringComparer.Ordinal) { ["webhook_url"] = "https://s" }),
    });

    private static NotificationChannelStats SomeStats() => new(10, 8, 1, 1, 3, 2);

    private static RepositoryResult<NotificationChannelList>[] Channels(params RepositoryResult<NotificationChannelList>[] emissions) =>
        emissions;

    private static NotificationChannelsViewModel NewViewModel(RepositoryResult<NotificationChannelList>[] channels) =>
        new(new FakeChannelsSource(channels), Localizer);

    private static List<NotificationChannelsToast> CaptureToasts(NotificationChannelsViewModel vm)
    {
        var toasts = new List<NotificationChannelsToast>();
        vm.ToastRequested += (_, t) => toasts.Add(t);
        return toasts;
    }

    private sealed class FakeChannelsSource : INotificationChannelsSource
    {
        private readonly RepositoryResult<NotificationChannelList>[] _channels;
        private readonly RepositoryResult<NotificationChannelStats>[] _stats;

        public FakeChannelsSource(
            RepositoryResult<NotificationChannelList>[] channels,
            RepositoryResult<NotificationChannelStats>[]? stats = null)
        {
            _channels = channels;
            _stats = stats ?? Array.Empty<RepositoryResult<NotificationChannelStats>>();
        }

        public List<(JsonObject Body, long? Id)> Saves { get; } = new();

        public List<long> Deletes { get; } = new();

        public List<long> Toggles { get; } = new();

        public List<long> Tests { get; } = new();

        public int ChannelLoads { get; private set; }

        public bool ThrowOnSave { get; init; }

        public ChannelTestResponse TestResult { get; init; } = new(true, null);

        public async IAsyncEnumerable<RepositoryResult<NotificationChannelList>> StreamChannelsAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            ChannelLoads++;
            foreach (var emission in _channels)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }

        public async IAsyncEnumerable<RepositoryResult<NotificationChannelStats>> StreamStatsAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in _stats)
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

        public Task<ChannelTestResponse> TestAsync(long id, CancellationToken cancellationToken = default)
        {
            Tests.Add(id);
            return Task.FromResult(TestResult);
        }
    }
}
