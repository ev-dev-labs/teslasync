using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the AppearanceSettings surface's UI-thread-free logic — the settings JSON parse
/// adapter (the <c>ui_density</c> / <c>time_format_default</c> / <c>chart_palette</c> read plus the
/// full-replace merge body), the wire-token mapping, the local-preference record, the projection (every
/// section's labels, active selection, preview rows, palette swatches, i18n keys and accessibility names),
/// the cache-then-network result mapper, the registration metadata, the diagnostics, and the state-holder
/// view-model's per-state transitions (loading / loaded / empty / error / stale / offline) plus its optimistic
/// server saves and instant local-preference mutations. Mirrors the web spec
/// (web/src/features/settings/components/AppearanceSettings.tsx).
/// </summary>
public sealed class AppearanceSettingsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter (web useSettings read) --------------------------------------

    [Fact]
    public void FromJson_reads_the_three_appearance_keys()
    {
        var settings = AppearanceServerSettings.FromJson(Json("""
        { "ui_density": "spacious", "time_format_default": "absolute", "chart_palette": "neon" }
        """));

        Assert.Equal(DensityChoice.Spacious, settings.Density);
        Assert.Equal(TimeFormatChoice.Absolute, settings.TimeFormat);
        Assert.Equal(ChartPaletteChoice.Neon, settings.ChartPalette);
    }

    [Fact]
    public void FromJson_defaults_absent_or_invalid_fields()
    {
        var settings = AppearanceServerSettings.FromJson(Json("""{ "ui_density": "nonsense" }"""));

        Assert.Equal(DensityChoice.Comfortable, settings.Density);
        Assert.Equal(TimeFormatChoice.Relative, settings.TimeFormat);
        Assert.Equal(ChartPaletteChoice.CbSafe, settings.ChartPalette);
    }

    [Fact]
    public void FromJson_returns_defaults_for_non_object()
    {
        var settings = AppearanceServerSettings.FromJson(Json("[]"));

        Assert.Equal(AppearanceServerSettings.Default.Density, settings.Density);
        Assert.Empty(settings.Raw);
    }

    [Fact]
    public void ToRequestBody_preserves_other_fields_and_overrides_the_three_keys()
    {
        var settings = AppearanceServerSettings.FromJson(Json("""
        { "ui_density": "compact", "theme": "tesla-red", "language": "en", "alert_email": "a@b.c" }
        """));

        var body = settings.WithDensity(DensityChoice.Spacious)
            .WithTimeFormat(TimeFormatChoice.Absolute)
            .WithChartPalette(ChartPaletteChoice.Neon)
            .ToRequestBody();

        // The web partial-merge keeps every other field of the settings document...
        Assert.True(body.ContainsKey("theme"));
        Assert.True(body.ContainsKey("language"));
        Assert.True(body.ContainsKey("alert_email"));

        // ...and authors the three appearance keys from the typed choices (snake_case wire tokens).
        Assert.Equal("spacious", (string?)body["ui_density"]);
        Assert.Equal("absolute", (string?)body["time_format_default"]);
        Assert.Equal("neon", (string?)body["chart_palette"]);
    }

    [Fact]
    public void With_helpers_change_one_field_only()
    {
        var settings = new AppearanceServerSettings(
            DensityChoice.Comfortable, TimeFormatChoice.Relative, ChartPaletteChoice.CbSafe,
            new Dictionary<string, JsonElement>());

        var next = settings.WithChartPalette(ChartPaletteChoice.Neon);

        Assert.Equal(ChartPaletteChoice.Neon, next.ChartPalette);
        Assert.Equal(DensityChoice.Comfortable, next.Density);
        Assert.Equal(TimeFormatChoice.Relative, next.TimeFormat);
    }

    // ---- Wire token mapping --------------------------------------------------------

    [Theory]
    [InlineData(DensityChoice.Compact, "compact")]
    [InlineData(DensityChoice.Comfortable, "comfortable")]
    [InlineData(DensityChoice.Spacious, "spacious")]
    public void Density_tokens_round_trip(DensityChoice choice, string token)
    {
        Assert.Equal(token, AppearanceWire.Token(choice));
        Assert.Equal(choice, AppearanceWire.ParseDensity(token));
    }

    [Theory]
    [InlineData(SidebarStyleChoice.Linear, "linear")]
    [InlineData(SidebarStyleChoice.Notion, "notion")]
    [InlineData(SidebarStyleChoice.Legacy, "legacy")]
    public void Sidebar_tokens_round_trip(SidebarStyleChoice choice, string token)
    {
        Assert.Equal(token, AppearanceWire.Token(choice));
        Assert.Equal(choice, AppearanceWire.ParseSidebar(token));
    }

    [Fact]
    public void Unknown_tokens_fall_back_to_defaults()
    {
        Assert.Equal(DensityChoice.Comfortable, AppearanceWire.ParseDensity(null));
        Assert.Equal(TimeFormatChoice.Relative, AppearanceWire.ParseTimeFormat("???"));
        Assert.Equal(ChartPaletteChoice.CbSafe, AppearanceWire.ParseChartPalette(""));
        Assert.Equal(SidebarStyleChoice.Linear, AppearanceWire.ParseSidebar("???"));
    }

    // ---- Local preferences ---------------------------------------------------------

    [Fact]
    public void Local_preferences_defaults_match_the_web_hooks()
    {
        var prefs = AppearanceLocalPreferences.Default;

        Assert.Equal(SidebarStyleChoice.Linear, prefs.SidebarStyle);
        Assert.True(prefs.StatusBarEnabled);
        Assert.False(prefs.StatusBarIconOnly);
        Assert.True(prefs.CelebrationShowToasts);
        Assert.False(prefs.CelebrationPlaySound);
        Assert.True(prefs.CelebrationShowOnDashboard);
        Assert.True(prefs.CelebrationPushOnUnlock);
    }

    [Fact]
    public void Local_preferences_normalize_an_undefined_sidebar_enum()
    {
        var prefs = (AppearanceLocalPreferences.Default with { SidebarStyle = (SidebarStyleChoice)42 }).Normalized();

        Assert.Equal(SidebarStyleChoice.Linear, prefs.SidebarStyle);
    }

    [Fact]
    public void InMemory_preference_store_round_trips_and_counts_saves()
    {
        var store = new InMemoryAppearanceLocalPreferences();
        var updated = AppearanceLocalPreferences.Default with { SidebarStyle = SidebarStyleChoice.Notion, StatusBarEnabled = false };

        store.Save(updated);

        Assert.Equal(1, store.SaveCount);
        Assert.Equal(SidebarStyleChoice.Notion, store.Load().SidebarStyle);
        Assert.False(store.Load().StatusBarEnabled);
    }

    // ---- Projection: titles + i18n keys --------------------------------------------

    [Fact]
    public void Projection_resolves_header_through_i18n()
    {
        var display = Project();

        Assert.Equal("Appearance", display.Title);
        Assert.Equal("Customize colors and display mode", display.Subtitle);
    }

    [Fact]
    public void Projection_density_has_three_options_with_the_active_one_marked()
    {
        var display = Project(Settings(density: DensityChoice.Spacious));

        Assert.Equal(3, display.Density.Options.Count);
        Assert.Equal("Information density", display.Density.Label);
        Assert.Equal("Compact", display.Density.Options[0].Label);
        Assert.Equal("Tight rows \u2014 fits more on screen", display.Density.Options[0].Help);
        Assert.True(display.Density.Options.Single(o => o.Id == DensityChoice.Spacious).IsActive);
        Assert.False(display.Density.Options.Single(o => o.Id == DensityChoice.Compact).IsActive);
    }

    [Fact]
    public void Projection_density_carries_the_three_preview_rows()
    {
        var display = Project();

        Assert.Equal("Preview", display.Density.PreviewTitle);
        Assert.Equal(3, display.Density.PreviewRows.Count);
        Assert.Equal("Sample row \u2014 Tesla Model 3", display.Density.PreviewRows[0]);
        Assert.Equal("Sample row \u2014 Tesla Model Y", display.Density.PreviewRows[1]);
        Assert.Equal("Sample row \u2014 Tesla Model S", display.Density.PreviewRows[2]);
    }

    [Fact]
    public void Projection_sidebar_has_three_options_labeled_minimal_compact_classic()
    {
        var display = Project(prefs: AppearanceLocalPreferences.Default with { SidebarStyle = SidebarStyleChoice.Legacy });

        Assert.Equal("Sidebar style", display.Sidebar.Label);
        Assert.Equal(new[] { "Minimal", "Compact", "Classic" }, display.Sidebar.Options.Select(o => o.Label).ToArray());
        Assert.True(display.Sidebar.Options.Single(o => o.Id == SidebarStyleChoice.Legacy).IsActive);
    }

    [Fact]
    public void Projection_time_format_has_two_options_with_active_marked()
    {
        var display = Project(Settings(timeFormat: TimeFormatChoice.Absolute));

        Assert.Equal("Default time format", display.TimeFormat.Label);
        Assert.Equal(2, display.TimeFormat.Options.Count);
        Assert.Equal("Relative (2h ago)", display.TimeFormat.Options[0].Label);
        Assert.Equal("Absolute (Nov 12, 13:42)", display.TimeFormat.Options[1].Label);
        Assert.True(display.TimeFormat.Options.Single(o => o.Id == TimeFormatChoice.Absolute).IsActive);
    }

    [Fact]
    public void Projection_chart_palette_carries_eight_swatches_per_option()
    {
        var display = Project(Settings(palette: ChartPaletteChoice.Neon));

        Assert.Equal("Chart palette", display.ChartPalette.Label);
        Assert.Equal(2, display.ChartPalette.Options.Count);
        Assert.Equal("Color-blind safe", display.ChartPalette.Options[0].Label);
        Assert.Equal("Stylistic neon", display.ChartPalette.Options[1].Label);
        Assert.All(display.ChartPalette.Options, o => Assert.Equal(8, o.Swatches.Count));
        Assert.Equal("#0072B2", display.ChartPalette.Options[0].Swatches[0]);
        Assert.Equal("#00f0ff", display.ChartPalette.Options[1].Swatches[0]);
        Assert.True(display.ChartPalette.Options.Single(o => o.Id == ChartPaletteChoice.Neon).IsActive);
    }

    [Fact]
    public void Projection_status_bar_reflects_prefs_and_disables_icon_only_when_hidden()
    {
        var hidden = Project(prefs: AppearanceLocalPreferences.Default with { StatusBarEnabled = false, StatusBarIconOnly = true });

        Assert.Equal("Status bar", hidden.StatusBar.Label);
        Assert.Equal("Show status bar", hidden.StatusBar.Show.Label);
        Assert.False(hidden.StatusBar.Show.IsOn);
        Assert.True(hidden.StatusBar.IconOnly.IsOn);
        Assert.False(hidden.StatusBar.IconOnly.IsEnabled); // web parity: dimmed while the bar is hidden

        var shown = Project(prefs: AppearanceLocalPreferences.Default with { StatusBarEnabled = true });
        Assert.True(shown.StatusBar.IconOnly.IsEnabled);
    }

    [Fact]
    public void Projection_celebration_has_four_toggle_rows()
    {
        var display = Project(prefs: AppearanceLocalPreferences.Default with
        {
            CelebrationShowToasts = false,
            CelebrationPlaySound = true,
        });

        Assert.Equal("Celebration", display.Celebration.Label);
        Assert.Equal("Show celebration toasts", display.Celebration.ShowToasts.Label);
        Assert.False(display.Celebration.ShowToasts.IsOn);
        Assert.True(display.Celebration.PlaySound.IsOn);
        Assert.Equal("Show recently unlocked on dashboard", display.Celebration.ShowOnDashboard.Label);
        Assert.Equal("Send push notifications for achievements", display.Celebration.PushOnUnlock.Label);
    }

    [Fact]
    public void Projection_tours_has_four_buttons_with_the_reset_destructive()
    {
        var tours = Project().Tours;

        Assert.Equal("Product tours", tours.Label);
        Assert.Equal(4, tours.Buttons.Count);
        Assert.Equal("Replay dashboard tour", tours.Buttons[0].Label);
        Assert.Equal("Debugger tour", tours.Buttons[1].Label);
        Assert.Equal("Automations tour", tours.Buttons[2].Label);
        Assert.Equal(TourAction.ResetAll, tours.Buttons[3].Action);
        Assert.Equal("Reset all tours", tours.Buttons[3].Label);
        Assert.Equal(TeslaSync.App.Core.ButtonVariant.Destructive, tours.Buttons[3].Variant);
    }

    [Fact]
    public void Projection_passes_through_the_server_controls_enabled_flag()
    {
        Assert.True(Project(serverControlsEnabled: true).ServerControlsEnabled);
        Assert.False(Project(serverControlsEnabled: false).ServerControlsEnabled);
    }

    // ---- Projection: accessibility names -------------------------------------------

    [Fact]
    public void Projection_every_interactive_element_has_a_narrator_name()
    {
        var display = Project();

        foreach (var option in display.Density.Options)
        {
            Assert.Equal($"{option.Label}. {option.Help}", option.AutomationName);
        }

        Assert.All(display.Sidebar.Options, o => Assert.False(string.IsNullOrWhiteSpace(o.AutomationName)));
        Assert.All(display.TimeFormat.Options, o => Assert.False(string.IsNullOrWhiteSpace(o.AutomationName)));
        Assert.All(display.ChartPalette.Options, o => Assert.False(string.IsNullOrWhiteSpace(o.AutomationName)));

        foreach (var row in new[]
                 {
                     display.StatusBar.Show, display.StatusBar.IconOnly,
                     display.Celebration.ShowToasts, display.Celebration.PlaySound,
                     display.Celebration.ShowOnDashboard, display.Celebration.PushOnUnlock,
                 })
        {
            Assert.Equal($"{row.Label}. {row.Help}", row.AutomationName);
        }
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Map_preserves_lifecycle_status_and_parses_the_value()
    {
        var json = Json("""{ "ui_density": "compact" }""");

        Assert.Equal(LoadStatus.Loading, Map(RepositoryResult<JsonElement>.Loading()).Status);

        var cached = Map(RepositoryResult<JsonElement>.Cached(json, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(DensityChoice.Compact, cached.Value!.Density);

        var loaded = Map(RepositoryResult<JsonElement>.Loaded(json, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Equal(DensityChoice.Compact, loaded.Value!.Density);

        Assert.Equal(LoadStatus.Empty, Map(RepositoryResult<JsonElement>.Empty(Now)).Status);

        var offline = Map(RepositoryResult<JsonElement>.OfflineCached(json, Now, new RepositoryError(RepositoryErrorKind.Network, "x")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.NotNull(offline.Value);

        var failure = Map(RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.NotNull(failure.Error);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("appearance-settings", AppearanceSettingsRegistration.Id);
        Assert.Equal("settings", AppearanceSettingsRegistration.Category);
        Assert.Equal("AppearanceSettings", AppearanceSettingsRegistration.Slug);
        Assert.Equal("Appearance", AppearanceSettingsRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AppearanceSettingsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AppearanceSettings", Assert.Single(lines));
    }

    // ---- ViewModel: per-state transitions ------------------------------------------

    [Fact]
    public async Task ViewModel_loading_with_no_cache_renders_loading()
    {
        using var vm = NewViewModel(RepositoryResult<AppearanceServerSettings>.Loading());
        await vm.LoadAsync();

        Assert.Equal(AppearanceSettingsState.Loading, vm.State);
        Assert.False(vm.ServerControlsEnabled);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_the_form_with_enabled_controls()
    {
        using var vm = NewViewModel(Loaded(Settings(density: DensityChoice.Spacious)));
        await vm.LoadAsync();

        Assert.Equal(AppearanceSettingsState.Loaded, vm.State);
        Assert.True(vm.ServerControlsEnabled);
        Assert.Equal(DensityChoice.Spacious, vm.ServerSettings.Density);
        Assert.True(vm.Display.Density.Options.Single(o => o.Id == DensityChoice.Spacious).IsActive);
        Assert.NotNull(vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_renders_full_form_with_defaults()
    {
        using var vm = NewViewModel(RepositoryResult<AppearanceServerSettings>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(AppearanceSettingsState.Empty, vm.State);
        Assert.True(vm.ServerControlsEnabled); // an empty {} document is still writable (web parity)
        Assert.Equal(DensityChoice.Comfortable, vm.ServerSettings.Density);
        Assert.Equal(3, vm.Display.Density.Options.Count);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<AppearanceServerSettings>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(AppearanceSettingsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.ServerControlsEnabled);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<AppearanceServerSettings>.Cached(Settings(density: DensityChoice.Compact), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(AppearanceSettingsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.Equal(DensityChoice.Compact, vm.ServerSettings.Density);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(
            RepositoryResult<AppearanceServerSettings>.OfflineCached(
                Settings(palette: ChartPaletteChoice.Neon),
                Now,
                new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(AppearanceSettingsState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.Equal(ChartPaletteChoice.Neon, vm.ServerSettings.ChartPalette);
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<AppearanceServerSettings>.Loading(),
            RepositoryResult<AppearanceServerSettings>.Cached(Settings(density: DensityChoice.Compact), Now, stale: false),
            RepositoryResult<AppearanceServerSettings>.Loaded(Settings(density: DensityChoice.Spacious), Now));
        await vm.LoadAsync();

        Assert.Equal(AppearanceSettingsState.Loaded, vm.State);
        Assert.Equal(DensityChoice.Spacious, vm.ServerSettings.Density);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Settings()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(AppearanceSettingsViewModel.State), changed);
        Assert.Contains(nameof(AppearanceSettingsViewModel.Display), changed);
    }

    // ---- ViewModel: server saves (web useSaveSettings) -----------------------------

    [Fact]
    public async Task SetDensityAsync_saves_the_merged_document_and_updates_state()
    {
        var source = new FakeAppearanceSettingsSource(Loaded(Settings(density: DensityChoice.Comfortable)));
        using var vm = new AppearanceSettingsViewModel(source, new InMemoryAppearanceLocalPreferences(), Localizer);
        await vm.LoadAsync();

        await vm.SetDensityAsync(DensityChoice.Compact);

        Assert.Equal(DensityChoice.Compact, vm.ServerSettings.Density);
        var saved = Assert.Single(source.Saved);
        Assert.Equal(DensityChoice.Compact, saved.Density);
        Assert.False(vm.IsSaving);
        Assert.True(vm.ServerControlsEnabled);
    }

    [Fact]
    public async Task SetDensityAsync_is_a_no_op_when_unchanged()
    {
        var source = new FakeAppearanceSettingsSource(Loaded(Settings(density: DensityChoice.Compact)));
        using var vm = new AppearanceSettingsViewModel(source, new InMemoryAppearanceLocalPreferences(), Localizer);
        await vm.LoadAsync();

        await vm.SetDensityAsync(DensityChoice.Compact);

        Assert.Empty(source.Saved);
    }

    [Fact]
    public async Task A_failed_save_reverts_the_optimistic_update_and_raises_a_toast()
    {
        var source = new FakeAppearanceSettingsSource(Loaded(Settings(palette: ChartPaletteChoice.CbSafe)))
        {
            SaveError = new InvalidOperationException("server down"),
        };
        using var vm = new AppearanceSettingsViewModel(source, new InMemoryAppearanceLocalPreferences(), Localizer);
        await vm.LoadAsync();
        var toasts = new List<string>();
        vm.ToastRequested += (_, m) => toasts.Add(m);

        await vm.SetChartPaletteAsync(ChartPaletteChoice.Neon);

        Assert.Equal(ChartPaletteChoice.CbSafe, vm.ServerSettings.ChartPalette); // reverted
        Assert.False(vm.IsSaving);
        Assert.NotEmpty(toasts);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    // ---- ViewModel: instant local mutations (web localStorage hooks) ---------------

    [Fact]
    public async Task SetSidebarStyle_persists_and_reprojects()
    {
        var store = new InMemoryAppearanceLocalPreferences();
        var source = new FakeAppearanceSettingsSource(Loaded(Settings()));
        using var vm = new AppearanceSettingsViewModel(source, store, Localizer);
        await vm.LoadAsync();

        vm.SetSidebarStyle(SidebarStyleChoice.Notion);

        Assert.Equal(SidebarStyleChoice.Notion, vm.LocalPreferences.SidebarStyle);
        Assert.Equal(SidebarStyleChoice.Notion, store.Load().SidebarStyle);
        Assert.True(vm.Display.Sidebar.Options.Single(o => o.Id == SidebarStyleChoice.Notion).IsActive);
        Assert.Equal(1, store.SaveCount);
    }

    [Fact]
    public async Task SetStatusBarEnabled_raises_the_shown_or_hidden_toast()
    {
        var source = new FakeAppearanceSettingsSource(Loaded(Settings()));
        using var vm = new AppearanceSettingsViewModel(source, new InMemoryAppearanceLocalPreferences(), Localizer);
        await vm.LoadAsync();
        var toasts = new List<string>();
        vm.ToastRequested += (_, m) => toasts.Add(m);

        vm.SetStatusBarEnabled(false);
        vm.SetStatusBarEnabled(true);

        Assert.Equal(new[] { "Status bar hidden", "Status bar shown" }, toasts);
        Assert.True(vm.LocalPreferences.StatusBarEnabled);
    }

    [Fact]
    public async Task Celebration_toggles_persist_each_flag()
    {
        var store = new InMemoryAppearanceLocalPreferences();
        var source = new FakeAppearanceSettingsSource(Loaded(Settings()));
        using var vm = new AppearanceSettingsViewModel(source, store, Localizer);
        await vm.LoadAsync();

        vm.SetCelebrationPlaySound(true);
        vm.SetCelebrationShowToasts(false);

        Assert.True(vm.LocalPreferences.CelebrationPlaySound);
        Assert.False(vm.LocalPreferences.CelebrationShowToasts);
        Assert.True(store.Load().CelebrationPlaySound);
        Assert.False(store.Load().CelebrationShowToasts);
    }

    // ---- ViewModel: product tours --------------------------------------------------

    [Fact]
    public void InvokeTour_forwards_replay_actions_to_the_host()
    {
        var source = new FakeAppearanceSettingsSource();
        using var vm = new AppearanceSettingsViewModel(source, new InMemoryAppearanceLocalPreferences(), Localizer);
        var actions = new List<TourAction>();
        vm.TourActionRequested += (_, a) => actions.Add(a);

        vm.InvokeTour(TourAction.ReplayMain);

        Assert.Equal(new[] { TourAction.ReplayMain }, actions);
    }

    [Fact]
    public void InvokeTour_reset_also_raises_the_success_toast()
    {
        var source = new FakeAppearanceSettingsSource();
        using var vm = new AppearanceSettingsViewModel(source, new InMemoryAppearanceLocalPreferences(), Localizer);
        var actions = new List<TourAction>();
        var toasts = new List<string>();
        vm.TourActionRequested += (_, a) => actions.Add(a);
        vm.ToastRequested += (_, m) => toasts.Add(m);

        vm.InvokeTour(TourAction.ResetAll);

        Assert.Equal(new[] { TourAction.ResetAll }, actions);
        Assert.Single(toasts);
        Assert.Contains("reset", toasts[0], StringComparison.OrdinalIgnoreCase);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private static AppearanceServerSettings Settings(
        DensityChoice density = DensityChoice.Comfortable,
        TimeFormatChoice timeFormat = TimeFormatChoice.Relative,
        ChartPaletteChoice palette = ChartPaletteChoice.CbSafe) =>
        new(density, timeFormat, palette, new Dictionary<string, JsonElement>());

    private static AppearanceSettingsDisplay Project(
        AppearanceServerSettings? settings = null,
        AppearanceLocalPreferences? prefs = null,
        bool serverControlsEnabled = true) =>
        AppearanceSettingsProjection.Project(
            settings ?? Settings(),
            prefs ?? AppearanceLocalPreferences.Default,
            serverControlsEnabled,
            Localizer);

    private static RepositoryResult<AppearanceServerSettings> Map(RepositoryResult<JsonElement> result) =>
        AppearanceSettingsResultMapper.Map(result);

    private static RepositoryResult<AppearanceServerSettings> Loaded(AppearanceServerSettings settings) =>
        RepositoryResult<AppearanceServerSettings>.Loaded(settings, Now);

    private static AppearanceSettingsViewModel NewViewModel(params RepositoryResult<AppearanceServerSettings>[] emissions) =>
        new(new FakeAppearanceSettingsSource(emissions), new InMemoryAppearanceLocalPreferences(), Localizer);

    private sealed class FakeAppearanceSettingsSource(params RepositoryResult<AppearanceServerSettings>[] emissions)
        : IAppearanceSettingsSource
    {
        public List<AppearanceServerSettings> Saved { get; } = new();

        public Exception? SaveError { get; set; }

        public async IAsyncEnumerable<RepositoryResult<AppearanceServerSettings>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
            }

            await Task.CompletedTask;
        }

        public Task<AppearanceServerSettings> SaveAsync(AppearanceServerSettings settings, CancellationToken cancellationToken = default)
        {
            Saved.Add(settings);
            return SaveError is not null
                ? Task.FromException<AppearanceServerSettings>(SaveError)
                : Task.FromResult(settings);
        }
    }
}
