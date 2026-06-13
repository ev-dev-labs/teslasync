using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>GDPRExportPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/GDPRExportPage.tsx), the tolerant artifact parser, the binary-unit byte formatter
/// (web <c>formatBytes</c>), the generated-client feed's request shaping (web <c>useGDPRExport</c>) and the view-model's
/// data-state matrix (loading / empty / error / success) with the distinct HTTP-503 subsystem-unavailable branch (web
/// <c>subsystemMissing</c>) and the HTTP-404 not-found branch (web <c>notFound</c>). The WinUI view is exercised by the
/// app build; its per-region visibility is driven entirely by the <see cref="GDPRExportDisplay"/> flags asserted here.
/// </summary>
public sealed class GDPRExportPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 13, 12, 0, 0, TimeSpan.Zero);

    // The 31 i18n keys the manifest requires the page to resolve (30 admin.gdprExport.* + admin.subsystem.unavailableTitle).
    private static readonly string[] RequiredStringKeys =
    [
        "admin.gdprExport.bytesLabel", "admin.gdprExport.downloadButton", "admin.gdprExport.downloadExpired",
        "admin.gdprExport.downloadFailed", "admin.gdprExport.downloadHint", "admin.gdprExport.downloadTitle",
        "admin.gdprExport.downloadWait", "admin.gdprExport.emptyMessage", "admin.gdprExport.emptyTitle",
        "admin.gdprExport.errorTitle", "admin.gdprExport.formatLabel", "admin.gdprExport.idLabel",
        "admin.gdprExport.idPlaceholder", "admin.gdprExport.lookupButton", "admin.gdprExport.lookupHint",
        "admin.gdprExport.lookupTitle", "admin.gdprExport.metaCompleted", "admin.gdprExport.metaCreated",
        "admin.gdprExport.metaExpires", "admin.gdprExport.metaId", "admin.gdprExport.metaSha256",
        "admin.gdprExport.metaTitle", "admin.gdprExport.metaUser", "admin.gdprExport.notConfigured",
        "admin.gdprExport.notFoundMessage", "admin.gdprExport.notFoundTitle", "admin.gdprExport.pageTitle",
        "admin.gdprExport.statusLabel", "admin.gdprExport.storageLabel", "admin.gdprExport.subtitle",
        "admin.subsystem.unavailableTitle",
    ];

    private static GDPRArtifact SampleArtifact(string status = "complete") => new(
        Id: "8f4c1d2e-0000-4a2b-9c3d-aabbccddeeff",
        UserId: "user-42",
        Status: status,
        Format: "zip",
        Bytes: 2_500_000,
        Sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        Storage: "s3",
        DownloadUrl: "https://teslasync.local/api/v1/admin/gdpr/exports/8f4c/download",
        CreatedAt: "2026-06-13T10:00:00Z",
        CompletedAt: "2026-06-13T10:05:00Z",
        ExpiresAt: "2026-06-20T10:00:00Z",
        Error: null);

    private static GDPRExportModel WithArtifact(GDPRArtifact artifact) => GDPRExportModel.Initial with
    {
        IdInput = artifact.Id,
        ActiveId = artifact.Id,
        Loading = false,
        Artifact = artifact,
    };

    // ── i18n key coverage (all 31 manifest strings) ──────────────────────────────────

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = GDPRExportProjection.Project(WithArtifact(SampleArtifact()), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_empty_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings are resolved on every projection regardless of data state (visibility is gated separately).
        _ = GDPRExportProjection.Project(GDPRExportModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ── Data states ──────────────────────────────────────────────────────────────────

    [Fact]
    public void State_empty_when_no_id_submitted()
    {
        var display = GDPRExportProjection.Project(GDPRExportModel.Initial, Localizer, Now);

        Assert.Equal(GDPRExportState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowArtifact);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    [Fact]
    public void State_loading_when_lookup_in_flight()
    {
        var model = GDPRExportModel.Initial with { IdInput = "abc", ActiveId = "abc", Loading = true };
        var display = GDPRExportProjection.Project(model, Localizer, Now);

        Assert.Equal(GDPRExportState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowArtifact);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_error_shows_failure_surface_with_detail()
    {
        var model = GDPRExportModel.Initial with
        {
            IdInput = "abc",
            ActiveId = "abc",
            Loading = false,
            HasError = true,
            ErrorDetail = "boom",
        };
        var display = GDPRExportProjection.Project(model, Localizer, Now);

        Assert.Equal(GDPRExportState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Contains("boom", display.ErrorText, StringComparison.Ordinal);
        Assert.False(display.ShowArtifact);
    }

    [Fact]
    public void State_success_when_artifact_present()
    {
        var display = GDPRExportProjection.Project(WithArtifact(SampleArtifact()), Localizer, Now);

        Assert.Equal(GDPRExportState.Success, display.State);
        Assert.True(display.ShowArtifact);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_404_not_found_raises_the_banner_in_the_error_state()
    {
        var model = GDPRExportModel.Initial with { IdInput = "abc", ActiveId = "abc", Loading = false, NotFound = true };
        var display = GDPRExportProjection.Project(model, Localizer, Now);

        Assert.True(display.ShowNotFound);
        Assert.Equal(GDPRExportState.Error, display.State);
        Assert.False(display.ShowArtifact);
    }

    [Fact]
    public void State_503_subsystem_missing_raises_the_banner_and_suppresses_artifact()
    {
        var model = GDPRExportModel.Initial with { IdInput = "abc", ActiveId = "abc", Loading = false, SubsystemMissing = true };
        var display = GDPRExportProjection.Project(model, Localizer, Now);

        Assert.True(display.ShowSubsystemUnavailable);
        Assert.False(display.ShowArtifact);
        Assert.False(display.ShowError);
        Assert.Equal(GDPRExportState.Empty, display.State);
    }

    // ── Artifact projection ──────────────────────────────────────────────────────────

    [Fact]
    public void Artifact_projects_status_badge_stat_tiles_and_meta_rows()
    {
        var display = GDPRExportProjection.Project(WithArtifact(SampleArtifact()), Localizer, Now);

        Assert.Equal("complete", display.StatusText);
        Assert.Equal(StatusKind.Success, display.StatusVariant);
        Assert.Equal("zip", display.FormatValue);
        Assert.Equal("2.4 MB", display.BytesValue);
        Assert.Equal("s3", display.StorageValue);
        Assert.Equal("8f4c1d2e-0000-4a2b-9c3d-aabbccddeeff", display.IdRowValue);

        // user + created + completed + expires + sha256 = 5 rows (the id row is rendered separately by the view).
        Assert.Equal(5, display.MetaRows.Count);
        Assert.Contains(display.MetaRows, r => r is { Copyable: true, Mono: true });
    }

    [Fact]
    public void Artifact_renders_em_dash_for_absent_optionals()
    {
        var bare = SampleArtifact() with
        {
            Format = string.Empty,
            Bytes = null,
            Storage = null,
            UserId = null,
            CompletedAt = null,
            ExpiresAt = null,
            Sha256 = null,
        };
        var display = GDPRExportProjection.Project(WithArtifact(bare), Localizer, Now);

        Assert.Equal("\u2014", display.FormatValue);
        Assert.Equal("\u2014", display.BytesValue);
        Assert.Equal("\u2014", display.StorageValue);
        Assert.Single(display.MetaRows); // only the always-present "Created" row remains
    }

    [Fact]
    public void Artifact_error_raises_the_export_failed_banner()
    {
        var failed = SampleArtifact("failed") with { Error = "disk full" };
        var display = GDPRExportProjection.Project(WithArtifact(failed), Localizer, Now);

        Assert.True(display.ShowArtifactError);
        Assert.Equal("disk full", display.ArtifactErrorText);
        Assert.Equal(StatusKind.Danger, display.StatusVariant);
    }

    // ── Download panel ───────────────────────────────────────────────────────────────

    [Fact]
    public void Download_button_shows_when_complete_with_the_conventional_path()
    {
        var display = GDPRExportProjection.Project(WithArtifact(SampleArtifact()), Localizer, Now);

        Assert.True(display.ShowDownloadButton);
        Assert.False(display.ShowDownloadCaption);
        Assert.Equal(
            "/api/v1/admin/gdpr/exports/8f4c1d2e-0000-4a2b-9c3d-aabbccddeeff/download",
            display.DownloadUrl);
        Assert.Equal("https://teslasync.local/api/v1/admin/gdpr/exports/8f4c/download", display.DownloadLaunchUri);
    }

    [Theory]
    [InlineData("queued", "Download becomes available once the export completes.")]
    [InlineData("running", "Download becomes available once the export completes.")]
    [InlineData("expired", "This artifact has expired and is no longer downloadable.")]
    [InlineData("failed", "No bundle available \u2014 see the error above.")]
    public void Download_caption_matches_the_non_complete_status(string status, string expected)
    {
        var display = GDPRExportProjection.Project(WithArtifact(SampleArtifact(status)), Localizer, Now);

        Assert.False(display.ShowDownloadButton);
        Assert.True(display.ShowDownloadCaption);
        Assert.Equal(expected, display.DownloadCaptionText);
    }

    // ── Byte formatter (web formatBytes binary-unit parity) ──────────────────────────

    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(512, "512 B")]
    [InlineData(2048, "2.0 KB")]
    [InlineData(2_500_000, "2.4 MB")]
    [InlineData(5_368_709_120, "5.0 GB")]
    public void FormatBytes_uses_binary_units(long bytes, string expected) =>
        Assert.Equal(expected, GDPRExportProjection.FormatBytes(bytes));

    [Fact]
    public void FormatBytes_null_is_em_dash() => Assert.Equal("\u2014", GDPRExportProjection.FormatBytes(null));

    // ── Status variant mapping (web STATUS_VARIANT) ──────────────────────────────────

    [Theory]
    [InlineData("queued", StatusKind.Info)]
    [InlineData("running", StatusKind.Info)]
    [InlineData("complete", StatusKind.Success)]
    [InlineData("failed", StatusKind.Danger)]
    [InlineData("expired", StatusKind.Warning)]
    [InlineData("weird", StatusKind.Neutral)]
    public void StatusVariant_matches_the_web_map(string status, StatusKind expected) =>
        Assert.Equal(expected, GDPRExportProjection.StatusVariantFor(status));

    // ── Tolerant parser ──────────────────────────────────────────────────────────────

    [Fact]
    public void GDPRArtifact_parses_snake_case_and_tolerates_missing_fields()
    {
        var el = Parse(
            "{\"id\":\"abc\",\"status\":\"complete\",\"format\":\"zip\",\"bytes\":1048576," +
            "\"created_at\":\"2026-06-13T00:00:00Z\",\"sha256\":\"deadbeef\"}");
        var artifact = GDPRArtifact.FromJson(el);

        Assert.Equal("abc", artifact.Id);
        Assert.Equal("complete", artifact.Status);
        Assert.Equal("zip", artifact.Format);
        Assert.Equal(1048576, artifact.Bytes);
        Assert.Equal("deadbeef", artifact.Sha256);
        Assert.Null(artifact.UserId);
        Assert.Null(artifact.CompletedAt);
        Assert.Null(artifact.Error);
    }

    // ── Registration contract (hook ↔ generated endpoint id) ─────────────────────────

    [Fact]
    public void Registration_operation_matches_the_generated_endpoint_id()
    {
        Assert.Equal("get_api_v1_admin_gdpr_exports_id", GDPRExportRegistration.FetchOperation);
        Assert.Equal("get_api_v1_admin_gdpr_exports_id_download", GDPRExportRegistration.DownloadOperation);
        Assert.Equal("GDPRExport", GDPRExportRegistration.RouteName);
    }

    // ── View-model data-state matrix ─────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_lookup_loads_artifact_into_the_success_state()
    {
        var feed = new FakeFeed { Result = SampleArtifact() };
        using var vm = new GDPRExportPageViewModel(feed, Localizer, () => Now);

        vm.SetIdInput("8f4c1d2e-0000-4a2b-9c3d-aabbccddeeff");
        await vm.LookupAsync();

        Assert.Equal(GDPRExportState.Success, vm.State);
        Assert.True(vm.Display.ShowArtifact);
        Assert.Equal("8f4c1d2e-0000-4a2b-9c3d-aabbccddeeff", feed.LastId);
    }

    [Fact]
    public async Task ViewModel_http_503_is_the_subsystem_unavailable_branch()
    {
        var feed = new FakeFeed { Error = new ApiException("gdpr subsystem not configured", 503) };
        using var vm = new GDPRExportPageViewModel(feed, Localizer, () => Now);

        vm.SetIdInput("abc");
        await vm.LookupAsync();

        Assert.True(vm.Display.ShowSubsystemUnavailable);
        Assert.Equal(GDPRExportState.Empty, vm.State);
        Assert.False(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_http_404_is_the_not_found_branch()
    {
        var feed = new FakeFeed { Error = new ApiException("no such artifact", 404) };
        using var vm = new GDPRExportPageViewModel(feed, Localizer, () => Now);

        vm.SetIdInput("abc");
        await vm.LookupAsync();

        Assert.True(vm.Display.ShowNotFound);
        Assert.Equal(GDPRExportState.Error, vm.State);
        Assert.False(vm.Display.ShowSubsystemUnavailable);
    }

    [Fact]
    public async Task ViewModel_null_result_is_treated_as_not_found()
    {
        var feed = new FakeFeed { Result = null };
        using var vm = new GDPRExportPageViewModel(feed, Localizer, () => Now);

        vm.SetIdInput("abc");
        await vm.LookupAsync();

        Assert.True(vm.Display.ShowNotFound);
        Assert.Equal(GDPRExportState.Error, vm.State);
    }

    [Fact]
    public async Task ViewModel_generic_failure_is_the_error_state()
    {
        var feed = new FakeFeed { Error = new InvalidOperationException("network down") };
        using var vm = new GDPRExportPageViewModel(feed, Localizer, () => Now);

        vm.SetIdInput("abc");
        await vm.LookupAsync();

        Assert.Equal(GDPRExportState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.False(vm.Display.ShowSubsystemUnavailable);
    }

    [Fact]
    public async Task ViewModel_empty_id_stays_in_the_empty_state_without_fetching()
    {
        var feed = new FakeFeed { Result = SampleArtifact() };
        using var vm = new GDPRExportPageViewModel(feed, Localizer, () => Now);

        vm.SetIdInput("   ");
        await vm.LookupAsync();

        Assert.Equal(GDPRExportState.Empty, vm.State);
        Assert.Equal(0, feed.Calls);
    }

    [Fact]
    public void ViewModel_typing_an_id_enables_the_lookup_button()
    {
        using var vm = new GDPRExportPageViewModel(new FakeFeed(), Localizer, () => Now);

        Assert.False(vm.Display.LookupEnabled);

        vm.SetIdInput("abc");

        Assert.True(vm.Display.LookupEnabled);
        Assert.Equal("abc", vm.Display.IdValue);
    }

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeFeed : IGDPRExportFeed
    {
        public GDPRArtifact? Result { get; init; }
        public Exception? Error { get; init; }
        public string? LastId { get; private set; }
        public int Calls { get; private set; }

        public Task<GDPRArtifact?> FetchAsync(string id, CancellationToken cancellationToken)
        {
            LastId = id;
            Calls++;
            return Error is not null
                ? Task.FromException<GDPRArtifact?>(Error)
                : Task.FromResult(Result);
        }
    }
}
