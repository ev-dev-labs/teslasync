using System.Linq;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the ImportPreviewModal surface's UI-thread-free logic — the pure
/// validate / URL-decode / base-64 / drop-guard adapter (the web <c>validateImportData</c> /
/// <c>fromUrlSafeBase64</c> / <c>handleUrlImport</c>), the catalog-backed widget-availability check, the
/// state-holder view-model's per-state flows (input / parse error / preview-valid / preview-invalid /
/// auto-validate-on-open / back / confirm / dismiss), the tab / error-line / widget-row / mini-grid
/// projections, the i18n key + fallback contract that doubles as the Narrator-label source, and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/features/dashboard/components/ImportPreviewModal.tsx +
/// web/src/features/dashboard/hooks/validateImport.ts). The WinUI view itself (ImportPreviewModal.cs) is
/// exercised by the app build.
/// </summary>
public sealed class ImportPreviewModalTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private const string AvailableWidgetId = "vehicle-hero";
    private const string MissingWidgetId = "totally-not-a-real-widget";

    private static IImportIdentity Identity() => new FakeImportIdentity();

    // ── Adapter: JSON parse + required-field shape (web validateImportData) ───────────────────────────────

    [Fact]
    public void Validate_rejects_non_json_with_invalid_json_error()
    {
        var result = ImportValidator.Validate("not json at all", Identity());

        Assert.False(result.IsValid);
        Assert.Equal(ImportMessageKind.InvalidJson, Assert.Single(result.Errors).Kind);
        Assert.Null(result.Dashboard);
    }

    [Theory]
    [InlineData("[1, 2, 3]")]
    [InlineData("\"a string\"")]
    [InlineData("42")]
    [InlineData("true")]
    public void Validate_rejects_non_object_root_with_expected_object_error(string json)
    {
        var result = ImportValidator.Validate(json, Identity());

        Assert.False(result.IsValid);
        Assert.Equal(ImportMessageKind.ExpectedObject, Assert.Single(result.Errors).Kind);
    }

    [Fact]
    public void Validate_reports_every_missing_required_field()
    {
        var result = ImportValidator.Validate("{}", Identity());

        Assert.False(result.IsValid);
        var kinds = result.Errors.Select(e => e.Kind).ToArray();
        Assert.Contains(ImportMessageKind.MissingName, kinds);
        Assert.Contains(ImportMessageKind.MissingWidgets, kinds);
        Assert.Contains(ImportMessageKind.MissingLayouts, kinds);
    }

    [Fact]
    public void Validate_treats_empty_name_as_missing()
    {
        // web: `!data.name` is true for "" (falsy), so an empty name is rejected.
        var result = ImportValidator.Validate(
            """{"name":"","widgets":[],"layouts":{}}""", Identity());

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Kind == ImportMessageKind.MissingName);
    }

    [Fact]
    public void Validate_with_no_compatible_widgets_is_invalid()
    {
        var result = ImportValidator.Validate(
            """{"name":"Dash","widgets":[{"widgetId":"totally-not-a-real-widget"}],"layouts":{}}""",
            Identity());

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, e => e.Kind == ImportMessageKind.NoCompatibleWidgets);
        Assert.Empty(result.AvailableWidgets);
        Assert.Equal(new[] { MissingWidgetId }, result.MissingWidgets);
    }

    // ── Adapter: widget availability against the shared catalog ───────────────────────────────────────────

    [Fact]
    public void Registry_count_matches_the_shared_widget_catalog()
    {
        Assert.Equal(WidgetPickerCatalog.WidgetCount, ImportWidgetRegistry.Count);
        Assert.True(ImportWidgetRegistry.Contains(AvailableWidgetId));
        Assert.False(ImportWidgetRegistry.Contains(MissingWidgetId));
        Assert.Equal("Vehicle Card", ImportWidgetRegistry.DisplayName(AvailableWidgetId));
        Assert.Null(ImportWidgetRegistry.DisplayName(MissingWidgetId));
    }

    [Fact]
    public void Validate_partitions_available_and_missing_widgets_and_warns()
    {
        var result = ImportValidator.Validate(
            """
            {"name":"Mix","widgets":[
              {"id":"w1","widgetId":"vehicle-hero"},
              {"id":"w2","widgetId":"totally-not-a-real-widget"}
            ],"layouts":{"lg":[{"i":"w1","x":0,"y":0,"w":2,"h":2}]}}
            """,
            Identity());

        Assert.True(result.IsValid);
        Assert.Equal(new[] { AvailableWidgetId }, result.AvailableWidgets);
        Assert.Equal(new[] { MissingWidgetId }, result.MissingWidgets);
        var warning = Assert.Single(result.Warnings);
        Assert.Equal(ImportMessageKind.SkippedWidgets, warning.Kind);
        Assert.Equal(1, warning.Count);
        Assert.NotNull(result.Dashboard);
    }

    [Fact]
    public void Validate_caps_name_at_one_hundred_characters()
    {
        string longName = new string('a', 150);
        var result = ImportValidator.Validate(
            "{\"name\":\"" + longName + "\",\"widgets\":[{\"widgetId\":\"vehicle-hero\"}],\"layouts\":{}}",
            Identity());

        Assert.True(result.IsValid);
        Assert.Equal(ImportValidator.MaxNameLength, result.Dashboard!.Name.Length);
    }

    [Fact]
    public void Validate_generates_ids_for_widgets_without_one_and_dedupes_repeats()
    {
        var result = ImportValidator.Validate(
            """
            {"name":"Dash","widgets":[
              {"widgetId":"vehicle-hero"},
              {"id":"dup","widgetId":"vehicle-hero"},
              {"id":"dup","widgetId":"vehicle-hero"}
            ],"layouts":{}}
            """,
            Identity());

        Assert.True(result.IsValid);
        var ids = result.Dashboard!.Widgets.Select(w => w.Id).ToArray();
        Assert.Equal(3, ids.Length);
        Assert.Equal(ids.Length, ids.Distinct().Count());
    }

    // ── Adapter: layout sanitization (web sanitizeLayoutItem) ─────────────────────────────────────────────

    [Fact]
    public void Validate_clamps_out_of_range_layout_coordinates()
    {
        var result = ImportValidator.Validate(
            """
            {"name":"Dash","widgets":[{"id":"w1","widgetId":"vehicle-hero"}],
             "layouts":{"lg":[{"i":"w1","x":99,"y":-5,"w":99,"h":99}]}}
            """,
            Identity());

        Assert.True(result.IsValid);
        ImportLayoutItem item = Assert.Single(result.Dashboard!.Layouts["lg"]);
        Assert.Equal(3, item.X);   // clamp(99, 0, cols-1) with lg cols = 4
        Assert.Equal(0, item.Y);   // negative → 0
        Assert.Equal(4, item.W);   // clamp(99, 1, cols)
        Assert.Equal(ImportValidator.MaxRowSpan, item.H); // clamp(99, 1, 8)
    }

    [Fact]
    public void Validate_drops_layout_items_for_unavailable_widget_ids()
    {
        var result = ImportValidator.Validate(
            """
            {"name":"Dash","widgets":[{"id":"w1","widgetId":"vehicle-hero"}],
             "layouts":{"lg":[{"i":"w1","x":0,"y":0,"w":1,"h":1},{"i":"ghost","x":1,"y":0,"w":1,"h":1}]}}
            """,
            Identity());

        Assert.True(result.IsValid);
        ImportLayoutItem item = Assert.Single(result.Dashboard!.Layouts["lg"]);
        Assert.Equal("w1", item.I);
    }

    // ── Adapter: URL-safe base-64 + share-URL decode (web fromUrlSafeBase64 / handleUrlImport) ─────────────

    [Theory]
    [InlineData("{\"name\":\"Round Trip\"}")]
    [InlineData("unicode \u2014 \u00e9 \u4f60\u597d")]
    public void UrlSafeBase64_round_trips(string value) =>
        Assert.Equal(value, ImportValidator.FromUrlSafeBase64(ImportValidator.ToUrlSafeBase64(value)));

    [Fact]
    public void ToUrlSafeBase64_uses_url_safe_alphabet_without_padding()
    {
        string encoded = ImportValidator.ToUrlSafeBase64(new string('?', 6));
        Assert.DoesNotContain('+', encoded);
        Assert.DoesNotContain('/', encoded);
        Assert.DoesNotContain('=', encoded);
    }

    [Fact]
    public void DecodeImportUrl_reads_the_fragment_payload()
    {
        string payload = ImportValidator.ToUrlSafeBase64("""{"name":"Shared"}""");
        var result = ImportValidator.DecodeImportUrl($"https://teslasync.example.com/dashboard#import={payload}");

        Assert.Equal(ImportUrlStatus.Decoded, result.Status);
        Assert.Equal("""{"name":"Shared"}""", result.Json);
    }

    [Fact]
    public void DecodeImportUrl_reads_the_query_payload()
    {
        string payload = ImportValidator.ToUrlSafeBase64("""{"name":"Q"}""");
        var result = ImportValidator.DecodeImportUrl($"https://teslasync.example.com/dashboard?import={payload}");

        Assert.Equal(ImportUrlStatus.Decoded, result.Status);
        Assert.Equal("""{"name":"Q"}""", result.Json);
    }

    [Fact]
    public void DecodeImportUrl_prefers_the_fragment_over_the_query()
    {
        string fragment = ImportValidator.ToUrlSafeBase64("fragment");
        string query = ImportValidator.ToUrlSafeBase64("query");
        var result = ImportValidator.DecodeImportUrl(
            $"https://teslasync.example.com/dashboard?import={query}#import={fragment}");

        Assert.Equal(ImportUrlStatus.Decoded, result.Status);
        Assert.Equal("fragment", result.Json);
    }

    [Fact]
    public void DecodeImportUrl_reports_missing_parameter() =>
        Assert.Equal(
            ImportUrlStatus.NoImportParam,
            ImportValidator.DecodeImportUrl("https://teslasync.example.com/dashboard").Status);

    [Theory]
    [InlineData("not a url")]
    [InlineData("")]
    public void DecodeImportUrl_reports_unparseable_urls(string url) =>
        Assert.Equal(ImportUrlStatus.InvalidUrl, ImportValidator.DecodeImportUrl(url).Status);

    // ── Adapter: drop .json guard (web handleDrop) ────────────────────────────────────────────────────────

    [Theory]
    [InlineData("dashboard.json", null, true)]
    [InlineData("DASHBOARD.JSON", null, true)]
    [InlineData(null, "application/json", true)]
    [InlineData("notes.txt", "text/plain", false)]
    [InlineData(null, null, false)]
    public void IsJsonFile_matches_the_web_drop_guard(string? name, string? contentType, bool expected) =>
        Assert.Equal(expected, ImportValidator.IsJsonFile(name, contentType));

    // ── View-model: initial input state ──────────────────────────────────────────────────────────────────

    [Fact]
    public void New_view_model_starts_on_the_file_tab_in_input_mode()
    {
        var vm = CreateViewModel();

        Assert.Equal(ImportPreviewTab.File, vm.ActiveTab);
        Assert.False(vm.HasValidation);
        Assert.False(vm.HasParseError);
        Assert.Equal("Import Dashboard", vm.Title);
    }

    [Fact]
    public void Validate_buttons_gate_on_non_empty_input()
    {
        var vm = CreateViewModel();
        Assert.False(vm.CanValidatePasted);
        Assert.False(vm.CanLoadUrl);

        vm.PastedJson = "   ";
        vm.ImportUrl = "   ";
        Assert.False(vm.CanValidatePasted);
        Assert.False(vm.CanLoadUrl);

        vm.PastedJson = "{}";
        vm.ImportUrl = "https://x";
        Assert.True(vm.CanValidatePasted);
        Assert.True(vm.CanLoadUrl);
    }

    // ── View-model: parse-error states ───────────────────────────────────────────────────────────────────

    [Fact]
    public void ValidatePasted_with_blank_input_surfaces_the_empty_parse_error()
    {
        var vm = CreateViewModel();
        vm.PastedJson = "   ";

        vm.ValidatePasted();

        Assert.True(vm.HasParseError);
        Assert.Equal("No data to validate", vm.ParseErrorText);
        Assert.False(vm.HasValidation);
    }

    [Fact]
    public void LoadFromUrl_without_parameter_surfaces_the_no_param_error()
    {
        var vm = CreateViewModel();
        vm.ImportUrl = "https://teslasync.example.com/dashboard";

        vm.LoadFromUrl();

        Assert.True(vm.HasParseError);
        Assert.Equal("URL does not contain an import parameter", vm.ParseErrorText);
    }

    [Fact]
    public void LoadFromUrl_with_invalid_url_surfaces_the_invalid_url_error()
    {
        var vm = CreateViewModel();
        vm.ImportUrl = "::not a url::";

        vm.LoadFromUrl();

        Assert.True(vm.HasParseError);
        Assert.Equal("Invalid URL format", vm.ParseErrorText);
    }

    // ── View-model: preview transitions ──────────────────────────────────────────────────────────────────

    [Fact]
    public void ValidatePasted_with_valid_payload_enters_preview_mode()
    {
        var vm = CreateViewModel();
        vm.PastedJson = ValidPayload();

        vm.ValidatePasted();

        Assert.True(vm.HasValidation);
        Assert.True(vm.HasDashboard);
        Assert.True(vm.CanConfirm);
        Assert.Equal("Import Preview", vm.Title);
        Assert.Equal("My Dashboard", vm.DashboardName);
        Assert.False(vm.HasParseError);
    }

    [Fact]
    public void LoadFromUrl_with_valid_payload_enters_preview_mode()
    {
        var vm = CreateViewModel();
        vm.ImportUrl = $"https://x/#import={ImportValidator.ToUrlSafeBase64(ValidPayload())}";

        vm.LoadFromUrl();

        Assert.True(vm.HasValidation);
        Assert.True(vm.CanConfirm);
    }

    [Fact]
    public void Back_returns_to_input_mode()
    {
        var vm = CreateViewModel();
        vm.PastedJson = ValidPayload();
        vm.ValidatePasted();
        Assert.True(vm.HasValidation);

        vm.Back();

        Assert.False(vm.HasValidation);
        Assert.False(vm.HasParseError);
        Assert.Equal("Import Dashboard", vm.Title);
    }

    [Fact]
    public void Confirm_raises_the_dashboard_and_closes()
    {
        var vm = CreateViewModel();
        vm.PastedJson = ValidPayload();
        vm.ValidatePasted();

        ImportedDashboard? confirmed = null;
        bool closed = false;
        vm.Confirmed += (_, dashboard) => confirmed = dashboard;
        vm.CloseRequested += (_, _) => closed = true;

        vm.Confirm();

        Assert.NotNull(confirmed);
        Assert.Equal("My Dashboard", confirmed!.Name);
        Assert.True(closed);
        Assert.False(vm.HasValidation); // reset on close
    }

    [Fact]
    public void Confirm_without_a_validated_dashboard_is_a_no_op()
    {
        var vm = CreateViewModel();
        bool raised = false;
        vm.Confirmed += (_, _) => raised = true;

        vm.Confirm();

        Assert.False(raised);
    }

    [Fact]
    public void RequestClose_resets_state_and_raises_close()
    {
        var vm = CreateViewModel();
        vm.PastedJson = ValidPayload();
        vm.ValidatePasted();

        bool closed = false;
        vm.CloseRequested += (_, _) => closed = true;

        vm.RequestClose();

        Assert.True(closed);
        Assert.False(vm.HasValidation);
        Assert.Equal(ImportPreviewTab.File, vm.ActiveTab);
        Assert.Equal(string.Empty, vm.PastedJson);
    }

    // ── View-model: file import paths (web handleFileImport / handleDrop) ─────────────────────────────────

    [Fact]
    public async Task BrowseForFile_validates_a_picked_file()
    {
        var vm = CreateViewModel(new StaticImportFilePicker(ImportFilePick.Picked(ValidPayload())));

        await vm.BrowseForFileAsync();

        Assert.True(vm.HasValidation);
        Assert.True(vm.CanConfirm);
    }

    [Fact]
    public async Task BrowseForFile_surfaces_the_read_error_on_failure()
    {
        var vm = CreateViewModel(new StaticImportFilePicker(ImportFilePick.Failed));

        await vm.BrowseForFileAsync();

        Assert.True(vm.HasParseError);
        Assert.Equal("Failed to read file", vm.ParseErrorText);
        Assert.False(vm.HasValidation);
    }

    [Fact]
    public async Task BrowseForFile_does_nothing_when_cancelled()
    {
        var vm = CreateViewModel(new StaticImportFilePicker(ImportFilePick.Cancelled));

        await vm.BrowseForFileAsync();

        Assert.False(vm.HasValidation);
        Assert.False(vm.HasParseError);
    }

    [Fact]
    public void Dropping_a_non_json_file_surfaces_the_wrong_type_error()
    {
        var vm = CreateViewModel();

        bool accepted = vm.TryAcceptDroppedFile("notes.txt", "text/plain");

        Assert.False(accepted);
        Assert.True(vm.HasParseError);
        Assert.Equal("Please drop a .json file", vm.ParseErrorText);
    }

    [Fact]
    public void Dropping_a_json_file_is_accepted_then_validated()
    {
        var vm = CreateViewModel();

        Assert.True(vm.TryAcceptDroppedFile("dashboard.json", null));
        Assert.False(vm.HasParseError);

        vm.ImportFileText(ValidPayload());
        Assert.True(vm.HasValidation);
    }

    [Fact]
    public void FailFileRead_surfaces_the_read_error()
    {
        var vm = CreateViewModel();

        vm.FailFileRead();

        Assert.True(vm.HasParseError);
        Assert.Equal("Failed to read file", vm.ParseErrorText);
    }

    // ── View-model: auto-validate on open (web initialJson) ───────────────────────────────────────────────

    [Fact]
    public void NotifyOpened_with_initial_json_auto_validates_into_preview()
    {
        var vm = CreateViewModel();

        vm.NotifyOpened(ValidPayload());

        Assert.True(vm.HasValidation);
        Assert.True(vm.HasDashboard);
    }

    [Fact]
    public void NotifyOpened_without_initial_json_stays_in_input_mode()
    {
        var vm = CreateViewModel();

        vm.NotifyOpened(null);

        Assert.False(vm.HasValidation);
    }

    // ── Projection: tabs / lines / rows / mini-grid ──────────────────────────────────────────────────────

    [Fact]
    public void Tabs_are_the_three_sources_in_web_order_with_labels()
    {
        var tabs = ImportPreviewProjection.Tabs(Localizer);

        Assert.Equal(
            new[] { ImportPreviewTab.File, ImportPreviewTab.Paste, ImportPreviewTab.Url },
            tabs.Select(t => t.Tab).ToArray());
        Assert.Equal(
            new[] { "From File", "Paste JSON", "From URL" },
            tabs.Select(t => t.Label).ToArray());
    }

    [Fact]
    public void WidgetRows_list_available_widgets_then_skipped_ones()
    {
        var validation = ImportValidator.Validate(
            """
            {"name":"Mix","widgets":[
              {"id":"w1","widgetId":"vehicle-hero"},
              {"id":"w2","widgetId":"totally-not-a-real-widget"}
            ],"layouts":{}}
            """,
            Identity());

        var rows = ImportPreviewProjection.WidgetRows(validation);

        Assert.Equal(2, rows.Count);
        Assert.True(rows[0].Available);
        Assert.Equal("Vehicle Card", rows[0].DisplayName);
        Assert.NotNull(rows[0].IconGlyph);
        Assert.False(rows[1].Available);
        Assert.Equal(MissingWidgetId, rows[1].DisplayName);
        Assert.Null(rows[1].IconGlyph);
    }

    [Fact]
    public void PreviewModel_projects_the_lg_layout_and_widgets()
    {
        var validation = ImportValidator.Validate(
            """
            {"name":"Dash","widgets":[{"id":"w1","widgetId":"vehicle-hero"}],
             "layouts":{"lg":[{"i":"w1","x":0,"y":0,"w":2,"h":2}]}}
            """,
            Identity());

        MiniGridPreviewModel model = ImportPreviewProjection.PreviewModel(validation.Dashboard!);

        Assert.Single(model.Widgets);
        Assert.Equal("w1", Assert.Single(model.Layout).Key);
    }

    [Fact]
    public void Error_and_warning_lines_localize_the_findings()
    {
        var validation = ImportValidator.Validate(
            """{"name":"Dash","widgets":[{"widgetId":"totally-not-a-real-widget"}],"layouts":{}}""",
            Identity());

        var errors = ImportPreviewProjection.ErrorLines(validation, Localizer);

        Assert.Contains("No compatible widgets found in this layout", errors);
    }

    // ── Registration: i18n keys / glyphs (the Narrator-label + parity source) ─────────────────────────────

    [Fact]
    public void Registration_resolves_every_extracted_i18n_key()
    {
        Assert.Equal("Import Dashboard", ImportPreviewRegistration.Title(Localizer));
        Assert.Equal("Import Preview", ImportPreviewRegistration.PreviewTitle(Localizer));
        Assert.Equal("From File", ImportPreviewRegistration.TabFile(Localizer));
        Assert.Equal("Paste JSON", ImportPreviewRegistration.TabPaste(Localizer));
        Assert.Equal("From URL", ImportPreviewRegistration.TabUrl(Localizer));
        Assert.Equal("Drop a .json file here or click to browse", ImportPreviewRegistration.DropFile(Localizer));
        Assert.Equal("Browse Files", ImportPreviewRegistration.Browse(Localizer));
        Assert.Equal("Dashboard JSON file", ImportPreviewRegistration.FileInputLabel(Localizer));
        Assert.Equal("Validate & Preview", ImportPreviewRegistration.Validate(Localizer));
        Assert.Equal("Load from URL", ImportPreviewRegistration.LoadUrl(Localizer));
        Assert.Equal("Widgets", ImportPreviewRegistration.Widgets(Localizer));
        Assert.Equal("Not available", ImportPreviewRegistration.NotAvailable(Localizer));
        Assert.Equal("Cannot preview this layout", ImportPreviewRegistration.CannotPreview(Localizer));
        Assert.Equal("Back", ImportPreviewRegistration.Back(Localizer));
        Assert.Equal("Import Dashboard", ImportPreviewRegistration.Confirm(Localizer));
    }

    [Fact]
    public void Registration_resolves_the_parse_error_keys()
    {
        Assert.Equal("No data to validate", ImportPreviewRegistration.EmptyInput(Localizer));
        Assert.Equal("Failed to read file", ImportPreviewRegistration.ReadError(Localizer));
        Assert.Equal("Please drop a .json file", ImportPreviewRegistration.InvalidFileType(Localizer));
        Assert.Equal("URL does not contain an import parameter", ImportPreviewRegistration.NoImportParam(Localizer));
        Assert.Equal("Invalid URL format", ImportPreviewRegistration.InvalidUrl(Localizer));
    }

    [Fact]
    public void Registration_interpolates_the_count_badges()
    {
        Assert.Equal("3 widgets", ImportPreviewRegistration.AvailableCount(Localizer, 3));
        Assert.Equal("2 skipped", ImportPreviewRegistration.MissingCount(Localizer, 2));
        Assert.Equal(
            "5 widget(s) not available and will be skipped",
            ImportPreviewRegistration.Message(new ImportMessage(ImportMessageKind.SkippedWidgets, 5), Localizer));
    }

    [Fact]
    public void Registration_glyphs_are_non_empty()
    {
        Assert.False(string.IsNullOrEmpty(ImportPreviewRegistration.UploadGlyph));
        Assert.False(string.IsNullOrEmpty(ImportPreviewRegistration.BrowseGlyph));
        Assert.False(string.IsNullOrEmpty(ImportPreviewRegistration.ValidateGlyph));
        Assert.False(string.IsNullOrEmpty(ImportPreviewRegistration.LinkGlyph));
        Assert.False(string.IsNullOrEmpty(ImportPreviewRegistration.AvailableGlyph));
        Assert.False(string.IsNullOrEmpty(ImportPreviewRegistration.MissingGlyph));
    }

    // ── Diagnostics: PII-safe counters (P1/S11) ──────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emit_the_slugged_view_opened_and_imported_events()
    {
        var events = new List<string>();
        var diagnostics = new ImportPreviewDiagnostics(events.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordImported();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.Imported);
        Assert.Contains("view.opened slug=ImportPreviewModal", events);
        Assert.Contains("dashboard.imported slug=ImportPreviewModal", events);
    }

    [Fact]
    public void View_model_records_open_and_import_diagnostics()
    {
        var diagnostics = new ImportPreviewDiagnostics();
        var vm = new ImportPreviewModalViewModel(
            new StaticImportFilePicker(), Localizer, Identity(), diagnostics);

        vm.NotifyOpened(ValidPayload());
        vm.Confirm();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.Imported);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static string ValidPayload(string name = "My Dashboard") =>
        "{\"name\":\"" + name + "\",\"widgets\":[{\"id\":\"w1\",\"widgetId\":\"vehicle-hero\"}]," +
        "\"layouts\":{\"lg\":[{\"i\":\"w1\",\"x\":0,\"y\":0,\"w\":2,\"h\":2}]}}";

    private static ImportPreviewModalViewModel CreateViewModel(IImportFilePicker? picker = null) =>
        new(picker ?? new StaticImportFilePicker(), Localizer, new FakeImportIdentity());

    private sealed class FakeImportIdentity : IImportIdentity
    {
        private int _counter;

        public string NewWidgetId() => $"gen-{++_counter}";

        public string DedupeSuffix() => $"-dup-{++_counter}";

        public string DashboardId() => "import-test";

        public string TimestampIso() => "2024-01-01T00:00:00.000Z";
    }
}
