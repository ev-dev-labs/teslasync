using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the SettingsExportImport feature-view's UI-thread-free logic — the schema
/// constants, the pure bundle validator (the web <c>validateSettingsBundle</c>: every rejection branch), the
/// import-result parser and summariser (the web <c>summariseImportResult</c>), the localizable validation
/// messages, the per-state projection (idle / parsing / preview / applied plus export-busy and inline error)
/// with its localized chrome, Apply gate and per-section diff, the state-holder view-model's export / ingest /
/// apply / reset flows, the registration metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/settings/components/SettingsExportImport.tsx and web/src/lib/settingsImportSchema.ts). The
/// WinUI view and the DownloadsFolder-backed downloader are exercised by the app build.
/// </summary>
public sealed class SettingsExportImportTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ---- Schema constants (web settingsImportSchema.ts) -----------------------------

    [Fact]
    public void Schema_constants_match_the_web_contract()
    {
        Assert.Equal(1, SettingsBundleConstants.SchemaVersion);
        Assert.Equal(1L << 20, SettingsBundleConstants.MaxImportFileBytes);
        Assert.Equal(
            new[] { "settings", "alert_rules", "geofences", "quiet_hours" },
            SettingsBundleConstants.SectionKeys);
    }

    [Fact]
    public void DefaultExportFilename_uses_the_utc_date()
    {
        var when = new DateTimeOffset(2024, 1, 15, 23, 59, 0, TimeSpan.FromHours(5));
        Assert.Equal("teslasync-settings-20240115.json", SettingsBundleConstants.DefaultExportFilename(when));
    }

    // ---- Validator: rejection branches (web validateSettingsBundle) -----------------

    [Theory]
    [InlineData("123")]
    [InlineData("\"a-string\"")]
    [InlineData("null")]
    [InlineData("[]")]
    public void Validate_non_object_root_is_rejected(string json)
    {
        var result = SettingsBundleValidator.Validate(JsonNode.Parse(json));
        Assert.False(result.IsValid);
        Assert.Equal(SettingsBundleErrorKind.NotObject, result.Error!.Kind);
    }

    [Theory]
    [InlineData("{}")]                                  // missing
    [InlineData("{\"schema_version\":\"1\"}")]          // string
    [InlineData("{\"schema_version\":0}")]              // below one
    [InlineData("{\"schema_version\":-3}")]             // negative
    public void Validate_invalid_version_is_rejected(string json)
    {
        var result = SettingsBundleValidator.Validate(JsonNode.Parse(json));
        Assert.False(result.IsValid);
        Assert.Equal(SettingsBundleErrorKind.VersionInvalid, result.Error!.Kind);
    }

    [Fact]
    public void Validate_version_newer_than_supported_is_rejected()
    {
        var result = SettingsBundleValidator.Validate(JsonNode.Parse("{\"schema_version\":999,\"exported_at\":\"x\",\"sections\":{}}"));
        Assert.False(result.IsValid);
        Assert.Equal(SettingsBundleErrorKind.VersionNewer, result.Error!.Kind);
        Assert.Equal(999, result.Error.Version);

        string message = result.Error.Localize(Localizer);
        Assert.Contains("newer than this build supports", message, StringComparison.Ordinal);
        Assert.Contains("999", message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("{\"schema_version\":1}")]                                  // missing
    [InlineData("{\"schema_version\":1,\"exported_at\":\"\"}")]            // blank
    [InlineData("{\"schema_version\":1,\"exported_at\":\"   \"}")]         // whitespace
    public void Validate_invalid_exported_at_is_rejected(string json)
    {
        var result = SettingsBundleValidator.Validate(JsonNode.Parse(json));
        Assert.False(result.IsValid);
        Assert.Equal(SettingsBundleErrorKind.ExportedAtInvalid, result.Error!.Kind);
    }

    [Theory]
    [InlineData("{\"schema_version\":1,\"exported_at\":\"x\"}")]              // missing sections
    [InlineData("{\"schema_version\":1,\"exported_at\":\"x\",\"sections\":[]}")] // array
    public void Validate_non_object_sections_is_rejected(string json)
    {
        var result = SettingsBundleValidator.Validate(JsonNode.Parse(json));
        Assert.False(result.IsValid);
        Assert.Equal(SettingsBundleErrorKind.SectionsNotObject, result.Error!.Kind);
    }

    [Fact]
    public void Validate_unknown_section_is_rejected_with_key()
    {
        var result = SettingsBundleValidator.Validate(JsonNode.Parse(
            "{\"schema_version\":1,\"exported_at\":\"x\",\"sections\":{\"evil\":[]}}"));
        Assert.False(result.IsValid);
        Assert.Equal(SettingsBundleErrorKind.UnknownSection, result.Error!.Kind);
        Assert.Equal("evil", result.Error.SectionKey);
        Assert.Contains("evil", result.Error.Localize(Localizer), StringComparison.Ordinal);
    }

    [Fact]
    public void Validate_non_object_settings_section_is_rejected()
    {
        var result = SettingsBundleValidator.Validate(JsonNode.Parse(
            "{\"schema_version\":1,\"exported_at\":\"x\",\"sections\":{\"settings\":[]}}"));
        Assert.False(result.IsValid);
        Assert.Equal(SettingsBundleErrorKind.SettingsNotObject, result.Error!.Kind);
    }

    [Theory]
    [InlineData("alert_rules")]
    [InlineData("geofences")]
    [InlineData("quiet_hours")]
    public void Validate_non_array_section_is_rejected_with_key(string key)
    {
        var result = SettingsBundleValidator.Validate(JsonNode.Parse(
            $"{{\"schema_version\":1,\"exported_at\":\"x\",\"sections\":{{\"{key}\":{{}}}}}}"));
        Assert.False(result.IsValid);
        Assert.Equal(SettingsBundleErrorKind.SectionNotArray, result.Error!.Kind);
        Assert.Equal(key, result.Error.SectionKey);
    }

    [Fact]
    public void Validate_accepts_a_well_formed_bundle()
    {
        var result = SettingsBundleValidator.Validate(JsonNode.Parse(ValidBundleJson()));
        Assert.True(result.IsValid);
        Assert.Equal(1, result.Bundle!.SchemaVersion);
        Assert.Equal("2024-01-01T00:00:00Z", result.Bundle.ExportedAt);
        Assert.Equal(
            new[] { "settings", "alert_rules", "geofences", "quiet_hours" },
            result.Bundle.PresentSections);
    }

    [Fact]
    public void Validate_accepts_a_partial_bundle()
    {
        var result = SettingsBundleValidator.Validate(JsonNode.Parse(
            "{\"schema_version\":1,\"exported_at\":\"x\",\"sections\":{\"alert_rules\":[]}}"));
        Assert.True(result.IsValid);
        Assert.Equal(new[] { "alert_rules" }, result.Bundle!.PresentSections);
    }

    [Fact]
    public void Validation_error_routes_messages_through_localizer()
    {
        var prefix = new PrefixLocalizer();
        Assert.Equal("L:" + SettingsBundleError.NotObjectKey, new SettingsBundleError(SettingsBundleErrorKind.NotObject).Localize(prefix));
        Assert.Equal("L:" + SettingsBundleError.SettingsNotObjectKey, new SettingsBundleError(SettingsBundleErrorKind.SettingsNotObject).Localize(prefix));
    }

    // ---- Import result parsing + summarise (web summariseImportResult) --------------

    [Fact]
    public void ImportResult_parses_dry_run_and_section_counts()
    {
        var result = SettingsImportResult.FromJson(JsonDocument.Parse(
            "{\"dry_run\":true,\"sections\":{\"settings\":{\"added\":0,\"updated\":1,\"skipped\":0},\"alert_rules\":{\"added\":1,\"updated\":0,\"skipped\":0}}}").RootElement);

        Assert.True(result.DryRun);
        Assert.Equal(2, result.Sections.Count);
        Assert.Equal(1, result.Sections["settings"].Updated);
        Assert.Equal(1, result.Sections["alert_rules"].Added);
    }

    [Fact]
    public void ImportResult_summary_totals_added_plus_updated_only()
    {
        var result = new SettingsImportResult(true, new Dictionary<string, SettingsImportSectionResult>(StringComparer.Ordinal)
        {
            ["settings"] = new(0, 1, 0, Array.Empty<string>()),
            ["alert_rules"] = new(1, 0, 0, Array.Empty<string>()),
            ["geofences"] = new(0, 0, 1, Array.Empty<string>()),
            ["quiet_hours"] = new(1, 0, 0, Array.Empty<string>()),
        });

        var summary = SettingsImportSummary.From(result);
        Assert.Equal(2, summary.Added);
        Assert.Equal(1, summary.Updated);
        Assert.Equal(1, summary.Skipped);
        Assert.Equal(3, summary.Total); // added + updated, skipped excluded (web parity)
    }

    // ---- Projection: idle / parsing -------------------------------------------------

    [Fact]
    public void Project_idle_shows_dropzone_and_export_cta()
    {
        var display = SettingsExportImportProjection.Project(Snapshot(SettingsExportImportState.Idle), Localizer);

        Assert.Equal("Backup & Restore", display.Title);
        Assert.Equal("Export JSON", display.ExportButtonText);
        Assert.False(display.ExportBusy);
        Assert.True(display.ShowDropzone);
        Assert.Equal("Choose a file", display.ChooseText);
        Assert.False(display.IsParsing);
        Assert.False(display.ShowPreview);
        Assert.False(display.ShowApplied);
        Assert.False(display.HasError);
        Assert.Empty(display.SectionRows);
        Assert.Equal(display.Title, display.RegionName);
    }

    [Fact]
    public void Project_export_busy_swaps_the_button_label_but_keeps_the_action_name()
    {
        var display = SettingsExportImportProjection.Project(
            Snapshot(SettingsExportImportState.Idle) with { ExportBusy = true }, Localizer);

        Assert.True(display.ExportBusy);
        Assert.Equal("Exporting\u2026", display.ExportButtonText);
        Assert.Equal("Export JSON", display.ExportButtonName);
    }

    [Fact]
    public void Project_parsing_swaps_the_choose_label()
    {
        var display = SettingsExportImportProjection.Project(Snapshot(SettingsExportImportState.Parsing), Localizer);
        Assert.True(display.IsParsing);
        Assert.Equal("Reading\u2026", display.ChooseText);
        Assert.True(display.ShowDropzone);
    }

    [Fact]
    public void Project_error_surfaces_the_inline_message()
    {
        var display = SettingsExportImportProjection.Project(
            Snapshot(SettingsExportImportState.Idle) with { ParseError = "File is too large (max 1 MB)." }, Localizer);

        Assert.True(display.HasError);
        Assert.Equal("File is too large (max 1 MB).", display.ErrorMessage);
    }

    // ---- Projection: preview --------------------------------------------------------

    [Fact]
    public void Project_preview_renders_header_summary_apply_label_and_four_rows()
    {
        var preview = PreviewWithChanges();
        var snapshot = Snapshot(SettingsExportImportState.Preview) with
        {
            PendingFilename = "bundle.json",
            PendingSizeBytes = 512,
            PreviewResult = preview,
        };

        var display = SettingsExportImportProjection.Project(snapshot, Localizer);

        Assert.True(display.ShowPreview);
        Assert.Equal("Previewing bundle.json (512 bytes)", display.PreviewHeader);
        Assert.Equal("2 added, 1 updated, 1 unchanged", display.SummaryText);
        Assert.Equal("Apply 3 change(s)", display.ApplyButtonText);
        Assert.True(display.ApplyEnabled);
        Assert.False(display.IsApplying);

        Assert.Equal(4, display.SectionRows.Count);
        var settings = display.SectionRows[0];
        Assert.Equal("General settings", settings.Label);
        Assert.True(settings.HasCounts);
        Assert.Equal("+0 ~1 =0", settings.CountsText);
    }

    [Fact]
    public void Project_preview_with_no_changes_disables_apply()
    {
        var empty = new SettingsImportResult(true, new Dictionary<string, SettingsImportSectionResult>(StringComparer.Ordinal)
        {
            ["geofences"] = new(0, 0, 5, Array.Empty<string>()),
        });
        var snapshot = Snapshot(SettingsExportImportState.Preview) with
        {
            PendingFilename = "b.json",
            PendingSizeBytes = 10,
            PreviewResult = empty,
        };

        var display = SettingsExportImportProjection.Project(snapshot, Localizer);
        Assert.False(display.ApplyEnabled);
        Assert.Equal("Nothing to apply", display.ApplyButtonText);

        // A section the backend did not report renders the em-dash, not counts.
        var alertRules = Assert.Single(display.SectionRows, r => r.Key == "alert_rules");
        Assert.False(alertRules.HasCounts);
    }

    [Fact]
    public void Project_preview_while_applying_shows_spinner_label_and_disables_apply()
    {
        var snapshot = Snapshot(SettingsExportImportState.Preview) with
        {
            PendingFilename = "b.json",
            PendingSizeBytes = 10,
            PreviewResult = PreviewWithChanges(),
            IsApplying = true,
        };

        var display = SettingsExportImportProjection.Project(snapshot, Localizer);
        Assert.True(display.IsApplying);
        Assert.Equal("Applying\u2026", display.ApplyButtonText);
        Assert.False(display.ApplyEnabled);
    }

    // ---- Projection: applied --------------------------------------------------------

    [Fact]
    public void Project_applied_renders_header_and_rows_from_applied_result()
    {
        var snapshot = Snapshot(SettingsExportImportState.Applied) with { AppliedResult = PreviewWithChanges() };
        var display = SettingsExportImportProjection.Project(snapshot, Localizer);

        Assert.True(display.ShowApplied);
        Assert.False(display.ShowDropzone);
        Assert.Equal("Import complete", display.AppliedHeader);
        Assert.Equal("Done", display.DoneText);
        Assert.Equal(4, display.SectionRows.Count);
    }

    // ---- Projection: i18n routing + a11y --------------------------------------------

    [Fact]
    public void Project_routes_owned_strings_through_localizer()
    {
        var display = SettingsExportImportProjection.Project(Snapshot(SettingsExportImportState.Idle), new PrefixLocalizer());

        Assert.Equal("L:" + SettingsExportImportProjection.TitleKey, display.Title);
        Assert.Equal("L:" + SettingsExportImportProjection.SubtitleKey, display.Subtitle);
        Assert.Equal("L:" + SettingsExportImportProjection.ExportHelpKey, display.ExportHelp);
        Assert.Equal("L:" + SettingsExportImportProjection.ImportHelpKey, display.ImportHelp);
        Assert.Equal("L:" + SettingsExportImportProjection.DropPromptKey, display.DropPrompt);
    }

    [Theory]
    [InlineData("settings", "General settings")]
    [InlineData("alert_rules", "Alert rules")]
    [InlineData("geofences", "Geofences")]
    [InlineData("quiet_hours", "Quiet hours")]
    public void SectionLabel_maps_known_keys(string key, string expected) =>
        Assert.Equal(expected, SettingsExportImportProjection.SectionLabel(key, Localizer));

    [Fact]
    public void Project_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => SettingsExportImportProjection.Project(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => SettingsExportImportProjection.Project(Snapshot(SettingsExportImportState.Idle), null!));
    }

    // ---- View-model: export ---------------------------------------------------------

    [Fact]
    public async Task ViewModel_export_writes_to_downloads_and_toasts_success()
    {
        var (vm, _, downloader) = MakeViewModel();
        var toasts = CaptureToasts(vm);

        await vm.ExportAsync();

        Assert.False(vm.ExportBusy);
        var saved = Assert.Single(downloader.Saved);
        Assert.EndsWith(".json", saved.Filename, StringComparison.Ordinal);
        Assert.Contains("\"schema_version\"", saved.Json, StringComparison.Ordinal);
        var toast = Assert.Single(toasts);
        Assert.False(toast.IsError);
        Assert.Equal("Settings exported", toast.Title);
        Assert.Equal("Saved to your downloads folder.", toast.Detail);
    }

    [Fact]
    public async Task ViewModel_export_failure_raises_an_error_toast()
    {
        var (vm, source, downloader) = MakeViewModel();
        source.ExportError = new InvalidOperationException("boom");
        var toasts = CaptureToasts(vm);

        await vm.ExportAsync();

        Assert.False(vm.ExportBusy);
        Assert.Empty(downloader.Saved);
        var toast = Assert.Single(toasts);
        Assert.True(toast.IsError);
        Assert.Equal("Failed to export settings", toast.Title);
    }

    // ---- View-model: ingest (web ingestFile) ----------------------------------------

    [Fact]
    public async Task ViewModel_ingest_rejects_a_too_large_file_before_reading()
    {
        var (vm, _, _) = MakeViewModel();
        bool read = false;

        await vm.IngestAsync("big.json", SettingsBundleConstants.MaxImportFileBytes + 1, _ =>
        {
            read = true;
            return Task.FromResult("{}");
        });

        Assert.False(read);
        Assert.Equal(SettingsExportImportState.Idle, vm.State);
        Assert.Equal("File is too large (max 1 MB).", vm.ParseError);
    }

    [Fact]
    public async Task ViewModel_ingest_surfaces_a_read_failure()
    {
        var (vm, _, _) = MakeViewModel();

        await vm.IngestAsync("x.json", 10, _ => Task.FromException<string>(new IOException("denied")));

        Assert.Equal(SettingsExportImportState.Idle, vm.State);
        Assert.Equal("Failed to read the file.", vm.ParseError);
    }

    [Fact]
    public async Task ViewModel_ingest_surfaces_invalid_json()
    {
        var (vm, _, _) = MakeViewModel();

        await vm.IngestAsync("x.json", 10, _ => Task.FromResult("{ not json"));

        Assert.Equal(SettingsExportImportState.Idle, vm.State);
        Assert.NotNull(vm.ParseError);
        Assert.StartsWith("File is not valid JSON:", vm.ParseError, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_ingest_surfaces_a_schema_validation_error_without_calling_the_backend()
    {
        var (vm, source, _) = MakeViewModel();

        await vm.IngestAsync("x.json", 10, _ => Task.FromResult(
            "{\"schema_version\":1,\"exported_at\":\"x\",\"sections\":{\"evil\":[]}}"));

        Assert.Equal(SettingsExportImportState.Idle, vm.State);
        Assert.Contains("evil", vm.ParseError!, StringComparison.Ordinal);
        Assert.Empty(source.PreviewedBundles);
    }

    [Fact]
    public async Task ViewModel_ingest_runs_the_dry_run_and_enters_preview()
    {
        var (vm, source, _) = MakeViewModel();
        source.PreviewResult = PreviewWithChanges();

        await vm.IngestAsync("bundle.json", 512, _ => Task.FromResult(ValidBundleJson()));

        Assert.Equal(SettingsExportImportState.Preview, vm.State);
        Assert.Equal("bundle.json", vm.PendingFilename);
        Assert.Equal(512, vm.PendingSizeBytes);
        Assert.NotNull(vm.PreviewResult);
        Assert.Single(source.PreviewedBundles);
        Assert.True(vm.Display.ShowPreview);
        Assert.Equal("Apply 3 change(s)", vm.Display.ApplyButtonText);
    }

    [Fact]
    public async Task ViewModel_ingest_preview_failure_returns_to_idle_with_error_and_toast()
    {
        var (vm, source, _) = MakeViewModel();
        source.PreviewError = new InvalidOperationException("server down");
        var toasts = CaptureToasts(vm);

        await vm.IngestAsync("bundle.json", 512, _ => Task.FromResult(ValidBundleJson()));

        Assert.Equal(SettingsExportImportState.Idle, vm.State);
        Assert.Equal("Failed to preview import.", vm.ParseError);
        Assert.Null(vm.PendingFilename);
        Assert.Contains(toasts, t => t.IsError && t.Title == "Failed to preview import");
    }

    // ---- View-model: apply (web handleApply) ----------------------------------------

    [Fact]
    public async Task ViewModel_apply_enters_applied_and_toasts_the_applied_counts()
    {
        var (vm, source, _) = MakeViewModel();
        source.PreviewResult = PreviewWithChanges();
        source.ApplyResult = PreviewWithChanges();
        await vm.IngestAsync("bundle.json", 512, _ => Task.FromResult(ValidBundleJson()));
        var toasts = CaptureToasts(vm);

        await vm.ApplyAsync();

        Assert.Equal(SettingsExportImportState.Applied, vm.State);
        Assert.NotNull(vm.AppliedResult);
        Assert.Single(source.AppliedBundles);
        var toast = Assert.Single(toasts);
        Assert.False(toast.IsError);
        Assert.Equal("Settings imported", toast.Title);
        Assert.Equal("2 added, 1 updated, 1 skipped.", toast.Detail);
    }

    [Fact]
    public async Task ViewModel_apply_step_up_cancel_keeps_the_preview_visible()
    {
        var (vm, source, _) = MakeViewModel();
        source.PreviewResult = PreviewWithChanges();
        source.ApplyError = new SettingsImportStepUpCanceledException();
        await vm.IngestAsync("bundle.json", 512, _ => Task.FromResult(ValidBundleJson()));
        var toasts = CaptureToasts(vm);

        await vm.ApplyAsync();

        Assert.Equal(SettingsExportImportState.Preview, vm.State);
        Assert.Null(vm.AppliedResult);
        Assert.False(vm.IsApplying);
        Assert.Empty(toasts); // a cancelled step-up is not an error
    }

    [Fact]
    public async Task ViewModel_apply_failure_keeps_preview_and_toasts_error()
    {
        var (vm, source, _) = MakeViewModel();
        source.PreviewResult = PreviewWithChanges();
        source.ApplyError = new InvalidOperationException("server down");
        await vm.IngestAsync("bundle.json", 512, _ => Task.FromResult(ValidBundleJson()));
        var toasts = CaptureToasts(vm);

        await vm.ApplyAsync();

        Assert.Equal(SettingsExportImportState.Preview, vm.State);
        Assert.Null(vm.AppliedResult);
        var toast = Assert.Single(toasts);
        Assert.True(toast.IsError);
        Assert.Equal("Failed to apply import", toast.Title);
    }

    [Fact]
    public async Task ViewModel_reset_returns_to_idle_and_clears_state()
    {
        var (vm, source, _) = MakeViewModel();
        source.PreviewResult = PreviewWithChanges();
        await vm.IngestAsync("bundle.json", 512, _ => Task.FromResult(ValidBundleJson()));
        Assert.Equal(SettingsExportImportState.Preview, vm.State);

        vm.Reset();

        Assert.Equal(SettingsExportImportState.Idle, vm.State);
        Assert.Null(vm.PendingFilename);
        Assert.Null(vm.PreviewResult);
        Assert.Null(vm.ParseError);
        Assert.True(vm.Display.ShowDropzone);
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        var source = new InMemorySettingsBackupSource();
        var downloader = new InMemorySettingsBundleDownloader();
        Assert.Throws<ArgumentNullException>(() => new SettingsExportImportViewModel(null!, downloader, Localizer));
        Assert.Throws<ArgumentNullException>(() => new SettingsExportImportViewModel(source, null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => new SettingsExportImportViewModel(source, downloader, null!));
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("SettingsExportImport", SettingsExportImportRegistration.Slug);

    [Fact]
    public void Registration_name_is_the_localized_title()
    {
        Assert.Equal("Backup & Restore", SettingsExportImportRegistration.Name(Localizer));
        Assert.Equal("L:" + SettingsExportImportProjection.TitleKey, SettingsExportImportRegistration.Name(new PrefixLocalizer()));
    }

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SettingsExportImportDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SettingsExportImport", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new SettingsExportImportDiagnostics();
        diagnostics.RecordViewOpened();
        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    // ---- Helpers / test doubles -----------------------------------------------------

    private static SettingsExportImportSnapshot Snapshot(SettingsExportImportState state) =>
        new(state, ExportBusy: false, IsApplying: false, ParseError: null, PendingFilename: null,
            PendingSizeBytes: 0, PreviewResult: null, AppliedResult: null);

    private static SettingsImportResult PreviewWithChanges() =>
        new(true, new Dictionary<string, SettingsImportSectionResult>(StringComparer.Ordinal)
        {
            ["settings"] = new(0, 1, 0, Array.Empty<string>()),
            ["alert_rules"] = new(1, 0, 0, Array.Empty<string>()),
            ["geofences"] = new(0, 0, 1, Array.Empty<string>()),
            ["quiet_hours"] = new(1, 0, 0, Array.Empty<string>()),
        });

    private static string ValidBundleJson() =>
        "{\"schema_version\":1,\"exported_at\":\"2024-01-01T00:00:00Z\",\"sections\":{" +
        "\"settings\":{\"unit_of_length\":\"mi\"}," +
        "\"alert_rules\":[{\"name\":\"Battery Low\"}]," +
        "\"geofences\":[{\"name\":\"Home\"}]," +
        "\"quiet_hours\":[{\"start_local\":\"22:00\"}]}}";

    private static (SettingsExportImportViewModel Vm, InMemorySettingsBackupSource Source, InMemorySettingsBundleDownloader Downloader) MakeViewModel()
    {
        var source = new InMemorySettingsBackupSource();
        var downloader = new InMemorySettingsBundleDownloader();
        var vm = new SettingsExportImportViewModel(source, downloader, Localizer, () => new DateTimeOffset(2024, 1, 1, 0, 0, 0, TimeSpan.Zero));
        return (vm, source, downloader);
    }

    private static List<SettingsToast> CaptureToasts(SettingsExportImportViewModel vm)
    {
        var toasts = new List<SettingsToast>();
        vm.ToastRequested += (_, t) => toasts.Add(t);
        return toasts;
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
