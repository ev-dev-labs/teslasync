using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the PollingEngine surface's UI-thread-free logic — the registration + i18n keys, the
/// PII-safe diagnostics, the tolerant snake_case parse adapters (<see cref="PollingStatusSnapshot"/>,
/// <see cref="PollingSavings"/>), the pure formatters / palette (<see cref="PollingEngineFormat"/>), the savings +
/// vehicle-row projections, the cache-then-network result mappers, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline / disabled). Mirrors the web spec one-for-one
/// (web/src/components/data-display/PollingEngine.tsx, web/src/api/polling.ts, web/src/lib/colors.ts). The WinUI
/// view (shared-surfaces/PollingEngine/PollingEngine.cs) is exercised by the app build.
/// </summary>
public sealed class PollingEngineTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 11, 12, 0, 0, TimeSpan.Zero);

    // ── registration + diagnostics ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_and_automation_id_match_the_surface()
    {
        Assert.Equal("PollingEngine", PollingEngineRegistration.Slug);
        Assert.Equal("polling-engine-root", PollingEngineRegistration.RootAutomationId);
        Assert.Equal("polling/status", PollingEngineRegistration.StatusPath);
        Assert.Equal("polling/savings", PollingEngineRegistration.SavingsPath);
    }

    [Fact]
    public void I18n_source_keys_and_fallbacks_match_the_web_source()
    {
        // web: the eight t('polling.*') call sites — translation-namespaced keys, verbatim English fallbacks.
        // These keys exist in Strings/{en,ar,he}/Resources.resw.
        Assert.Equal("translation.polling.pollsSaved", PollingEngineRegistration.PollsSavedKey);
        Assert.Equal("Polls Saved", PollingEngineRegistration.PollsSavedFallback);
        Assert.Equal("translation.polling.savedAmount", PollingEngineRegistration.SavedAmountKey);
        Assert.Equal("$ Saved", PollingEngineRegistration.SavedAmountFallback);
        Assert.Equal("translation.polling.pollsMade", PollingEngineRegistration.PollsMadeKey);
        Assert.Equal("Polls Made", PollingEngineRegistration.PollsMadeFallback);
        Assert.Equal("translation.polling.creditLeft", PollingEngineRegistration.CreditLeftKey);
        Assert.Equal("Credit Left", PollingEngineRegistration.CreditLeftFallback);
        Assert.Equal("translation.polling.fleetTelemetry", PollingEngineRegistration.FleetTelemetryKey);
        Assert.Equal("Fleet Telemetry", PollingEngineRegistration.FleetTelemetryFallback);
        Assert.Equal("translation.polling.idleDetection", PollingEngineRegistration.IdleDetectionKey);
        Assert.Equal("Idle Detection", PollingEngineRegistration.IdleDetectionFallback);
        Assert.Equal("translation.polling.prediction", PollingEngineRegistration.PredictionKey);
        Assert.Equal("Prediction", PollingEngineRegistration.PredictionFallback);
        Assert.Equal("translation.polling.sleep", PollingEngineRegistration.SleepKey);
        Assert.Equal("Sleep", PollingEngineRegistration.SleepFallback);
    }

    [Fact]
    public void ProfileLabel_maps_known_profiles_and_passes_through_unknown()
    {
        Assert.Equal("Driving", PollingEngineRegistration.ProfileLabel("driving", Localizer));
        Assert.Equal("Charging", PollingEngineRegistration.ProfileLabel("charging", Localizer));
        Assert.Equal("Idle", PollingEngineRegistration.ProfileLabel("idle", Localizer));
        Assert.Equal("Sleeping", PollingEngineRegistration.ProfileLabel("sleeping", Localizer));
        Assert.Equal("warp-speed", PollingEngineRegistration.ProfileLabel("warp-speed", Localizer));
    }

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new PollingEngineDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=PollingEngine", Assert.Single(lines));
    }

    // ── status parse adapter (snake_case, tolerant) ──────────────────────────────────────────────────────────

    [Fact]
    public void ParseStatus_reads_snake_case_vehicles_decision_and_prediction()
    {
        const string json = """
        {
          "enabled": true,
          "vehicles": {
            "5YJ3VIN0000ABCDE": {
              "activity": "active",
              "profile": "driving",
              "consec_idle": 3,
              "next_poll_after": "2026-06-11T12:00:30Z",
              "battery_level": 72,
              "last_decision": {
                "next_interval_ms": 15000,
                "reasons": ["driving detected", "high speed"],
                "prediction": {
                  "next_state": "charging",
                  "estimated_in": 300000000000,
                  "confidence": 0.85,
                  "based_on": "recent pattern"
                }
              }
            }
          }
        }
        """;
        using var doc = JsonDocument.Parse(json);

        PollingStatusSnapshot snapshot = PollingStatusSnapshot.Parse(doc.RootElement);

        Assert.True(snapshot.Enabled);
        PollingVehicleActivity vehicle = Assert.Single(snapshot.Vehicles);
        Assert.Equal("5YJ3VIN0000ABCDE", vehicle.Vin);
        Assert.Equal("active", vehicle.Activity);
        Assert.Equal(PollingActivity.Active, vehicle.ActivityKind);
        Assert.Equal("driving", vehicle.Profile);
        Assert.Equal(3, vehicle.ConsecIdle);
        Assert.Equal("2026-06-11T12:00:30Z", vehicle.NextPollAfter);
        Assert.Equal(72, vehicle.BatteryLevel);
        Assert.NotNull(vehicle.LastDecision);
        Assert.Equal(15000, vehicle.LastDecision!.NextIntervalMs);
        Assert.Equal(new[] { "driving detected", "high speed" }, vehicle.LastDecision.Reasons);
        Assert.NotNull(vehicle.LastDecision.Prediction);
        Assert.Equal("charging", vehicle.LastDecision.Prediction!.NextState);
        Assert.Equal(300_000_000_000d, vehicle.LastDecision.Prediction.EstimatedInNanos);
        Assert.Equal(0.85, vehicle.LastDecision.Prediction.Confidence);
        Assert.Equal("recent pattern", vehicle.LastDecision.Prediction.BasedOn);
    }

    [Fact]
    public void ParseStatus_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"enabled":true,"vehicles":{"VIN":{}}}""");

        PollingVehicleActivity vehicle = Assert.Single(PollingStatusSnapshot.Parse(doc.RootElement).Vehicles);

        Assert.Equal("VIN", vehicle.Vin);
        Assert.Equal(string.Empty, vehicle.Activity);
        Assert.Equal(PollingActivity.Unknown, vehicle.ActivityKind);
        Assert.Equal(0, vehicle.ConsecIdle);
        Assert.Null(vehicle.NextPollAfter);
        Assert.Null(vehicle.LastDecision);
    }

    [Fact]
    public void ParseStatus_non_object_returns_disabled()
    {
        using var doc = JsonDocument.Parse("null");

        PollingStatusSnapshot snapshot = PollingStatusSnapshot.Parse(doc.RootElement);

        Assert.False(snapshot.Enabled);
        Assert.Empty(snapshot.Vehicles);
    }

    [Fact]
    public void ParseStatus_disabled_engine_round_trips()
    {
        using var doc = JsonDocument.Parse("""{"enabled":false,"vehicles":{}}""");

        Assert.False(PollingStatusSnapshot.Parse(doc.RootElement).Enabled);
    }

    // ── savings parse adapter ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ParseSavings_reads_scalars_and_sums_every_breakdown_bucket()
    {
        const string json = """
        {
          "polls_made": 480,
          "savings_percent": 62.5,
          "estimated_savings": 12.34,
          "remaining_credit": 87.66,
          "savings_breakdown": {
            "fleet_telemetry": 100,
            "idle_detection": 60,
            "prediction": 30,
            "sleep_detection": 10,
            "future_bucket": 5
          }
        }
        """;
        using var doc = JsonDocument.Parse(json);

        PollingSavings savings = PollingSavings.Parse(doc.RootElement);

        Assert.Equal(62.5, savings.SavingsPercent);
        Assert.Equal(12.34, savings.EstimatedSavings);
        Assert.Equal(480, savings.PollsMade);
        Assert.Equal(87.66, savings.RemainingCredit);
        Assert.Equal(100, savings.FleetTelemetry);
        Assert.Equal(60, savings.IdleDetection);
        Assert.Equal(30, savings.Prediction);
        Assert.Equal(10, savings.SleepDetection);
        // web: Object.values(breakdown).reduce(...) sums EVERY bucket, including ones the panel does not name.
        Assert.Equal(205, savings.BreakdownTotal);
    }

    // ── formatters / palette ─────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0, "now")]
    [InlineData(-5, "now")]
    [InlineData(5000, "5s")]
    [InlineData(59000, "59s")]
    [InlineData(60000, "1m")]
    [InlineData(3540000, "59m")]
    [InlineData(3600000, "1h 0m")]
    [InlineData(3900000, "1h 5m")]
    public void FormatDuration_matches_web_tiers(double ms, string expected) =>
        Assert.Equal(expected, PollingEngineFormat.FormatDuration(ms));

    [Fact]
    public void FormatTimeUntil_past_or_unparseable_is_now_future_is_a_duration()
    {
        Assert.Equal("now", PollingEngineFormat.FormatTimeUntil(null, Now));
        Assert.Equal("now", PollingEngineFormat.FormatTimeUntil("not-a-date", Now));
        Assert.Equal("now", PollingEngineFormat.FormatTimeUntil("2026-06-11T11:59:00Z", Now)); // past
        Assert.Equal("1m", PollingEngineFormat.FormatTimeUntil("2026-06-11T12:01:30Z", Now));  // +90s
    }

    [Fact]
    public void VinTail_returns_the_last_eight_characters()
    {
        Assert.Equal("12345678", PollingEngineFormat.VinTail("TESLAVIN12345678"));
        Assert.Equal("SHORT", PollingEngineFormat.VinTail("SHORT"));
    }

    [Theory]
    [InlineData(PollingActivity.Active, "#10b981")]
    [InlineData(PollingActivity.Critical, "#10b981")]
    [InlineData(PollingActivity.Moderate, "#3b82f6")]
    [InlineData(PollingActivity.Low, "#f59e0b")]
    [InlineData(PollingActivity.Idle, "#6b7280")]
    [InlineData(PollingActivity.Sleeping, "#4b5563")]
    [InlineData(PollingActivity.Unknown, "#6b7280")]
    public void ActivityColorHex_matches_web_activityColor(PollingActivity activity, string expected) =>
        Assert.Equal(expected, PollingEngineFormat.ActivityColorHex(activity));

    [Fact]
    public void ActivityGlyph_is_present_for_every_bucket()
    {
        foreach (PollingActivity activity in Enum.GetValues<PollingActivity>())
        {
            Assert.False(string.IsNullOrEmpty(PollingEngineFormat.ActivityGlyph(activity)));
        }
    }

    // ── savings projection ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void SavingsView_projects_four_metrics_in_web_order_with_formats()
    {
        var savings = new PollingSavings(62.5, 12.34, 480, 87.66, 100, 60, 30, 10, 200);

        PollingSavingsView view = PollingSavingsView.Project(savings);

        Assert.Equal(4, view.Metrics.Count);

        Assert.Equal(PollingEngineRegistration.PollsSavedKey, view.Metrics[0].LabelKey);
        Assert.Equal(62.5, view.Metrics[0].Value);
        Assert.Equal(1, view.Metrics[0].Precision);
        Assert.Equal("%", view.Metrics[0].Suffix);
        Assert.True(view.Metrics[0].Emphasis);

        Assert.Equal(PollingEngineRegistration.SavedAmountKey, view.Metrics[1].LabelKey);
        Assert.Equal("$", view.Metrics[1].Prefix);
        Assert.Equal(2, view.Metrics[1].Precision);
        Assert.True(view.Metrics[1].Emphasis);

        Assert.Equal(PollingEngineRegistration.PollsMadeKey, view.Metrics[2].LabelKey);
        Assert.Equal(0, view.Metrics[2].Precision);
        Assert.False(view.Metrics[2].Emphasis);

        Assert.Equal(PollingEngineRegistration.CreditLeftKey, view.Metrics[3].LabelKey);
        Assert.Equal("$", view.Metrics[3].Prefix);
        Assert.False(view.Metrics[3].Emphasis);
    }

    [Fact]
    public void SavingsView_segments_only_include_positive_buckets_with_fractions()
    {
        var savings = new PollingSavings(0, 0, 0, 0, 100, 0, 50, 50, 200);

        PollingSavingsView view = PollingSavingsView.Project(savings);

        Assert.True(view.HasBreakdown);
        Assert.Equal(3, view.Segments.Count); // idle_detection (0) is dropped
        Assert.Equal(PollingBreakdownKind.FleetTelemetry, view.Segments[0].Kind);
        Assert.Equal(0.5, view.Segments[0].Fraction);
        Assert.DoesNotContain(view.Segments, s => s.Kind == PollingBreakdownKind.IdleDetection);
        Assert.Equal("#3b82f6", view.Segments[0].ColorHex);
    }

    [Fact]
    public void SavingsView_with_no_breakdown_hides_the_bar()
    {
        var savings = new PollingSavings(10, 1, 5, 9, 0, 0, 0, 0, 0);

        PollingSavingsView view = PollingSavingsView.Project(savings);

        Assert.False(view.HasBreakdown);
        Assert.Empty(view.Segments);
        Assert.Equal(4, view.Metrics.Count);
    }

    // ── vehicle-row projection ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void VehicleRow_projects_summary_details_and_prediction()
    {
        var prediction = new PollingPrediction("charging", 300_000_000_000d, 0.85, "recent pattern");
        var decision = new PollingDecision(15000, new[] { "driving detected" }, prediction);
        var activity = new PollingVehicleActivity(
            "TESLAVIN12345678", "active", "driving", 2, "2026-06-11T12:01:30Z", 72, decision);

        PollingVehicleRow row = PollingVehicleRow.Project(activity, Now, Localizer);

        Assert.Equal("12345678", row.VinTail);
        Assert.Equal("active \u00b7 Driving", row.ActivityChip);
        Assert.Equal("#10b981", row.ActivityColorHex);
        Assert.False(string.IsNullOrEmpty(row.ActivityGlyph));
        Assert.True(row.Animate);                 // only the active bucket pulses
        Assert.Equal("1m", row.NextPollLabel);    // +90s
        Assert.True(row.HasDetails);
        Assert.Equal("15s", row.IntervalLabel);
        Assert.Equal(2, row.ConsecIdle);
        Assert.Equal(72, row.BatteryLevel);
        Assert.Equal(new[] { "driving detected" }, row.Reasons);
        Assert.NotNull(row.Prediction);
        Assert.Equal("charging", row.Prediction!.NextState);
        Assert.Equal("5m", row.Prediction.InLabel);   // estimated_in (ns) / 1e6 = 300000 ms -> 5m
        Assert.Equal(85, row.Prediction.ConfidencePercent);
        Assert.Equal("recent pattern", row.Prediction.BasedOn);
    }

    [Fact]
    public void VehicleRow_without_decision_has_no_details_and_does_not_animate()
    {
        var activity = new PollingVehicleActivity("VIN", "idle", "idle", 9, null, 40, LastDecision: null);

        PollingVehicleRow row = PollingVehicleRow.Project(activity, Now, Localizer);

        Assert.False(row.HasDetails);
        Assert.Null(row.IntervalLabel);
        Assert.Null(row.Prediction);
        Assert.False(row.Animate);
        Assert.Equal("now", row.NextPollLabel); // null next_poll_after
        Assert.Equal("idle \u00b7 Idle", row.ActivityChip);
    }

    // ── result mappers ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void MapStatus_preserves_lifecycle_and_parses_value()
    {
        using var doc = JsonDocument.Parse("""{"enabled":true,"vehicles":{}}""");
        JsonElement el = doc.RootElement.Clone();

        Assert.Equal(LoadStatus.Loading, PollingEngineResultMapper.MapStatus(RepositoryResult<JsonElement>.Loading()).Status);
        RepositoryResult<PollingStatusSnapshot> loaded =
            PollingEngineResultMapper.MapStatus(RepositoryResult<JsonElement>.Loaded(el, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.True(loaded.Value!.Enabled);

        RepositoryResult<PollingStatusSnapshot> offline = PollingEngineResultMapper.MapStatus(
            RepositoryResult<JsonElement>.OfflineCached(el, Now, new RepositoryError(RepositoryErrorKind.Network, "x")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.IsStale);

        RepositoryResult<PollingStatusSnapshot> error = PollingEngineResultMapper.MapStatus(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, error.Status);
    }

    [Fact]
    public void MapSavings_preserves_lifecycle_and_parses_value()
    {
        using var doc = JsonDocument.Parse("""{"savings_percent":50}""");
        RepositoryResult<PollingSavings> mapped =
            PollingEngineResultMapper.MapSavings(RepositoryResult<JsonElement>.Loaded(doc.RootElement.Clone(), Now));

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.Equal(50, mapped.Value!.SavingsPercent);
        Assert.Equal(LoadStatus.Empty, PollingEngineResultMapper.MapSavings(RepositoryResult<JsonElement>.Empty(Now)).Status);
    }

    // ── view-model: per-state transitions ────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_starts_in_loading()
    {
        using var vm = NewViewModel(Array.Empty<RepositoryResult<PollingStatusSnapshot>>());

        Assert.Equal(PollingEngineState.Loading, vm.State);
        Assert.True(vm.ShowSkeleton);
        Assert.False(vm.IsCollapsed);
    }

    [Fact]
    public async Task ViewModel_loaded_projects_savings_and_vehicle_rows()
    {
        var snapshot = Snapshot(Vehicle("TESLAVIN12345678", "active", "driving"));
        using var vm = NewViewModel(
            new[] { RepositoryResult<PollingStatusSnapshot>.Loaded(snapshot, Now) },
            new[] { RepositoryResult<PollingSavings>.Loaded(Savings(), Now) });

        await vm.LoadAsync();

        Assert.Equal(PollingEngineState.Loaded, vm.State);
        Assert.True(vm.ShowPanel);
        Assert.True(vm.HasVehicles);
        Assert.True(vm.HasSavings);
        Assert.Equal("12345678", Assert.Single(vm.VehicleRows).VinTail);
        Assert.Equal(4, vm.Savings!.Metrics.Count);
        Assert.False(vm.IsStale);
        Assert.False(vm.IsOffline);
    }

    [Fact]
    public async Task ViewModel_enabled_with_no_vehicles_is_empty_but_still_shows_the_panel()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<PollingStatusSnapshot>.Loaded(Snapshot(), Now) },
            new[] { RepositoryResult<PollingSavings>.Loaded(Savings(), Now) });

        await vm.LoadAsync();

        Assert.Equal(PollingEngineState.Empty, vm.State);
        Assert.True(vm.ShowPanel);     // the panel + savings card still render
        Assert.False(vm.HasVehicles);
        Assert.True(vm.HasSavings);
        Assert.False(string.IsNullOrEmpty(vm.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_disabled_engine_collapses_the_surface()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<PollingStatusSnapshot>.Loaded(new PollingStatusSnapshot(false, Array.Empty<PollingVehicleActivity>()), Now) });

        await vm.LoadAsync();

        Assert.Equal(PollingEngineState.Disabled, vm.State);
        Assert.True(vm.IsCollapsed);
        Assert.False(vm.ShowPanel);
    }

    [Fact]
    public async Task ViewModel_absent_status_body_collapses_like_web_return_null()
    {
        using var vm = NewViewModel(new[] { RepositoryResult<PollingStatusSnapshot>.Empty(Now) });

        await vm.LoadAsync();

        Assert.Equal(PollingEngineState.Disabled, vm.State);
        Assert.True(vm.IsCollapsed);
    }

    [Fact]
    public async Task ViewModel_failure_with_no_cache_is_error_with_retry_message()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<PollingStatusSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")) });

        await vm.LoadAsync();

        Assert.Equal(PollingEngineState.Error, vm.State);
        Assert.True(vm.ShowError);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_shows_content_plus_stale_chip()
    {
        var snapshot = Snapshot(Vehicle("VIN0000012345678", "moderate", "idle"));
        using var vm = NewViewModel(
            new[] { RepositoryResult<PollingStatusSnapshot>.Cached(snapshot, Now, stale: true) });

        await vm.LoadAsync();

        Assert.Equal(PollingEngineState.Stale, vm.State);
        Assert.True(vm.ShowStaleChip);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasVehicles);
    }

    [Fact]
    public async Task ViewModel_offline_shows_cached_content_plus_offline_chip_and_message()
    {
        var snapshot = Snapshot(Vehicle("VIN0000012345678", "low", "charging"));
        using var vm = NewViewModel(
            new[]
            {
                RepositoryResult<PollingStatusSnapshot>.OfflineCached(
                    snapshot, Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
            });

        await vm.LoadAsync();

        Assert.Equal(PollingEngineState.Offline, vm.State);
        Assert.True(vm.ShowOfflineChip);
        Assert.True(vm.IsOffline);
        Assert.True(vm.HasVehicles);
        Assert.Equal(PollingEngineRegistration.OfflineFallback, vm.ErrorMessage);
    }

    [Fact]
    public async Task ViewModel_empty_savings_stream_yields_no_savings_card()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<PollingStatusSnapshot>.Loaded(Snapshot(Vehicle("VIN", "idle", "idle")), Now) },
            new[] { RepositoryResult<PollingSavings>.Empty(Now) });

        await vm.LoadAsync();

        Assert.Equal(PollingEngineState.Loaded, vm.State);
        Assert.False(vm.HasSavings);
        Assert.Null(vm.Savings);
    }

    [Fact]
    public async Task ViewModel_keeps_content_visible_while_refreshing()
    {
        var snapshot = Snapshot(Vehicle("VIN", "active", "driving"));
        using var vm = NewViewModel(
            new[]
            {
                RepositoryResult<PollingStatusSnapshot>.Cached(snapshot, Now, stale: false),
                RepositoryResult<PollingStatusSnapshot>.Refreshing(snapshot, Now, stale: false),
                RepositoryResult<PollingStatusSnapshot>.Loaded(snapshot, Now),
            });

        await vm.LoadAsync();

        Assert.Equal(PollingEngineState.Loaded, vm.State);
        Assert.True(vm.HasVehicles);
        Assert.False(vm.IsFetching); // settled after the terminal Loaded
    }

    // ── view-model: i18n + accessibility labels ──────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_localized_labels_for_every_chrome_string()
    {
        using var vm = NewViewModel(Array.Empty<RepositoryResult<PollingStatusSnapshot>>());

        Assert.Equal("Adaptive Polling Engine", vm.Title);
        Assert.Equal("Active", vm.ActiveLabel);
        Assert.Equal("Vehicle Activity", vm.VehicleActivityLabel);
        Assert.Equal(PollingEngineRegistration.NoVehiclesFallback, vm.EmptyMessage);
        Assert.Equal("Next", vm.NextLabel);
        Assert.Equal("Interval", vm.IntervalLabel);
        Assert.Equal("Consecutive idle", vm.ConsecutiveIdleLabel);
        Assert.Equal("Battery", vm.BatteryLabel);
        Assert.Equal("Based on", vm.BasedOnLabel);
        Assert.Equal("conf", vm.ConfidenceLabel);
        Assert.Equal("Stale", vm.StaleLabel);
        Assert.Equal("Offline", vm.OfflineChipLabel);
        Assert.Equal("Retry", vm.RetryLabel);
        Assert.False(string.IsNullOrEmpty(vm.LoadingLabel));
    }

    [Fact]
    public void ViewModel_accessible_name_combines_title_and_active()
    {
        using var vm = NewViewModel(Array.Empty<RepositoryResult<PollingStatusSnapshot>>());

        Assert.Equal("Adaptive Polling Engine, Active", vm.AccessibleName);
    }

    [Fact]
    public void ViewModel_metric_accessible_name_combines_value_and_label()
    {
        using var vm = NewViewModel(Array.Empty<RepositoryResult<PollingStatusSnapshot>>());
        var metric = new PollingSavingsMetric(
            PollingEngineRegistration.PollsSavedKey, PollingEngineRegistration.PollsSavedFallback,
            62.5, 1, string.Empty, "%", Emphasis: true);

        string name = vm.MetricAccessibleName(metric);

        Assert.Contains("Polls Saved", name, StringComparison.Ordinal);
        Assert.Contains("%", name, StringComparison.Ordinal);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────

    private static PollingEngineViewModel NewViewModel(
        RepositoryResult<PollingStatusSnapshot>[] status,
        RepositoryResult<PollingSavings>[]? savings = null) =>
        new(new InMemoryPollingEngineSource(status, savings), Localizer, () => Now);

    private static PollingVehicleActivity Vehicle(string vin, string activity, string profile) =>
        new(vin, activity, profile, 0, "2026-06-11T12:01:30Z", 80,
            new PollingDecision(15000, new[] { "reason" }, Prediction: null));

    private static PollingStatusSnapshot Snapshot(params PollingVehicleActivity[] vehicles) =>
        new(true, vehicles);

    private static PollingSavings Savings() =>
        new(62.5, 12.34, 480, 87.66, 100, 60, 30, 10, 200);
}
