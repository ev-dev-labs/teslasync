using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SettingsPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/settings/pages/SettingsPage.tsx), the two-state lifecycle the parity manifest declares
/// (loading → success), and the view-model's load flow over the default <see cref="EmptySettingsFeed"/>. The WinUI
/// view is exercised by the app build; its per-region content is driven entirely by the <see cref="SettingsDisplay"/>
/// asserted here.
/// </summary>
public sealed class SettingsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 12 i18n keys the parity manifest requires the page to resolve (the exact web key names).
    private static readonly string[] RequiredStringKeys =
    [
        "checklist.settings.description",
        "checklist.settings.restart",
        "checklist.settings.restarted",
        "checklist.settings.title",
        "editConflict.resource.settings",
        "export.subtitle",
        "export.title",
        "subtitle",
        "title",
        "tour.description",
        "tour.restart",
        "tour.title",
    ];

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = SettingsProjection.Project(new SettingsModel(Loading: false), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Every chrome string resolves on every projection (regardless of data state); visibility is gated separately.
        _ = SettingsProjection.Project(SettingsModel.Initial, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = SettingsProjection.Project(SettingsModel.Initial, Localizer);

        Assert.Equal(SettingsState.Loading, display.State);
        Assert.True(display.ShowLoading);
    }

    [Fact]
    public void State_success_when_query_resolved()
    {
        var display = SettingsProjection.Project(new SettingsModel(Loading: false), Localizer);

        Assert.Equal(SettingsState.Success, display.State);
        Assert.False(display.ShowLoading);
    }

    [Fact]
    public void Projection_carries_every_panel_string()
    {
        var display = SettingsProjection.Project(new SettingsModel(Loading: false), Localizer);

        // GlassPanel1 (Data Export), GlassPanel2 (Onboarding Tour), GlassPanel3 (Setup Checklist).
        Assert.Equal("Data Export", display.ExportTitle);
        Assert.Equal("Export drives, charging, analytics, or full backup as CSV/JSON", display.ExportSubtitle);
        Assert.Equal("Onboarding Tour", display.TourTitle);
        Assert.Equal("Re-run the guided walkthrough of TeslaSync features", display.TourDescription);
        Assert.Equal("Open Tour Launcher", display.TourActionLabel);
        Assert.Equal("Setup Checklist", display.ChecklistTitle);
        Assert.Equal("Restart Checklist", display.ChecklistActionLabel);
        Assert.Equal("Your settings", display.ConflictResourceLabel);
        Assert.Equal("Settings", display.Title);
        Assert.Equal("Configure TeslaSync preferences and Tesla account connection", display.Subtitle);
    }

    [Fact]
    public async Task ViewModel_transitions_from_loading_to_success_after_load()
    {
        using var viewModel = new SettingsPageViewModel(EmptySettingsFeed.Instance, Localizer);

        Assert.Equal(SettingsState.Loading, viewModel.State);
        Assert.True(viewModel.Display.ShowLoading);

        await viewModel.LoadAsync();

        Assert.Equal(SettingsState.Success, viewModel.State);
        Assert.False(viewModel.Display.ShowLoading);
        Assert.False(viewModel.IsFetching);
    }

    [Fact]
    public void Snapshot_parser_reads_bare_object_and_data_envelope()
    {
        Assert.True(SettingsSnapshot.FromJson(System.Text.Json.JsonDocument.Parse("{\"theme\":\"dark\"}").RootElement).HasData);
        Assert.True(SettingsSnapshot.FromJson(System.Text.Json.JsonDocument.Parse("{\"data\":{\"theme\":\"dark\"}}").RootElement).HasData);
        Assert.False(SettingsSnapshot.FromJson(System.Text.Json.JsonDocument.Parse("null").RootElement).HasData);
    }

    /// <summary>An <see cref="ILocalizer"/> that records the keys it was asked for (mirrors the sibling page tests).</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
