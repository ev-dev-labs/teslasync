using System.Net.Http;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the IncidentForm feature-view's UI-thread-free logic — the severity / status wire
/// mappings, the option / comma-list / title-validation / payload projections, the contract-client-backed
/// create source's request shape and error classification (the web <c>useCreateIncident</c> adapter), the
/// state-holder view-model's per-state flows (idle / title-validation / submitting / success-and-close /
/// failure, plus the toast + close contract that mirrors <c>useToast</c> + <c>onClose</c>), the i18n key +
/// fallback contract that doubles as the Narrator-label source, and the PII-safe diagnostics. Mirrors the web
/// spec (web/src/features/system/components/status/IncidentForm.tsx + web/src/api/hooks/useIncidents.ts). The
/// WinUI view itself (IncidentForm.cs) is exercised by the app build.
/// </summary>
public sealed class IncidentFormTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Wire mappings (web severity / status unions) ─────────────────────────────────────────────────────

    [Theory]
    [InlineData(IncidentSeverity.Minor, "minor")]
    [InlineData(IncidentSeverity.Major, "major")]
    [InlineData(IncidentSeverity.Critical, "critical")]
    public void Severity_round_trips_through_wire(IncidentSeverity severity, string wire)
    {
        Assert.Equal(wire, IncidentSeverities.ToWire(severity));
        Assert.True(IncidentSeverities.TryFromWire(wire, out var parsed));
        Assert.Equal(severity, parsed);
    }

    [Theory]
    [InlineData(IncidentStatus.Investigating, "investigating")]
    [InlineData(IncidentStatus.Identified, "identified")]
    [InlineData(IncidentStatus.Monitoring, "monitoring")]
    [InlineData(IncidentStatus.Resolved, "resolved")]
    public void Status_round_trips_through_wire(IncidentStatus status, string wire)
    {
        Assert.Equal(wire, IncidentStatuses.ToWire(status));
        Assert.True(IncidentStatuses.TryFromWire(wire, out var parsed));
        Assert.Equal(status, parsed);
    }

    [Fact]
    public void Wire_from_unknown_token_is_false_and_defaults()
    {
        Assert.False(IncidentSeverities.TryFromWire("nope", out var severity));
        Assert.Equal(IncidentSeverity.Minor, severity);
        Assert.False(IncidentStatuses.TryFromWire(null, out var status));
        Assert.Equal(IncidentStatus.Investigating, status);
    }

    // ── Projection: options ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void SeverityOptions_are_the_three_values_in_web_order_with_labels()
    {
        var options = IncidentFormProjection.SeverityOptions(Localizer);

        Assert.Equal(
            [IncidentSeverity.Minor, IncidentSeverity.Major, IncidentSeverity.Critical],
            options.Select(o => o.Value).ToArray());
        Assert.Equal(["Minor", "Major", "Critical"], options.Select(o => o.Label).ToArray());
    }

    [Fact]
    public void StatusOptions_are_the_four_values_in_web_order_with_labels()
    {
        var options = IncidentFormProjection.StatusOptions(Localizer);

        Assert.Equal(
            [IncidentStatus.Investigating, IncidentStatus.Identified, IncidentStatus.Monitoring, IncidentStatus.Resolved],
            options.Select(o => o.Value).ToArray());
        Assert.Equal(
            ["Investigating", "Identified", "Monitoring", "Resolved"],
            options.Select(o => o.Label).ToArray());
    }

    // ── Projection: comma-list parsing (web split/trim/filter) ───────────────────────────────────────────

    [Theory]
    [InlineData("", new string[0])]
    [InlineData("   ", new string[0])]
    [InlineData("tesla", new[] { "tesla" })]
    [InlineData("tesla, telemetry", new[] { "tesla", "telemetry" })]
    [InlineData(" tesla ,, telemetry , ", new[] { "tesla", "telemetry" })]
    public void ParseComponents_splits_trims_and_filters(string input, string[] expected)
    {
        Assert.Equal(expected, IncidentFormProjection.ParseComponents(input).ToArray());
    }

    [Fact]
    public void ParseComponents_of_null_is_empty() =>
        Assert.Empty(IncidentFormProjection.ParseComponents(null));

    // ── Projection: title validation (web t.length < 3) ──────────────────────────────────────────────────

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("ab", false)]
    [InlineData("  ab  ", false)]
    [InlineData("abc", true)]
    [InlineData("  abc  ", true)]
    public void IsTitleValid_enforces_the_three_char_minimum(string? title, bool valid) =>
        Assert.Equal(valid, IncidentFormProjection.IsTitleValid(title));

    [Fact]
    public void NormalizeTitle_trims() => Assert.Equal("hi", IncidentFormProjection.NormalizeTitle("  hi  "));

    // ── Projection: payload assembly (web create.mutateAsync object) ─────────────────────────────────────

    [Fact]
    public void BuildRequest_trims_title_maps_wire_and_parses_components()
    {
        var request = IncidentFormProjection.BuildRequest(
            "  Wall connector restart  ",
            IncidentSeverity.Major,
            IncidentStatus.Identified,
            "tesla, telemetry",
            "  Investigating now  ");

        Assert.Equal("Wall connector restart", request.Title);
        Assert.Equal("major", request.Severity);
        Assert.Equal("identified", request.Status);
        Assert.Equal(["tesla", "telemetry"], request.AffectedComponents.ToArray());
        Assert.Equal("Investigating now", request.InitialMessage);
    }

    [Fact]
    public void BuildRequest_omits_initial_message_when_blank()
    {
        var request = IncidentFormProjection.BuildRequest("Outage", IncidentSeverity.Minor, IncidentStatus.Investigating, "", "   ");

        Assert.Null(request.InitialMessage);
        Assert.Empty(request.AffectedComponents);
    }

    [Fact]
    public void Request_serializes_to_the_web_wire_shape_with_message()
    {
        var request = IncidentFormProjection.BuildRequest(
            "Disk full", IncidentSeverity.Major, IncidentStatus.Identified, "tesla, telemetry", "Investigating");

        Assert.Equal(
            """{"title":"Disk full","severity":"major","status":"identified","affected_components":["tesla","telemetry"],"initial_message":"Investigating"}""",
            Serialize(request));
    }

    [Fact]
    public void Request_serializes_without_initial_message_when_blank()
    {
        var request = IncidentFormProjection.BuildRequest(
            "Disk full", IncidentSeverity.Minor, IncidentStatus.Investigating, "", "");

        Assert.Equal(
            """{"title":"Disk full","severity":"minor","status":"investigating","affected_components":[]}""",
            Serialize(request));
    }

    // ── Adapter: POST /status/incidents request shape + classification ───────────────────────────────────

    [Fact]
    public async Task CreateAsync_posts_the_create_operation_and_body()
    {
        var api = new FakeApiClient { Response = """{"id":1,"title":"Disk full"}""" };
        var source = new IncidentCreateSource(api);
        var request = IncidentFormProjection.BuildRequest(
            "Disk full", IncidentSeverity.Major, IncidentStatus.Identified, "tesla", "Looking into it");

        var outcome = await source.CreateAsync(request);

        Assert.True(outcome.Success);
        Assert.Null(outcome.Error);
        Assert.NotNull(api.Last);
        Assert.Equal("post_api_v1_status_incidents", api.Last!.OperationId);
        Assert.Equal(
            """{"title":"Disk full","severity":"major","status":"identified","affected_components":["tesla"],"initial_message":"Looking into it"}""",
            Serialize(api.Last.Body));
    }

    [Fact]
    public async Task CreateAsync_classifies_an_api_fault_without_throwing()
    {
        var api = new FakeApiClient { Failure = new ApiException("bad request", statusCode: 400) };
        var source = new IncidentCreateSource(api);

        var outcome = await source.CreateAsync(SampleRequest());

        Assert.False(outcome.Success);
        Assert.NotNull(outcome.Error);
        Assert.Equal(400, outcome.Error!.StatusCode);
    }

    [Fact]
    public async Task CreateAsync_classifies_a_network_fault_as_network()
    {
        var api = new FakeApiClient { Failure = new HttpRequestException("offline") };
        var source = new IncidentCreateSource(api);

        var outcome = await source.CreateAsync(SampleRequest());

        Assert.False(outcome.Success);
        Assert.Equal(RepositoryErrorKind.Network, outcome.Error!.Kind);
    }

    [Fact]
    public async Task CreateAsync_rejects_a_null_request() =>
        await Assert.ThrowsAsync<ArgumentNullException>(() => new IncidentCreateSource(new FakeApiClient()).CreateAsync(null!));

    // ── View-model: initial (idle) state ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Initial_state_matches_web_defaults()
    {
        var vm = new IncidentFormViewModel(new FakeCreateSource(), Localizer);

        Assert.Equal(IncidentSeverity.Minor, vm.Severity);
        Assert.Equal(IncidentStatus.Investigating, vm.Status);
        Assert.False(vm.IsSubmitting);
        Assert.False(vm.HasTitleError);
        Assert.Null(vm.TitleError);
        Assert.Equal(3, vm.SeverityOptions.Count);
        Assert.Equal(4, vm.StatusOptions.Count);
        Assert.Equal("Log incident", vm.SubmitLabel);
        Assert.Equal(200, IncidentFormRegistration.TitleMaxLength);
        Assert.Equal(4000, IncidentFormRegistration.MessageMaxLength);
    }

    // ── View-model: title-validation state ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task Submit_with_short_title_surfaces_validation_and_does_not_call_the_source()
    {
        var source = new FakeCreateSource();
        var vm = new IncidentFormViewModel(source, Localizer);
        var toasts = new List<IncidentFormToast>();
        int closes = 0;
        vm.ToastRequested += (_, t) => toasts.Add(t);
        vm.CloseRequested += (_, _) => closes++;
        vm.Title = "hi";

        bool created = await vm.SubmitAsync();

        Assert.False(created);
        Assert.Equal(0, source.Calls);
        Assert.True(vm.HasTitleError);
        Assert.Equal("Title must be at least 3 characters.", vm.TitleError);
        var toast = Assert.Single(toasts);
        Assert.True(toast.IsError);
        Assert.Equal("Title must be at least 3 characters.", toast.Message);
        Assert.Equal(0, closes);
        Assert.False(vm.IsSubmitting);
    }

    [Fact]
    public async Task Editing_the_title_clears_a_prior_validation_error()
    {
        var vm = new IncidentFormViewModel(new FakeCreateSource(), Localizer);
        vm.Title = "no";
        await vm.SubmitAsync();
        Assert.True(vm.HasTitleError);

        vm.Title = "now valid";

        Assert.False(vm.HasTitleError);
        Assert.Null(vm.TitleError);
    }

    // ── View-model: success → close ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Submit_success_logs_raises_success_toast_and_closes()
    {
        var source = new FakeCreateSource { Outcome = IncidentFormSubmitOutcome.Ok() };
        var diag = new IncidentFormDiagnostics();
        var vm = new IncidentFormViewModel(source, Localizer, diag);
        var toasts = new List<IncidentFormToast>();
        int closes = 0;
        vm.ToastRequested += (_, t) => toasts.Add(t);
        vm.CloseRequested += (_, _) => closes++;
        vm.Title = "Wall connector restart";
        vm.Severity = IncidentSeverity.Major;
        vm.Status = IncidentStatus.Identified;
        vm.Components = "tesla, telemetry";
        vm.Message = "Investigating";

        bool created = await vm.SubmitAsync();

        Assert.True(created);
        Assert.Equal(1, source.Calls);
        Assert.NotNull(source.LastRequest);
        Assert.Equal("Wall connector restart", source.LastRequest!.Title);
        Assert.Equal("major", source.LastRequest.Severity);
        Assert.Equal("identified", source.LastRequest.Status);
        Assert.Equal(["tesla", "telemetry"], source.LastRequest.AffectedComponents.ToArray());
        Assert.Equal("Investigating", source.LastRequest.InitialMessage);
        var toast = Assert.Single(toasts);
        Assert.False(toast.IsError);
        Assert.Equal("Incident logged.", toast.Message);
        Assert.Equal(1, closes);
        Assert.Equal(1, diag.IncidentsLogged);
        Assert.False(vm.IsSubmitting);
    }

    // ── View-model: failure keeps the form open ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Submit_failure_raises_error_toast_and_keeps_open()
    {
        var source = new FakeCreateSource
        {
            Outcome = IncidentFormSubmitOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "boom")),
        };
        var vm = new IncidentFormViewModel(source, Localizer);
        var toasts = new List<IncidentFormToast>();
        int closes = 0;
        vm.ToastRequested += (_, t) => toasts.Add(t);
        vm.CloseRequested += (_, _) => closes++;
        vm.Title = "Valid title";

        bool created = await vm.SubmitAsync();

        Assert.False(created);
        Assert.Equal(1, source.Calls);
        var toast = Assert.Single(toasts);
        Assert.True(toast.IsError);
        Assert.Equal("Failed to log incident", toast.Message);
        Assert.Equal(0, closes);
        Assert.False(vm.IsSubmitting);
    }

    // ── View-model: submitting (busy) state ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task SubmitLabel_reflects_the_in_flight_state()
    {
        var gate = new TaskCompletionSource<IncidentFormSubmitOutcome>();
        var source = new FakeCreateSource { Gate = gate.Task };
        var vm = new IncidentFormViewModel(source, Localizer);
        vm.Title = "Valid title";

        var submit = vm.SubmitAsync();

        Assert.True(vm.IsSubmitting);
        Assert.Equal("Logging\u2026", vm.SubmitLabel);

        gate.SetResult(IncidentFormSubmitOutcome.Ok());
        Assert.True(await submit);
        Assert.False(vm.IsSubmitting);
        Assert.Equal("Log incident", vm.SubmitLabel);
    }

    [Fact]
    public async Task Submit_is_ignored_while_already_submitting()
    {
        var gate = new TaskCompletionSource<IncidentFormSubmitOutcome>();
        var source = new FakeCreateSource { Gate = gate.Task };
        var vm = new IncidentFormViewModel(source, Localizer);
        vm.Title = "Valid title";

        var first = vm.SubmitAsync();
        bool second = await vm.SubmitAsync();

        Assert.False(second);
        gate.SetResult(IncidentFormSubmitOutcome.Ok());
        Assert.True(await first);
        Assert.Equal(1, source.Calls);
    }

    // ── View-model: cancel / close ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void RequestClose_raises_close()
    {
        var vm = new IncidentFormViewModel(new FakeCreateSource(), Localizer);
        int closes = 0;
        vm.CloseRequested += (_, _) => closes++;

        vm.RequestClose();

        Assert.Equal(1, closes);
    }

    [Fact]
    public async Task RequestClose_is_ignored_while_submitting()
    {
        var gate = new TaskCompletionSource<IncidentFormSubmitOutcome>();
        var source = new FakeCreateSource { Gate = gate.Task };
        var vm = new IncidentFormViewModel(source, Localizer);
        int closes = 0;
        vm.CloseRequested += (_, _) => closes++;
        vm.Title = "Valid title";
        var submit = vm.SubmitAsync();

        vm.RequestClose();

        Assert.Equal(0, closes);
        gate.SetResult(IncidentFormSubmitOutcome.Ok());
        await submit;
        Assert.Equal(1, closes); // the success path itself raised exactly one close
    }

    // ── Diagnostics (PII-safe, P1/S11) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void NotifyOpened_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diag = new IncidentFormDiagnostics(lines.Add);
        var vm = new IncidentFormViewModel(new FakeCreateSource(), Localizer, diag);

        vm.NotifyOpened();

        Assert.Equal(1, diag.ViewsOpened);
        Assert.Equal("view.opened slug=IncidentForm", Assert.Single(lines));
    }

    [Fact]
    public void RecordIncidentLogged_emits_slug_without_content()
    {
        var lines = new List<string>();
        var diag = new IncidentFormDiagnostics(lines.Add);

        diag.RecordIncidentLogged();

        Assert.Equal(1, diag.IncidentsLogged);
        Assert.Equal("status.incident.logged slug=IncidentForm", Assert.Single(lines));
    }

    // ── i18n key + fallback contract (the Narrator-label source) ─────────────────────────────────────────

    [Fact]
    public void Every_label_routes_through_a_status_incidents_key()
    {
        var recorder = new RecordingLocalizer();

        ReadAllLabels(recorder);

        Assert.NotEmpty(recorder.Keys);
        Assert.All(recorder.Keys, key => Assert.StartsWith("status.incidents.", key, StringComparison.Ordinal));
    }

    [Fact]
    public void English_fallbacks_match_the_web_literals()
    {
        Assert.Equal("Log an incident", IncidentFormRegistration.ModalTitle(Localizer));
        Assert.Equal("Title", IncidentFormRegistration.TitleLabel(Localizer));
        Assert.Equal("Severity", IncidentFormRegistration.SeverityLabel(Localizer));
        Assert.Equal("Status", IncidentFormRegistration.StatusLabel(Localizer));
        Assert.Equal("Affected components", IncidentFormRegistration.ComponentsLabel(Localizer));
        Assert.Equal("(comma-separated, optional)", IncidentFormRegistration.ComponentsHint(Localizer));
        Assert.Equal("Initial timeline message", IncidentFormRegistration.MessageLabel(Localizer));
        Assert.Equal("(optional)", IncidentFormRegistration.MessageHint(Localizer));
        Assert.Equal("Cancel", IncidentFormRegistration.CancelLabel(Localizer));
        Assert.Equal("Log incident", IncidentFormRegistration.SubmitLabel(Localizer));
        Assert.Equal("Logging\u2026", IncidentFormRegistration.SubmittingLabel(Localizer));
        Assert.Equal("Title must be at least 3 characters.", IncidentFormRegistration.TitleTooShortMessage(Localizer));
        Assert.Equal("Incident logged.", IncidentFormRegistration.SuccessMessage(Localizer));
        Assert.Equal("Failed to log incident", IncidentFormRegistration.ErrorMessage(Localizer));
    }

    private static void ReadAllLabels(ILocalizer localizer)
    {
        _ = IncidentFormRegistration.ModalTitle(localizer);
        _ = IncidentFormRegistration.TitleLabel(localizer);
        _ = IncidentFormRegistration.TitlePrompt(localizer);
        _ = IncidentFormRegistration.SeverityLabel(localizer);
        _ = IncidentFormRegistration.StatusLabel(localizer);
        _ = IncidentFormRegistration.ComponentsLabel(localizer);
        _ = IncidentFormRegistration.ComponentsHint(localizer);
        _ = IncidentFormRegistration.ComponentsPrompt(localizer);
        _ = IncidentFormRegistration.MessageLabel(localizer);
        _ = IncidentFormRegistration.MessageHint(localizer);
        _ = IncidentFormRegistration.MessagePrompt(localizer);
        _ = IncidentFormRegistration.CancelLabel(localizer);
        _ = IncidentFormRegistration.SubmitLabel(localizer);
        _ = IncidentFormRegistration.SubmittingLabel(localizer);
        _ = IncidentFormRegistration.TitleTooShortMessage(localizer);
        _ = IncidentFormRegistration.SuccessMessage(localizer);
        _ = IncidentFormRegistration.ErrorMessage(localizer);
        _ = IncidentFormProjection.SeverityOptions(localizer);
        _ = IncidentFormProjection.StatusOptions(localizer);
    }

    private static IncidentCreateRequest SampleRequest() =>
        IncidentFormProjection.BuildRequest("Sample", IncidentSeverity.Minor, IncidentStatus.Investigating, "", null);

    private static string Serialize(object? body)
    {
        Assert.NotNull(body);
        return JsonSerializer.Serialize(body, body!.GetType());
    }

    private sealed class FakeCreateSource : IIncidentCreateSource
    {
        public int Calls { get; private set; }

        public IncidentCreateRequest? LastRequest { get; private set; }

        public IncidentFormSubmitOutcome Outcome { get; set; } = IncidentFormSubmitOutcome.Ok();

        public Task<IncidentFormSubmitOutcome>? Gate { get; set; }

        public async Task<IncidentFormSubmitOutcome> CreateAsync(
            IncidentCreateRequest request,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            LastRequest = request;
            if (Gate is { } gate)
            {
                return await gate.ConfigureAwait(false);
            }

            return Outcome;
        }
    }

    private sealed class FakeApiClient : IApiClient
    {
        public ApiRequest? Last { get; private set; }

        public string Response { get; set; } = "{}";

        public Exception? Failure { get; set; }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            throw new NotSupportedException();

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            Last = request;
            if (Failure is { } error)
            {
                return Task.FromException<T>(error);
            }

            using var doc = JsonDocument.Parse(Response);
            object element = doc.RootElement.Clone();
            return Task.FromResult((T)element);
        }
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
}
