using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ChartTooltip surface's UI-thread-free logic — the registration metadata
/// (slug, automation id, the ARIA role/live contract, the swatch/corner parity dimensions), the pure
/// <see cref="ChartTooltipFormatting"/> ports (ISO heuristic, <c>fmtNumber</c>, <c>formatDateTime</c>,
/// default value/label formatting), the <see cref="ChartTooltipProjection"/> adapter (visibility +
/// per-row mapping + accessible-text composition), the <see cref="ChartTooltipViewModel"/> state holder and
/// the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/charts/ChartTooltip.tsx, web/src/lib/numberFormat.ts, web/src/lib/dateFormat.ts). The
/// WinUI view (ChartTooltip.cs) is exercised by the app build.
/// </summary>
public sealed class ChartTooltipTests
{
    private static readonly ChartTooltipTimestampFormatter SpyTimestamp = _ => "FORMATTED_TS";

    // ── registration (diagnostics slug, automation id, ARIA contract, parity dimensions) ─────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ChartTooltip", ChartTooltipRegistration.Slug);

    [Fact]
    public void Registration_exposes_a_stable_root_automation_id() =>
        Assert.Equal("chart-tooltip", ChartTooltipRegistration.RootAutomationId);

    [Fact]
    public void Registration_carries_the_tooltip_polite_live_contract()
    {
        // web: role="tooltip" aria-live="polite".
        Assert.Equal("tooltip", ChartTooltipRegistration.Role);
        Assert.Equal("polite", ChartTooltipRegistration.LiveSetting);
    }

    [Fact]
    public void Registration_parity_dimensions_match_the_web_classes()
    {
        // web: h-2.5 w-2.5 (10px) swatch, rounded-xl (12px) panel.
        Assert.Equal(10d, ChartTooltipRegistration.SwatchDiameter);
        Assert.Equal(12d, ChartTooltipRegistration.CornerRadius);
    }

    // ── adapter: ISO heuristic (web ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/) ─────────────────────────

    [Theory]
    [InlineData("2026-04-04T02:30")]
    [InlineData("2026-04-04T02:30:00Z")]
    [InlineData("2026-04-04T02:30:00.123+05:00")]
    public void IsoHeuristic_accepts_iso_timestamps(string value) =>
        Assert.True(ChartTooltipFormatting.LooksLikeIsoTimestamp(value));

    [Theory]
    [InlineData("Apr 4")]
    [InlineData("14:30")]
    [InlineData("2026-04-04")]
    [InlineData("2026/04/04T02:30")]
    [InlineData("")]
    [InlineData(null)]
    public void IsoHeuristic_rejects_non_iso_labels(string? value) =>
        Assert.False(ChartTooltipFormatting.LooksLikeIsoTimestamp(value));

    // ── adapter: FormatNumber (web fmtNumber, default precision 2, en-US grouping) ────────────────────────

    [Theory]
    [InlineData(1234.5, "1,234.50")]
    [InlineData(0d, "0.00")]
    [InlineData(80d, "80.00")]
    [InlineData(1000000d, "1,000,000.00")]
    public void FormatNumber_uses_grouping_and_default_precision(double value, string expected) =>
        Assert.Equal(expected, ChartTooltipFormatting.FormatNumber(value));

    [Fact]
    public void FormatNumber_honours_an_explicit_precision() =>
        Assert.Equal("1,235", ChartTooltipFormatting.FormatNumber(1234.5, precision: 0));

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void FormatNumber_collapses_non_finite_to_zero(double value) =>
        Assert.Equal("0.00", ChartTooltipFormatting.FormatNumber(value));

    // ── adapter: FormatTimestamp (web formatDateTime "MMM d, yyyy, h:mm tt"), tz-stable ──────────────────

    [Fact]
    public void FormatTimestamp_renders_the_web_date_time_shape()
    {
        // Anchor at the local offset so ToLocalTime() is a no-op and the assertion is timezone-independent.
        var wall = new DateTime(2026, 4, 4, 2, 30, 0);
        var offset = TimeZoneInfo.Local.GetUtcOffset(wall);
        var value = new DateTimeOffset(wall, offset);

        Assert.Equal("Apr 4, 2026, 2:30 AM", ChartTooltipFormatting.FormatTimestamp(value));
    }

