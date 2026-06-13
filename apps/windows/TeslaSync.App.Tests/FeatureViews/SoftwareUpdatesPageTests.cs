using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.VehicleSystems;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SoftwareUpdatesPage</c> surface's Microsoft.UI-free logic — the tolerant
/// update/vehicle parsers, the status → presentation map, the list → display projection (current version,
/// installed count, total, the timeline rows with owner-name resolution / scheduled line / release-notes link),
/// the four-state view-model matrix (loading / loaded / empty / error) and the registry metadata. The WinUI
/// view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="SoftwareUpdatesDisplay"/> flags asserted here. Mirrors the web spec
/// (web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx).
/// </summary>
public sealed class SoftwareUpdatesPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 13, 12, 0, 0, TimeSpan.Zero);

    // The 14 i18n keys the manifest requires the page to resolve (web key names).
    private static readonly string[] RequiredStringKeys =
    [
        "Current Version", "No software update history available", "No update history", "Scheduled",
        "Software Updates", "Total Updates", "Track firmware versions and update history", "Unknown",
        "Update Timeline", "Updates Installed", "Vehicle", "View release notes", "error.loadFailed",
        "softwareUpdates.title",
    ];

    private static SoftwareUpdatesSnapshot Snapshot(
        IReadOnlyList<SoftwareUpdateEntry>? updates = null,
        IReadOnlyList<SoftwareUpdateVehicle>? vehicles = null) =>
        new(updates ?? Array.Empty<SoftwareUpdateEntry>(), vehicles ?? Array.Empty<SoftwareUpdateVehicle>());

    private static SoftwareUpdateEntry Entry(
        long id = 1,
        long vehicleId = 7,
        string? version = "2026.8.1",
        string? status = "installed",
        string? installedAt = "2026-05-01T00:00:00Z",
        string? scheduledAt = null,
        string? createdAt = "2026-05-01T00:00:00Z") =>
        new(id, vehicleId, version, status, installedAt, scheduledAt, createdAt);

    // ---- Parser ------------------------------------------------------------------

    [Fact]
    public void ParseList_reads_snake_case_fields()
    {
        using var doc = JsonDocument.Parse("""
        [{"id":5,"vehicle_id":7,"version":"2026.8.1","status":"installed",
          "installed_at":"2026-05-01T10:00:00Z","scheduled_at":null,"created_at":"2026-04-30T10:00:00Z"}]
        """);

        var list = SoftwareUpdateEntry.ParseList(doc.RootElement);

        Assert.Single(list);
        var row = list[0];
        Assert.Equal(5, row.Id);
        Assert.Equal(7, row.VehicleId);
        Assert.Equal("2026.8.1", row.Version);
        Assert.Equal("installed", row.Status);
        Assert.True(row.IsInstalled);
        Assert.NotNull(row.InstalledAt);
        Assert.Null(row.ScheduledAt);
    }

    [Fact]
    public void ParseList_is_empty_for_a_non_array_body()
    {
        using var obj = JsonDocument.Parse("{}");
        Assert.Empty(SoftwareUpdateEntry.ParseList(obj.RootElement));
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"id":9}""");
        var row = SoftwareUpdateEntry.FromJson(doc.RootElement);

        Assert.Equal(9, row.Id);
        Assert.Null(row.Version);
        Assert.Null(row.Status);
        Assert.False(row.IsInstalled);
        Assert.Null(row.CreatedAt);
    }

    [Fact]
    public void ParseRoster_reads_id_and_display_name()
    {
        using var doc = JsonDocument.Parse("""[{"id":7,"display_name":"Garage Y"},{"id":9}]""");
        var roster = SoftwareUpdateVehicle.ParseRoster(doc.RootElement);

        Assert.Equal(2, roster.Count);
        Assert.Equal(7, roster[0].Id);
        Assert.Equal("Garage Y", roster[0].DisplayName);
        Assert.Equal(string.Empty, roster[1].DisplayName);
    }

    // ---- Status presentation -----------------------------------------------------

    [Theory]
    [InlineData("installed", StatusKind.Success)]
    [InlineData("installing", StatusKind.Info)]
    [InlineData("downloading", StatusKind.Info)]
    [InlineData("available", StatusKind.Warning)]
    [InlineData("scheduled", StatusKind.Neutral)]
    public void Status_presentation_maps_each_status(string status, StatusKind expected)
    {
        var tokens = SoftwareUpdateStatusPresentation.For(status);
        Assert.Equal(expected, tokens.Badge);
        Assert.False(string.IsNullOrEmpty(tokens.Glyph));
        Assert.False(string.IsNullOrEmpty(tokens.AccentBrushKey));
    }

    [Fact]
    public void Status_presentation_falls_back_to_available_for_unknown()
    {
        var unknown = SoftwareUpdateStatusPresentation.For("bogus");
        var available = SoftwareUpdateStatusPresentation.For("available");
        Assert.Equal(available, unknown);
        Assert.Equal(available, SoftwareUpdateStatusPresentation.For(null));
    }

    // ---- Projection: metrics -----------------------------------------------------

    [Fact]
    public void Projection_current_version_is_the_first_update_version()
    {
        var updates = new[] { Entry(version: "2026.20.5"), Entry(id: 2, version: "2026.8.1") };
        var display = SoftwareUpdatesProjection.Project(Snapshot(updates), SoftwareUpdatesState.Loaded, Localizer, Now);

        Assert.Equal("2026.20.5", Metric(display, "currentVersion").Value);
    }

    [Fact]
    public void Projection_current_version_falls_back_to_unknown()
    {
        var emptyDisplay = SoftwareUpdatesProjection.Project(Snapshot(), SoftwareUpdatesState.Empty, Localizer, Now);
        Assert.Equal("Unknown", Metric(emptyDisplay, "currentVersion").Value);

        var nullVersion = SoftwareUpdatesProjection.Project(
            Snapshot(new[] { Entry(version: null) }), SoftwareUpdatesState.Loaded, Localizer, Now);
        Assert.Equal("Unknown", Metric(nullVersion, "currentVersion").Value);
    }

    [Fact]
    public void Projection_counts_installed_and_total()
    {
        var updates = new[]
        {
            Entry(id: 1, status: "installed"),
            Entry(id: 2, status: "installing"),
            Entry(id: 3, status: "installed"),
        };
        var display = SoftwareUpdatesProjection.Project(Snapshot(updates), SoftwareUpdatesState.Loaded, Localizer, Now);

        Assert.Equal("2", Metric(display, "updatesInstalled").Value);
        Assert.Equal("3", Metric(display, "totalUpdates").Value);
    }

    // ---- Projection: timeline rows ----------------------------------------------

    [Fact]
    public void Projection_resolves_vehicle_name_and_falls_back_to_id()
    {
        var vehicles = new[] { new SoftwareUpdateVehicle(7, "Garage Y") };
        var updates = new[] { Entry(id: 1, vehicleId: 7), Entry(id: 2, vehicleId: 99) };

        var display = SoftwareUpdatesProjection.Project(
            Snapshot(updates, vehicles), SoftwareUpdatesState.Loaded, Localizer, Now);

        Assert.Equal(2, display.Rows.Count);
        Assert.Equal("Garage Y", display.Rows[0].VehicleName);
        Assert.Equal("Vehicle 99", display.Rows[1].VehicleName);
    }

    [Fact]
    public void Projection_builds_scheduled_line_and_release_notes_uri()
    {
        var updates = new[]
        {
            Entry(id: 1, version: "2026.8.1", status: "scheduled", installedAt: null, scheduledAt: "2026-07-01T00:00:00Z"),
        };
        var display = SoftwareUpdatesProjection.Project(Snapshot(updates), SoftwareUpdatesState.Loaded, Localizer, Now);

        var row = display.Rows[0];
        Assert.True(row.HasScheduled);
        Assert.False(row.HasInstalledDate);
        Assert.StartsWith("Scheduled: ", row.ScheduledText, StringComparison.Ordinal);
        Assert.Equal(
            "https://www.notateslaapp.com/software-updates/version/2026.8.1/release-notes",
            row.ReleaseNotesUri.AbsoluteUri);
        Assert.Equal("View release notes", row.ReleaseNotesTooltip);
        Assert.Equal(StatusKind.Neutral, row.BadgeStatus);
    }

    [Fact]
    public void Projection_shows_installed_date_when_present()
    {
        var updates = new[] { Entry(status: "installed", installedAt: "2026-05-01T00:00:00Z", scheduledAt: "2026-04-01T00:00:00Z") };
        var display = SoftwareUpdatesProjection.Project(Snapshot(updates), SoftwareUpdatesState.Loaded, Localizer, Now);

        var row = display.Rows[0];
        Assert.True(row.HasInstalledDate);
        Assert.False(string.IsNullOrEmpty(row.InstalledDate));
        // Web parity: the scheduled line is hidden once a build is installed.
        Assert.False(row.HasScheduled);
    }

    [Fact]
    public void Projection_uses_em_dash_for_a_missing_version()
    {
        var updates = new[] { Entry(version: null) };
        var display = SoftwareUpdatesProjection.Project(Snapshot(updates), SoftwareUpdatesState.Loaded, Localizer, Now);
        Assert.Equal(SoftwareUpdatesProjection.EmDash, display.Rows[0].Version);
    }

    [Fact]
    public void BuildReleaseNotesUri_encodes_the_version()
    {
        var uri = SoftwareUpdatesProjection.BuildReleaseNotesUri("2026.8 beta/rc");
        Assert.Equal(
            "https://www.notateslaapp.com/software-updates/version/2026.8%20beta%2Frc/release-notes",
            uri.AbsoluteUri);
    }

    // ---- Projection: state flags -------------------------------------------------

    [Fact]
    public void Projection_loading_state_shows_only_the_skeleton()
    {
        var display = SoftwareUpdatesProjection.Project(Snapshot(), SoftwareUpdatesState.Loading, Localizer, Now);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowRows);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void Projection_loaded_state_shows_the_rows()
    {
        var display = SoftwareUpdatesProjection.Project(
            Snapshot(new[] { Entry() }), SoftwareUpdatesState.Loaded, Localizer, Now);
        Assert.True(display.ShowRows);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void Projection_empty_state_shows_the_empty_surface()
    {
        var display = SoftwareUpdatesProjection.Project(Snapshot(), SoftwareUpdatesState.Empty, Localizer, Now);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowRows);
        Assert.False(display.ShowError);
        Assert.Equal("No update history", display.EmptyTitle);
        Assert.Equal("No software update history available", display.EmptyMessage);
    }

    [Fact]
    public void Projection_error_state_shows_the_banner_and_empty_timeline()
    {
        var display = SoftwareUpdatesProjection.Project(Snapshot(), SoftwareUpdatesState.Error, Localizer, Now);
        Assert.True(display.ShowError);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowRows);
        Assert.Equal("Failed to load data", display.ErrorText);
    }

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();
        var vehicles = new[] { new SoftwareUpdateVehicle(7, "Garage Y") };
        var updates = new[] { Entry(vehicleId: 7, status: "scheduled", installedAt: null, scheduledAt: "2026-07-01T00:00:00Z") };

        SoftwareUpdatesProjection.Project(Snapshot(updates, vehicles), SoftwareUpdatesState.Loaded, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_uses_the_web_metric_accent_tokens()
    {
        var display = SoftwareUpdatesProjection.Project(
            Snapshot(new[] { Entry() }), SoftwareUpdatesState.Loaded, Localizer, Now);

        Assert.Equal(SoftwareUpdatesProjection.CyanAccentBrushKey, Metric(display, "currentVersion").AccentBrushKey);
        Assert.Equal(SoftwareUpdatesProjection.GreenAccentBrushKey, Metric(display, "updatesInstalled").AccentBrushKey);
        Assert.Equal(SoftwareUpdatesProjection.PurpleAccentBrushKey, Metric(display, "totalUpdates").AccentBrushKey);
    }

    // ---- View-model: four-state matrix ------------------------------------------

    [Fact]
    public async Task ViewModel_starts_loading_then_resolves_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SoftwareUpdatesSnapshot>.Loaded(Snapshot(new[] { Entry() }), Now));

        Assert.Equal(SoftwareUpdatesState.Loading, vm.State);

        await vm.LoadAsync();

        Assert.Equal(SoftwareUpdatesState.Loaded, vm.State);
        Assert.True(vm.Display.ShowRows);
        Assert.Single(vm.Display.Rows);
    }

    [Fact]
    public async Task ViewModel_classifies_a_no_data_result_as_empty()
    {
        using var vm = NewViewModel(RepositoryResult<SoftwareUpdatesSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.Equal(SoftwareUpdatesState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_classifies_a_resolved_empty_snapshot_as_empty()
    {
        using var vm = NewViewModel(
            RepositoryResult<SoftwareUpdatesSnapshot>.Loaded(SoftwareUpdatesSnapshot.Empty, Now));

        await vm.LoadAsync();

        Assert.Equal(SoftwareUpdatesState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_surfaces_the_error_state_on_failure()
    {
        using var vm = NewViewModel(
            RepositoryResult<SoftwareUpdatesSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(SoftwareUpdatesState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public void ViewModel_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        using var vm = new SoftwareUpdatesPageViewModel(
            new FakeSource(), Localizer, () => Now, new SoftwareUpdatesDiagnostics(lines.Add));

        vm.NotifyOpened();

        Assert.Contains("view.opened slug=SoftwareUpdatesPage", lines);
    }

    // ---- Registration ------------------------------------------------------------

    [Fact]
    public void Registration_mirrors_the_web_route()
    {
        Assert.Equal("SoftwareUpdates", SoftwareUpdatesRegistration.RouteName);
        Assert.Equal("software-updates", SoftwareUpdatesRegistration.Route);
        Assert.Equal("vehicle-systems/software", SoftwareUpdatesRegistration.AliasRoute);
        Assert.Equal(50, SoftwareUpdatesRegistration.PageSize);
        Assert.Equal("Software Updates", SoftwareUpdatesRegistration.Title(Localizer));
    }

    // ---- Fakes / helpers ---------------------------------------------------------

    private static SoftwareUpdateMetric Metric(SoftwareUpdatesDisplay display, string key)
    {
        foreach (var metric in display.Metrics)
        {
            if (string.Equals(metric.Key, key, StringComparison.Ordinal))
            {
                return metric;
            }
        }

        throw new KeyNotFoundException(key);
    }

    private static SoftwareUpdatesPageViewModel NewViewModel(params RepositoryResult<SoftwareUpdatesSnapshot>[] emissions) =>
        new(new FakeSource(emissions), Localizer, () => Now);

    private sealed class FakeSource(params RepositoryResult<SoftwareUpdatesSnapshot>[] emissions) : ISoftwareUpdatesSource
    {
        public async IAsyncEnumerable<RepositoryResult<SoftwareUpdatesSnapshot>> StreamAsync(
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

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
