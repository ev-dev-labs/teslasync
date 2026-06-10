using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Preset-Gallery surface's UI-thread-free logic — the preset JSON parse adapter,
/// the icon-glyph and trigger-label mappings, the projection into localized cards (em-dash for a blank name,
/// the interpolated "{count} actions" chip, the first-trigger label or "No trigger configured"), the
/// install-target builder (web <c>/automations/new?preset=id</c>), the cache-then-network result mapper, the
/// repository source's request shape, the state-holder view-model's per-state matrix (loading / loaded / empty
/// / error / stale / offline) plus its Install navigation, the registry metadata, the Narrator labels and the
/// PII-safe diagnostics. Mirrors the web spec (web/src/features/automations/pages/PresetGallery.tsx).
/// </summary>
public sealed class PresetGalleryTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // Two presets: a Shield/event preset with two actions, and a Moon/schedule preset with one action.
    private const string PresetsJson = """
    {
      "categories": [ { "id": "security", "name": "Security", "description": "Keep it safe", "icon": "Shield" } ],
      "presets": [
        { "id": "sentry_alert", "name": "Sentry Alert", "description": "Notify on sentry events", "category": "security", "icon": "Shield",
          "triggers": [ { "kind": "trigger_event" } ], "actions": [ { "kind": "action_notify" }, { "kind": "action_command" } ] },
        { "id": "night_charge", "name": "Night Charge", "description": "Charge overnight", "category": "charging", "icon": "Moon",
          "triggers": [ { "kind": "trigger_schedule" } ], "actions": [ { "kind": "action_command" } ] }
      ]
    }
    """;

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseResponse_reads_every_preset_field()
    {
        using var doc = JsonDocument.Parse(PresetsJson);
        var rows = AutomationPresetRow.ParseResponse(doc.RootElement);

        Assert.Equal(2, rows.Count);
        Assert.Equal("sentry_alert", rows[0].Id);
        Assert.Equal("Sentry Alert", rows[0].Name);
        Assert.Equal("Notify on sentry events", rows[0].Description);
        Assert.Equal("Shield", rows[0].Icon);
        Assert.Equal("trigger_event", rows[0].FirstTriggerKind);
        Assert.Equal(2, rows[0].ActionCount);
        Assert.Equal("trigger_schedule", rows[1].FirstTriggerKind);
        Assert.Equal(1, rows[1].ActionCount);
    }

    [Fact]
    public void ParseResponse_accepts_bare_array()
    {
        using var doc = JsonDocument.Parse("""[ { "id": "x", "name": "X", "actions": [] } ]""");
        var rows = AutomationPresetRow.ParseResponse(doc.RootElement);

        Assert.Single(rows);
        Assert.Equal("x", rows[0].Id);
    }

    [Fact]
    public void ParseResponse_non_object_or_missing_presets_is_empty()
    {
        using var noArray = JsonDocument.Parse("""{ "presets": "nope" }""");
        Assert.Empty(AutomationPresetRow.ParseResponse(noArray.RootElement));

        using var scalar = JsonDocument.Parse("42");
        Assert.Empty(AutomationPresetRow.ParseResponse(scalar.RootElement));
    }

    [Fact]
    public void FromJson_tolerates_missing_and_non_string_fields()
    {
        using var doc = JsonDocument.Parse("""{ "triggers": [], "actions": "oops" }""");
        var row = AutomationPresetRow.FromJson(doc.RootElement);

        Assert.Equal(string.Empty, row.Id);
        Assert.Equal(string.Empty, row.Name);
        Assert.Equal(string.Empty, row.Description);
        Assert.Equal(string.Empty, row.Icon);
        Assert.Null(row.FirstTriggerKind);
        Assert.Equal(0, row.ActionCount);
    }

    [Fact]
    public void FromJson_accepts_numeric_id()
    {
        using var doc = JsonDocument.Parse("""{ "id": 101, "name": "N", "actions": [ {} ] }""");
        var row = AutomationPresetRow.FromJson(doc.RootElement);

        Assert.Equal("101", row.Id);
        Assert.Equal(1, row.ActionCount);
    }

    // ---- Icon glyph mapping (web iconMap) ------------------------------------------

    [Theory]
    [InlineData("Shield")]
    [InlineData("ShieldCheck")]
    [InlineData("Moon")]
    [InlineData("Sun")]
    [InlineData("Lock")]
    [InlineData("UserX")]
    [InlineData("CarFront")]
    [InlineData("Siren")]
    public void IconGlyphs_resolve_every_known_key_to_a_glyph(string key)
    {
        string glyph = PresetIconGlyphs.Resolve(key);
        Assert.False(string.IsNullOrEmpty(glyph));
    }

    [Fact]
    public void IconGlyphs_unknown_key_falls_back_to_shield()
    {
        Assert.Equal(PresetIconGlyphs.Shield, PresetIconGlyphs.Resolve("Nope"));
        Assert.Equal(PresetIconGlyphs.Shield, PresetIconGlyphs.Resolve(null));
        Assert.Equal(PresetIconGlyphs.Shield, PresetIconGlyphs.Resolve("Shield"));
    }

    // ---- Trigger label mapping (web triggerLabels) ---------------------------------

    [Theory]
    [InlineData("trigger_schedule", "Schedule")]
    [InlineData("trigger_event", "Vehicle Event")]
    [InlineData("trigger_geofence", "Geofence")]
    [InlineData("trigger_signal", "Signal Threshold")]
    public void TriggerLabels_resolve_known_kinds(string kind, string fallback)
    {
        Assert.True(PresetTriggerLabels.TryResolve(kind, out var label));
        Assert.Equal(fallback, label.Fallback);
        Assert.StartsWith("automations.builder.trigger", label.Key, StringComparison.Ordinal);
    }

    [Fact]
    public void TriggerLabels_unknown_kind_is_no_trigger()
    {
        Assert.False(PresetTriggerLabels.TryResolve("trigger_unknown", out var label));
        Assert.Equal(PresetTriggerLabels.NoTriggerKey, label.Key);
        Assert.Equal("No trigger configured", label.Fallback);

        Assert.False(PresetTriggerLabels.TryResolve(null, out _));
    }

    // ---- Projection (web render) ---------------------------------------------------

    [Fact]
    public void Project_builds_one_localized_card_per_preset()
    {
        using var doc = JsonDocument.Parse(PresetsJson);
        var rows = AutomationPresetRow.ParseResponse(doc.RootElement);

        var display = PresetGalleryProjection.Project(rows, Localizer);

        Assert.True(display.HasData);
        Assert.Equal(2, display.Cards.Count);

        var first = display.Cards[0];
        Assert.Equal("sentry_alert", first.Id);
        Assert.Equal("Sentry Alert", first.Name);
        Assert.Equal("Notify on sentry events", first.Description);
        Assert.Equal(PresetIconGlyphs.Shield, first.IconGlyph);
        Assert.Equal("Vehicle Event", first.TriggerLabel);
        Assert.Equal("2 actions", first.ActionCountLabel);
        Assert.Equal("Install", first.InstallLabel);
    }

    [Fact]
    public void Project_blank_name_renders_em_dash()
    {
        var row = Row("p1", string.Empty, "desc", "Shield", "trigger_event", 1);
        var card = PresetGalleryProjection.ProjectCard(row, Localizer);

        Assert.Equal(EmDash, card.Name);
    }

    [Fact]
    public void ProjectCard_no_trigger_uses_no_trigger_label()
    {
        var row = Row("p1", "Name", "desc", "Shield", firstTriggerKind: null, actionCount: 0);
        var card = PresetGalleryProjection.ProjectCard(row, Localizer);

        Assert.Equal("No trigger configured", card.TriggerLabel);
        Assert.Equal("0 actions", card.ActionCountLabel);
    }

    [Fact]
    public void ProjectCard_automation_name_includes_name_trigger_and_count()
    {
        var row = Row("p1", "Sentry Alert", "desc", "Shield", "trigger_event", 2);
        var card = PresetGalleryProjection.ProjectCard(row, Localizer);

        Assert.Contains("Sentry Alert", card.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Vehicle Event", card.AutomationName, StringComparison.Ordinal);
        Assert.Contains("2 actions", card.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_empty_list_has_no_data()
    {
        var display = PresetGalleryProjection.Project(Array.Empty<AutomationPresetRow>(), Localizer);

        Assert.False(display.HasData);
        Assert.Empty(display.Cards);
    }

    [Fact]
    public void Project_constants_match_web()
    {
        Assert.Equal("\u2014", PresetGalleryProjection.EmDash);
        Assert.Equal("automations.presets.actionCount", PresetGalleryProjection.ActionCountKey);
        Assert.Equal("{{count}} actions", PresetGalleryProjection.ActionCountFallback);
        Assert.Equal("automations.presets.install", PresetGalleryProjection.InstallKey);
        Assert.Equal("automations.presets.empty", PresetGalleryProjection.EmptyKey);
        Assert.Equal("No preset templates available", PresetGalleryProjection.EmptyFallback);
    }

    // ---- Install target (web navigate) ---------------------------------------------

    [Fact]
    public void BuildInstallTarget_matches_web_builder_deeplink()
    {
        var target = PresetGalleryRegistration.BuildInstallTarget("sentry_alert");

        Assert.Equal("sentry_alert", target.PresetId);
        Assert.Equal("automations/new", target.RoutePath);
        Assert.Equal("?preset=sentry_alert", target.Search);
        Assert.Equal("/automations/new?preset=sentry_alert", target.Href);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Map_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse(PresetsJson);

        var cached = PresetGalleryResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(2, cached.Value!.Count);

        var offline = PresetGalleryResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(2, offline.Value!.Count);
    }

    [Fact]
    public void Map_maps_loaded_empty_failure_and_loading()
    {
        using var doc = JsonDocument.Parse(PresetsJson);

        Assert.Equal(LoadStatus.Loaded, PresetGalleryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);
        Assert.Equal(LoadStatus.Empty, PresetGalleryResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(LoadStatus.Error, PresetGalleryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
        Assert.Equal(LoadStatus.Loading, PresetGalleryResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(new FakeNavigator(), RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(PresetGalleryState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_cards()
    {
        using var vm = NewViewModel(new FakeNavigator(), Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(PresetGalleryState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(2, vm.Display.Cards.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_presets_renders_empty()
    {
        using var vm = NewViewModel(new FakeNavigator(), Loaded(Array.Empty<AutomationPresetRow>()));
        await vm.LoadAsync();

        Assert.Equal(PresetGalleryState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No preset templates available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(new FakeNavigator(), RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(PresetGalleryState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            new FakeNavigator(),
            RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(PresetGalleryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            new FakeNavigator(),
            RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(PresetGalleryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(new FakeNavigator(), RepositoryResult<IReadOnlyList<AutomationPresetRow>>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(PresetGalleryState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            new FakeNavigator(),
            RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Loading(),
            RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Cached(Sample(), Now, stale: false),
            RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(PresetGalleryState.Loaded, vm.State);
        Assert.Equal("2 actions", vm.Display.Cards[0].ActionCountLabel);
    }

    [Fact]
    public async Task ViewModel_install_dispatches_builder_deeplink()
    {
        var navigator = new FakeNavigator();
        using var vm = NewViewModel(navigator, Loaded(Sample()));
        await vm.LoadAsync();

        vm.Install(vm.Display.Cards[0].Id);

        Assert.NotNull(navigator.LastTarget);
        Assert.Equal("sentry_alert", navigator.LastTarget!.PresetId);
        Assert.Equal("/automations/new?preset=sentry_alert", navigator.LastTarget.Href);
    }

    [Fact]
    public async Task ViewModel_install_ignores_blank_id()
    {
        var navigator = new FakeNavigator();
        using var vm = NewViewModel(navigator, Loaded(Sample()));
        await vm.LoadAsync();

        vm.Install("   ");

        Assert.Null(navigator.LastTarget);
    }

    [Fact]
    public async Task ViewModel_labels_resolve_through_i18n()
    {
        using var vm = NewViewModel(new FakeNavigator(), RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Quick Start Templates", vm.Title);
        Assert.Equal("Retry", vm.RetryLabel);
        Assert.Equal("Loading preset templates", vm.LoadingLabel);
        Assert.Equal("No preset templates available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(new FakeNavigator(), Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(PresetGalleryViewModel.State), changed);
        Assert.Contains(nameof(PresetGalleryViewModel.Display), changed);
    }

    // ---- Repository source request shape (engine + fake client) ---------------------

    [Fact]
    public async Task Source_streams_presets_and_targets_the_presets_operation()
    {
        using var doc = JsonDocument.Parse(PresetsJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(2, emissions[^1].Value!.Count);

        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_automations_presets", request.OperationId);
        Assert.Null(request.Query);
    }

    [Fact]
    public async Task Source_scopes_by_category_when_supplied()
    {
        using var doc = JsonDocument.Parse(PresetsJson);
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = new PresetGallerySource(client, NewEngine(), NewOptions(), category: "security");

        await Collect(source.StreamAsync());

        var request = client.Requests[^1];
        Assert.Equal("get_api_v1_automations_presets", request.OperationId);
        Assert.NotNull(request.Query);
        Assert.Equal("security", request.Query!["category"]);
    }

    [Fact]
    public async Task Source_object_without_presets_streams_empty()
    {
        using var doc = JsonDocument.Parse("""{ "categories": [], "presets": [] }""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("preset-gallery", PresetGalleryRegistration.Id);
        Assert.Equal("automations", PresetGalleryRegistration.Category);
        Assert.Equal("PresetGallery", PresetGalleryRegistration.Slug);
        Assert.Equal("automations/new", PresetGalleryRegistration.BuilderRoutePath);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new PresetGalleryDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=PresetGallery", Assert.Single(sink));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static AutomationPresetRow Row(
        string id,
        string name,
        string description,
        string icon,
        string? firstTriggerKind,
        int actionCount) =>
        new(id, name, description, icon, firstTriggerKind, actionCount);

    private static IReadOnlyList<AutomationPresetRow> Sample() =>
        new[]
        {
            Row("sentry_alert", "Sentry Alert", "Notify on sentry events", "Shield", "trigger_event", 2),
            Row("night_charge", "Night Charge", "Charge overnight", "Moon", "trigger_schedule", 1),
        };

    private static RepositoryResult<IReadOnlyList<AutomationPresetRow>> Loaded(IReadOnlyList<AutomationPresetRow> presets) =>
        RepositoryResult<IReadOnlyList<AutomationPresetRow>>.Loaded(presets, Now);

    private static PresetGalleryViewModel NewViewModel(
        IPresetGalleryNavigator navigator,
        params RepositoryResult<IReadOnlyList<AutomationPresetRow>>[] emissions) =>
        new(new FakeSource(emissions), navigator, Localizer, () => Now);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static ApiClientOptions NewOptions() => new() { BaseAddress = new Uri("http://localhost") };

    private static PresetGallerySource NewSource(IApiClient client) => new(client, NewEngine(), NewOptions());

    private static async Task<IReadOnlyList<RepositoryResult<IReadOnlyList<AutomationPresetRow>>>> Collect(
        IAsyncEnumerable<RepositoryResult<IReadOnlyList<AutomationPresetRow>>> stream)
    {
        var list = new List<RepositoryResult<IReadOnlyList<AutomationPresetRow>>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<AutomationPresetRow>>[] emissions)
        : IPresetGallerySource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<AutomationPresetRow>>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakeNavigator : IPresetGalleryNavigator
    {
        public PresetInstallTarget? LastTarget { get; private set; }

        public void OpenBuilder(PresetInstallTarget target) => LastTarget = target;
    }
}