    // ── adapter: DefaultValue (web defaultValueFormatter "formatted" half) ───────────────────────────────

    [Fact]
    public void DefaultValue_formats_numbers_through_fmtNumber()
    {
        Assert.Equal("80.00", ChartTooltipFormatting.DefaultValue(80d));
        Assert.Equal("42.00", ChartTooltipFormatting.DefaultValue(42));
        Assert.Equal("5.50", ChartTooltipFormatting.DefaultValue(5.5m));
    }

    [Fact]
    public void DefaultValue_passes_non_numbers_through_string()
    {
        Assert.Equal("hello", ChartTooltipFormatting.DefaultValue("hello"));
        Assert.Equal(string.Empty, ChartTooltipFormatting.DefaultValue(null));
    }

    // ── adapter: DefaultLabel (web defaultLabelFormatter) ─────────────────────────────────────────────────

    [Fact]
    public void DefaultLabel_is_empty_for_null() =>
        Assert.Equal(string.Empty, ChartTooltipFormatting.DefaultLabel(null, SpyTimestamp));

    [Fact]
    public void DefaultLabel_routes_iso_timestamps_to_the_timestamp_formatter()
    {
        var seen = new List<DateTimeOffset>();
        ChartTooltipTimestampFormatter spy = ts =>
        {
            seen.Add(ts);
            return "ROUTED";
        };

        var result = ChartTooltipFormatting.DefaultLabel("2026-04-04T02:30:00Z", spy);

        Assert.Equal("ROUTED", result);
        Assert.Single(seen);
    }

    [Fact]
    public void DefaultLabel_passes_non_iso_strings_through_verbatim() =>
        Assert.Equal("14:30", ChartTooltipFormatting.DefaultLabel("14:30", SpyTimestamp));

    [Theory]
    [InlineData(42, "42")]
    [InlineData(42.5, "42.5")]
    public void DefaultLabel_stringifies_numeric_labels(object label, string expected) =>
        Assert.Equal(expected, ChartTooltipFormatting.DefaultLabel(label, SpyTimestamp));

    [Fact]
    public void DefaultLabel_returns_em_dash_for_iso_looking_but_invalid_dates()
    {
        // Matches the ISO shape but month 13 / time 99:99 is unparseable — the web formatDateTime FALLBACK.
        var result = ChartTooltipFormatting.DefaultLabel("2026-13-45T99:99", SpyTimestamp);

        Assert.Equal("\u2014", result);
    }

    [Fact]
    public void DefaultLabel_throws_when_the_timestamp_formatter_is_null() =>
        Assert.Throws<ArgumentNullException>(() => ChartTooltipFormatting.DefaultLabel("x", null!));

    // ── adapter: Project visibility (web !active || !payload?.length) ─────────────────────────────────────

    [Fact]
    public void Project_is_hidden_when_inactive()
    {
        var payload = new[] { new ChartTooltipPoint("Battery", 80d) };

        var projection = ChartTooltipProjection.Project(active: false, payload, label: "x");

        Assert.Same(ChartTooltipProjection.Hidden, projection);
        Assert.False(projection.IsVisible);
        Assert.Empty(projection.Rows);
    }

    [Fact]
    public void Project_is_hidden_for_a_null_payload() =>
        Assert.Same(ChartTooltipProjection.Hidden, ChartTooltipProjection.Project(active: true, payload: null, label: "x"));

    [Fact]
    public void Project_is_hidden_for_an_empty_payload() =>
        Assert.Same(
            ChartTooltipProjection.Hidden,
            ChartTooltipProjection.Project(active: true, Array.Empty<ChartTooltipPoint>(), label: "x"));

    // ── adapter: Project rows + default value/unit (web payload.map + defaultValueFormatter) ──────────────

    [Fact]
    public void Project_maps_each_point_to_a_formatted_row_with_default_value_and_unit()
    {
        var payload = new[] { new ChartTooltipPoint("Battery", 80d, Unit: "%", Color: "#10B981") };

        var projection = ChartTooltipProjection.Project(active: true, payload, label: "14:30");

        Assert.True(projection.IsVisible);
        Assert.Equal("14:30", projection.Label);
        var row = Assert.Single(projection.Rows);
        Assert.Equal("Battery", row.Name);
        Assert.Equal("80.00", row.ValueText);
        Assert.Equal("%", row.Unit);
        Assert.Equal("#10B981", row.SwatchColorHex);
    }

