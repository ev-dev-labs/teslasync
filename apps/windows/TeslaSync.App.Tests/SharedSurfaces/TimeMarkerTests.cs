using System.ComponentModel;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>TimeMarker</c> shared surface's UI-thread-free logic — the pure projection
/// (the data adapter: the null/empty-x hidden guard, severity → stroke colour, default label/stroke/overflow),
/// the alert-context adapter (timestamp → visibility, signal → critical severity, the ±30-minute window), the
/// alert-context seam/store (set / params / clear + change notification), the view-model's hidden (web
/// <c>return null</c>) vs visible states with prop overrides, the localized label, the PII-safe diagnostics and
/// the argument validation. Mirrors the web spec one-for-one (web/src/components/charts/TimeMarker.tsx +
/// web/src/hooks/useAlertContext.ts). The WinUI view itself (the rule + label chip) is exercised by the app
/// build.
/// </summary>
public sealed class TimeMarkerTests
{
    // ── Projection (the data adapter): the null/empty-x hidden guard ─────────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Project_hides_the_marker_when_x_is_null_or_empty(string? x)
    {
        // web: `if (x == null || x === '') return null;`
        TimeMarkerDisplay display = TimeMarkerProjection.Project(new TimeMarkerInput(x), PassthroughLocalizer.Instance);

        Assert.False(display.IsVisible);
        Assert.Same(TimeMarkerDisplay.Hidden, display);
    }

    [Fact]
    public void Project_shows_the_marker_for_a_non_empty_x_including_whitespace()
    {
        // web compares `x === ''` exactly, so a whitespace key is still a visible marker.
        Assert.True(TimeMarkerProjection.Project(new TimeMarkerInput("2026-04-30"), PassthroughLocalizer.Instance).IsVisible);
        Assert.True(TimeMarkerProjection.Project(new TimeMarkerInput(" "), PassthroughLocalizer.Instance).IsVisible);
    }

    [Fact]
    public void Project_carries_the_x_key_when_visible()
    {
        TimeMarkerDisplay display = TimeMarkerProjection.Project(new TimeMarkerInput("Apr 30"), PassthroughLocalizer.Instance);

        Assert.True(display.IsVisible);
        Assert.Equal("Apr 30", display.XKey);
    }

    // ── Projection: severity → stroke colour (web SEVERITY_STROKE + normalizeSeverity) ───────────────────

    [Theory]
    [InlineData("info", SeverityLevel.Info, "#0ea5e9")]
    [InlineData("warn", SeverityLevel.Warn, "#f59e0b")]
    [InlineData("critical", SeverityLevel.Critical, "#ef4444")]
    [InlineData("success", SeverityLevel.Success, "#10b981")]
    public void Project_pins_the_web_stroke_for_each_canonical_severity(string severity, SeverityLevel level, string hex)
    {
        TimeMarkerDisplay display = TimeMarkerProjection.Project(
            new TimeMarkerInput("x") { Severity = severity }, PassthroughLocalizer.Instance);

        Assert.Equal(level, display.Severity);
        Assert.Equal(hex, display.StrokeHex);
    }

    [Theory]
    [InlineData("warning", "#f59e0b")]   // web normalizeSeverity legacy alias -> warn
    [InlineData("error", "#ef4444")]     // -> critical
    [InlineData("fatal", "#ef4444")]     // -> critical
    [InlineData("ok", "#10b981")]        // -> success
    [InlineData("UNKNOWN", "#0ea5e9")]   // unrecognised -> info
    [InlineData("", "#0ea5e9")]          // empty string -> info (web normalizeSeverity(''))
    public void Project_normalizes_legacy_severity_aliases_before_the_stroke_lookup(string severity, string hex)
    {
        TimeMarkerDisplay display = TimeMarkerProjection.Project(
            new TimeMarkerInput("x") { Severity = severity }, PassthroughLocalizer.Instance);

        Assert.Equal(hex, display.StrokeHex);
    }

