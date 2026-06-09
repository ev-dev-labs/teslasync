using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the WarrantyStatusWidget's UI-thread-free logic — the JSON parse adapter (the
/// expiry / mileage / start-date nullish chains with the <c>asString</c> / <c>asNumber</c> edge cases, the
/// five known coverage flags), the <c>daysUntil</c> / <c>totalDays</c> / <c>daysUsed</c> computation, the
/// projection (the compact shield summary, the Time-Remaining + Mileage-Remaining progress bars with their SI
/// unit conversion and status colours, the detail rows + Active/Expired/Covered badges, the accessibility
/// names), the footprint flag, the cache-then-network source (the fleet-wide warranty read), the registry
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded /
/// empty / error / stale / offline) plus unit re-projection. Mirrors the web spec
/// (web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx).
/// </summary>
public sealed class WarrantyStatusWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 12, 0, 0, TimeSpan.Zero);
    private const string EmDash = "\u2014";

    // Noon-UTC anchors so the whole-day countdown and the month/year coverage label are deterministic
    // regardless of the test runner's local time zone.
    private const string SuccessExpiry = "2026-10-06T12:00:00Z"; // +120 days → Success / Active
    private const string WarningExpiry = "2026-07-08T12:00:00Z"; // +30 days  → Warning / Active
    private const string PastExpiry = "2026-05-29T12:00:00Z";    // -10 days  → Danger / Expired
    private const string StartDate = "2024-06-08T12:00:00Z";     // totalDays 850 with SuccessExpiry

    // SI metres on the wire (the web reads these via convertDistanceFromSI): 100 km / 50 km.
    private const double LimitMeters = 100000;
    private const double CurrentMeters = 50000;

    // ---- Parse adapter: field extraction -------------------------------------------

    [Fact]
    public void Parse_non_object_data_is_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var parsed = WarrantyStatusParser.Parse(doc.RootElement, Now);
        Assert.False(parsed.HasData);
        Assert.Empty(parsed.Coverages);
    }

    [Fact]
    public void Parse_object_data_has_data_even_when_fields_absent()
    {
        var parsed = Parse("""{"unrelated":1}""");
        Assert.True(parsed.HasData);
        Assert.Null(parsed.ExpiryDate);
        Assert.Null(parsed.DaysRemaining);
        Assert.Empty(parsed.Coverages);
    }

    [Fact]
    public void Parse_expiry_prefers_warranty_expiry_then_expiry_then_basic()
    {
        Assert.Equal(SuccessExpiry, Parse($$"""{"warranty_expiry_date":"{{SuccessExpiry}}","expiry_date":"{{PastExpiry}}"}""").ExpiryDate);
        Assert.Equal(SuccessExpiry, Parse($$"""{"expiry_date":"{{SuccessExpiry}}"}""").ExpiryDate);
        Assert.Equal(SuccessExpiry, Parse($$"""{"basic_expiry_date":"{{SuccessExpiry}}"}""").ExpiryDate);
    }

    [Fact]
    public void Parse_expiry_chain_skips_json_null_but_keeps_present_value()
    {
        // Web parity: `a ?? b` falls through a JSON-null `a` to `b`.
        Assert.Equal(SuccessExpiry, Parse($$"""{"warranty_expiry_date":null,"expiry_date":"{{SuccessExpiry}}"}""").ExpiryDate);
    }

    [Fact]
    public void Parse_days_remaining_is_ceiling_of_whole_days()
    {
        Assert.Equal(120, Parse($$"""{"warranty_expiry_date":"{{SuccessExpiry}}"}""").DaysRemaining);
        Assert.Equal(-10, Parse($$"""{"warranty_expiry_date":"{{PastExpiry}}"}""").DaysRemaining);
        Assert.Null(Parse("""{"warranty_expiry_date":"not-a-date"}""").DaysRemaining);
    }

    [Fact]
    public void Parse_mileage_prefers_mi_then_plain_then_basic()
    {
        Assert.Equal(LimitMeters, Parse($$"""{"mileage_limit_mi":{{LimitMeters}},"mileage_limit":1}""").MileageLimit);
        Assert.Equal(LimitMeters, Parse($$"""{"mileage_limit":{{LimitMeters}}}""").MileageLimit);
        Assert.Equal(CurrentMeters, Parse($$"""{"current_mileage_mi":{{CurrentMeters}}}""").CurrentMileage);
        Assert.Equal(CurrentMeters, Parse($$"""{"odometer_mi":{{CurrentMeters}}}""").CurrentMileage);
    }

    [Fact]
    public void Parse_mileage_accepts_numeric_string_and_rejects_non_numeric()
    {
        Assert.Equal(80467.2, Parse("""{"mileage_limit_mi":"80467.2"}""").MileageLimit);
        Assert.Null(Parse("""{"mileage_limit_mi":"n/a"}""").MileageLimit);
        Assert.Null(Parse("""{"mileage_limit_mi":true}""").MileageLimit);
    }

    [Fact]
    public void Parse_total_days_and_days_used()
    {
        var parsed = Parse($$"""{"warranty_start_date":"{{StartDate}}","warranty_expiry_date":"{{SuccessExpiry}}"}""");
        Assert.Equal(850, parsed.TotalDays);
        Assert.Equal(730, parsed.DaysUsed); // totalDays(850) - daysRemaining(120)
    }

    [Fact]
    public void Parse_days_used_null_without_start_or_expiry()
    {
        Assert.Null(Parse($$"""{"warranty_expiry_date":"{{SuccessExpiry}}"}""").TotalDays);
        Assert.Null(Parse($$"""{"warranty_expiry_date":"{{SuccessExpiry}}"}""").DaysUsed);
        Assert.Null(Parse($$"""{"warranty_start_date":"{{StartDate}}"}""").DaysUsed);
    }

    // ---- Parse adapter: coverage flags ---------------------------------------------

    [Fact]
    public void Parse_coverage_present_flags_in_canonical_order()
    {
        var coverages = Parse(
            """{"body":true,"basic":true,"emissions":true}""").Coverages;

        Assert.Collection(
            coverages,
            c => Assert.Equal("widget.warranty.basic", c.LabelKey),
            c => Assert.Equal("widget.warranty.emissions", c.LabelKey),
            c => Assert.Equal("widget.warranty.body", c.LabelKey));
    }

    [Fact]
    public void Parse_coverage_skips_null_false_and_empty_string()
    {
        var coverages = Parse(
            """{"basic":null,"battery_drive_unit":false,"corrosion":"","emissions":true}""").Coverages;

        Assert.Equal("widget.warranty.emissions", Assert.Single(coverages).LabelKey);
    }

    [Fact]
    public void Parse_coverage_active_from_future_expiry()
    {
        var coverage = Assert.Single(Parse(
            $$"""{"basic":true,"basic_expiry_date":"{{SuccessExpiry}}"}""").Coverages);

        Assert.True(coverage.Active);
        Assert.Equal(SuccessExpiry, coverage.ExpiryDate);
    }

    [Fact]
    public void Parse_coverage_expired_from_past_expiry()
    {
        var coverage = Assert.Single(Parse(
            $$"""{"corrosion":true,"corrosion_expiry_date":"{{PastExpiry}}"}""").Coverages);

        Assert.False(coverage.Active);
    }

    [Fact]
    public void Parse_coverage_without_expiry_is_active_included()
    {
        var coverage = Assert.Single(Parse("""{"emissions":true}""").Coverages);
        Assert.True(coverage.Active);
        Assert.Null(coverage.ExpiryDate);
    }

    [Fact]
    public void Parse_coverage_zero_is_present_but_included()
    {
        // Web parity: 0 is not skipped (not null/false/''), and with no expiry it is active.
        var coverage = Assert.Single(Parse("""{"basic":0}""").Coverages);
        Assert.True(coverage.Active);
        Assert.Null(coverage.ExpiryDate);
    }

    // ---- DaysUntil / TotalDays -----------------------------------------------------

    [Fact]
    public void DaysUntil_null_or_unparseable_is_null()
    {
        Assert.Null(WarrantyStatusParser.DaysUntil(null, Now));
        Assert.Null(WarrantyStatusParser.DaysUntil("", Now));
        Assert.Null(WarrantyStatusParser.DaysUntil("not-a-date", Now));
        Assert.Null(WarrantyStatusParser.DaysUntil("1700000000", Now));
    }

    [Fact]
    public void TotalDays_null_when_either_endpoint_missing()
    {
        Assert.Null(WarrantyStatusParser.TotalDays(null, SuccessExpiry));
        Assert.Null(WarrantyStatusParser.TotalDays(StartDate, null));
        Assert.Equal(850, WarrantyStatusParser.TotalDays(StartDate, SuccessExpiry));
    }

    // ---- Snapshot ------------------------------------------------------------------

    [Fact]
    public void Snapshot_from_envelope_keeps_data_object_json()
    {
        using var doc = JsonDocument.Parse("""{"data":{"warranty_expiry_date":"2026-10-06T12:00:00Z"},"fetched_at":"2026-06-06T00:00:00Z"}""");
        var snapshot = WarrantyStatusSnapshot.FromEnvelope(doc.RootElement);

        Assert.NotNull(snapshot.DataJson);
        Assert.Contains("warranty_expiry_date", snapshot.DataJson);
    }

    [Theory]
    [InlineData("""{"data":null,"fetched_at":null}""")]
    [InlineData("""{"fetched_at":null}""")]
    [InlineData("""{"data":[]}""")]
    [InlineData("[]")]
    public void Snapshot_from_envelope_without_data_object_is_none(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(WarrantyStatusSnapshot.FromEnvelope(doc.RootElement).DataJson);
    }

    // ---- Projection: HasData gate + compact summary --------------------------------

    [Fact]
    public void Project_has_data_tracks_snapshot()
    {
        Assert.True(Project("""{"warranty_expiry_date":"2026-10-06T12:00:00Z"}""").HasData);
        Assert.False(WarrantyStatusProjection
            .Project(WarrantyStatusSnapshot.None, WarrantyStatusSize.Default, Now, Localizer, UnitPref.Metric)
            .HasData);
    }

    [Fact]
    public void Project_compact_summary_days_caption_and_badge()
    {
        var compact = Project($$"""{"warranty_expiry_date":"{{SuccessExpiry}}"}""", new WarrantyStatusSize(1, 2)).Compact;

        Assert.Equal("120", compact.DaysText);
        Assert.Equal("days left", compact.DaysLeftCaption);
        Assert.Equal("Active", compact.BadgeText);
        Assert.Equal(StatusKind.Success, compact.BadgeStatus);
    }

    [Fact]
    public void Project_compact_days_em_dash_and_expired_without_expiry()
    {
        var compact = Project("""{"basic":true}""", new WarrantyStatusSize(1, 2)).Compact;

        Assert.Equal(EmDash, compact.DaysText);
        Assert.Equal("Expired", compact.BadgeText);
        Assert.Equal(StatusKind.Danger, compact.BadgeStatus);
    }

    [Theory]
    [InlineData(SuccessExpiry, "Active", true)]   // +120 days
    [InlineData(WarningExpiry, "Active", false)]  // +30 days
    [InlineData(PastExpiry, "Expired", false)]    // -10 days
    public void Project_compact_badge_label_tracks_countdown(string expiry, string badge, bool _)
    {
        var compact = Project($$"""{"warranty_expiry_date":"{{expiry}}"}""", new WarrantyStatusSize(1, 2)).Compact;
        Assert.Equal(badge, compact.BadgeText);
    }

    [Fact]
    public void Variant_is_danger_warning_then_success()
    {
        Assert.Equal(StatusKind.Danger, WarrantyStatusProjection.Variant(null));
        Assert.Equal(StatusKind.Danger, WarrantyStatusProjection.Variant(0));
        Assert.Equal(StatusKind.Danger, WarrantyStatusProjection.Variant(-5));
        Assert.Equal(StatusKind.Warning, WarrantyStatusProjection.Variant(1));
        Assert.Equal(StatusKind.Warning, WarrantyStatusProjection.Variant(90));
        Assert.Equal(StatusKind.Success, WarrantyStatusProjection.Variant(91));
    }

    // ---- Projection: progress bars -------------------------------------------------

    [Fact]
    public void Project_time_bar_present_with_start_and_expiry()
    {
        var bar = Project($$"""{"warranty_start_date":"{{StartDate}}","warranty_expiry_date":"{{SuccessExpiry}}"}""").TimeBar;

        Assert.NotNull(bar);
        Assert.Equal(730, bar!.Value);   // daysUsed
        Assert.Equal(850, bar.Max);      // totalDays
        Assert.Equal("120 days", bar.Sublabel);
        Assert.Equal("TsColorSuccessBrush", bar.BrushKey);
    }

    [Fact]
    public void Project_time_bar_absent_without_start_date()
    {
        Assert.Null(Project($$"""{"warranty_expiry_date":"{{SuccessExpiry}}"}""").TimeBar);
    }

    [Fact]
    public void Project_time_bar_colour_tracks_variant()
    {
        // Start far enough back that daysUsed resolves; a +30-day expiry is the warning band.
        var bar = Project($$"""{"warranty_start_date":"{{StartDate}}","warranty_expiry_date":"{{WarningExpiry}}"}""").TimeBar;
        Assert.Equal("TsColorWarningBrush", bar!.BrushKey);
    }

    [Fact]
    public void Project_mileage_bar_present_with_both_values_metric()
    {
        var bar = Project($$"""{"mileage_limit_mi":{{LimitMeters}},"current_mileage_mi":{{CurrentMeters}}}""").MileageBar;

        Assert.NotNull(bar);
        Assert.Equal(50, bar!.Value);        // current 50 km
        Assert.Equal(100, bar.Max);          // limit 100 km
        Assert.Equal("50 km", bar.Sublabel); // remaining 50 km
        Assert.Equal("TsColorSuccessBrush", bar.BrushKey); // ratio 0.5
    }

    [Fact]
    public void Project_mileage_bar_absent_when_one_value_missing()
    {
        Assert.Null(Project($$"""{"mileage_limit_mi":{{LimitMeters}}}""").MileageBar);
        Assert.Null(Project($$"""{"current_mileage_mi":{{CurrentMeters}}}""").MileageBar);
    }

    [Theory]
    [InlineData(50000, "TsColorSuccessBrush")] // ratio 0.5
    [InlineData(80000, "TsColorWarningBrush")] // ratio 0.8
    [InlineData(95000, "TsColorDangerBrush")]  // ratio 0.95
    public void Project_mileage_bar_colour_tracks_ratio(double current, string brushKey)
    {
        var bar = Project($$"""{"mileage_limit_mi":{{LimitMeters}},"current_mileage_mi":{{current}}}""").MileageBar;
        Assert.Equal(brushKey, bar!.BrushKey);
    }

    // ---- Projection: detail rows ---------------------------------------------------

    [Fact]
    public void Project_entries_always_include_expiry_and_days_when_has_data()
    {
        var entries = Project($$"""{"warranty_expiry_date":"{{SuccessExpiry}}"}""").Entries;

        Assert.Equal(2, entries.Count);

        var expiry = entries[0];
        Assert.Equal("Expiry Date", expiry.Label);
        Assert.Equal(WarrantyStatusProjection.FormatDate(SuccessExpiry, Now), expiry.Value);
        Assert.True(expiry.HasBadge);
        Assert.Equal("Active", expiry.BadgeText);
        Assert.Equal(StatusKind.Success, expiry.BadgeStatus);

        var days = entries[1];
        Assert.Equal("Days Remaining", days.Label);
        Assert.Equal("120", days.Value);
        Assert.True(days.Mono);
        Assert.False(days.HasBadge);
    }

    [Fact]
    public void Project_expiry_row_em_dash_and_expired_badge_without_expiry()
    {
        var entries = Project("""{"basic":true}""").Entries;
        var expiry = entries[0];

        Assert.Equal(EmDash, expiry.Value);
        Assert.Equal("Expired", expiry.BadgeText);
        Assert.Equal(StatusKind.Danger, expiry.BadgeStatus);
        Assert.Equal(EmDash, entries[1].Value); // Days Remaining with no expiry
    }

    [Fact]
    public void Project_entries_include_mileage_rows_metric()
    {
        var entries = Project($$"""{"mileage_limit_mi":{{LimitMeters}},"current_mileage_mi":{{CurrentMeters}}}""").Entries;

        var limit = Assert.Single(entries, e => e.Label == "Mileage Limit");
        Assert.Equal("100 km", limit.Value);
        Assert.True(limit.Mono);

        var current = Assert.Single(entries, e => e.Label == "Current Mileage");
        Assert.Equal("50 km", current.Value);
    }

    [Fact]
    public void Project_mileage_rows_convert_to_imperial()
    {
        var entries = Project(
            $$"""{"mileage_limit_mi":{{LimitMeters}},"current_mileage_mi":{{CurrentMeters}}}""",
            UnitPref.Imperial).Entries;

        Assert.Equal("62 mi", Assert.Single(entries, e => e.Label == "Mileage Limit").Value);
        Assert.Equal("31 mi", Assert.Single(entries, e => e.Label == "Current Mileage").Value);
    }

    [Fact]
    public void Project_coverage_rows_render_month_year_and_badges()
    {
        var entries = Project(
            $$"""
            {"warranty_expiry_date":"{{SuccessExpiry}}",
             "basic":true,"basic_expiry_date":"{{SuccessExpiry}}",
             "corrosion":true,"corrosion_expiry_date":"{{PastExpiry}}",
             "emissions":true}
            """).Entries;

        var basic = Assert.Single(entries, e => e.Label == "Basic");
        Assert.Equal(WarrantyStatusProjection.FormatMonthYear(SuccessExpiry), basic.Value);
        Assert.Equal("Covered", basic.BadgeText);
        Assert.Equal(StatusKind.Success, basic.BadgeStatus);

        var corrosion = Assert.Single(entries, e => e.Label == "Corrosion");
        Assert.Equal("Expired", corrosion.BadgeText);
        Assert.Equal(StatusKind.Danger, corrosion.BadgeStatus);

        var emissions = Assert.Single(entries, e => e.Label == "Emissions");
        Assert.Equal("Included", emissions.Value);
        Assert.Equal("Covered", emissions.BadgeText);
    }

    [Fact]
    public void Project_empty_snapshot_has_no_entries_or_bars()
    {
        var display = WarrantyStatusProjection.Project(
            WarrantyStatusSnapshot.None, WarrantyStatusSize.Default, Now, Localizer, UnitPref.Metric);

        Assert.False(display.HasData);
        Assert.Empty(display.Entries);
        Assert.Null(display.TimeBar);
        Assert.Null(display.MileageBar);
    }

    [Theory]
    [InlineData(1, 2, true)]
    [InlineData(2, 2, false)]
    [InlineData(3, 40, false)]
    public void Project_compact_flag_tracks_footprint(int cols, int rows, bool compact)
    {
        var display = WarrantyStatusProjection.Project(
            WarrantyStatusSnapshot.None, new WarrantyStatusSize(cols, rows), Now, Localizer, UnitPref.Metric);
        Assert.Equal(compact, display.IsCompact);
    }

    // ---- Date formatting -----------------------------------------------------------

    [Fact]
    public void FormatDate_null_or_unparseable_is_em_dash()
    {
        Assert.Equal(EmDash, WarrantyStatusProjection.FormatDate(null, Now));
        Assert.Equal(EmDash, WarrantyStatusProjection.FormatDate("not-a-date", Now));
    }

    [Fact]
    public void FormatDate_valid_is_month_day_year()
    {
        var formatted = WarrantyStatusProjection.FormatDate(SuccessExpiry, Now);
        Assert.NotEqual(EmDash, formatted);
        Assert.Contains("Oct", formatted);
        Assert.Contains("2026", formatted);
    }

    [Fact]
    public void FormatMonthYear_valid_is_month_year()
    {
        var formatted = WarrantyStatusProjection.FormatMonthYear(SuccessExpiry);
        Assert.Contains("Oct", formatted);
        Assert.Contains("2026", formatted);
        Assert.Equal(EmDash, WarrantyStatusProjection.FormatMonthYear("not-a-date"));
    }

    // ---- Accessibility -------------------------------------------------------------

    [Fact]
    public void Project_entries_carry_accessibility_names()
    {
        var entries = Project($$"""{"warranty_expiry_date":"{{SuccessExpiry}}"}""").Entries;
        var expiry = entries[0];

        Assert.Equal($"Expiry Date: {expiry.Value}, Active", expiry.AccessibilityName);
        Assert.Equal($"Days Remaining: {entries[1].Value}", entries[1].AccessibilityName);
    }

    [Fact]
    public void Project_compact_and_bars_carry_accessibility_names()
    {
        var display = Project(
            $$"""
            {"warranty_start_date":"{{StartDate}}","warranty_expiry_date":"{{SuccessExpiry}}",
             "mileage_limit_mi":{{LimitMeters}},"current_mileage_mi":{{CurrentMeters}}}
            """,
            new WarrantyStatusSize(1, 2));

        Assert.StartsWith("Warranty Status: 120 days left", display.Compact.AccessibilityName);
        Assert.Equal("Time Remaining: 120 days", display.TimeBar!.AccessibilityName);
        Assert.Equal("Mileage Remaining: 50 km", display.MileageBar!.AccessibilityName);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<WarrantyStatusSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(WarrantyStatusState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_with_data_exposes_entries()
    {
        using var vm = NewViewModel(Loaded(Snapshot($$"""{"warranty_expiry_date":"{{SuccessExpiry}}"}""")));
        await vm.LoadAsync();

        Assert.Equal(WarrantyStatusState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(2, vm.Display.Entries.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_data_object_is_empty()
    {
        using var vm = NewViewModel(Loaded(WarrantyStatusSnapshot.None));
        await vm.LoadAsync();

        Assert.Equal(WarrantyStatusState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No warranty data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_engine_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<WarrantyStatusSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(WarrantyStatusState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<WarrantyStatusSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(WarrantyStatusState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_entries()
    {
        using var vm = NewViewModel(
            RepositoryResult<WarrantyStatusSnapshot>.Cached(Snapshot($$"""{"warranty_expiry_date":"{{SuccessExpiry}}"}"""), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(WarrantyStatusState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_entries()
    {
        using var vm = NewViewModel(RepositoryResult<WarrantyStatusSnapshot>.OfflineCached(
            Snapshot($$"""{"warranty_expiry_date":"{{SuccessExpiry}}"}"""), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(WarrantyStatusState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<WarrantyStatusSnapshot>.Loading(),
            RepositoryResult<WarrantyStatusSnapshot>.Cached(Snapshot($$"""{"warranty_expiry_date":"{{SuccessExpiry}}"}"""), Now, stale: false),
            RepositoryResult<WarrantyStatusSnapshot>.Loaded(Snapshot($$"""{"warranty_expiry_date":"{{SuccessExpiry}}","basic":true}"""), Now));
        await vm.LoadAsync();

        Assert.Equal(WarrantyStatusState.Loaded, vm.State);
        Assert.Equal(3, vm.Display.Entries.Count); // Expiry Date, Days Remaining, Basic
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact_flag()
    {
        using var vm = NewViewModel(
            new WarrantyStatusSize(2, 2), UnitPref.Metric, Loaded(Snapshot($$"""{"warranty_expiry_date":"{{SuccessExpiry}}"}""")));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new WarrantyStatusSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(WarrantyStatusState.Loaded, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_units_change_reprojects_mileage()
    {
        using var vm = NewViewModel(
            new WarrantyStatusSize(2, 2),
            UnitPref.Metric,
            Loaded(Snapshot($$"""{"mileage_limit_mi":{{LimitMeters}},"current_mileage_mi":{{CurrentMeters}}}""")));
        await vm.LoadAsync();
        Assert.Equal("100 km", Assert.Single(vm.Display.Entries, e => e.Label == "Mileage Limit").Value);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("62 mi", Assert.Single(vm.Display.Entries, e => e.Label == "Mileage Limit").Value);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<WarrantyStatusSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Warranty Status", vm.Title);
        Assert.Equal("No warranty data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snapshot($$"""{"warranty_expiry_date":"{{SuccessExpiry}}"}""")));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(WarrantyStatusViewModel.State), changed);
        Assert.Contains(nameof(WarrantyStatusViewModel.Display), changed);
    }

    // ---- Source: fleet-wide read ---------------------------------------------------

    [Fact]
    public async Task Source_reads_warranty_fleet_wide_without_path_params()
    {
        using var envelope = JsonDocument.Parse(
            """{"data":{"warranty_expiry_date":"2026-10-06T12:00:00Z"},"fetched_at":"2026-06-06T00:00:00Z"}""");
        var api = new FakeApiClient().ReturnsValue(envelope.RootElement);
        var source = new WarrantyStatusSource(api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.NotNull(terminal.Value!.DataJson);

        var request = Assert.Single(api.Requests);
        Assert.Equal(WarrantyStatusRegistration.WarrantyOperationId, request.OperationId);
        Assert.True(request.PathParams is null || request.PathParams.Count == 0);
    }

    [Fact]
    public async Task Source_envelope_without_data_resolves_empty_snapshot()
    {
        using var envelope = JsonDocument.Parse("""{"data":null,"fetched_at":null}""");
        var api = new FakeApiClient().ReturnsValue(envelope.RootElement);
        var source = new WarrantyStatusSource(api, NewEngine(), new ApiClientOptions());

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Null(terminal.Value!.DataJson);
        Assert.False(WarrantyStatusProjection.ParseSnapshot(terminal.Value, Now).HasData);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("warranty-status", WarrantyStatusRegistration.Id);
        Assert.Equal("vehicle", WarrantyStatusRegistration.Category);
        Assert.Equal("WarrantyStatusWidget", WarrantyStatusRegistration.Slug);
        Assert.Equal(new WarrantyStatusSize(2, 2), WarrantyStatusRegistration.DefaultSize);
        Assert.Equal(new WarrantyStatusSize(1, 2), WarrantyStatusRegistration.MinSize);
        Assert.Equal(new WarrantyStatusSize(3, 40), WarrantyStatusRegistration.MaxSize);
        Assert.Equal("Warranty Status", WarrantyStatusRegistration.Name(Localizer));
        Assert.Contains("coverage", WarrantyStatusRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 2, true)]
    [InlineData(1, 2, true)]
    [InlineData(3, 40, true)]
    [InlineData(0, 2, false)]
    [InlineData(4, 40, false)]
    [InlineData(2, 41, false)]
    [InlineData(2, 1, false)]
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, WarrantyStatusRegistration.IsWithinBounds(new WarrantyStatusSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new WarrantyStatusSize(1, 2), WarrantyStatusRegistration.Clamp(new WarrantyStatusSize(0, 0)));
        Assert.Equal(new WarrantyStatusSize(3, 40), WarrantyStatusRegistration.Clamp(new WarrantyStatusSize(9, 99)));
    }

    [Fact]
    public void Registration_operation_id_resolves_against_the_generated_endpoint_table()
    {
        var index = GeneratedApi.ApiEndpoints.All.ToDictionary(e => e.OperationId, e => e, StringComparer.Ordinal);
        Assert.True(index.ContainsKey(WarrantyStatusRegistration.WarrantyOperationId));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new WarrantyStatusDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WarrantyStatusWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static ParsedWarranty Parse(string dataJson)
    {
        using var doc = JsonDocument.Parse(dataJson);
        return WarrantyStatusParser.Parse(doc.RootElement, Now);
    }

    private static WarrantyStatusSnapshot Snapshot(string dataJson) => new(dataJson);

    private static WarrantyStatusDisplay Project(string dataJson) =>
        Project(dataJson, WarrantyStatusSize.Default, UnitPref.Metric);

    private static WarrantyStatusDisplay Project(string dataJson, WarrantyStatusSize size) =>
        Project(dataJson, size, UnitPref.Metric);

    private static WarrantyStatusDisplay Project(string dataJson, UnitPref units) =>
        Project(dataJson, WarrantyStatusSize.Default, units);

    private static WarrantyStatusDisplay Project(string dataJson, WarrantyStatusSize size, UnitPref units) =>
        WarrantyStatusProjection.Project(Snapshot(dataJson), size, Now, Localizer, units);

    private static RepositoryResult<WarrantyStatusSnapshot> Loaded(WarrantyStatusSnapshot snapshot) =>
        RepositoryResult<WarrantyStatusSnapshot>.Loaded(snapshot, Now);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<WarrantyStatusSnapshot>>> Drain(IWarrantyStatusSource source)
    {
        var results = new List<RepositoryResult<WarrantyStatusSnapshot>>();
        await foreach (var result in source.StreamAsync())
        {
            results.Add(result);
        }

        return results;
    }

    private static WarrantyStatusViewModel NewViewModel(params RepositoryResult<WarrantyStatusSnapshot>[] emissions) =>
        NewViewModel(WarrantyStatusSize.Default, UnitPref.Metric, emissions);

    private static WarrantyStatusViewModel NewViewModel(
        WarrantyStatusSize size,
        UnitPref units,
        params RepositoryResult<WarrantyStatusSnapshot>[] emissions) =>
        new(new FakeWarrantyStatusSource(emissions), Localizer, size, units, () => Now);

    private sealed class FakeWarrantyStatusSource(params RepositoryResult<WarrantyStatusSnapshot>[] emissions)
        : IWarrantyStatusSource
    {
        public async IAsyncEnumerable<RepositoryResult<WarrantyStatusSnapshot>> StreamAsync(
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
}