    [Fact]
    public void Project_preserves_payload_order_for_multiple_series()
    {
        var payload = new[]
        {
            new ChartTooltipPoint("Battery", 80d, Unit: "%"),
            new ChartTooltipPoint("Range", 240d, Unit: "mi"),
        };

        var projection = ChartTooltipProjection.Project(active: true, payload, label: null);

        Assert.Collection(
            projection.Rows,
            r => Assert.Equal("Battery", r.Name),
            r => Assert.Equal("Range", r.Name));
    }

    [Theory]
    [InlineData("#10B981", "#000000", "#10B981")] // color wins
    [InlineData("", "#3B82F6", "#3B82F6")]          // empty color falls through to fill (web ||)
    [InlineData(null, null, null)]                   // neither colour present
    public void Project_resolves_swatch_color_as_color_or_fill(string? color, string? fill, string? expected)
    {
        var payload = new[] { new ChartTooltipPoint("S", 1d, Color: color, Fill: fill) };

        var projection = ChartTooltipProjection.Project(active: true, payload, label: null);

        Assert.Equal(expected, Assert.Single(projection.Rows).SwatchColorHex);
    }

    [Fact]
    public void Project_uses_a_custom_value_formatter_and_clears_the_separate_unit()
    {
        ChartTooltipValueFormatter formatter = (value, name, unit) => $"{name}={value}{unit}";
        var payload = new[] { new ChartTooltipPoint("kW", 9d, Unit: "kW") };

        var projection = ChartTooltipProjection.Project(active: true, payload, label: null, valueFormatter: formatter);

        var row = Assert.Single(projection.Rows);
        Assert.Equal("kW=9kW", row.ValueText);
        Assert.Equal(string.Empty, row.Unit);
    }

    [Fact]
    public void Project_uses_a_custom_label_formatter_instead_of_iso_detection()
    {
        ChartTooltipLabelFormatter formatter = label => $"[{label}]";
        var payload = new[] { new ChartTooltipPoint("S", 1d) };

        var projection = ChartTooltipProjection.Project(
            active: true,
            payload,
            label: "2026-04-04T02:30:00Z",
            labelFormatter: formatter);

        Assert.Equal("[2026-04-04T02:30:00Z]", projection.Label);
    }

    [Fact]
    public void Project_applies_default_iso_label_formatting_through_the_timestamp_formatter()
    {
        var payload = new[] { new ChartTooltipPoint("S", 1d) };

        var projection = ChartTooltipProjection.Project(
            active: true,
            payload,
            label: "2026-04-04T02:30:00Z",
            timestampFormatter: SpyTimestamp);

        Assert.Equal("FORMATTED_TS", projection.Label);
    }

    // ── per-state snapshot: each render state projects an exact, stable value ─────────────────────────────

    [Fact]
    public void Snapshot_hidden_state()
    {
        var projection = ChartTooltipProjection.Hidden;

        Assert.False(projection.IsVisible);
        Assert.Equal(string.Empty, projection.Label);
        Assert.Empty(projection.Rows);
        Assert.Equal(string.Empty, projection.AccessibleText);
    }

    [Fact]
    public void Snapshot_visible_state()
    {
        var payload = new[]
        {
            new ChartTooltipPoint("Battery", 80d, Unit: "%", Color: "#10B981"),
            new ChartTooltipPoint("Range", 240d, Unit: "mi", Fill: "#3B82F6"),
        };

        var projection = ChartTooltipProjection.Project(active: true, payload, label: "14:30");

        Assert.True(projection.IsVisible);
        Assert.Equal("14:30", projection.Label);
        Assert.Equal(
            new[]
            {
                new ChartTooltipSeriesRow("Battery", "80.00", "%", "#10B981"),
                new ChartTooltipSeriesRow("Range", "240.00", "mi", "#3B82F6"),
            },
            projection.Rows);
    }

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var payload = new[] { new ChartTooltipPoint("Battery", 80d, Unit: "%") };

        var a = ChartTooltipProjection.Project(active: true, payload, label: "14:30");
        var b = ChartTooltipProjection.Project(active: true, payload, label: "14:30");
        var different = ChartTooltipProjection.Project(active: true, payload, label: "15:30");