    [Fact]
    public void Project_defaults_a_null_severity_to_warn()
    {
        // web: `normalizeSeverity(severity ?? 'warn')` — null defaults to warn (not the info empty-string case).
        TimeMarkerDisplay display = TimeMarkerProjection.Project(
            new TimeMarkerInput("x") { Severity = null }, PassthroughLocalizer.Instance);

        Assert.Equal(SeverityLevel.Warn, display.Severity);
        Assert.Equal("#f59e0b", display.StrokeHex);
    }

    [Fact]
    public void SeverityStroke_pins_the_web_palette()
    {
        Assert.Equal("#0ea5e9", TimeMarkerStroke.Info);
        Assert.Equal("#f59e0b", TimeMarkerStroke.Warn);
        Assert.Equal("#ef4444", TimeMarkerStroke.Critical);
        Assert.Equal("#10b981", TimeMarkerStroke.Success);
        Assert.Equal("#0ea5e9", TimeMarkerStroke.Hex(SeverityLevel.Info));
        Assert.Equal("#f59e0b", TimeMarkerStroke.Hex(SeverityLevel.Warn));
        Assert.Equal("#ef4444", TimeMarkerStroke.Hex(SeverityLevel.Critical));
        Assert.Equal("#10b981", TimeMarkerStroke.Hex(SeverityLevel.Success));
    }

    // ── Projection: label, stroke width, dash, overflow, y-axis defaults + overrides ─────────────────────

    [Fact]
    public void Project_uses_the_localized_default_label_when_none_is_supplied()
    {
        var localizer = new RecordingLocalizer();

        TimeMarkerDisplay display = TimeMarkerProjection.Project(new TimeMarkerInput("x"), localizer);

        Assert.Equal("Alert", display.Label);
        Assert.Contains(("translation.chart.timeMarker.label", "Alert"), localizer.Requests);
    }

    [Fact]
    public void Project_honours_an_explicit_label_without_consulting_the_localizer()
    {
        var localizer = new RecordingLocalizer();

        TimeMarkerDisplay display = TimeMarkerProjection.Project(
            new TimeMarkerInput("x") { Label = "Battery alert" }, localizer);

        Assert.Equal("Battery alert", display.Label);
        Assert.Empty(localizer.Requests);
    }

    [Fact]
    public void Project_honours_an_explicit_empty_label()
    {
        // web renders the empty string verbatim — the ?? default only applies to a null/undefined label.
        TimeMarkerDisplay display = TimeMarkerProjection.Project(
            new TimeMarkerInput("x") { Label = string.Empty }, PassthroughLocalizer.Instance);

        Assert.Equal(string.Empty, display.Label);
    }

    [Fact]
    public void Project_defaults_stroke_width_to_two_and_honours_an_override()
    {
        Assert.Equal(2, TimeMarkerProjection.Project(new TimeMarkerInput("x"), PassthroughLocalizer.Instance).StrokeWidth);
        Assert.Equal(4, TimeMarkerProjection.Project(new TimeMarkerInput("x") { StrokeWidth = 4 }, PassthroughLocalizer.Instance).StrokeWidth);
    }

    [Fact]
    public void Project_defaults_to_a_solid_rule_and_carries_a_dash_pattern()
    {
        TimeMarkerDisplay solid = TimeMarkerProjection.Project(new TimeMarkerInput("x"), PassthroughLocalizer.Instance);
        Assert.False(solid.IsDashed);
        Assert.Null(solid.StrokeDasharray);

        TimeMarkerDisplay dashed = TimeMarkerProjection.Project(
            new TimeMarkerInput("x") { StrokeDasharray = "6 4" }, PassthroughLocalizer.Instance);
        Assert.True(dashed.IsDashed);
        Assert.Equal("6 4", dashed.StrokeDasharray);
    }

    [Fact]
    public void Project_defaults_overflow_to_extend_domain_and_honours_an_override()
    {
        Assert.Equal(
            TimeMarkerOverflow.ExtendDomain,
            TimeMarkerProjection.Project(new TimeMarkerInput("x"), PassthroughLocalizer.Instance).IfOverflow);
        Assert.Equal(
            TimeMarkerOverflow.Hidden,
            TimeMarkerProjection.Project(new TimeMarkerInput("x") { IfOverflow = TimeMarkerOverflow.Hidden }, PassthroughLocalizer.Instance).IfOverflow);
    }

