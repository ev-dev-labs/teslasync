using System.Text;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the ExportModal surface's UI-thread-free logic — the i18n key + fallback contract
/// (which doubles as the Narrator-label source), the pure projections (the URL-safe base64 encode, the minimal
/// share payload, the pretty / compact serialization, the byte-size tier, the share-URL assembly + 2000-char
/// limit, the layout-preview math and the download file name), the date-formatter adapter (web
/// <c>useDateFormat</c>), the state-holder view-model's per-state surfaces (the normal export, the empty layout,
/// and the URL-too-long warning + disabled share copy), the download / close command contract (web
/// <c>onDownload</c> / <c>onClose</c>) and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/dashboard/components/ExportModal.tsx + web/src/features/dashboard/hooks/validateImport.ts).
/// The WinUI view itself (ExportModal.cs) is exercised by the app build.
/// </summary>
public sealed class ExportModalTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
    private const string Origin = "https://teslasync.example";

    // ── Registration: slug + i18n fallbacks (the Narrator-label source) ──────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable() => Assert.Equal("ExportModal", ExportModalRegistration.Slug);

    [Fact]
    public void Registration_resolves_the_catalog_english_fallbacks()
    {
        Assert.Equal("Export Dashboard", ExportModalRegistration.Title(Localizer));
        Assert.Equal("Download JSON File", ExportModalRegistration.DownloadLabel(Localizer));
        Assert.Equal("Copy to Clipboard", ExportModalRegistration.CopyClipboardLabel(Localizer));
        Assert.Equal("Copy Shareable URL", ExportModalRegistration.CopyShareUrlLabel(Localizer));
        Assert.Equal("Copied!", ExportModalRegistration.CopiedLabel(Localizer));
        Assert.Equal("URL Copied!", ExportModalRegistration.UrlCopiedLabel(Localizer));
    }

    [Fact]
    public void Registration_interpolates_count_date_and_size_tokens()
    {
        Assert.Equal("3 widgets", ExportModalRegistration.WidgetCountLabel(Localizer, 3));
        Assert.Equal("0 widgets", ExportModalRegistration.WidgetCountLabel(Localizer, 0));
        Assert.Equal("Updated Apr 4, 2026", ExportModalRegistration.UpdatedLabel(Localizer, "Apr 4, 2026"));
        Assert.Equal(
            "Layout too large for URL sharing (2500 chars). Use clipboard or file export instead.",
            ExportModalRegistration.UrlTooLongLabel(Localizer, 2500));
    }

    [Fact]
    public void Registration_copy_flows_through_the_i18n_keys()
    {
        var localizer = new KeyCapturingLocalizer();

        ExportModalRegistration.Title(localizer);
        ExportModalRegistration.WidgetCountLabel(localizer, 1);
        ExportModalRegistration.UpdatedLabel(localizer, "x");
        ExportModalRegistration.DownloadLabel(localizer);
        ExportModalRegistration.CopyClipboardLabel(localizer);
        ExportModalRegistration.CopyShareUrlLabel(localizer);
        ExportModalRegistration.CopiedLabel(localizer);
        ExportModalRegistration.UrlCopiedLabel(localizer);
        ExportModalRegistration.UrlTooLongLabel(localizer, 1);
        ExportModalRegistration.CloseLabel(localizer);

        string[] expected =
        [
            "export.title",
            "export.widgetCount",
            "export.updated",
            "export.downloadFile",
            "export.copyClipboard",
            "export.copyShareUrl",
            "export.copied",
            "export.urlCopied",
            "export.urlTooLong",
            "common.close",
        ];
        foreach (var key in expected)
        {
            Assert.Contains(key, localizer.RequestedKeys);
        }
    }

    [Fact]
    public void Registration_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => ExportModalRegistration.Title(null!));

    // ── Projection: URL-safe base64 (web toUrlSafeBase64) ────────────────────────────────────────────────

    [Theory]
    [InlineData("{}", "e30")]
    [InlineData("hi", "aGk")]
    public void ToUrlSafeBase64_matches_known_vectors(string input, string expected) =>
        Assert.Equal(expected, ExportModalProjection.ToUrlSafeBase64(input));

    [Fact]
    public void ToUrlSafeBase64_strips_padding_and_uses_url_safe_alphabet()
    {
        // A payload large enough to force '+' and '/' in standard base64 — both must be remapped.
        string encoded = ExportModalProjection.ToUrlSafeBase64(new string('\u00ff', 64));

        Assert.DoesNotContain('+', encoded);
        Assert.DoesNotContain('/', encoded);
        Assert.DoesNotContain('=', encoded);
        Assert.Equal(new string('\u00ff', 64), Decode(encoded));
    }

    [Fact]
    public void ToUrlSafeBase64_round_trips_unicode() =>
        Assert.Equal("dashboard \u2014 \u00e9\u00e0", Decode(ExportModalProjection.ToUrlSafeBase64("dashboard \u2014 \u00e9\u00e0")));

    // ── Projection: minimal export (web buildMinimalExport) ──────────────────────────────────────────────

    [Fact]
    public void BuildMinimalExport_keeps_name_widgets_layouts_and_strips_metadata()
    {
        var minimal = ExportModalProjection.BuildMinimalExport(SampleDashboard());

        using var doc = JsonDocument.Parse(minimal);
        var root = doc.RootElement;
        Assert.Equal("My Dashboard", root.GetProperty("name").GetString());
        Assert.True(root.TryGetProperty("widgets", out _));
        Assert.True(root.TryGetProperty("layouts", out _));
        Assert.False(root.TryGetProperty("id", out _));
        Assert.False(root.TryGetProperty("createdAt", out _));
        Assert.False(root.TryGetProperty("updatedAt", out _));
        Assert.False(root.TryGetProperty("isDefault", out _));
        Assert.DoesNotContain('\n', minimal); // compact
    }

    [Fact]
    public void BuildMinimalExport_includes_widget_config_only_when_present()
    {
        var withConfig = SampleDashboard(widgetConfig: Json("{\"vehicleId\":7}"));
        var withoutConfig = SampleDashboard();

        using var a = JsonDocument.Parse(ExportModalProjection.BuildMinimalExport(withConfig));
        using var b = JsonDocument.Parse(ExportModalProjection.BuildMinimalExport(withoutConfig));

        Assert.True(a.RootElement.GetProperty("widgets")[0].TryGetProperty("config", out var cfg));
        Assert.Equal(7, cfg.GetProperty("vehicleId").GetInt32());
        Assert.False(b.RootElement.GetProperty("widgets")[0].TryGetProperty("config", out _));
    }

    // ── Projection: full serialization (web JSON.stringify(dashboard, null, 2)) ───────────────────────────

    [Fact]
    public void SerializeDashboard_is_indented_and_includes_full_fields_omitting_null_optionals()
    {
        string json = ExportModalProjection.SerializeDashboard(SampleDashboard());

        Assert.Contains("\n", json); // pretty
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        Assert.Equal("dash-1", root.GetProperty("id").GetString());
        Assert.Equal("My Dashboard", root.GetProperty("name").GetString());
        Assert.True(root.TryGetProperty("createdAt", out _));
        Assert.True(root.TryGetProperty("updatedAt", out _));
        Assert.False(root.TryGetProperty("icon", out _));
        Assert.False(root.TryGetProperty("vehicleId", out _));
        Assert.False(root.TryGetProperty("settings", out _));
    }

    // ── Projection: byte size + human tier (web Blob size + B/KB) ────────────────────────────────────────

    [Fact]
    public void ByteSize_counts_utf8_bytes() =>
        Assert.Equal(4, ExportModalProjection.ByteSize("\u00e9\u00e9")); // each é is 2 UTF-8 bytes

    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(512, "512 B")]
    [InlineData(1023, "1023 B")]
    [InlineData(1024, "1.0 KB")]
    [InlineData(1536, "1.5 KB")]
    [InlineData(10240, "10.0 KB")]
    public void FormatJsonSize_matches_the_web_tier(int bytes, string expected) =>
        Assert.Equal(expected, ExportModalProjection.FormatJsonSize(bytes));

    // ── Projection: share URL (web `${origin}/dashboard#import=${encoded}`) ──────────────────────────────

    [Fact]
    public void BuildShareUrl_composes_origin_route_and_encoded_payload()
    {
        var dashboard = SampleDashboard();
        string url = ExportModalProjection.BuildShareUrl(Origin, dashboard);

        Assert.StartsWith("https://teslasync.example/dashboard#import=", url, StringComparison.Ordinal);
        string encoded = url["https://teslasync.example/dashboard#import=".Length..];
        Assert.Equal(ExportModalProjection.BuildMinimalExport(dashboard), Decode(encoded));
    }

    [Fact]
    public void BuildShareUrl_trims_a_trailing_slash_on_the_origin()
    {
        string url = ExportModalProjection.BuildShareUrl("https://teslasync.example/", SampleDashboard());
        Assert.StartsWith("https://teslasync.example/dashboard#import=", url, StringComparison.Ordinal);
        Assert.DoesNotContain("//dashboard", url);
    }

    [Fact]
    public void IsShareUrlTooLong_gates_at_2000_characters()
    {
        Assert.False(ExportModalProjection.IsShareUrlTooLong(new string('a', 2000)));
        Assert.True(ExportModalProjection.IsShareUrlTooLong(new string('a', 2001)));
    }

    // ── Projection: layout preview (web MiniGridPreview) ─────────────────────────────────────────────────

    [Fact]
    public void BuildMiniGrid_defaults_empty_layout_to_four_cols_two_rows_no_tiles()
    {
        var grid = ExportModalProjection.BuildMiniGrid(SampleDashboard(includeLayout: false));

        Assert.Equal(4, grid.Columns);
        Assert.Equal(2, grid.Rows);
        Assert.Empty(grid.Tiles);
    }

    [Fact]
    public void BuildMiniGrid_uses_max_y_plus_h_for_rows_and_maps_tiles()
    {
        var dashboard = SampleDashboard(layout:
        [
            new DashboardLayoutItem("w1", 0, 0, 2, 2),
            new DashboardLayoutItem("w2", 2, 2, 2, 2),
        ]);

        var grid = ExportModalProjection.BuildMiniGrid(dashboard);

        Assert.Equal(4, grid.Columns);
        Assert.Equal(4, grid.Rows);
        Assert.Collection(
            grid.Tiles,
            t => Assert.Equal((0, 0, 2, 2), (t.Column, t.Row, t.ColumnSpan, t.RowSpan)),
            t => Assert.Equal((2, 2, 2, 2), (t.Column, t.Row, t.ColumnSpan, t.RowSpan)));
    }

    [Fact]
    public void BuildMiniGrid_clamps_out_of_bounds_items_into_the_grid()
    {
        var dashboard = SampleDashboard(layout:
        [
            new DashboardLayoutItem("oob", 6, 0, 9, 1),
        ]);

        var tile = Assert.Single(ExportModalProjection.BuildMiniGrid(dashboard).Tiles);
        Assert.Equal(3, tile.Column);     // clamped to cols-1
        Assert.Equal(1, tile.ColumnSpan); // clamped to remaining width
        Assert.True(tile.Row >= 0);
        Assert.True(tile.RowSpan >= 1);
    }

    // ── Projection: download file name ───────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("My Dashboard", "My Dashboard.json")]
    [InlineData("", "dashboard.json")]
    [InlineData("   ", "dashboard.json")]
    [InlineData("a/b:c*d", "a-b-c-d.json")]
    public void ExportFileName_sanitizes_and_falls_back(string? name, string expected) =>
        Assert.Equal(expected, ExportModalProjection.ExportFileName(name));

    [Fact]
    public void Projection_rejects_null_inputs()
    {
        Assert.Throws<ArgumentNullException>(() => ExportModalProjection.SerializeDashboard(null!));
        Assert.Throws<ArgumentNullException>(() => ExportModalProjection.BuildMinimalExport(null!));
        Assert.Throws<ArgumentNullException>(() => ExportModalProjection.ToUrlSafeBase64(null!));
        Assert.Throws<ArgumentNullException>(() => ExportModalProjection.BuildShareUrl(null!, SampleDashboard()));
    }

    // ── Source: date formatter (web useDateFormat) ───────────────────────────────────────────────────────

    [Fact]
    public void SystemExportDateFormatter_delegates_to_the_shared_date_variant()
    {
        var formatter = new SystemExportDateFormatter(() => Now);
        var instant = new DateTimeOffset(2026, 4, 4, 9, 30, 0, TimeSpan.Zero);

        Assert.Equal(
            DateTimeFormatting.Format(instant, DateTimeVariant.Date, Now),
            formatter.FormatDate(instant));
    }

    [Fact]
    public void SystemExportDateFormatter_renders_the_em_dash_for_a_missing_instant() =>
        Assert.Equal(DateTimeFormatting.DefaultEmptyDisplay, new SystemExportDateFormatter(() => Now).FormatDate(null));

    // ── ViewModel: the normal export state ───────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_projects_the_normal_state()
    {
        var vm = NewViewModel(SampleDashboard());

        Assert.Equal("Export Dashboard", vm.Title);
        Assert.Equal("My Dashboard", vm.DashboardName);
        Assert.Equal("2 widgets", vm.WidgetCountLabel);
        Assert.Equal("Updated Apr 4, 2026", vm.UpdatedLabel);
        Assert.EndsWith(" B", vm.JsonSizeLabel, StringComparison.Ordinal);
        Assert.Contains("\"name\": \"My Dashboard\"", vm.DashboardJson, StringComparison.Ordinal);
        Assert.StartsWith("https://teslasync.example/dashboard#import=", vm.ShareUrl, StringComparison.Ordinal);
        Assert.False(vm.ShareUrlTooLong);
        Assert.True(vm.CanCopyShareUrl);
        Assert.False(vm.HasShareError);
        Assert.Null(vm.ShareErrorMessage);
        Assert.Equal("My Dashboard.json", vm.DownloadFileName);
        Assert.Equal(2, vm.MiniGrid.Tiles.Count);
    }

    [Fact]
    public void ViewModel_projects_an_empty_layout_dashboard()
    {
        var vm = NewViewModel(SampleDashboard(widgetCount: 0, includeLayout: false));

        Assert.Equal("0 widgets", vm.WidgetCountLabel);
        Assert.Empty(vm.MiniGrid.Tiles);
        Assert.Equal(2, vm.MiniGrid.Rows);
        Assert.False(vm.HasShareError);
    }

    // ── ViewModel: the URL-too-long state (web shareUrlTooLong) ──────────────────────────────────────────

    [Fact]
    public void ViewModel_surfaces_the_warning_and_disables_share_copy_when_url_too_long()
    {
        var vm = NewViewModel(OversizedDashboard());

        Assert.True(vm.ShareUrlTooLong);
        Assert.False(vm.CanCopyShareUrl);
        Assert.True(vm.HasShareError);
        Assert.NotNull(vm.ShareErrorMessage);
        Assert.Contains("Layout too large for URL sharing", vm.ShareErrorMessage!, StringComparison.Ordinal);
        Assert.Contains(vm.ShareUrl.Length.ToString(System.Globalization.CultureInfo.CurrentCulture), vm.ShareErrorMessage!, StringComparison.Ordinal);
    }

    // ── ViewModel: commands (web handleDownload / onClose) ───────────────────────────────────────────────

    [Fact]
    public void NotifyOpened_records_the_view_opened_diagnostic()
    {
        var captured = new List<string>();
        var vm = NewViewModel(SampleDashboard(), captured);

        vm.NotifyOpened();

        Assert.Equal("view.opened slug=ExportModal", Assert.Single(captured));
    }

    [Fact]
    public void RequestDownload_raises_the_request_with_json_and_file_name_and_records_the_export()
    {
        var captured = new List<string>();
        var vm = NewViewModel(SampleDashboard(), captured);
        ExportDownloadRequest? request = null;
        vm.DownloadRequested += (_, r) => request = r;

        vm.RequestDownload();

        Assert.NotNull(request);
        Assert.Equal(vm.DashboardJson, request!.Json);
        Assert.Equal("My Dashboard.json", request.FileName);
        Assert.Equal("dashboard.exported slug=ExportModal", Assert.Single(captured));
    }

    [Fact]
    public void RequestClose_raises_the_close_event()
    {
        var vm = NewViewModel(SampleDashboard());
        int closed = 0;
        vm.CloseRequested += (_, _) => closed++;

        vm.RequestClose();

        Assert.Equal(1, closed);
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        var dashboard = SampleDashboard();
        var formatter = new StubDateFormatter("Apr 4, 2026");
        Assert.Throws<ArgumentNullException>(() => new ExportModalViewModel(null!, Origin, Localizer, formatter));
        Assert.Throws<ArgumentNullException>(() => new ExportModalViewModel(dashboard, null!, Localizer, formatter));
        Assert.Throws<ArgumentNullException>(() => new ExportModalViewModel(dashboard, Origin, null!, formatter));
        Assert.Throws<ArgumentNullException>(() => new ExportModalViewModel(dashboard, Origin, Localizer, null!));
    }

    // ── Accessibility: the labels that back the Narrator names are non-empty ─────────────────────────────

    [Fact]
    public void ViewModel_exposes_non_empty_accessible_labels()
    {
        var vm = NewViewModel(SampleDashboard());

        Assert.All(
            new[] { vm.Title, vm.DownloadLabel, vm.CopyClipboardLabel, vm.CopyShareUrlLabel, vm.CloseLabel, vm.WidgetCountLabel, vm.JsonSizeLabel, vm.UpdatedLabel },
            label => Assert.False(string.IsNullOrWhiteSpace(label)));
    }

    // ── Diagnostics (P1/S11): slug-only counters, never dashboard data ───────────────────────────────────

    [Fact]
    public void Diagnostics_count_each_operational_event()
    {
        var captured = new List<string>();
        var diagnostics = new ExportModalDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordDashboardExported();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.DashboardsExported);
        Assert.Equal(
            ["view.opened slug=ExportModal", "dashboard.exported slug=ExportModal"],
            captured);
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private static ExportModalViewModel NewViewModel(SavedDashboardSnapshot dashboard, List<string>? sink = null) =>
        new(
            dashboard,
            Origin,
            Localizer,
            new StubDateFormatter("Apr 4, 2026"),
            sink is null ? null : new ExportModalDiagnostics(sink.Add));

    private static SavedDashboardSnapshot SampleDashboard(
        int widgetCount = 2,
        bool includeLayout = true,
        JsonElement? widgetConfig = null,
        IReadOnlyList<DashboardLayoutItem>? layout = null)
    {
        var widgets = new List<WidgetInstanceSnapshot>();
        for (int i = 0; i < widgetCount; i++)
        {
            widgets.Add(new WidgetInstanceSnapshot(
                $"w{i + 1}",
                $"battery-gauge-{i + 1}",
                i == 0 ? widgetConfig : null));
        }

        var layouts = new Dictionary<string, IReadOnlyList<DashboardLayoutItem>>();
        if (layout is not null)
        {
            layouts["lg"] = layout;
        }
        else if (includeLayout)
        {
            layouts["lg"] =
            [
                new DashboardLayoutItem("w1", 0, 0, 2, 2),
                new DashboardLayoutItem("w2", 2, 0, 2, 3),
            ];
        }

        return new SavedDashboardSnapshot(
            "dash-1",
            "My Dashboard",
            widgets,
            layouts,
            "2026-01-01T00:00:00Z",
            "2026-04-04T09:30:00Z");
    }

    private static SavedDashboardSnapshot OversizedDashboard()
    {
        // A widget config large enough that the encoded share link blows past the 2000-char limit.
        var config = Json("{\"note\":\"" + new string('x', 2400) + "\"}");
        return SampleDashboard(widgetConfig: config);
    }

    private static JsonElement Json(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static string Decode(string urlSafeBase64)
    {
        string padded = urlSafeBase64.Replace('-', '+').Replace('_', '/');
        switch (padded.Length % 4)
        {
            case 2: padded += "=="; break;
            case 3: padded += "="; break;
            default: break;
        }

        return Encoding.UTF8.GetString(Convert.FromBase64String(padded));
    }

    private sealed class StubDateFormatter : IExportDateFormatter
    {
        private readonly string _value;

        public StubDateFormatter(string value) => _value = value;

        public DateTimeOffset? LastValue { get; private set; }

        public string FormatDate(DateTimeOffset? value)
        {
            LastValue = value;
            return _value;
        }
    }

    private sealed class KeyCapturingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = [];

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }
}
