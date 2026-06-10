using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Helix (AI) settings surface's UI-thread-free logic — the JSON parse adapters
/// (mode / features / provider config / cost cap), the provider draft hydration (namespaced entry, off-mode
/// key redaction, legacy fallback) and provider switch, the cost-cap spend-bar projection (level thresholds,
/// "$today / $cap" amount, loading caption), the ADR-015 save patch builder (off-mode minimal patch, cloud
/// namespaced re-nest, legacy-key strip, optional / api-key omission, existing-entry merge) and the lighter
/// restore patch, the repository source's request shapes, the state-holder view-model's state matrix and
/// mode/feature/restore/save handlers, the registry metadata and the diagnostics. Mirrors the web spec
/// (web/src/features/settings/components/AISettings.tsx).
/// </summary>
public sealed class AISettingsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // ---- AiMode ---------------------------------------------------------------------

    [Theory]
    [InlineData("off", AiMode.Off)]
    [InlineData("local", AiMode.Local)]
    [InlineData("cloud", AiMode.Cloud)]
    [InlineData(null, AiMode.Off)]
    [InlineData("", AiMode.Off)]
    [InlineData("bogus", AiMode.Off)]
    public void Mode_parses_wire_tokens_with_off_default(string? raw, AiMode expected) =>
        Assert.Equal(expected, AiModes.Parse(raw));

    [Theory]
    [InlineData(AiMode.Off, "off")]
    [InlineData(AiMode.Local, "local")]
    [InlineData(AiMode.Cloud, "cloud")]
    public void Mode_serializes_to_lowercase_wire(AiMode mode, string expected) =>
        Assert.Equal(expected, AiModes.Wire(mode));

    // ---- Snapshot parse adapter ----------------------------------------------------

    [Fact]
    public void Snapshot_parses_the_helix_keys()
    {
        var snap = SnapshotFromJson(
            """{"ai_mode":"cloud","ai_features":{"a":true,"b":false},"ai_features_archived":{"c":true},"ai_cost_cap_cents":750,"ai_provider_config":{"default":"openai"}}""");

        Assert.Equal(AiMode.Cloud, snap.Mode);
        Assert.True(snap.Features["a"]);
        Assert.False(snap.Features["b"]);
        Assert.True(snap.HasRestorableArchive);
        Assert.Equal(750, snap.CostCapCents);
        Assert.NotNull(snap.ProviderConfigJson);
        Assert.NotNull(snap.DocumentJson);
    }

    [Fact]
    public void Snapshot_is_tolerant_of_missing_fields_and_non_object()
    {
        var snap = SnapshotFromJson("{}");
        Assert.Equal(AiMode.Off, snap.Mode);
        Assert.Empty(snap.Features);
        Assert.False(snap.HasRestorableArchive);
        Assert.Equal(0, snap.CostCapCents);
        Assert.Null(snap.ProviderConfigJson);

        using var notObject = JsonDocument.Parse("[]");
        Assert.Same(AiSettingsSnapshot.Empty, AiSettingsSnapshot.FromJson(notObject.RootElement));
    }

    [Fact]
    public void Snapshot_archive_with_only_false_entries_is_not_restorable()
    {
        var snap = SnapshotFromJson("""{"ai_mode":"local","ai_features_archived":{"a":false,"b":false}}""");
        Assert.False(snap.HasRestorableArchive);
    }

    // ---- Provider draft hydration --------------------------------------------------

    [Fact]
    public void InitProvider_reads_the_namespaced_entry_and_surfaces_the_key_in_cloud()
    {
        var snap = SnapshotFromJson(
            """{"ai_mode":"cloud","ai_provider_config":{"default":"openai","openai":{"base_url":"https://api.openai.com","model":"gpt-4o","api_key":"sk-x","api_version":"2024-02"}}}""");

        var provider = AiSettingsProjection.InitProvider(snap);

        Assert.Equal("openai", provider.Provider);
        Assert.Equal("https://api.openai.com", provider.BaseUrl);
        Assert.Equal("gpt-4o", provider.Model);
        Assert.Equal("sk-x", provider.ApiKey);
        Assert.Equal("2024-02", provider.ApiVersion);
    }

    [Fact]
    public void InitProvider_redacts_the_key_when_mode_is_off()
    {
        var snap = SnapshotFromJson(
            """{"ai_mode":"off","ai_provider_config":{"default":"openai","openai":{"api_key":"sk-secret"}}}""");

        Assert.Equal(string.Empty, AiSettingsProjection.InitProvider(snap).ApiKey);
    }

    [Fact]
    public void InitProvider_falls_back_to_legacy_provider_key_and_flat_entry()
    {
        var snap = SnapshotFromJson(
            """{"ai_mode":"local","ai_provider_config":{"provider":"ollama","base_url":"http://localhost:11434","model":"llama3"}}""");

        var provider = AiSettingsProjection.InitProvider(snap);

        Assert.Equal("ollama", provider.Provider);
        Assert.Equal("http://localhost:11434", provider.BaseUrl);
        Assert.Equal("llama3", provider.Model);
    }

    [Fact]
    public void InitProvider_defaults_to_ollama_when_no_config()
    {
        var snap = SnapshotFromJson("""{"ai_mode":"off","ai_cost_cap_cents":250}""");
        var provider = AiSettingsProjection.InitProvider(snap);

        Assert.Equal("ollama", provider.Provider);
        Assert.Equal(string.Empty, provider.BaseUrl);
        Assert.Equal(250, provider.CostCapCents);
    }

    [Fact]
    public void SwitchProvider_loads_the_saved_entry_without_the_key()
    {
        var snap = SnapshotFromJson(
            """{"ai_mode":"cloud","ai_provider_config":{"default":"openai","azure":{"base_url":"https://azure.example","model":"gpt-35"}}}""");

        var provider = AiSettingsProjection.SwitchProvider(snap, "azure", 0);

        Assert.Equal("azure", provider.Provider);
        Assert.Equal("https://azure.example", provider.BaseUrl);
        Assert.Equal("gpt-35", provider.Model);
        Assert.Equal(string.Empty, provider.ApiKey);
    }

    [Fact]
    public void SwitchProvider_is_blank_for_a_provider_with_no_entry()
    {
        var snap = SnapshotFromJson("""{"ai_mode":"cloud","ai_provider_config":{"default":"openai"}}""");
        var provider = AiSettingsProjection.SwitchProvider(snap, "anthropic", 100);

        Assert.Equal("anthropic", provider.Provider);
        Assert.Equal(string.Empty, provider.BaseUrl);
        Assert.Equal(string.Empty, provider.Model);
        Assert.Equal(100, provider.CostCapCents);
    }

    // ---- Cost-cap projection -------------------------------------------------------

    [Theory]
    [InlineData(2_500_000, AiCostCapLevel.Ok)]
    [InlineData(4_000_000, AiCostCapLevel.Warn)]
    [InlineData(5_000_000, AiCostCapLevel.Critical)]
    [InlineData(6_000_000, AiCostCapLevel.Critical)]
    public void CostCap_bands_match_the_web_thresholds(long microCents, AiCostCapLevel expected)
    {
        var display = AiSettingsProjection.ProjectCostCap(500, new AiUsageTodaySnapshot(microCents), false, Localizer);
        Assert.Equal(expected, display.Level);
    }

    [Fact]
    public void CostCap_amount_and_percentage_match_the_web()
    {
        var display = AiSettingsProjection.ProjectCostCap(500, new AiUsageTodaySnapshot(2_500_000), false, Localizer);
        Assert.Equal("$2.50 / $5.00", display.AmountText);
        Assert.Equal(50, display.Pct);
        Assert.Equal("TsColorInfoBrush", display.AccentBrushKey);
    }

    [Fact]
    public void CostCap_clamps_over_budget_to_full_and_warns()
    {
        var display = AiSettingsProjection.ProjectCostCap(500, new AiUsageTodaySnapshot(6_000_000), false, Localizer);
        Assert.Equal(100, display.Pct);
        Assert.Equal("$6.00 / $5.00", display.AmountText);
        Assert.NotNull(display.Hint);
    }

    [Fact]
    public void CostCap_loading_shows_the_loading_caption()
    {
        var display = AiSettingsProjection.ProjectCostCap(500, null, true, Localizer);
        Assert.Equal("Loading\u2026", display.AmountText);
    }

    [Fact]
    public void CostCap_zero_cap_is_empty_and_ok()
    {
        var display = AiSettingsProjection.ProjectCostCap(0, new AiUsageTodaySnapshot(100), false, Localizer);
        Assert.Equal(0, display.Pct);
        Assert.Equal(AiCostCapLevel.Ok, display.Level);
    }

    // ---- Save patch builder (web handleSave) ---------------------------------------

    [Fact]
    public void SavePatch_off_mode_sends_minimal_patch_and_preserves_other_keys()
    {
        var snap = SnapshotFromJson(
            """{"ai_mode":"cloud","ai_cost_cap_cents":500,"ai_provider_config":{"default":"openai","openai":{"model":"gpt-4o"}},"theme":"dark"}""");

        var document = AiSettingsPatchBuilder.BuildSaveDocument(
            AiMode.Off, new Dictionary<string, bool>(StringComparer.Ordinal), AiProviderDraft.Empty, snap.DocumentJson);

        Assert.Equal("off", document["ai_mode"]!.GetValue<string>());
        Assert.Empty((JsonObject)document["ai_features"]!);
        Assert.NotNull(document["ai_provider_config"]);
        Assert.Equal(500, document["ai_cost_cap_cents"]!.GetValue<long>());
        Assert.Equal("dark", document["theme"]!.GetValue<string>());
    }

    [Fact]
    public void SavePatch_cloud_mode_builds_namespaced_config_and_strips_legacy_keys()
    {
        var snap = SnapshotFromJson(
            """{"ai_mode":"local","ai_provider_config":{"provider":"legacy","base_url":"old","openai":{"base_url":"https://old.example","model":"old","api_key":"sk-existing","api_version":"2024-01"}}}""");
        var draft = new AiProviderDraft(
            "openai", "https://api.openai.com", "gpt-4o", string.Empty, 1000,
            string.Empty, string.Empty, string.Empty, string.Empty, string.Empty);
        var features = new Dictionary<string, bool>(StringComparer.Ordinal) { ["chatbot-llm"] = true };

        var document = AiSettingsPatchBuilder.BuildSaveDocument(AiMode.Cloud, features, draft, snap.DocumentJson);

        Assert.Equal("cloud", document["ai_mode"]!.GetValue<string>());
        Assert.Equal(1000, document["ai_cost_cap_cents"]!.GetValue<long>());
        Assert.True(((JsonObject)document["ai_features"]!)["chatbot-llm"]!.GetValue<bool>());

        var config = (JsonObject)document["ai_provider_config"]!;
        Assert.Equal("openai", config["default"]!.GetValue<string>());
        Assert.False(config.ContainsKey("provider"));
        Assert.False(config.ContainsKey("base_url"));

        var entry = (JsonObject)config["openai"]!;
        Assert.Equal("https://api.openai.com", entry["base_url"]!.GetValue<string>());
        Assert.Equal("gpt-4o", entry["model"]!.GetValue<string>());
        Assert.Equal("sk-existing", entry["api_key"]!.GetValue<string>());
        Assert.Equal("2024-01", entry["api_version"]!.GetValue<string>());
    }

    [Fact]
    public void SavePatch_forwards_a_nonempty_key_and_omits_empty_optionals()
    {
        var draft = new AiProviderDraft(
            "openai", "https://api.openai.com", "gpt-4o", "sk-new", 0,
            string.Empty, string.Empty, string.Empty, string.Empty, string.Empty);

        var document = AiSettingsPatchBuilder.BuildSaveDocument(
            AiMode.Cloud, new Dictionary<string, bool>(StringComparer.Ordinal), draft, "{}");

        var entry = (JsonObject)((JsonObject)document["ai_provider_config"]!)["openai"]!;
        Assert.Equal("sk-new", entry["api_key"]!.GetValue<string>());
        Assert.True(entry.ContainsKey("base_url"));
        Assert.True(entry.ContainsKey("model"));
        Assert.False(entry.ContainsKey("api_version"));
        Assert.False(entry.ContainsKey("flavor"));
        Assert.False(entry.ContainsKey("deployment"));
    }

    [Fact]
    public void FeaturesPatch_merges_only_mode_and_features()
    {
        var snap = SnapshotFromJson(
            """{"ai_mode":"local","ai_cost_cap_cents":300,"ai_provider_config":{"default":"x"}}""");

        var document = AiSettingsPatchBuilder.BuildFeaturesDocument(
            AiMode.Local, new Dictionary<string, bool>(StringComparer.Ordinal) { ["a"] = true }, snap.DocumentJson);

        Assert.Equal("local", document["ai_mode"]!.GetValue<string>());
        Assert.True(((JsonObject)document["ai_features"]!)["a"]!.GetValue<bool>());
        Assert.Equal(300, document["ai_cost_cap_cents"]!.GetValue<long>());
        Assert.NotNull(document["ai_provider_config"]);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_with_no_cache()
    {
        using var vm = NewViewModel(RepositoryResult<AiSettingsSnapshot>.Loading());
        await vm.LoadAsync();
        Assert.Equal(AiSettingsPanelState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_hydrates_the_draft()
    {
        var snap = SnapshotFromJson("""{"ai_mode":"local","ai_features":{"chatbot-llm":true}}""");
        using var vm = NewViewModel(Loaded(snap));

        await vm.LoadAsync();

        Assert.Equal(AiSettingsPanelState.Loaded, vm.State);
        Assert.Equal(AiMode.Local, vm.Mode);
        Assert.True(vm.Features["chatbot-llm"]);
        Assert.True(vm.ShowProviderSection);
        Assert.False(vm.IsCloud);
    }

    [Fact]
    public async Task ViewModel_empty_renders_off_defaults()
    {
        using var vm = NewViewModel(RepositoryResult<AiSettingsSnapshot>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal(AiSettingsPanelState.Empty, vm.State);
        Assert.Equal(AiMode.Off, vm.Mode);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache()
    {
        using var vm = NewViewModel(
            RepositoryResult<AiSettingsSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(AiSettingsPanelState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_the_form()
    {
        var snap = SnapshotFromJson("""{"ai_mode":"cloud","ai_cost_cap_cents":0}""");
        using var vm = NewViewModel(RepositoryResult<AiSettingsSnapshot>.Cached(snap, Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(AiSettingsPanelState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.Equal(AiMode.Cloud, vm.Mode);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_the_form_and_sets_the_chip()
    {
        var snap = SnapshotFromJson("""{"ai_mode":"local"}""");
        using var vm = NewViewModel(RepositoryResult<AiSettingsSnapshot>.OfflineCached(
            snap, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(AiSettingsPanelState.Offline, vm.State);
        Assert.True(vm.IsError);
        Assert.True(vm.IsStale);
    }

    [Fact]
    public async Task ViewModel_set_mode_off_clears_features()
    {
        var snap = SnapshotFromJson("""{"ai_mode":"local","ai_features":{"a":true,"b":true}}""");
        using var vm = NewViewModel(Loaded(snap));
        await vm.LoadAsync();
        Assert.Equal(2, vm.Features.Count);

        vm.SetMode(AiMode.Off);

        Assert.Equal(AiMode.Off, vm.Mode);
        Assert.Empty(vm.Features);
        Assert.False(vm.ShowProviderSection);
    }

    [Fact]
    public async Task ViewModel_cloud_cost_cap_loads_usage_and_projects_it()
    {
        var snap = SnapshotFromJson("""{"ai_mode":"cloud","ai_cost_cap_cents":500}""");
        var usage = new[] { RepositoryResult<AiUsageTodaySnapshot>.Loaded(new AiUsageTodaySnapshot(2_500_000), Now) };
        var source = new FakeAiSettingsSource(new[] { Loaded(snap) }, usage);
        using var vm = new AiSettingsViewModel(source, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.True(vm.IsCloud);
        Assert.True(vm.CostCapVisible);
        Assert.Equal(AiCostCapLevel.Ok, vm.CostCapDisplay.Level);
        Assert.Equal("$2.50 / $5.00", vm.CostCapDisplay.AmountText);
    }

    [Fact]
    public async Task ViewModel_save_builds_the_patch_and_clears_pending()
    {
        var snap = SnapshotFromJson("""{"ai_mode":"local","ai_features":{"a":true}}""");
        var source = new FakeAiSettingsSource(new[] { Loaded(snap) })
        {
            SaveResult = AiSettingsSaveOutcome.Ok(snap),
        };
        using var vm = new AiSettingsViewModel(source, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.SaveAsync();

        var document = Assert.Single(source.SavedDocuments);
        Assert.Equal("local", document["ai_mode"]!.GetValue<string>());
        Assert.Null(vm.SaveError);
        Assert.False(vm.IsSaving);
    }

    [Fact]
    public async Task ViewModel_save_failure_sets_the_error()
    {
        var snap = SnapshotFromJson("""{"ai_mode":"local"}""");
        var source = new FakeAiSettingsSource(new[] { Loaded(snap) })
        {
            SaveResult = AiSettingsSaveOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "save boom")),
        };
        using var vm = new AiSettingsViewModel(source, Localizer, () => Now);
        await vm.LoadAsync();

        await vm.SaveAsync();

        Assert.Equal("save boom", vm.SaveError);
        Assert.False(vm.IsSaving);
    }

    [Fact]
    public async Task ViewModel_restore_confirm_applies_the_archive_and_saves()
    {
        var snap = SnapshotFromJson(
            """{"ai_mode":"local","ai_features":{},"ai_features_archived":{"a":true,"b":false}}""");
        var afterRestore = SnapshotFromJson("""{"ai_mode":"local","ai_features":{"a":true,"b":false}}""");
        var source = new FakeAiSettingsSource(new[] { Loaded(snap) })
        {
            SaveResult = AiSettingsSaveOutcome.Ok(afterRestore),
        };
        using var vm = new AiSettingsViewModel(source, Localizer, () => Now);
        await vm.LoadAsync();
        Assert.True(vm.ShowRestorePanel);

        await vm.ConfirmRestoreAsync();

        var document = Assert.Single(source.SavedDocuments);
        var features = (JsonObject)document["ai_features"]!;
        Assert.True(features["a"]!.GetValue<bool>());
        Assert.False(features["b"]!.GetValue<bool>());
        Assert.True(vm.Features["a"]);
        Assert.False(vm.ShowRestorePanel);
    }

    [Fact]
    public async Task ViewModel_restore_decline_dismisses_the_prompt()
    {
        var snap = SnapshotFromJson("""{"ai_mode":"local","ai_features_archived":{"a":true}}""");
        using var vm = NewViewModel(Loaded(snap));
        await vm.LoadAsync();
        Assert.True(vm.ShowRestorePanel);

        vm.DeclineRestore();

        Assert.True(vm.RestoreDismissed);
        Assert.False(vm.ShowRestorePanel);
    }

    [Fact]
    public void ViewModel_exposes_localized_copy_through_the_facade()
    {
        using var vm = new AiSettingsViewModel(new FakeAiSettingsSource(), Localizer, () => Now);

        Assert.Equal("Helix", vm.Title);
        Assert.StartsWith("Optional. Helix is off", vm.Subtitle);
        Assert.Equal("Helix mode", vm.ModeLegend);
        Assert.Equal("Off (default)", vm.ModeOffLabel);
        Assert.Equal("Local-only", vm.ModeLocalLabel);
        Assert.Equal("Cloud", vm.ModeCloudLabel);
        Assert.Equal("Save Helix settings", vm.SaveLabel);
        Assert.Equal("Saving\u2026", vm.SavingLabel);
    }

    // ---- Repository source request shapes ------------------------------------------

    [Fact]
    public async Task Source_streams_settings_and_targets_the_generated_operation()
    {
        using var doc = JsonDocument.Parse("""{"ai_mode":"local","ai_features":{"x":true}}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamSettingsAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(AiMode.Local, emissions[^1].Value!.Mode);
        Assert.Equal("get_api_v1_settings", client.Requests[^1].OperationId);
        Assert.Equal(AiSettingsSource.SettingsOperation, client.Requests[^1].OperationId);
    }

    [Fact]
    public async Task Source_streams_usage_and_targets_the_generated_operation()
    {
        using var doc = JsonDocument.Parse("""{"cost_micro_cents":1500000}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamUsageTodayAsync());

        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(1_500_000, emissions[^1].Value!.CostMicroCents);
        Assert.Equal("get_api_v1_ai_usage_today", client.Requests[^1].OperationId);
    }

    [Fact]
    public async Task Source_treats_a_non_object_body_as_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamSettingsAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    [Fact]
    public async Task Source_save_posts_the_document_to_the_put_operation()
    {
        using var doc = JsonDocument.Parse("""{"ai_mode":"cloud"}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);
        var body = new JsonObject { ["ai_mode"] = "cloud" };

        var outcome = await source.SaveAsync(body);

        Assert.True(outcome.Success);
        Assert.Equal(AiMode.Cloud, outcome.Snapshot!.Mode);
        Assert.Equal("put_api_v1_settings", client.Requests[^1].OperationId);
        Assert.Same(body, client.Requests[^1].Body);
    }

    [Fact]
    public async Task Source_save_classifies_a_transport_fault()
    {
        var client = new FakeApiClient().Throws(new HttpRequestException("down"));
        var source = NewSource(client);

        var outcome = await source.SaveAsync(new JsonObject());

        Assert.False(outcome.Success);
        Assert.NotNull(outcome.Error);
        Assert.Equal(RepositoryErrorKind.Network, outcome.Error!.Kind);
    }

    // ---- Registry + diagnostics ----------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_copy()
    {
        Assert.Equal("ai-settings-panel", AiSettingsRegistration.Id);
        Assert.Equal("AISettings", AiSettingsRegistration.Slug);
        Assert.Equal("Helix", AiSettingsRegistration.Title(Localizer));
        Assert.StartsWith("Optional. Helix is off", AiSettingsRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new AiSettingsDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AISettings", Assert.Single(sink));
    }

    // ---- helpers -------------------------------------------------------------------

    private static AiSettingsViewModel NewViewModel(params RepositoryResult<AiSettingsSnapshot>[] results) =>
        new(new FakeAiSettingsSource(results), Localizer, () => Now);

    private static AiSettingsSnapshot SnapshotFromJson(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return AiSettingsSnapshot.FromJson(doc.RootElement);
    }

    private static RepositoryResult<AiSettingsSnapshot> Loaded(AiSettingsSnapshot snapshot) =>
        RepositoryResult<AiSettingsSnapshot>.Loaded(snapshot, Now);

    private static AiSettingsSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new AiSettingsSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<T>>> Collect<T>(IAsyncEnumerable<RepositoryResult<T>> stream)
    {
        var list = new List<RepositoryResult<T>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeAiSettingsSource : IAiSettingsSource
    {
        private readonly RepositoryResult<AiSettingsSnapshot>[] _settings;
        private readonly RepositoryResult<AiUsageTodaySnapshot>[] _usage;

        public FakeAiSettingsSource(
            IReadOnlyList<RepositoryResult<AiSettingsSnapshot>>? settings = null,
            IReadOnlyList<RepositoryResult<AiUsageTodaySnapshot>>? usage = null)
        {
            _settings = settings?.ToArray() ?? Array.Empty<RepositoryResult<AiSettingsSnapshot>>();
            _usage = usage?.ToArray()
                ?? new[] { RepositoryResult<AiUsageTodaySnapshot>.Loaded(AiUsageTodaySnapshot.Empty, Now) };
        }

        public List<JsonObject> SavedDocuments { get; } = new();

        public AiSettingsSaveOutcome SaveResult { get; set; } = AiSettingsSaveOutcome.Ok(AiSettingsSnapshot.Empty);

        public async IAsyncEnumerable<RepositoryResult<AiSettingsSnapshot>> StreamSettingsAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in _settings)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
                await Task.Yield();
            }
        }

        public async IAsyncEnumerable<RepositoryResult<AiUsageTodaySnapshot>> StreamUsageTodayAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in _usage)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
                await Task.Yield();
            }
        }

        public Task<AiSettingsSaveOutcome> SaveAsync(JsonObject document, CancellationToken cancellationToken = default)
        {
            SavedDocuments.Add(document);
            return Task.FromResult(SaveResult);
        }
    }
}
