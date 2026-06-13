using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Admin;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SecretRotationPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/SecretRotationPage.tsx), the tolerant parsers (incl. the platform <c>{data:…}</c>
/// envelope), the view-model's four-state matrix (loading / empty / error / success) with the distinct HTTP-503
/// subsystem-unavailable branch (web <c>subsystemMissing</c>), and the generated-client feed's request shaping (web
/// <c>useSecretRotation</c>). The WinUI view is exercised by the app build; its per-region visibility is driven
/// entirely by the <see cref="SecretRotationDisplay"/> flags asserted here.
/// </summary>
public sealed class SecretRotationPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 21 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "admin.secretRotation.colAge", "admin.secretRotation.colExpiry", "admin.secretRotation.colKind",
        "admin.secretRotation.colRotated", "admin.secretRotation.colSeverity", "admin.secretRotation.colThresholds",
        "admin.secretRotation.criticalLabel", "admin.secretRotation.criticalMessage",
        "admin.secretRotation.criticalTitle", "admin.secretRotation.daysToExpiry", "admin.secretRotation.emptyMessage",
        "admin.secretRotation.emptyTable", "admin.secretRotation.emptyTitle", "admin.secretRotation.notConfigured",
        "admin.secretRotation.okLabel", "admin.secretRotation.pageTitle", "admin.secretRotation.subtitle",
        "admin.secretRotation.tableTitle", "admin.secretRotation.totalLabel", "admin.secretRotation.warnLabel",
        "admin.subsystem.unavailableTitle",
    ];

    private static SecretRotationItem CriticalItem() => new(
        Kind: "tesla_refresh_token",
        TargetId: null,
        LastRotated: "2026-05-01T10:00:00Z",
        AgeDays: 42,
        ExpiresAt: null,
        DaysToExpiry: null,
        WarnDays: 30,
        CriticalDays: 40,
        Severity: SecretRotationSeverity.Critical);

    private static SecretRotationItem OkItem() => new(
        Kind: "mqtt_mtls_cert",
        TargetId: "broker-1",
        LastRotated: "2026-06-12T11:55:00Z",
        AgeDays: 2,
        ExpiresAt: "2026-09-10T00:00:00Z",
        DaysToExpiry: 90,
        WarnDays: 30,
        CriticalDays: 60,
        Severity: SecretRotationSeverity.Ok);

    private static SecretRotationModel SuccessModel(IReadOnlyList<SecretRotationItem>? items = null) => new(
        HasData: true,
        Items: items ?? [OkItem(), CriticalItem()],
        Loading: false,
        HasError: false,
        ErrorDetail: null,
        SubsystemMissing: false);

    // ---- i18n key coverage (all 21 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = SecretRotationProjection.Project(SuccessModel(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings (incl. the daysToExpiry + criticalMessage templates) are resolved on every projection
        // regardless of data state; visibility is gated separately.
        _ = SecretRotationProjection.Project(SecretRotationModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = SecretRotationProjection.Project(SecretRotationModel.Initial, Localizer, Now);

        Assert.Equal(SecretRotationState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowSubsystemUnavailable);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_items()
    {
        var model = SuccessModel(items: []);
        var display = SecretRotationProjection.Project(model, Localizer, Now);

        Assert.Equal(SecretRotationState.Empty, display.State);
        Assert.True(display.ShowContent);        // the panel still renders…
        Assert.True(display.ShowEmptyState);     // …with the empty state inside, never a blank box
        Assert.False(display.ShowTable);
        Assert.False(display.ShowStatCards);     // web gates the StatCard grid on items.length > 0
        Assert.False(display.ShowCriticalBanner);
        Assert.Equal("No tracked secrets", display.EmptyTitle);
        Assert.Equal(
            "No rotation events have been recorded yet. The tracker captures observations on every credential rotation.",
            display.EmptyMessage);
    }

    [Fact]
    public void State_error_subsystem_unavailable_is_the_503_banner()
    {
        var model = SecretRotationModel.Initial with { Loading = false, SubsystemMissing = true };
        var display = SecretRotationProjection.Project(model, Localizer, Now);

        Assert.Equal(SecretRotationState.Error, display.State);
        Assert.True(display.ShowSubsystemUnavailable);
        Assert.False(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Equal("Subsystem unavailable", display.SubsystemTitle);
        Assert.Equal(
            "The rotation tracker is not configured on this deployment. Enable secret rotation tracking in config to populate this page.",
            display.SubsystemMessage);
    }

    [Fact]
    public void State_error_generic_failure_shows_retry()
    {
        var model = SecretRotationModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down" };
        var display = SecretRotationProjection.Project(model, Localizer, Now);

        Assert.Equal(SecretRotationState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowSubsystemUnavailable);
        Assert.False(display.ShowContent);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_items_present()
    {
        var display = SecretRotationProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(SecretRotationState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.ShowStatCards);
        Assert.True(display.ShowTable);
        Assert.False(display.ShowEmptyState);
        Assert.False(display.ShowError);
        Assert.False(display.ShowSubsystemUnavailable);
    }

    // ---- Panels: tracked-secret stat cards -----------------------------------------

    [Fact]
    public void Stat_cards_project_labels_and_tallied_values()
    {
        // Two ok + one warn + three critical.
        var items = new List<SecretRotationItem>
        {
            OkItem(),
            OkItem(),
            OkItem() with { Severity = SecretRotationSeverity.Warn },
            CriticalItem(),
            CriticalItem(),
            CriticalItem(),
        };
        var display = SecretRotationProjection.Project(SuccessModel(items), Localizer, Now);

        Assert.Equal("Tracked secrets", display.TotalLabel);
        Assert.Equal("6", display.TotalValue);

        Assert.Equal("OK", display.OkLabel);
        Assert.Equal("2", display.OkValue);

        Assert.Equal("Warn", display.WarnLabel);
        Assert.Equal("1", display.WarnValue);

        Assert.Equal("Critical", display.CriticalLabel);
        Assert.Equal("3", display.CriticalValue);
    }

    [Fact]
    public void Total_card_always_carries_the_shield_glyph()
    {
        var display = SecretRotationProjection.Project(SuccessModel(), Localizer, Now);
        Assert.Equal(SecretRotationRegistration.ShieldGlyph, display.TotalGlyph);
    }

    [Fact]
    public void Critical_card_glyph_only_appears_when_there_are_overdue_secrets()
    {
        var withCritical = SecretRotationProjection.Project(SuccessModel(items: [CriticalItem()]), Localizer, Now);
        Assert.Equal(SecretRotationRegistration.AlertGlyph, withCritical.CriticalGlyph);

        var withoutCritical = SecretRotationProjection.Project(SuccessModel(items: [OkItem()]), Localizer, Now);
        Assert.Equal(string.Empty, withoutCritical.CriticalGlyph);
    }

    // ---- Overdue-rotations critical banner -----------------------------------------

    [Fact]
    public void Critical_banner_shows_with_the_count_when_overdue_secrets_exist()
    {
        var items = new List<SecretRotationItem> { CriticalItem(), CriticalItem(), OkItem() };
        var display = SecretRotationProjection.Project(SuccessModel(items), Localizer, Now);

        Assert.True(display.ShowCriticalBanner);
        Assert.Equal("Overdue rotations", display.CriticalTitle);
        Assert.Equal(
            "2 secrets are past their critical rotation threshold. These should be rotated immediately to reduce blast radius.",
            display.CriticalMessage);
    }

    [Fact]
    public void Critical_banner_hidden_when_no_overdue_secrets()
    {
        var display = SecretRotationProjection.Project(SuccessModel(items: [OkItem()]), Localizer, Now);
        Assert.False(display.ShowCriticalBanner);
    }

    // ---- Panel: rotation-status table (GlassPanel5) --------------------------------

    [Fact]
    public void Table_panel_has_title_and_six_localized_columns()
    {
        var display = SecretRotationProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal("Rotation status", display.TableTitle);
        Assert.Equal("Kind", display.Columns.Kind);
        Assert.Equal("Last rotated", display.Columns.Rotated);
        Assert.Equal("Age (days)", display.Columns.Age);
        Assert.Equal("Expires", display.Columns.Expiry);
        Assert.Equal("Warn / critical", display.Columns.Thresholds);
        Assert.Equal("Severity", display.Columns.Severity);
    }

    [Fact]
    public void Table_row_formats_every_cell_for_an_expiring_ok_secret()
    {
        var display = SecretRotationProjection.Project(SuccessModel(items: [OkItem()]), Localizer, Now);
        var row = Assert.Single(display.Rows);

        Assert.Equal("mqtt_mtls_cert:broker-1", row.Key);
        Assert.Equal("MQTT mTLS certificate", row.Kind);
        Assert.True(row.ShowTarget);
        Assert.Equal("broker-1", row.TargetId);
        Assert.Equal(ExpectedDateTime("2026-06-12T11:55:00Z"), row.Rotated);
        Assert.Equal("5m ago", row.RotatedRelative);
        Assert.Equal("2", row.Age);
        Assert.Equal(ExpectedDateTime("2026-09-10T00:00:00Z"), row.Expiry);
        Assert.True(row.ShowDaysToExpiry);
        Assert.Equal("90d remaining", row.DaysToExpiry);
        Assert.Equal("30d / 60d", row.Thresholds);
        Assert.Equal("OK", row.SeverityLabel);
        Assert.Equal(StatusKind.Success, row.SeverityVariant);
    }

    [Fact]
    public void Table_row_for_a_never_expiring_overdue_secret_uses_em_dash_and_no_target()
    {
        var display = SecretRotationProjection.Project(SuccessModel(items: [CriticalItem()]), Localizer, Now);
        var row = Assert.Single(display.Rows);

        Assert.Equal("tesla_refresh_token:", row.Key);
        Assert.Equal("Tesla refresh token", row.Kind);
        Assert.False(row.ShowTarget);
        Assert.Equal(string.Empty, row.TargetId);
        Assert.Equal("42", row.Age);
        Assert.Equal(SecretRotationProjection.EmDash, row.Expiry);   // no expires_at → em-dash
        Assert.False(row.ShowDaysToExpiry);
        Assert.Equal(string.Empty, row.DaysToExpiry);
        Assert.Equal("30d / 40d", row.Thresholds);
        Assert.Equal("Overdue", row.SeverityLabel);
        Assert.Equal(StatusKind.Danger, row.SeverityVariant);
    }

    [Fact]
    public void Table_row_kind_falls_back_to_the_raw_value_for_an_unmapped_kind()
    {
        var item = OkItem() with { Kind = "future_kind_v2", TargetId = null };
        var display = SecretRotationProjection.Project(SuccessModel(items: [item]), Localizer, Now);

        Assert.Equal("future_kind_v2", Assert.Single(display.Rows).Kind);
    }

    [Fact]
    public void Empty_table_message_is_projected()
    {
        var display = SecretRotationProjection.Project(SuccessModel(items: []), Localizer, Now);
        Assert.Equal("No tracked secrets", display.EmptyTableMessage);
    }

    // ---- Counts reducer ------------------------------------------------------------

    [Fact]
    public void Counts_tally_total_and_each_tier()
    {
        var items = new List<SecretRotationItem>
        {
            OkItem(),
            OkItem() with { Severity = SecretRotationSeverity.Warn },
            CriticalItem(),
            OkItem() with { Severity = SecretRotationSeverity.Unknown },
        };
        var counts = SecretRotationCounts.From(items);

        Assert.Equal(4, counts.Total);
        Assert.Equal(1, counts.Ok);
        Assert.Equal(1, counts.Warn);
        Assert.Equal(1, counts.Critical);
    }

    // ---- Severity mapping ----------------------------------------------------------

    [Theory]
    [InlineData(SecretRotationSeverity.Ok, StatusKind.Success)]
    [InlineData(SecretRotationSeverity.Warn, StatusKind.Warning)]
    [InlineData(SecretRotationSeverity.Critical, StatusKind.Danger)]
    [InlineData(SecretRotationSeverity.Unknown, StatusKind.Neutral)]
    public void Severity_maps_to_the_shared_status_chip_variant(SecretRotationSeverity severity, StatusKind expected) =>
        Assert.Equal(expected, SecretRotationProjection.SeverityVariant(severity));

    [Theory]
    [InlineData(SecretRotationSeverity.Ok, "OK")]
    [InlineData(SecretRotationSeverity.Warn, "Rotate soon")]
    [InlineData(SecretRotationSeverity.Critical, "Overdue")]
    public void Severity_label_resolves_through_the_localizer(SecretRotationSeverity severity, string expected) =>
        Assert.Equal(expected, SecretRotationProjection.SeverityLabel(severity, Localizer));

    [Fact]
    public void Severity_label_for_unknown_is_the_em_dash() =>
        Assert.Equal(SecretRotationProjection.EmDash, SecretRotationProjection.SeverityLabel(SecretRotationSeverity.Unknown, Localizer));

    [Theory]
    [InlineData("ok", SecretRotationSeverity.Ok)]
    [InlineData("warn", SecretRotationSeverity.Warn)]
    [InlineData("critical", SecretRotationSeverity.Critical)]
    [InlineData("unknown", SecretRotationSeverity.Unknown)]
    [InlineData("", SecretRotationSeverity.Unknown)]
    [InlineData(null, SecretRotationSeverity.Unknown)]
    public void Severity_parses_from_the_wire_string(string? raw, SecretRotationSeverity expected) =>
        Assert.Equal(expected, SecretRotationItem.ParseSeverity(raw));

    // ---- Kind labels ---------------------------------------------------------------

    [Theory]
    [InlineData("tesla_refresh_token", "Tesla refresh token")]
    [InlineData("mqtt_mtls_cert", "MQTT mTLS certificate")]
    [InlineData("database_password", "Database password")]
    [InlineData("session_jwk", "Session JWK")]
    [InlineData("app_signing_key", "App signing key")]
    [InlineData("authentik_secret", "Authentik client secret")]
    public void Kind_label_maps_known_kinds(string raw, string expected) =>
        Assert.Equal(expected, SecretRotationProjection.FormatKind(raw, Localizer));

    // ---- Number / relative / datetime formatting -----------------------------------

    [Theory]
    [InlineData(0, "0")]
    [InlineData(5, "5")]
    [InlineData(42, "42")]
    [InlineData(12345, "12,345")]
    public void FormatCount_matches_web(long value, string expected) =>
        Assert.Equal(expected, SecretRotationProjection.FormatCount(value));

    [Theory]
    [InlineData(null, "\u2014")]
    [InlineData("not-a-date", "\u2014")]
    [InlineData("2026-06-12T11:59:30Z", "just now")]
    [InlineData("2026-06-12T11:55:00Z", "5m ago")]
    [InlineData("2026-06-12T09:00:00Z", "3h ago")]
    [InlineData("2026-06-09T12:00:00Z", "3d ago")]
    public void FormatRelative_matches_web_tiers(string? raw, string expected) =>
        Assert.Equal(expected, SecretRotationProjection.FormatRelative(raw, Now));

    [Fact]
    public void FormatRelative_falls_back_to_absolute_date_beyond_a_week()
    {
        const string raw = "2026-06-01T12:00:00Z";
        var value = ParseInstant(raw);
        var expected = DateTimeFormatting.Format(value, DateTimeVariant.Date, Now);

        Assert.Equal(expected, SecretRotationProjection.FormatRelative(raw, Now));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-date")]
    public void FormatDateTime_falls_back_to_em_dash_for_missing_or_bad_input(string? raw) =>
        Assert.Equal(SecretRotationProjection.EmDash, SecretRotationProjection.FormatDateTime(raw, Now));

    [Fact]
    public void FormatDateTime_renders_the_full_variant()
    {
        const string raw = "2026-06-12T10:30:00Z";
        var expected = DateTimeFormatting.Format(ParseInstant(raw), DateTimeVariant.Full, Now);
        Assert.Equal(expected, SecretRotationProjection.FormatDateTime(raw, Now));
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Snapshot_parse_unwraps_the_data_envelope_and_reads_items()
    {
        using var doc = JsonDocument.Parse(
            "{\"data\":{\"items\":[{\"kind\":\"database_password\",\"target_id\":\"primary\"," +
            "\"last_rotated\":\"2026-06-01T00:00:00Z\",\"age_days\":11,\"expires_at\":\"2026-12-01T00:00:00Z\"," +
            "\"days_to_expiry\":172,\"warn_days\":60,\"critical_days\":90,\"severity\":\"warn\"}]}}");

        var snapshot = SecretRotationSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        var item = Assert.Single(snapshot.Items);
        Assert.Equal("database_password", item.Kind);
        Assert.Equal("primary", item.TargetId);
        Assert.Equal("2026-06-01T00:00:00Z", item.LastRotated);
        Assert.Equal(11, item.AgeDays);
        Assert.Equal("2026-12-01T00:00:00Z", item.ExpiresAt);
        Assert.Equal(172, item.DaysToExpiry);
        Assert.Equal(60, item.WarnDays);
        Assert.Equal(90, item.CriticalDays);
        Assert.Equal(SecretRotationSeverity.Warn, item.Severity);
    }

    [Fact]
    public void Snapshot_parse_reads_a_bare_unwrapped_object()
    {
        using var doc = JsonDocument.Parse("{\"items\":[]}");
        var snapshot = SecretRotationSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        Assert.Empty(snapshot.Items);
    }

    [Fact]
    public void Snapshot_parse_is_tolerant_of_missing_optional_fields()
    {
        using var doc = JsonDocument.Parse("{\"data\":{\"items\":[{\"kind\":\"session_jwk\"}]}}");
        var snapshot = SecretRotationSnapshot.FromJson(doc.RootElement);

        var item = Assert.Single(snapshot.Items);
        Assert.Equal("session_jwk", item.Kind);
        Assert.Null(item.TargetId);
        Assert.Null(item.LastRotated);
        Assert.Equal(0, item.AgeDays);
        Assert.Null(item.ExpiresAt);
        Assert.Null(item.DaysToExpiry);
        Assert.Equal(SecretRotationSeverity.Unknown, item.Severity);
    }

    [Fact]
    public void Snapshot_parse_treats_non_object_as_no_data()
    {
        using var notObject = JsonDocument.Parse("null");
        Assert.False(SecretRotationSnapshot.FromJson(notObject.RootElement).HasData);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_items_into_the_success_state()
    {
        var feed = new FakeFeed(new SecretRotationSnapshot(true, [OkItem(), CriticalItem()]));
        using var vm = new SecretRotationPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SecretRotationState.Success, vm.State);
        Assert.True(vm.Display.ShowTable);
        Assert.True(vm.Display.ShowStatCards);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new SecretRotationPageViewModel(EmptySecretRotationFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SecretRotationState.Empty, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.True(vm.Display.ShowEmptyState);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_generic_error_state()
    {
        using var vm = new SecretRotationPageViewModel(new ThrowingFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SecretRotationState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.False(vm.Display.ShowSubsystemUnavailable);
        Assert.Contains("Failed to load data", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_http_503_is_the_subsystem_unavailable_branch()
    {
        using var vm = new SecretRotationPageViewModel(new SubsystemMissingFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SecretRotationState.Error, vm.State);
        Assert.True(vm.Display.ShowSubsystemUnavailable);
        Assert.False(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeFeed(new SecretRotationSnapshot(true, [OkItem()]));
        using var vm = new SecretRotationPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web useSecretRotation) -----------------------------

    [Fact]
    public async Task ClientFeed_sends_the_observability_operation_without_query_params()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"data\":{\"items\":[]}}"));
        var feed = new SecretRotationClientFeed(api);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_admin_observability_secret_rotation", request.OperationId);
        Assert.Null(request.Query);
        Assert.Null(request.PathParams);
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception_for_the_subsystem_branch()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("not configured", 503));
        var feed = new SecretRotationClientFeed(api);

        var ex = await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
        Assert.Equal(503, ex.StatusCode);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new SecretRotationDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SecretRotationPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operation()
    {
        Assert.Equal("SecretRotation", SecretRotationRegistration.RouteName);
        Assert.Equal("get_api_v1_admin_observability_secret_rotation", SecretRotationRegistration.Operation);
        Assert.Equal("Secret Rotation", SecretRotationRegistration.Title(Localizer));
    }

    private static string ExpectedDateTime(string raw) =>
        DateTimeFormatting.Format(ParseInstant(raw), DateTimeVariant.Full, Now);

    private static DateTimeOffset ParseInstant(string raw) =>
        DateTimeOffset.Parse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);

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

    private sealed class FakeFeed : ISecretRotationFeed
    {
        private readonly SecretRotationSnapshot _snapshot;

        public FakeFeed(SecretRotationSnapshot snapshot) => _snapshot = snapshot;

        public int FetchCount { get; private set; }

        public Task<SecretRotationSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(_snapshot);
        }
    }

    private sealed class ThrowingFeed : ISecretRotationFeed
    {
        public Task<SecretRotationSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");
    }

    private sealed class SubsystemMissingFeed : ISecretRotationFeed
    {
        public Task<SecretRotationSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("secret-rotation subsystem not configured", 503);
    }
}
