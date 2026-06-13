using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.SystemDiagnostics;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>DiagnosticPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/system/pages/DiagnosticPage.tsx), the tolerant parsers, the <c>formatDiagnosticReportText</c> and
/// download-filename ports, the view-model's three-state matrix (loading / empty / success) with the layered failure
/// panel, and the generated-client runner's request shaping (web <c>useRunDiagnostic</c>). The WinUI view is exercised
/// by the app build; its per-region visibility is driven entirely by the <see cref="DiagnosticDisplay"/> flags asserted
/// here.
/// </summary>
public sealed class DiagnosticPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // The 16 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "diagnostic.checkCount", "diagnostic.copyReport", "diagnostic.copyReportSuccess", "diagnostic.downloadReport",
        "diagnostic.duration", "diagnostic.errorBody", "diagnostic.errorTitle", "diagnostic.filename",
        "diagnostic.lastRun", "diagnostic.noReport", "diagnostic.remediationLabel", "diagnostic.rerun",
        "diagnostic.run", "diagnostic.running", "diagnostic.subtitle", "diagnostic.title",
    ];

    private static DiagnosticReport SampleReport(
        DiagnosticOverallStatus overall = DiagnosticOverallStatus.Degraded,
        string generatedAt = "2025-01-15T12:34:56Z") => new(
        GeneratedAt: generatedAt,
        OverallStatus: overall,
        Checks:
        [
            new DiagnosticCheck("db.connectivity", "Database connectivity", DiagnosticCheckStatus.Ok, "SELECT 1 succeeded", null, 4),
            new DiagnosticCheck("telemetry.signal_log_freshness", "Telemetry freshness", DiagnosticCheckStatus.Warn, "most recent signal 12m20s ago", "Check Fleet Telemetry stream.", 8),
            new DiagnosticCheck("mqtt.connected", "MQTT broker connection", DiagnosticCheckStatus.Fail, "broker unreachable", "Restart mosquitto.", 2),
        ]);

    private static DiagnosticModel SuccessModel(DiagnosticReport? report = null) => new(
        HasReport: true,
        Report: report ?? SampleReport(),
        IsRunning: false,
        HasError: false,
        ErrorDetail: null);

    // ---- i18n key coverage (all 16 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = DiagnosticProjection.Project(SuccessModel(), recorder, Now);

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
        _ = DiagnosticProjection.Project(DiagnosticModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_overall_and_status_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = DiagnosticProjection.Project(SuccessModel(SampleReport(DiagnosticOverallStatus.Ok)), recorder, Now);

        Assert.Contains("diagnostic.overall.ok", recorder.Keys);
        Assert.Contains("diagnostic.status.ok", recorder.Keys);
        Assert.Contains("diagnostic.status.warn", recorder.Keys);
        Assert.Contains("diagnostic.status.fail", recorder.Keys);
    }

    // ---- Three data states ---------------------------------------------------------

    [Fact]
    public void State_loading_when_run_in_flight()
    {
        var model = DiagnosticModel.Initial with { IsRunning = true };
        var display = DiagnosticProjection.Project(model, Localizer, Now);

        Assert.Equal(DiagnosticState.Loading, display.State);
        Assert.True(display.ShowRunning);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowOverall);
        Assert.False(display.ShowChecks);
        Assert.False(display.ShowActions);
        Assert.Equal("Running diagnostic\u2026", display.RunningText);
    }

    [Fact]
    public void State_empty_before_any_run()
    {
        var display = DiagnosticProjection.Project(DiagnosticModel.Initial, Localizer, Now);

        Assert.Equal(DiagnosticState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowRunning);
        Assert.False(display.ShowOverall);
        Assert.False(display.ShowError);
        Assert.Equal("System diagnostic", display.EmptyTitle);
        Assert.Equal(
            "No diagnostic has been run in this session yet. Click \"Run diagnostic\" to probe every dependency.",
            display.EmptyMessage);
        Assert.Equal("Run diagnostic", display.EmptyActionLabel);
        Assert.Equal("Run diagnostic", display.RunLabel);
    }

    [Fact]
    public void State_success_renders_hero_actions_and_checks()
    {
        var display = DiagnosticProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(DiagnosticState.Success, display.State);
        Assert.True(display.ShowOverall);
        Assert.True(display.ShowActions);
        Assert.True(display.ShowChecks);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowRunning);
        Assert.Equal("Re-run diagnostic", display.RunLabel);
        Assert.Equal(3, display.Checks.Count);
    }

    [Fact]
    public void State_error_panel_layers_over_the_empty_surface()
    {
        var model = DiagnosticModel.Initial with { HasError = true, ErrorDetail = "boom: 500 Internal" };
        var display = DiagnosticProjection.Project(model, Localizer, Now);

        Assert.Equal(DiagnosticState.Empty, display.State);
        Assert.True(display.ShowError);
        Assert.True(display.ShowEmpty);
        Assert.Equal("Diagnostic failed to run", display.ErrorTitle);
        Assert.Equal("boom: 500 Internal", display.ErrorMessage);
    }

    [Fact]
    public void Error_message_falls_back_to_body_when_detail_absent()
    {
        var model = DiagnosticModel.Initial with { HasError = true, ErrorDetail = null };
        var display = DiagnosticProjection.Project(model, Localizer, Now);

        Assert.Equal(
            "The diagnostic endpoint returned an error. Check API logs and try again.",
            display.ErrorMessage);
    }

    // ---- Panel: overall hero -------------------------------------------------------

    [Theory]
    [InlineData(DiagnosticOverallStatus.Ok, StatusKind.Success, "All systems healthy")]
    [InlineData(DiagnosticOverallStatus.Degraded, StatusKind.Warning, "Degraded \u2014 some checks need attention")]
    [InlineData(DiagnosticOverallStatus.Down, StatusKind.Danger, "One or more checks failed")]
    public void Overall_hero_tone_and_title(DiagnosticOverallStatus overall, StatusKind tone, string title)
    {
        var display = DiagnosticProjection.Project(SuccessModel(SampleReport(overall)), Localizer, Now);

        Assert.Equal(tone, display.OverallTone);
        Assert.Equal(title, display.OverallTitle);
    }

    [Fact]
    public void Overall_hero_last_run_formats_through_the_shared_formatter()
    {
        var display = DiagnosticProjection.Project(SuccessModel(), Localizer, Now);

        var when = DateTimeFormatting.Format(
            DateTimeOffset.Parse("2025-01-15T12:34:56Z", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal),
            DateTimeVariant.Full,
            Now);
        Assert.Equal($"Generated {when}", display.LastRunText);
    }

    [Theory]
    [InlineData(1, "1 check")]
    [InlineData(3, "3 checks")]
    [InlineData(0, "0 checks")]
    public void Overall_hero_check_count_pluralizes(int count, string expected)
    {
        var checks = Enumerable.Range(0, count)
            .Select(i => new DiagnosticCheck($"id{i}", $"Check {i}", DiagnosticCheckStatus.Ok, "ok", null, 1))
            .ToList();
        var report = new DiagnosticReport("2025-01-15T12:34:56Z", DiagnosticOverallStatus.Ok, checks);

        var display = DiagnosticProjection.Project(SuccessModel(report), Localizer, Now);

        Assert.Equal(expected, display.CheckCountText);
    }

    // ---- Panel: check cards --------------------------------------------------------

    [Fact]
    public void Check_cards_project_tone_badge_duration_and_remediation()
    {
        var display = DiagnosticProjection.Project(SuccessModel(), Localizer, Now);

        var ok = display.Checks[0];
        Assert.Equal("Database connectivity", ok.Name);
        Assert.Equal("db.connectivity", ok.Id);
        Assert.Equal("SELECT 1 succeeded", ok.Detail);
        Assert.Equal(StatusKind.Success, ok.Tone);
        Assert.Equal("OK", ok.StatusBadgeLabel);
        Assert.Equal("4ms", ok.DurationText);
        Assert.False(ok.ShowRemediation);

        var warn = display.Checks[1];
        Assert.Equal(StatusKind.Warning, warn.Tone);
        Assert.Equal("Warning", warn.StatusBadgeLabel);
        Assert.True(warn.ShowRemediation);
        Assert.Equal("Remediation", warn.RemediationLabel);
        Assert.Equal("Check Fleet Telemetry stream.", warn.Remediation);

        var fail = display.Checks[2];
        Assert.Equal(StatusKind.Danger, fail.Tone);
        Assert.Equal("Fail", fail.StatusBadgeLabel);
    }

    // ---- Data source: formatDiagnosticReportText -----------------------------------

    [Fact]
    public void ReportText_matches_the_web_plain_text_format()
    {
        var report = new DiagnosticReport(
            "2025-01-15T12:34:56Z",
            DiagnosticOverallStatus.Degraded,
            [
                new DiagnosticCheck("db.connectivity", "Database connectivity", DiagnosticCheckStatus.Ok, "SELECT 1 succeeded", null, 4),
                new DiagnosticCheck("telemetry.signal_log_freshness", "Telemetry freshness", DiagnosticCheckStatus.Warn, "most recent signal 12m20s ago", "Check Fleet Telemetry stream.", 8),
            ]);

        var text = DiagnosticReportText.Format(report);

        var expected = string.Join("\n",
            "TeslaSync diagnostic report",
            "Generated: 2025-01-15T12:34:56Z",
            "Overall:   degraded",
            string.Empty,
            "Checks:",
            "  [OK] Database connectivity (db.connectivity) \u2014 4ms",
            "    detail:      SELECT 1 succeeded",
            "  [WARN] Telemetry freshness (telemetry.signal_log_freshness) \u2014 8ms",
            "    detail:      most recent signal 12m20s ago",
            "    remediation: Check Fleet Telemetry stream.",
            string.Empty);
        Assert.Equal(expected, text);
    }

    // ---- Download filename ---------------------------------------------------------

    [Fact]
    public void Filename_slugifies_the_report_timestamp()
    {
        var name = DiagnosticFilename.Build("2025-01-15T12:34:56Z", "teslasync-diagnostic-{0}.txt", Now);
        Assert.Equal("teslasync-diagnostic-2025-01-15T12-34-56Z.txt", name);
    }

    [Fact]
    public void Filename_falls_back_to_now_when_timestamp_unparseable()
    {
        var name = DiagnosticFilename.Build("not-a-date", "teslasync-diagnostic-{0}.txt", Now);
        Assert.Equal("teslasync-diagnostic-2026-06-06T12-00-00Z.txt", name);
    }

    [Fact]
    public void Projection_exposes_report_text_and_filename_for_the_actions()
    {
        var display = DiagnosticProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal("teslasync-diagnostic-2025-01-15T12-34-56Z.txt", display.DownloadFilename);
        Assert.StartsWith("TeslaSync diagnostic report", display.ReportText, StringComparison.Ordinal);
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Report_parse_reads_status_checks_and_pretty_json()
    {
        using var doc = JsonDocument.Parse(
            "{\"generated_at\":\"2025-01-15T12:34:56Z\",\"overall_status\":\"degraded\",\"checks\":[" +
            "{\"id\":\"db.connectivity\",\"name\":\"Database connectivity\",\"status\":\"ok\",\"detail\":\"SELECT 1 succeeded\",\"duration_ms\":4}," +
            "{\"id\":\"mqtt.connected\",\"name\":\"MQTT\",\"status\":\"fail\",\"detail\":\"down\",\"remediation\":\"restart\",\"duration_ms\":2}]}");

        var report = DiagnosticReport.FromJson(doc.RootElement);

        Assert.Equal("2025-01-15T12:34:56Z", report.GeneratedAt);
        Assert.Equal(DiagnosticOverallStatus.Degraded, report.OverallStatus);
        Assert.Equal(2, report.Checks.Count);
        Assert.Equal(DiagnosticCheckStatus.Ok, report.Checks[0].Status);
        Assert.Null(report.Checks[0].Remediation);
        Assert.Equal(DiagnosticCheckStatus.Fail, report.Checks[1].Status);
        Assert.Equal("restart", report.Checks[1].Remediation);
        Assert.Contains("\"overall_status\": \"degraded\"", report.Json, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("ok", DiagnosticCheckStatus.Ok)]
    [InlineData("warn", DiagnosticCheckStatus.Warn)]
    [InlineData("fail", DiagnosticCheckStatus.Fail)]
    [InlineData("bogus", DiagnosticCheckStatus.Fail)]
    [InlineData(null, DiagnosticCheckStatus.Fail)]
    public void Check_status_parse_collapses_unknown_to_fail(string? token, DiagnosticCheckStatus expected) =>
        Assert.Equal(expected, DiagnosticCheck.ParseStatus(token));

    [Theory]
    [InlineData("ok", DiagnosticOverallStatus.Ok)]
    [InlineData("degraded", DiagnosticOverallStatus.Degraded)]
    [InlineData("down", DiagnosticOverallStatus.Down)]
    [InlineData("bogus", DiagnosticOverallStatus.Down)]
    [InlineData(null, DiagnosticOverallStatus.Down)]
    public void Overall_status_parse_collapses_unknown_to_down(string? token, DiagnosticOverallStatus expected) =>
        Assert.Equal(expected, DiagnosticReport.ParseOverall(token));

    [Fact]
    public void Report_parse_tolerates_missing_and_partial_fields()
    {
        using var partial = JsonDocument.Parse("{\"checks\":[{\"id\":\"x\"}]}");
        var report = DiagnosticReport.FromJson(partial.RootElement);

        Assert.Equal(string.Empty, report.GeneratedAt);
        Assert.Equal(DiagnosticOverallStatus.Down, report.OverallStatus);
        Assert.Single(report.Checks);
        Assert.Equal("x", report.Checks[0].Id);
        Assert.Equal(DiagnosticCheckStatus.Fail, report.Checks[0].Status);
        Assert.Equal(0, report.Checks[0].DurationMs);

        using var notObject = JsonDocument.Parse("[]");
        Assert.Empty(DiagnosticReport.FromJson(notObject.RootElement).Checks);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_starts_in_the_empty_state_without_running()
    {
        var runner = new FakeRunner(SampleReport());
        using var vm = new DiagnosticPageViewModel(runner, Localizer, () => Now);

        Assert.Equal(DiagnosticState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
        Assert.False(vm.IsRunning);
        Assert.Equal(0, runner.Calls); // never auto-runs on construction
    }

    [Fact]
    public async Task ViewModel_run_loads_report_into_the_success_state()
    {
        var runner = new FakeRunner(SampleReport());
        using var vm = new DiagnosticPageViewModel(runner, Localizer, () => Now);

        await vm.RunAsync();

        Assert.Equal(DiagnosticState.Success, vm.State);
        Assert.True(vm.Display.ShowOverall);
        Assert.True(vm.Display.ShowChecks);
        Assert.False(vm.IsRunning);
        Assert.Equal(1, runner.Calls);
    }

    [Fact]
    public async Task ViewModel_run_failure_is_the_error_panel_over_empty()
    {
        using var vm = new DiagnosticPageViewModel(new ThrowingRunner(), Localizer, () => Now);

        await vm.RunAsync();

        Assert.Equal(DiagnosticState.Empty, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.False(vm.Display.ShowOverall);
        Assert.False(vm.IsRunning);
    }

    [Fact]
    public async Task ViewModel_api_exception_surfaces_the_error_panel()
    {
        using var vm = new DiagnosticPageViewModel(new ApiFailRunner(), Localizer, () => Now);

        await vm.RunAsync();

        Assert.True(vm.Display.ShowError);
        Assert.Contains("boom", vm.Display.ErrorMessage, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_rerun_replaces_the_prior_report()
    {
        var runner = new FakeRunner(SampleReport(DiagnosticOverallStatus.Degraded));
        using var vm = new DiagnosticPageViewModel(runner, Localizer, () => Now);

        await vm.RunAsync();
        runner.Next = SampleReport(DiagnosticOverallStatus.Ok);
        await vm.RunAsync();

        Assert.Equal(DiagnosticState.Success, vm.State);
        Assert.Equal(StatusKind.Success, vm.Display.OverallTone);
        Assert.Equal(2, runner.Calls);
    }

    // ---- Generated-client runner (web useRunDiagnostic) ----------------------------

    [Fact]
    public async Task ClientRunner_posts_the_diagnostic_operation_with_no_params()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"generated_at\":\"2025-01-15T12:34:56Z\",\"overall_status\":\"ok\",\"checks\":[]}"));
        var runner = new DiagnosticClientRunner(api);

        var report = await runner.RunAsync(default);

        Assert.Equal(DiagnosticOverallStatus.Ok, report.OverallStatus);
        var request = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_system_diagnostic", request.OperationId);
        Assert.Null(request.Query);
        Assert.Null(request.PathParams);
        Assert.Null(request.Body);
    }

    [Fact]
    public async Task ClientRunner_propagates_api_exception()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("rate limited", 429));
        var runner = new DiagnosticClientRunner(api);

        var ex = await Assert.ThrowsAsync<ApiException>(() => runner.RunAsync(default));
        Assert.Equal(429, ex.StatusCode);
    }

    // ---- Report downloader ---------------------------------------------------------

    [Fact]
    public async Task Downloader_records_filename_and_content()
    {
        var downloader = new RecordingDownloader();

        var saved = await downloader.SaveAsync("teslasync-diagnostic-x.txt", "report body", default);

        Assert.Equal("teslasync-diagnostic-x.txt", saved);
        Assert.Equal("report body", downloader.Content);
        Assert.Equal(1, downloader.Calls);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new DiagnosticDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DiagnosticPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operation()
    {
        Assert.Equal("Diagnostic", DiagnosticRegistration.RouteName);
        Assert.Equal("DiagnosticPage", DiagnosticRegistration.Slug);
        Assert.Equal("post_api_v1_system_diagnostic", DiagnosticRegistration.Operation);
        Assert.Equal("System diagnostic", DiagnosticRegistration.Title(Localizer));
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeRunner : IDiagnosticRunner
    {
        public FakeRunner(DiagnosticReport report) => Next = report;

        public DiagnosticReport Next { get; set; }

        public int Calls { get; private set; }

        public Task<DiagnosticReport> RunAsync(CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(Next);
        }
    }

    private sealed class ThrowingRunner : IDiagnosticRunner
    {
        public Task<DiagnosticReport> RunAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("diagnostic endpoint unavailable");
    }

    private sealed class ApiFailRunner : IDiagnosticRunner
    {
        public Task<DiagnosticReport> RunAsync(CancellationToken cancellationToken) =>
            throw new ApiException("boom: 500 Internal", 500);
    }

    private sealed class RecordingDownloader : IDiagnosticReportDownloader
    {
        public string? Content { get; private set; }

        public int Calls { get; private set; }

        public Task<string> SaveAsync(string filename, string content, CancellationToken cancellationToken)
        {
            Calls++;
            Content = content;
            return Task.FromResult(filename);
        }
    }
}