        Assert.Equal(a, b);
        Assert.Equal(a.GetHashCode(), b.GetHashCode());
        Assert.NotEqual(a, different);
    }

    // ── accessibility: the flattened header + values is the surface's accessible name ─────────────────────

    [Fact]
    public void AccessibleText_joins_the_header_and_each_row_value()
    {
        var payload = new[]
        {
            new ChartTooltipPoint("Battery", 80d, Unit: "%"),
            new ChartTooltipPoint("Range", 240d, Unit: "mi"),
        };

        var projection = ChartTooltipProjection.Project(active: true, payload, label: "Apr 4");

        // The view sets AutomationProperties.Name to this string on the tooltip/polite live region, so it IS
        // the announcement Narrator reads; the colour swatches are decorative and not voiced.
        Assert.Equal("Apr 4; Battery: 80.00 %; Range: 240.00 mi", projection.AccessibleText);
    }

    [Fact]
    public void AccessibleText_omits_an_empty_header_and_unitless_suffix()
    {
        var payload = new[] { new ChartTooltipPoint("Count", 3d) };

        var projection = ChartTooltipProjection.Project(active: true, payload, label: null);

        Assert.Equal("Count: 3.00", projection.AccessibleText);
    }

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("ChartTooltip", ChartTooltipViewModel.Slug);

    [Fact]
    public void ViewModel_starts_hidden()
    {
        var viewModel = new ChartTooltipViewModel();

        Assert.False(viewModel.IsVisible);
        Assert.Same(ChartTooltipProjection.Hidden, viewModel.Projection);
        Assert.Empty(viewModel.Rows);
        Assert.Equal(string.Empty, viewModel.AccessibleText);
    }

    [Fact]
    public void ViewModel_update_publishes_the_visible_projection_and_raises_changes()
    {
        var viewModel = new ChartTooltipViewModel();
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Update(active: true, new[] { new ChartTooltipPoint("Battery", 80d, Unit: "%") }, label: "14:30");

        Assert.True(viewModel.IsVisible);
        Assert.Equal("14:30", viewModel.Label);
        Assert.Single(viewModel.Rows);
        Assert.Contains(nameof(ChartTooltipViewModel.Projection), changed);
        Assert.Contains(nameof(ChartTooltipViewModel.IsVisible), changed);
        Assert.Contains(nameof(ChartTooltipViewModel.Label), changed);
        Assert.Contains(nameof(ChartTooltipViewModel.Rows), changed);
        Assert.Contains(nameof(ChartTooltipViewModel.AccessibleText), changed);
    }

    [Fact]
    public void ViewModel_does_not_raise_when_an_update_is_a_no_op()
    {
        var viewModel = new ChartTooltipViewModel();
        var payload = new[] { new ChartTooltipPoint("Battery", 80d, Unit: "%") };
        viewModel.Update(active: true, payload, label: "14:30");

        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;
        viewModel.Update(active: true, payload, label: "14:30");

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_clear_returns_to_hidden()
    {
        var viewModel = new ChartTooltipViewModel();
        viewModel.Update(active: true, new[] { new ChartTooltipPoint("Battery", 80d) }, label: "14:30");

        viewModel.Clear();

        Assert.False(viewModel.IsVisible);
        Assert.Same(ChartTooltipProjection.Hidden, viewModel.Projection);
    }

    [Fact]
    public void ViewModel_update_with_inactive_cursor_is_hidden()
    {
        var viewModel = new ChartTooltipViewModel();

        viewModel.Update(active: false, new[] { new ChartTooltipPoint("Battery", 80d) }, label: "14:30");

        Assert.False(viewModel.IsVisible);
    }

    [Fact]
    public void ViewModel_honours_constructor_formatters()
    {
        ChartTooltipValueFormatter valueFormatter = (value, _, _) => $"<{value}>";
        var viewModel = new ChartTooltipViewModel(valueFormatter);

        viewModel.Update(active: true, new[] { new ChartTooltipPoint("S", 7d, Unit: "kW") }, label: null);

        var row = Assert.Single(viewModel.Rows);
        Assert.Equal("<7>", row.ValueText);
        Assert.Equal(string.Empty, row.Unit);
    }

    // ── diagnostics (view.opened, PII-safe — only the slug) ───────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChartTooltipDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChartTooltip", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new ChartTooltipDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
