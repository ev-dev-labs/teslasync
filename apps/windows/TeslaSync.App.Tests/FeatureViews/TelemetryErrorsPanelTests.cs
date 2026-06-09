using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.TelemetryErrors;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TelemetryErrorsPanel</c> feature surface's UI-thread-free logic — the
/// branch projection (idle / loading / error / data / empty, with the empty ok/unknown sub-states and the
/// raw-response disclosure), the row formatting, the download payload, the accessible names, and the
/// diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/devtools/TelemetryErrorsPanel.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class TelemetryErrorsPanelTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 12, 5, 0, TimeSpan.Zero);

    private static TelemetryErrorRow Row(
        string key = "r1",
        string timestamp = "2026-06-08T12:00:00Z",
        string code = "ERR_DECODE",
        string message = "boom") =>
        new(key, timestamp, code, message);

    private static TelemetryErrorsPanelModel Model(
        bool requested = true,
        bool loading = false,
        string? error = null,
        bool ok = true,
        IReadOnlyList<TelemetryErrorRow>? errors = null,
        string vin = "VIN1",
        string? raw = null) =>
        new(requested, loading, error, ok, errors ?? Array.Empty<TelemetryErrorRow>(), vin, raw);

    private static TelemetryErrorsPanelDisplay Project(TelemetryErrorsPanelModel model) =>
        TelemetryErrorsPanelProjection.Project(model, Localizer, Now);

    // ── Branch precedence: idle → loading → error → data → empty (web source order) ─────────────────

    [Fact]
    public void Idle_when_not_requested()
    {
        var display = Project(Model(requested: false, errors: new[] { Row() }, error: "boom"));

        Assert.Equal(TelemetryErrorsPanelState.Idle, display.State);
        Assert.Equal("Telemetry Errors", display.Title);
        Assert.Equal(
            "Click View Errors to fetch recent Fleet Telemetry errors for this vehicle.",
            display.IdleMessage);
    }

    [Fact]
    public void Loading_takes_precedence_over_error_and_data()
    {
        var display = Project(Model(loading: true, error: "boom", errors: new[] { Row() }));

        Assert.Equal(TelemetryErrorsPanelState.Loading, display.State);
    }

    [Fact]
    public void Error_takes_precedence_over_data()
    {
        var display = Project(Model(error: "Tesla 401", errors: new[] { Row() }));

        Assert.Equal(TelemetryErrorsPanelState.Error, display.State);
        Assert.Equal("Tesla 401", display.ErrorText);
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void Empty_or_absent_error_is_falsy_like_the_web(string? error)
    {
        // Web `if (error)` is false for "" / undefined — an empty/absent error must not select the error branch.
        var display = Project(Model(error: error, ok: true));

        Assert.Equal(TelemetryErrorsPanelState.Empty, display.State);
        Assert.Null(display.ErrorText);
    }

    [Theory]
    [InlineData("   ")]
    [InlineData("Tesla 500")]
    public void Nonempty_error_is_truthy_like_the_web(string error)
    {
        // Web `if (error)` is truthy for any non-empty string (whitespace included) — it selects the error branch.
        var display = Project(Model(error: error, errors: new[] { Row() }));

        Assert.Equal(TelemetryErrorsPanelState.Error, display.State);
        Assert.Equal(error, display.ErrorText);
    }

    [Fact]
    public void Data_when_rows_present()
    {
        var display = Project(Model(errors: new[] { Row(), Row(key: "r2", code: "ERR_AUTH") }));

        Assert.Equal(TelemetryErrorsPanelState.Data, display.State);
        Assert.Equal(2, display.Rows.Count);
    }

    // ── Data state: columns, row formatting, download payload ───────────────────────────────────────

    [Fact]
    public void Columns_match_the_web_three_columns()
    {
        var columns = Project(Model(errors: new[] { Row() })).Columns;

        Assert.Collection(
            columns,
            c => Assert.Equal((TelemetryErrorsPanelProjection.TimestampKey, "Timestamp"), (c.Key, c.Header)),
            c => Assert.Equal((TelemetryErrorsPanelProjection.CodeKey, "Code"), (c.Key, c.Header)),
            c => Assert.Equal((TelemetryErrorsPanelProjection.MessageKey, "Message"), (c.Key, c.Header)));
    }

    [Fact]
    public void Row_formats_timestamp_and_passes_through_code_and_message()
    {
        var row = Assert.Single(Project(Model(errors: new[] { Row() })).Rows);

        Assert.Equal("r1", row.RowKey);
        Assert.Contains("2026", row.Cells[TelemetryErrorsPanelProjection.TimestampKey], StringComparison.Ordinal);
        Assert.NotEqual(EmDash, row.Cells[TelemetryErrorsPanelProjection.TimestampKey]);
        Assert.Equal("ERR_DECODE", row.Cells[TelemetryErrorsPanelProjection.CodeKey]);
        Assert.Equal("boom", row.Cells[TelemetryErrorsPanelProjection.MessageKey]);
    }

    [Fact]
    public void Row_renders_em_dash_for_missing_fields()
    {
        var row = Assert.Single(Project(Model(errors: new[] { Row(timestamp: "", code: "", message: "") })).Rows);

        Assert.Equal(EmDash, row.Cells[TelemetryErrorsPanelProjection.TimestampKey]);
        Assert.Equal(EmDash, row.Cells[TelemetryErrorsPanelProjection.CodeKey]);
        Assert.Equal(EmDash, row.Cells[TelemetryErrorsPanelProjection.MessageKey]);
    }

    [Fact]
    public void Download_filename_uses_vin_then_all()
    {
        Assert.Equal("telemetry-errors-VIN1.json", Project(Model(vin: "VIN1", errors: new[] { Row() })).DownloadFileName);
        Assert.Equal("telemetry-errors-all.json", Project(Model(vin: "", errors: new[] { Row() })).DownloadFileName);
    }

    [Fact]
    public void Download_json_serializes_the_errors_with_camel_case_keys()
    {
        var display = Project(Model(errors: new[] { Row(code: "ERR_DECODE", message: "boom") }));

        using var doc = JsonDocument.Parse(display.DownloadJson);
        var first = Assert.Single(EnumerateArray(doc.RootElement));
        Assert.Equal("ERR_DECODE", first.GetProperty("code").GetString());
        Assert.Equal("boom", first.GetProperty("message").GetString());
        Assert.Equal("r1", first.GetProperty("rowKey").GetString());
    }

    // ── Empty state: ok (success "0") vs unknown (warning "?") + raw disclosure ──────────────────────

    [Fact]
    public void Empty_ok_shows_success_zero_chip_without_raw_disclosure()
    {
        var display = Project(Model(ok: true, raw: "{\"unexpected\":true}"));

        Assert.Equal(TelemetryErrorsPanelState.Empty, display.State);
        Assert.Equal("0", display.BadgeText);
        Assert.Equal(StatusKind.Success, display.BadgeStatus);
        Assert.False(display.ShowRawDisclosure);
    }

    [Fact]
    public void Empty_unknown_shows_warning_chip_and_raw_disclosure()
    {
        var display = Project(Model(ok: false, raw: "{\"weird\":1}"));

        Assert.Equal(TelemetryErrorsPanelState.Empty, display.State);
        Assert.Equal("?", display.BadgeText);
        Assert.Equal(StatusKind.Warning, display.BadgeStatus);
        Assert.True(display.ShowRawDisclosure);
        Assert.Equal("{\"weird\":1}", display.RawJson);
        Assert.Equal("Show raw Tesla response", display.RawDisclosureLabel);
    }

    [Fact]
    public void Empty_unknown_without_raw_data_hides_disclosure()
    {
        // Web `!ok && rawData != null` — a null raw response keeps the disclosure hidden.
        var display = Project(Model(ok: false, raw: null));

        Assert.Equal(TelemetryErrorsPanelState.Empty, display.State);
        Assert.Equal("?", display.BadgeText);
        Assert.False(display.ShowRawDisclosure);
    }

    // ── Accessibility: every state exposes a non-empty Narrator name ────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(Model(requested: false)),
                Project(Model(loading: true)),
                Project(Model(error: "boom")),
                Project(Model(errors: new[] { Row() })),
                Project(Model(ok: false, raw: "{}")),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Data_rows_each_expose_a_descriptive_automation_name()
    {
        var rows = Project(Model(errors: new[] { Row(), Row(key: "r2", code: "ERR_AUTH", message: "denied") })).Rows;

        Assert.All(rows, row => Assert.False(string.IsNullOrWhiteSpace(row.AutomationName)));
        Assert.Contains("ERR_AUTH", rows[1].AutomationName, StringComparison.Ordinal);
        Assert.Contains("denied", rows[1].AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Idle_automation_name_carries_the_idle_hint()
    {
        var display = Project(Model(requested: false));

        Assert.Contains(display.IdleMessage, display.AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=TelemetryErrorsPanel, PII-safe ───────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new TelemetryErrorsPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TelemetryErrorsPanel", Assert.Single(captured));
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("TelemetryErrorsPanel", TelemetryErrorsPanelRegistration.Slug);
    }

    private static IEnumerable<JsonElement> EnumerateArray(JsonElement element)
    {
        foreach (var item in element.EnumerateArray())
        {
            yield return item;
        }
    }
}