    [Fact]
    public void Project_carries_the_y_axis_id()
    {
        TimeMarkerDisplay display = TimeMarkerProjection.Project(
            new TimeMarkerInput("x") { YAxisId = "right" }, PassthroughLocalizer.Instance);

        Assert.Equal("right", display.YAxisId);
    }

    [Fact]
    public void Hidden_display_carries_inert_defaults()
    {
        TimeMarkerDisplay hidden = TimeMarkerDisplay.Hidden;

        Assert.False(hidden.IsVisible);
        Assert.Equal(string.Empty, hidden.XKey);
        Assert.Equal(2, hidden.StrokeWidth);
        Assert.Equal(TimeMarkerOverflow.ExtendDomain, hidden.IfOverflow);
        Assert.Equal(10, hidden.LabelFontSize);
    }

    [Fact]
    public void Projection_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => TimeMarkerProjection.Project((TimeMarkerInput)null!, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() => TimeMarkerProjection.Project(new TimeMarkerInput("x"), null!));
        Assert.Throws<ArgumentNullException>(() => TimeMarkerProjection.Project((AlertMarkerContext)null!, PassthroughLocalizer.Instance));
    }

    // ── Alert-context adapter: timestamp → visibility, signal → critical (web BatteryHealthPage wiring) ──

    [Fact]
    public void From_alert_context_with_a_timestamp_and_no_signal_is_a_visible_warn_marker()
    {
        var context = AlertMarkerContext.Create(12, "2026-04-30T13:00:00Z", signal: null);

        TimeMarkerDisplay display = TimeMarkerProjection.Project(context, PassthroughLocalizer.Instance);

        Assert.True(display.IsVisible);
        Assert.Equal("2026-04-30T13:00:00Z", display.XKey);
        Assert.Equal(SeverityLevel.Warn, display.Severity);
        Assert.Equal("#f59e0b", display.StrokeHex);
    }

    [Fact]
    public void From_alert_context_with_a_signal_escalates_to_critical()
    {
        // web: `severity={alertCtx.signal ? 'critical' : undefined}`.
        var context = AlertMarkerContext.Create(12, "2026-04-30T13:00:00Z", "BatteryLevel");

        TimeMarkerDisplay display = TimeMarkerProjection.Project(context, PassthroughLocalizer.Instance);

        Assert.True(display.IsVisible);
        Assert.Equal(SeverityLevel.Critical, display.Severity);
        Assert.Equal("#ef4444", display.StrokeHex);
    }

    [Fact]
    public void From_alert_context_without_a_timestamp_is_hidden_even_with_a_signal()
    {
        // web: `x={timestamp ? formatDateShort(timestamp) : null}` -> no timestamp means no marker.
        var context = AlertMarkerContext.Create(12, timestamp: null, signal: "BatteryLevel");

        Assert.False(TimeMarkerProjection.Project(context, PassthroughLocalizer.Instance).IsVisible);
    }

    [Fact]
    public void Context_projection_matches_the_explicit_input_projection()
    {
        var context = AlertMarkerContext.Create(7, "2026-01-02T03:04:05Z", "ChargeState");

        TimeMarkerDisplay viaContext = TimeMarkerProjection.Project(context, PassthroughLocalizer.Instance);
        TimeMarkerDisplay viaInput = TimeMarkerProjection.Project(
            TimeMarkerInput.FromAlertContext(context), PassthroughLocalizer.Instance);

        Assert.Equal(viaInput, viaContext);
    }

    [Fact]
    public void From_alert_context_rejects_null() =>
        Assert.Throws<ArgumentNullException>(() => TimeMarkerInput.FromAlertContext(null!));

    // ── AlertMarkerContext.Create / FromQuery (cached -> projection adapter) ─────────────────────────────

    [Fact]
    public void Create_derives_a_plus_minus_30_minute_window_from_a_valid_timestamp()
    {
        var context = AlertMarkerContext.Create(1, "2026-04-30T13:00:00Z", null);

        Assert.NotNull(context.TimeWindow);
        Assert.Equal("2026-04-30T12:30:00.000Z", context.TimeWindow!.From);
        Assert.Equal("2026-04-30T13:30:00.000Z", context.TimeWindow.To);
        Assert.True(context.HasContext);
    }

    [Fact]
    public void Create_normalizes_the_window_bounds_to_utc()
    {
        var context = AlertMarkerContext.Create(1, "2026-04-30T13:00:00+02:00", null);

        // web Date.toISOString() is always UTC; +02:00 13:00 -> 11:00 UTC.
        Assert.Equal("2026-04-30T10:30:00.000Z", context.TimeWindow!.From);
        Assert.Equal("2026-04-30T11:30:00.000Z", context.TimeWindow.To);
    }

    [Fact]
    public void Create_keeps_an_unparseable_timestamp_but_yields_no_window()
    {
        var context = AlertMarkerContext.Create(1, "not-a-date", null);

        Assert.Equal("not-a-date", context.Timestamp);
        Assert.Null(context.TimeWindow);
        Assert.True(context.HasContext);
    }

    [Fact]
    public void Create_sets_has_context_from_any_present_field()
    {
        Assert.True(AlertMarkerContext.Create(5, null, null).HasContext);
        Assert.True(AlertMarkerContext.Create(null, null, "BatteryLevel").HasContext);
        Assert.False(AlertMarkerContext.Create(null, null, null).HasContext);
        Assert.False(AlertMarkerContext.Create(null, "", "").HasContext);
    }

    [Fact]
    public void From_query_parses_the_vehicle_id_and_guards_non_integers()
    {
        Assert.Equal(42, AlertMarkerContext.FromQuery("42", null, null).VehicleId);
        Assert.Null(AlertMarkerContext.FromQuery("not-a-number", null, null).VehicleId);
        Assert.Null(AlertMarkerContext.FromQuery("", null, null).VehicleId);
        Assert.Null(AlertMarkerContext.FromQuery(null, null, null).VehicleId);
    }

    [Fact]
    public void None_carries_no_context()
    {
        Assert.False(AlertMarkerContext.None.HasContext);
        Assert.Null(AlertMarkerContext.None.Timestamp);
        Assert.Null(AlertMarkerContext.None.Signal);
        Assert.Null(AlertMarkerContext.None.TimeWindow);
    }

    // ── Source / store (the P1/S8 seam): set, params, clear, change notification ─────────────────────────

    [Fact]
    public void A_default_store_starts_with_no_context()
    {
        var store = new TimeMarkerStore();

        Assert.Same(AlertMarkerContext.None, store.Context);
    }

    [Fact]
    public void Set_context_replaces_and_raises_changed()
    {
        var store = new TimeMarkerStore();
        int changes = 0;
        store.Changed += (_, _) => changes++;

        var context = AlertMarkerContext.Create(1, "2026-04-30T13:00:00Z", "BatteryLevel");
        store.SetContext(context);

        Assert.Same(context, store.Context);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Set_params_derives_the_context_and_raises_changed()
    {
        var store = new TimeMarkerStore();
        int changes = 0;
        store.Changed += (_, _) => changes++;

        store.SetParams("12", "2026-04-30T13:00:00Z", "BatteryLevel");

        Assert.Equal(12, store.Context.VehicleId);
        Assert.Equal("BatteryLevel", store.Context.Signal);
        Assert.NotNull(store.Context.TimeWindow);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Clear_resets_to_none_and_raises_changed()
    {
        var store = new TimeMarkerStore(AlertMarkerContext.Create(1, "2026-04-30T13:00:00Z", null));
        int changes = 0;
        store.Changed += (_, _) => changes++;

        store.Clear();

        Assert.Same(AlertMarkerContext.None, store.Context);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Set_context_rejects_null() =>
        Assert.Throws<ArgumentNullException>(() => new TimeMarkerStore().SetContext(null!));

    // ── View-model state: hidden (web `return null`) vs visible ──────────────────────────────────────────

    [Fact]
    public void View_model_is_hidden_with_no_alert_context()
    {
        using var vm = new TimeMarkerViewModel(new TimeMarkerStore(), PassthroughLocalizer.Instance);

        Assert.True(vm.IsHidden);
        Assert.False(vm.IsVisible);
        Assert.Same(TimeMarkerDisplay.Hidden, vm.Display);
    }

    [Fact]
    public void View_model_is_visible_with_an_alert_timestamp()
    {
        var store = new TimeMarkerStore(AlertMarkerContext.Create(1, "2026-04-30T13:00:00Z", null));
        using var vm = new TimeMarkerViewModel(store, PassthroughLocalizer.Instance);

        Assert.True(vm.IsVisible);
        Assert.Equal("Alert", vm.ResolvedLabel);
        Assert.Equal(SeverityLevel.Warn, vm.ResolvedSeverity);
        Assert.Equal("2026-04-30T13:00:00Z", vm.Timestamp);
        Assert.True(vm.HasContext);
    }

    [Fact]
    public void View_model_follows_the_context_signal_to_critical()
    {
        var store = new TimeMarkerStore(AlertMarkerContext.Create(1, "2026-04-30T13:00:00Z", "BatteryLevel"));
        using var vm = new TimeMarkerViewModel(store, PassthroughLocalizer.Instance);

        Assert.Equal(SeverityLevel.Critical, vm.ResolvedSeverity);
        Assert.Equal("BatteryLevel", vm.Signal);
    }

    [Fact]
    public void View_model_severity_override_wins_over_the_context()
    {
        var store = new TimeMarkerStore(AlertMarkerContext.Create(1, "2026-04-30T13:00:00Z", "BatteryLevel"));
        using var vm = new TimeMarkerViewModel(store, PassthroughLocalizer.Instance) { Severity = "info" };

        Assert.Equal(SeverityLevel.Info, vm.ResolvedSeverity);
        Assert.Equal("#0ea5e9", vm.Display.StrokeHex);
    }

    [Fact]
    public void View_model_label_override_flows_to_the_display()
    {
        var store = new TimeMarkerStore(AlertMarkerContext.Create(1, "2026-04-30T13:00:00Z", null));
        using var vm = new TimeMarkerViewModel(store, PassthroughLocalizer.Instance) { Label = "Spike" };

        Assert.Equal("Spike", vm.ResolvedLabel);
    }

    [Fact]
    public void View_model_stroke_dash_overflow_and_axis_overrides_flow_to_the_display()
    {
        var store = new TimeMarkerStore(AlertMarkerContext.Create(1, "2026-04-30T13:00:00Z", null));
        using var vm = new TimeMarkerViewModel(store, PassthroughLocalizer.Instance)
        {
            StrokeWidth = 3,
            StrokeDasharray = "8 4",
            IfOverflow = TimeMarkerOverflow.Visible,
            YAxisId = "left",
        };

        TimeMarkerDisplay display = vm.Display;
        Assert.Equal(3, display.StrokeWidth);
        Assert.Equal("8 4", display.StrokeDasharray);
        Assert.True(display.IsDashed);
        Assert.Equal(TimeMarkerOverflow.Visible, display.IfOverflow);
        Assert.Equal("left", display.YAxisId);
    }

    [Fact]
    public void View_model_reprojects_and_notifies_when_the_source_changes()
    {
        var store = new TimeMarkerStore();
        using var vm = new TimeMarkerViewModel(store, PassthroughLocalizer.Instance);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        Assert.True(vm.IsHidden);
        store.SetParams("1", "2026-04-30T13:00:00Z", "BatteryLevel");

        Assert.True(vm.IsVisible);
        Assert.Equal(SeverityLevel.Critical, vm.ResolvedSeverity);
        Assert.Contains(nameof(TimeMarkerViewModel.Display), changed);
        Assert.Contains(nameof(TimeMarkerViewModel.IsVisible), changed);
        Assert.Contains(nameof(TimeMarkerViewModel.Timestamp), changed);
    }

    [Fact]
    public void View_model_raises_property_changed_when_a_prop_is_set()
    {
        using var vm = new TimeMarkerViewModel(
            new TimeMarkerStore(AlertMarkerContext.Create(1, "2026-04-30T13:00:00Z", null)),
            PassthroughLocalizer.Instance);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.StrokeWidth = 5;

        Assert.Contains(nameof(TimeMarkerViewModel.StrokeWidth), changed);
        Assert.Contains(nameof(TimeMarkerViewModel.Display), changed);
    }

    [Fact]
    public void View_model_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() => new TimeMarkerViewModel(null!, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() => new TimeMarkerViewModel(new TimeMarkerStore(), null!));
    }

    [Fact]
    public void Disposed_view_model_stops_reprojecting()
    {
        var store = new TimeMarkerStore();
        var vm = new TimeMarkerViewModel(store, PassthroughLocalizer.Instance);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Dispose();
        store.SetParams("1", "2026-04-30T13:00:00Z", null);

        // A disposed holder is detached from the seam: a later source change raises no notifications, so the
        // bound view is never told to re-render (the derived getters still read the live source if queried).
        Assert.Empty(changed);
    }

    [Fact]
    public void View_model_dispose_is_idempotent()
    {
        var vm = new TimeMarkerViewModel(new TimeMarkerStore(), PassthroughLocalizer.Instance);

        vm.Dispose();
        Assert.Null(Record.Exception(vm.Dispose));
    }

    // ── i18n / accessibility: the label resolves through the localizer with the web key ──────────────────

    [Fact]
    public void Resolved_label_flows_through_the_localizer_with_the_web_key()
    {
        var localizer = new RecordingLocalizer();
        using var vm = new TimeMarkerViewModel(
            new TimeMarkerStore(AlertMarkerContext.Create(1, "2026-04-30T13:00:00Z", null)), localizer);

        Assert.Equal("Alert", vm.ResolvedLabel);
        Assert.Contains(("translation.chart.timeMarker.label", "Alert"), localizer.Requests);
    }

    [Fact]
    public void Registration_default_label_resolves_through_the_localizer()
    {
        var localizer = new RecordingLocalizer();

        Assert.Equal("Alert", TimeMarkerRegistration.DefaultLabel(localizer));
        Assert.Contains(("translation.chart.timeMarker.label", "Alert"), localizer.Requests);
    }

    // ── Diagnostics (P1/S11): slug-only view.opened, never the alert content ─────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TimeMarkerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TimeMarker", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new TimeMarkerDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Notify_opened_emits_the_view_opened_event_once()
    {
        var lines = new List<string>();
        using var vm = new TimeMarkerViewModel(
            new TimeMarkerStore(), PassthroughLocalizer.Instance, new TimeMarkerDiagnostics(lines.Add));

        vm.NotifyOpened();
        vm.NotifyOpened();

        Assert.Equal("view.opened slug=TimeMarker", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_leak_the_alert_content()
    {
        var lines = new List<string>();
        var store = new TimeMarkerStore(AlertMarkerContext.Create(987654, "2026-04-30T13:00:00Z", "BatterySecretSignal"));
        using var vm = new TimeMarkerViewModel(store, PassthroughLocalizer.Instance, new TimeMarkerDiagnostics(lines.Add));

        vm.NotifyOpened();
        store.SetParams("987654", "2026-04-30T13:00:00Z", "BatterySecretSignal");

        Assert.All(lines, line =>
        {
            Assert.DoesNotContain("987654", line, StringComparison.Ordinal);
            Assert.DoesNotContain("2026-04-30", line, StringComparison.Ordinal);
            Assert.DoesNotContain("BatterySecretSignal", line, StringComparison.Ordinal);
        });
    }

    // ── Registration metadata is stable and matches the web spec ─────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("TimeMarker", TimeMarkerRegistration.Slug);
        Assert.Equal("TimeMarker", TimeMarkerViewModel.Slug);
    }

    [Fact]
    public void Registration_pins_the_web_constants()
    {
        Assert.Equal("translation.chart.timeMarker.label", TimeMarkerRegistration.LabelKey);
        Assert.Equal("Alert", TimeMarkerRegistration.LabelFallback);
        Assert.Equal(10, TimeMarkerRegistration.LabelFontSize);
        Assert.Equal(2, TimeMarkerRegistration.DefaultStrokeWidth);
        Assert.Equal("time-marker-root", TimeMarkerRegistration.RootAutomationId);
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<(string Key, string Fallback)> Requests { get; } = [];

        public string GetString(string key, string fallback)
        {
            Requests.Add((key, fallback));
            return fallback;
        }
    }
}
