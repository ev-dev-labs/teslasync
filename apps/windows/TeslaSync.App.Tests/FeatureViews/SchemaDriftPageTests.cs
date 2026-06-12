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
/// Headless verification of the <c>SchemaDriftPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/admin/pages/SchemaDriftPage.tsx), the tolerant parsers, the view-model's four-state matrix
/// (loading / empty / error / success) with the distinct HTTP-503 subsystem-unavailable branch (web
/// <c>subsystemMissing</c>), and the generated-client feed's request shaping (web <c>useSchemaDrift</c>). The WinUI
/// view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="SchemaDriftDisplay"/> flags asserted here.
/// </summary>
public sealed class SchemaDriftPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // The 22 i18n keys the manifest requires the page to resolve.
    private static readonly string[] RequiredStringKeys =
    [
        "admin.schemaDrift.columnDelta", "admin.schemaDrift.columnSub", "admin.schemaDrift.columns",
        "admin.schemaDrift.emptyMessage", "admin.schemaDrift.emptyTitle", "admin.schemaDrift.fingerprintCurrent",
        "admin.schemaDrift.fingerprintExpected", "admin.schemaDrift.fingerprintTitle", "admin.schemaDrift.generatedAt",
        "admin.schemaDrift.indexDelta", "admin.schemaDrift.indexSub", "admin.schemaDrift.indexes",
        "admin.schemaDrift.notConfigured", "admin.schemaDrift.pageTitle", "admin.schemaDrift.statusClean",
        "admin.schemaDrift.statusDrifted", "admin.schemaDrift.statusTitle", "admin.schemaDrift.subtitle",
        "admin.schemaDrift.tableDelta", "admin.schemaDrift.tableSub", "admin.schemaDrift.tables",
        "admin.subsystem.unavailableTitle",
    ];

    private static SchemaDrift SampleDrift(
        bool hasDrift = true,
        long tableDelta = 2,
        long columnDelta = 10,
        long indexDelta = 2,
        string currentSha = "abc123def456",
        string expectedSha = "789beefcafe0",
        string? expectedGeneratedAt = "2026-06-06T11:30:00Z") => new(
        HasDrift: hasDrift,
        Current: new SchemaFingerprint(currentSha, 100, 800, 250),
        Expected: new SchemaFingerprint(expectedSha, 98, 790, 248),
        TableCountDelta: tableDelta,
        ColumnCountDelta: columnDelta,
        IndexCountDelta: indexDelta,
        ExpectedGeneratedAt: expectedGeneratedAt);

    private static SchemaDriftModel SuccessModel(bool? isDifferent = true, SchemaDrift? drift = null) => new(
        HasData: true,
        Drift: drift ?? SampleDrift(),
        IsDifferent: isDifferent,
        Loading: false,
        HasError: false,
        ErrorDetail: null,
        SubsystemMissing: false);

    // ---- i18n key coverage (all 22 manifest strings) ------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = SchemaDriftProjection.Project(SuccessModel(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings are resolved on every projection regardless of data state (visibility is gated separately).
        _ = SchemaDriftProjection.Project(SchemaDriftModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = SchemaDriftProjection.Project(SchemaDriftModel.Initial, Localizer, Now);

        Assert.Equal(SchemaDriftState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowSummary);
        Assert.False(display.ShowDetails);
        Assert.False(display.ShowError);
        Assert.False(display.ShowSubsystemUnavailable);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_data()
    {
        var model = SchemaDriftModel.Initial with { Loading = false };
        var display = SchemaDriftProjection.Project(model, Localizer, Now);

        Assert.Equal(SchemaDriftState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowSummary);
        Assert.False(display.ShowError);
        Assert.False(display.ShowSubsystemUnavailable);
        Assert.Equal("No fingerprint available", display.EmptyTitle);
        Assert.Equal(
            "The schema fingerprint has not been computed yet. Restart the API to capture a seed fingerprint.",
            display.EmptyMessage);
    }

    [Fact]
    public void State_error_subsystem_unavailable_is_the_503_banner()
    {
        var model = SchemaDriftModel.Initial with { Loading = false, SubsystemMissing = true };
        var display = SchemaDriftProjection.Project(model, Localizer, Now);

        Assert.Equal(SchemaDriftState.Error, display.State);
        Assert.True(display.ShowSubsystemUnavailable);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowSummary);
        Assert.Equal("Subsystem unavailable", display.SubsystemTitle);
        Assert.Equal(
            "The schema-drift subsystem is not configured on this deployment. Enable schema fingerprinting in config to populate this page.",
            display.SubsystemMessage);
    }

    [Fact]
    public void State_error_generic_failure_shows_retry()
    {
        var model = SchemaDriftModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down" };
        var display = SchemaDriftProjection.Project(model, Localizer, Now);

        Assert.Equal(SchemaDriftState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowSubsystemUnavailable);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowSummary);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_when_data_present()
    {
        var display = SchemaDriftProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal(SchemaDriftState.Success, display.State);
        Assert.True(display.ShowSummary);
        Assert.True(display.ShowDetails);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowSubsystemUnavailable);
    }

    // ---- Panel: drift summary (status badge + delta cards) -------------------------

    [Fact]
    public void Summary_badge_drifted_uses_warning_tone()
    {
        var display = SchemaDriftProjection.Project(SuccessModel(isDifferent: true), Localizer, Now);

        Assert.True(display.IsDrifted);
        Assert.Equal("Drift detected", display.StatusBadgeLabel);
        Assert.Equal(StatusKind.Warning, display.StatusBadgeVariant);
        Assert.Equal("Drift status", display.StatusTitle);
    }

    [Fact]
    public void Summary_badge_clean_uses_success_tone()
    {
        var drift = SampleDrift(hasDrift: false, tableDelta: 0, columnDelta: 0, indexDelta: 0);
        var display = SchemaDriftProjection.Project(SuccessModel(isDifferent: false, drift: drift), Localizer, Now);

        Assert.False(display.IsDrifted);
        Assert.Equal("No drift", display.StatusBadgeLabel);
        Assert.Equal(StatusKind.Success, display.StatusBadgeVariant);
    }

    [Fact]
    public void Summary_drift_flag_prefers_is_different_then_falls_back_to_has_drift()
    {
        // web: data.is_different ?? drift.has_drift — an explicit is_different wins over has_drift.
        var conflicting = SampleDrift(hasDrift: true);
        Assert.False(SchemaDriftProjection.Project(SuccessModel(isDifferent: false, drift: conflicting), Localizer, Now).IsDrifted);

        // when is_different is absent, has_drift drives the badge.
        Assert.True(SchemaDriftProjection.Project(SuccessModel(isDifferent: null, drift: SampleDrift(hasDrift: true)), Localizer, Now).IsDrifted);
    }

    [Fact]
    public void Summary_delta_cards_label_format_and_sublabels()
    {
        var display = SchemaDriftProjection.Project(SuccessModel(), Localizer, Now);

        Assert.Equal("Tables \u0394", display.TableDeltaLabel);
        Assert.Equal("Columns \u0394", display.ColumnDeltaLabel);
        Assert.Equal("Indexes \u0394", display.IndexDeltaLabel);

        Assert.Equal("+2", display.TableDeltaValue);
        Assert.Equal("+10", display.ColumnDeltaValue);
        Assert.Equal("+2", display.IndexDeltaValue);

        Assert.Equal("100 current \u00b7 98 expected", display.TableDeltaSub);
        Assert.Equal("800 current \u00b7 790 expected", display.ColumnDeltaSub);
        Assert.Equal("250 current \u00b7 248 expected", display.IndexDeltaSub);
    }

    [Theory]
    [InlineData(0, "0")]
    [InlineData(5, "+5")]
    [InlineData(-3, "-3")]
    [InlineData(1234, "+1,234")]
    [InlineData(-1234, "-1,234")]
    public void FormatDelta_matches_web(long delta, string expected) =>
        Assert.Equal(expected, SchemaDriftProjection.FormatDelta(delta));

    [Fact]
    public void FormatCount_groups_thousands() =>
        Assert.Equal("12,345", SchemaDriftProjection.FormatCount(12345));

    // ---- Panel: fingerprint details ------------------------------------------------

    [Fact]
    public void Details_current_and_expected_cards_project_counts_and_titles()
    {
        var display = SchemaDriftProjection.Project(SuccessModel(), Localizer, Now);

        var current = display.CurrentCard;
        Assert.Equal("Current", current.Title);
        Assert.Equal("abc123def456", current.Sha256);
        Assert.Equal("Tables", current.TablesLabel);
        Assert.Equal("100", current.TablesValue);
        Assert.Equal("Columns", current.ColumnsLabel);
        Assert.Equal("800", current.ColumnsValue);
        Assert.Equal("Indexes", current.IndexesLabel);
        Assert.Equal("250", current.IndexesValue);
        Assert.False(current.ShowGeneratedAt); // the current card never shows a capture time

        var expected = display.ExpectedCard;
        Assert.Equal("Expected (seed)", expected.Title);
        Assert.Equal("789beefcafe0", expected.Sha256);
        Assert.Equal("98", expected.TablesValue);
        Assert.Equal("790", expected.ColumnsValue);
        Assert.Equal("248", expected.IndexesValue);
        Assert.True(expected.ShowGeneratedAt);

        var when = DateTimeFormatting.Format(
            DateTimeOffset.Parse("2026-06-06T11:30:00Z", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal),
            DateTimeVariant.Full,
            Now);
        Assert.Equal($"Captured {when}", expected.GeneratedAtText);
        Assert.Equal("Fingerprints", display.FingerprintTitle);
    }

    [Fact]
    public void Details_sha256_falls_back_to_em_dash_when_empty()
    {
        var drift = SampleDrift() with { Current = new SchemaFingerprint(string.Empty, 1, 2, 3) };
        var display = SchemaDriftProjection.Project(SuccessModel(drift: drift), Localizer, Now);

        Assert.Equal(SchemaDriftProjection.EmDash, display.CurrentCard.Sha256);
    }

    [Fact]
    public void Details_generated_at_hidden_when_absent_or_unparseable()
    {
        var absent = SampleDrift(expectedGeneratedAt: null);
        Assert.False(SchemaDriftProjection.Project(SuccessModel(drift: absent), Localizer, Now).ExpectedCard.ShowGeneratedAt);

        var garbage = SampleDrift(expectedGeneratedAt: "not-a-date");
        Assert.False(SchemaDriftProjection.Project(SuccessModel(drift: garbage), Localizer, Now).ExpectedCard.ShowGeneratedAt);
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Snapshot_parse_reads_drift_and_is_different()
    {
        using var doc = JsonDocument.Parse(
            "{\"drift\":{\"has_drift\":true,\"current\":{\"sha256\":\"aa\",\"table_count\":10,\"column_count\":20,\"index_count\":5}," +
            "\"expected\":{\"sha256\":\"bb\",\"table_count\":9,\"column_count\":19,\"index_count\":5}," +
            "\"table_count_delta\":1,\"column_count_delta\":1,\"index_count_delta\":0,\"expected_generated_at\":\"2026-06-01T00:00:00Z\"}," +
            "\"is_different\":true}");

        var snapshot = SchemaDriftSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        Assert.True(snapshot.IsDifferent);
        Assert.True(snapshot.Drift.HasDrift);
        Assert.Equal("aa", snapshot.Drift.Current.Sha256);
        Assert.Equal(10, snapshot.Drift.Current.TableCount);
        Assert.Equal(9, snapshot.Drift.Expected.TableCount);
        Assert.Equal(1, snapshot.Drift.TableCountDelta);
        Assert.Equal("2026-06-01T00:00:00Z", snapshot.Drift.ExpectedGeneratedAt);
    }

    [Fact]
    public void Snapshot_parse_treats_missing_drift_as_empty()
    {
        using var noDrift = JsonDocument.Parse("{\"is_different\":false}");
        Assert.False(SchemaDriftSnapshot.FromJson(noDrift.RootElement).HasData);

        using var notObject = JsonDocument.Parse("null");
        Assert.False(SchemaDriftSnapshot.FromJson(notObject.RootElement).HasData);
    }

    [Fact]
    public void Drift_parse_is_tolerant_of_partial_fingerprints()
    {
        using var partial = JsonDocument.Parse("{\"has_drift\":true,\"current\":{\"table_count\":3}}");
        var drift = SchemaDrift.FromJson(partial.RootElement);

        Assert.True(drift.HasDrift);
        Assert.Equal(3, drift.Current.TableCount);
        Assert.Equal(string.Empty, drift.Current.Sha256);
        Assert.Equal(0, drift.Current.ColumnCount);
        Assert.Equal(SchemaFingerprint.Empty, drift.Expected);
        Assert.Null(drift.ExpectedGeneratedAt);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_drift_into_the_success_state()
    {
        var feed = new FakeFeed(new SchemaDriftSnapshot(true, SampleDrift(), true));
        using var vm = new SchemaDriftPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SchemaDriftState.Success, vm.State);
        Assert.True(vm.Display.ShowSummary);
        Assert.True(vm.Display.ShowDetails);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new SchemaDriftPageViewModel(EmptySchemaDriftFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SchemaDriftState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_generic_error_state()
    {
        using var vm = new SchemaDriftPageViewModel(new ThrowingFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SchemaDriftState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.False(vm.Display.ShowSubsystemUnavailable);
        Assert.Contains("Failed to load data", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_http_503_is_the_subsystem_unavailable_branch()
    {
        using var vm = new SchemaDriftPageViewModel(new SubsystemMissingFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SchemaDriftState.Error, vm.State);
        Assert.True(vm.Display.ShowSubsystemUnavailable);
        Assert.False(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeFeed(new SchemaDriftSnapshot(true, SampleDrift(), true));
        using var vm = new SchemaDriftPageViewModel(feed, Localizer, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web useSchemaDrift) --------------------------------

    [Fact]
    public async Task ClientFeed_sends_the_observability_operation_with_no_params()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"drift\":{\"has_drift\":false},\"is_different\":false}"));
        var feed = new SchemaDriftClientFeed(api);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_admin_observability_schema_drift", request.OperationId);
        Assert.Null(request.Query);
        Assert.Null(request.PathParams);
        Assert.Null(request.Body);
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception_for_the_subsystem_branch()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("not configured", 503));
        var feed = new SchemaDriftClientFeed(api);

        var ex = await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
        Assert.Equal(503, ex.StatusCode);
    }

    // ---- Diagnostics ---------------------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new SchemaDriftDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SchemaDriftPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operation()
    {
        Assert.Equal("SchemaDrift", SchemaDriftRegistration.RouteName);
        Assert.Equal("get_api_v1_admin_observability_schema_drift", SchemaDriftRegistration.Operation);
        Assert.Equal("Schema Drift", SchemaDriftRegistration.Title(Localizer));
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

    private sealed class FakeFeed : ISchemaDriftFeed
    {
        private readonly SchemaDriftSnapshot _snapshot;

        public FakeFeed(SchemaDriftSnapshot snapshot) => _snapshot = snapshot;

        public int FetchCount { get; private set; }

        public Task<SchemaDriftSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(_snapshot);
        }
    }

    private sealed class ThrowingFeed : ISchemaDriftFeed
    {
        public Task<SchemaDriftSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");
    }

    private sealed class SubsystemMissingFeed : ISchemaDriftFeed
    {
        public Task<SchemaDriftSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("schema-drift subsystem not configured", 503);
    }
}
