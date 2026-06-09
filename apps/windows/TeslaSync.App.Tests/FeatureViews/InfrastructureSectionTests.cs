using System.Net.Http;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Infrastructure;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Infrastructure feature view's UI-thread-free logic — the descriptor catalog
/// (the five dev-tools the web section runs), the projection adapter (the web <c>JSON.stringify</c> pretty
/// printer, the <c>mutation.data.error</c> truthiness reader, the offline classification and the Narrator
/// name), the repository-backed runner (the web <c>apiFetch</c> success/<c>{ error }</c> mapping), the
/// per-tool state-holder transitions (idle / running-stale / succeeded / failed / offline), the MQTT
/// topic/message body, the section composition, the registry metadata and the diagnostics. Mirrors the web
/// spec (web/src/features/admin/components/devtools/InfrastructureSection.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class InfrastructureSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static JsonElement Json(string raw) => JsonSerializer.Deserialize<JsonElement>(raw);

    private static InfrastructureToolViewModel ToolFor(InfrastructureToolKind kind, IInfrastructureToolRunner runner) =>
        kind == InfrastructureToolKind.MqttTest
            ? new MqttTestToolViewModel(InfrastructureToolDescriptor.For(kind), runner, Localizer)
            : new InfrastructureToolViewModel(InfrastructureToolDescriptor.For(kind), runner, Localizer);

    // ---- Descriptor catalog ---------------------------------------------------------

    [Fact]
    public void Catalog_lists_the_five_tools_in_web_order()
    {
        var kinds = InfrastructureToolDescriptor.Catalog.Select(d => d.Kind).ToArray();
        Assert.Equal(
            new[]
            {
                InfrastructureToolKind.DbStats,
                InfrastructureToolKind.Migrations,
                InfrastructureToolKind.MqttTest,
                InfrastructureToolKind.EnvCheck,
                InfrastructureToolKind.Runtime,
            },
            kinds);
    }

    [Fact]
    public void Catalog_operation_ids_resolve_against_the_generated_endpoint_table()
    {
        foreach (var descriptor in InfrastructureToolDescriptor.Catalog)
        {
            Assert.Contains(GeneratedApi.ApiEndpoints.All, e => e.OperationId == descriptor.OperationId);
        }
    }

    [Fact]
    public void Only_the_mqtt_tool_requires_input()
    {
        foreach (var descriptor in InfrastructureToolDescriptor.Catalog)
        {
            Assert.Equal(descriptor.Kind == InfrastructureToolKind.MqttTest, descriptor.RequiresInput);
        }
    }

    // ---- Projection -----------------------------------------------------------------

    [Fact]
    public void PrettyJson_indents_with_newlines()
    {
        var text = InfrastructureToolProjection.PrettyJson(Json("""{"a":1,"b":[2]}"""));
        Assert.Contains("\n", text);
        Assert.Contains("\"a\": 1", text);
    }

    [Theory]
    [InlineData("""{"error":"boom"}""", true, "boom")]
    [InlineData("""{"error":""}""", false, null)]
    [InlineData("""{"error":true}""", true, null)]
    [InlineData("""{"error":false}""", false, null)]
    [InlineData("""{"error":null}""", false, null)]
    [InlineData("""{"error":0}""", false, null)]
    [InlineData("""{"error":7}""", true, null)]
    [InlineData("""{"ok":1}""", false, null)]
    [InlineData("[]", false, null)]
    public void TryReadInbandError_matches_web_truthiness(string raw, bool expected, string? expectedMessage)
    {
        var result = InfrastructureToolProjection.TryReadInbandError(Json(raw), out var message);
        Assert.Equal(expected, result);
        Assert.Equal(expectedMessage, message);
    }

    [Theory]
    [InlineData(RepositoryErrorKind.Network, true)]
    [InlineData(RepositoryErrorKind.Offline, true)]
    [InlineData(RepositoryErrorKind.Server, false)]
    [InlineData(RepositoryErrorKind.Unauthorized, false)]
    public void IsOffline_only_for_transport_faults(RepositoryErrorKind kind, bool expected) =>
        Assert.Equal(expected, InfrastructureToolProjection.IsOffline(kind));

    [Fact]
    public void StatusFor_classifies_each_outcome()
    {
        Assert.Equal(
            InfrastructureToolStatus.Succeeded,
            InfrastructureToolProjection.StatusFor(InfrastructureToolOutcome.Success(Json("""{"ok":1}"""))));
        Assert.Equal(
            InfrastructureToolStatus.Failed,
            InfrastructureToolProjection.StatusFor(InfrastructureToolOutcome.Success(Json("""{"error":"x"}"""))));
        Assert.Equal(
            InfrastructureToolStatus.Offline,
            InfrastructureToolProjection.StatusFor(InfrastructureToolOutcome.Failure("n", RepositoryErrorKind.Network)));
        Assert.Equal(
            InfrastructureToolStatus.Failed,
            InfrastructureToolProjection.StatusFor(InfrastructureToolOutcome.Failure("s", RepositoryErrorKind.Server)));
    }

    [Fact]
    public void AutomationName_joins_title_and_state_phrase() =>
        Assert.Equal(
            "Db Stats: Success",
            InfrastructureToolProjection.AutomationName("Db Stats", InfrastructureToolStatus.Succeeded, "Success"));

    // ---- Runner adapter (over the contract client) ----------------------------------

    [Fact]
    public async Task Runner_returns_success_outcome_with_the_response_body()
    {
        var api = new FakeApiClient().ReturnsValue<JsonElement>(Json("""{"ok":true}"""));
        var runner = new InfrastructureToolRunner(api);

        var outcome = await runner.RunAsync(InfrastructureToolDescriptor.For(InfrastructureToolKind.DbStats), null);

        Assert.True(outcome.Succeeded);
        Assert.NotNull(outcome.Value);
        Assert.True(outcome.Value!.Value.GetProperty("ok").GetBoolean());
    }

    [Fact]
    public async Task Runner_maps_a_500_to_a_server_failure()
    {
        var api = new FakeApiClient().Throws(new ApiException("server", 500));
        var runner = new InfrastructureToolRunner(api);

        var outcome = await runner.RunAsync(InfrastructureToolDescriptor.For(InfrastructureToolKind.EnvCheck), null);

        Assert.False(outcome.Succeeded);
        Assert.Equal(RepositoryErrorKind.Server, outcome.ErrorKind);
    }

    [Fact]
    public async Task Runner_maps_a_transport_fault_to_a_network_failure()
    {
        var api = new FakeApiClient().Throws(new HttpRequestException("offline"));
        var runner = new InfrastructureToolRunner(api);

        var outcome = await runner.RunAsync(InfrastructureToolDescriptor.For(InfrastructureToolKind.Runtime), null);

        Assert.False(outcome.Succeeded);
        Assert.Equal(RepositoryErrorKind.Network, outcome.ErrorKind);
    }

    [Fact]
    public async Task Runner_forwards_the_body_and_operation_id()
    {
        var api = new FakeApiClient().ReturnsValue<JsonElement>(Json("{}"));
        var runner = new InfrastructureToolRunner(api);
        var descriptor = InfrastructureToolDescriptor.For(InfrastructureToolKind.MqttTest);
        var body = new Dictionary<string, string> { ["topic"] = "t", ["message"] = "m" };

        await runner.RunAsync(descriptor, body);

        Assert.Single(api.Requests);
        Assert.Equal(descriptor.OperationId, api.Requests[0].OperationId);
        Assert.Same(body, api.Requests[0].Body);
    }

    // ---- View-model transitions -----------------------------------------------------

    [Fact]
    public void Tool_starts_in_the_idle_state()
    {
        var tool = ToolFor(InfrastructureToolKind.DbStats, new FakeToolRunner());

        Assert.Equal(InfrastructureToolStatus.Idle, tool.Status);
        Assert.False(tool.HasResult);
        Assert.False(tool.ShowBadge);
        Assert.False(tool.HasError);
        Assert.Equal(InfrastructureResultTone.Idle, tool.ResultTone);
        Assert.Equal("No result yet", tool.IdleMessage);
    }

    [Fact]
    public async Task Run_success_enters_the_succeeded_state()
    {
        var runner = new FakeToolRunner().Returns(InfrastructureToolOutcome.Success(Json("""{"tables":3}""")));
        var tool = ToolFor(InfrastructureToolKind.DbStats, runner);

        await tool.RunAsync();

        Assert.Equal(InfrastructureToolStatus.Succeeded, tool.Status);
        Assert.True(tool.IsSuccess);
        Assert.True(tool.HasResult);
        Assert.Contains("\"tables\": 3", tool.ResultJson!);
        Assert.True(tool.ShowBadge);
        Assert.Equal("Success", tool.BadgeText);
        Assert.Equal(StatusKind.Success, tool.BadgeStatus);
        Assert.Equal(InfrastructureResultTone.Success, tool.ResultTone);
        Assert.Null(tool.ErrorMessage);
    }

    [Fact]
    public async Task Run_with_inband_error_enters_the_failed_state_and_shows_the_server_message()
    {
        var runner = new FakeToolRunner().Returns(InfrastructureToolOutcome.Success(Json("""{"error":"bad topic"}""")));
        var tool = ToolFor(InfrastructureToolKind.Migrations, runner);

        await tool.RunAsync();

        Assert.Equal(InfrastructureToolStatus.Failed, tool.Status);
        Assert.True(tool.HasError);
        Assert.False(tool.HasResult);
        Assert.Equal("bad topic", tool.ErrorMessage);
        Assert.Equal("Failed", tool.BadgeText);
        Assert.Equal(StatusKind.Danger, tool.BadgeStatus);
        Assert.Equal(InfrastructureResultTone.Error, tool.ResultTone);
    }

    [Fact]
    public async Task Run_transport_failure_enters_the_offline_state()
    {
        var runner = new FakeToolRunner().Returns(InfrastructureToolOutcome.Failure("net", RepositoryErrorKind.Network));
        var tool = ToolFor(InfrastructureToolKind.EnvCheck, runner);

        await tool.RunAsync();

        Assert.Equal(InfrastructureToolStatus.Offline, tool.Status);
        Assert.True(tool.IsOffline);
        Assert.True(tool.HasError);
        Assert.False(string.IsNullOrEmpty(tool.ErrorMessage));
        Assert.Equal(InfrastructureResultTone.Error, tool.ResultTone);
    }

    [Fact]
    public async Task Run_server_failure_enters_the_failed_state()
    {
        var runner = new FakeToolRunner().Returns(InfrastructureToolOutcome.Failure("srv", RepositoryErrorKind.Server));
        var tool = ToolFor(InfrastructureToolKind.Runtime, runner);

        await tool.RunAsync();

        Assert.Equal(InfrastructureToolStatus.Failed, tool.Status);
        Assert.Equal(StatusKind.Danger, tool.BadgeStatus);
    }

    [Fact]
    public async Task Running_keeps_the_prior_result_visible_then_replaces_it()
    {
        var runner = new FakeToolRunner().Returns(InfrastructureToolOutcome.Success(Json("""{"v":1}""")));
        var tool = ToolFor(InfrastructureToolKind.DbStats, runner);
        await tool.RunAsync();
        Assert.Contains("\"v\": 1", tool.ResultJson!);

        runner.Gate = new TaskCompletionSource<InfrastructureToolOutcome>();
        var pending = tool.RunAsync();

        Assert.Equal(InfrastructureToolStatus.Running, tool.Status);
        Assert.True(tool.IsRunning);
        Assert.Contains("\"v\": 1", tool.ResultJson!); // stale: prior result stays visible while re-running

        runner.Gate.SetResult(InfrastructureToolOutcome.Success(Json("""{"v":2}""")));
        await pending;

        Assert.Equal(InfrastructureToolStatus.Succeeded, tool.Status);
        Assert.Contains("\"v\": 2", tool.ResultJson!);
    }

    [Fact]
    public async Task Run_increments_the_attempt_count()
    {
        var runner = new FakeToolRunner()
            .Returns(InfrastructureToolOutcome.Failure("x", RepositoryErrorKind.Server))
            .Returns(InfrastructureToolOutcome.Success(Json("{}")));
        var tool = ToolFor(InfrastructureToolKind.DbStats, runner);

        await tool.RunAsync();
        await tool.RetryAsync();

        Assert.Equal(2, tool.Attempts);
    }

    [Fact]
    public async Task Mqtt_tool_builds_the_topic_message_body()
    {
        var runner = new FakeToolRunner().Returns(InfrastructureToolOutcome.Success(Json("{}")));
        var mqtt = (MqttTestToolViewModel)ToolFor(InfrastructureToolKind.MqttTest, runner);
        mqtt.Topic = "test/topic";
        mqtt.Message = """{"key":"value"}""";

        await mqtt.RunAsync();

        var body = Assert.IsType<Dictionary<string, string>>(runner.LastBody);
        Assert.Equal("test/topic", body["topic"]);
        Assert.Equal("""{"key":"value"}""", body["message"]);
    }

    [Fact]
    public void Mqtt_tool_uses_the_send_test_button_label()
    {
        var mqtt = (MqttTestToolViewModel)ToolFor(InfrastructureToolKind.MqttTest, new FakeToolRunner());
        Assert.Equal("Send Test", mqtt.RunButtonText);
        Assert.Equal("Run", ToolFor(InfrastructureToolKind.DbStats, new FakeToolRunner()).RunButtonText);
    }

    // ---- Accessibility label presence ----------------------------------------------

    [Fact]
    public async Task Automation_name_is_present_and_titled_in_every_state()
    {
        var idle = ToolFor(InfrastructureToolKind.DbStats, new FakeToolRunner());
        Assert.Equal("Db Stats: Ready", idle.AutomationName);

        var ok = ToolFor(InfrastructureToolKind.DbStats, new FakeToolRunner().Returns(InfrastructureToolOutcome.Success(Json("{}"))));
        await ok.RunAsync();
        Assert.Equal("Db Stats: Success", ok.AutomationName);

        var failed = ToolFor(InfrastructureToolKind.DbStats, new FakeToolRunner().Returns(InfrastructureToolOutcome.Failure("e", RepositoryErrorKind.Server)));
        await failed.RunAsync();
        Assert.Equal("Db Stats: Failed", failed.AutomationName);

        var offline = ToolFor(InfrastructureToolKind.DbStats, new FakeToolRunner().Returns(InfrastructureToolOutcome.Failure("e", RepositoryErrorKind.Network)));
        await offline.RunAsync();
        Assert.Equal("Db Stats: Offline", offline.AutomationName);
    }

    [Fact]
    public void Tool_exposes_localized_title_and_description()
    {
        var tool = ToolFor(InfrastructureToolKind.DbStats, new FakeToolRunner());
        Assert.Equal("Db Stats", tool.Title);
        Assert.False(string.IsNullOrWhiteSpace(tool.Description));
    }

    [Fact]
    public void Mqtt_tool_exposes_field_labels_and_hints()
    {
        var mqtt = (MqttTestToolViewModel)ToolFor(InfrastructureToolKind.MqttTest, new FakeToolRunner());
        Assert.Equal("Topic", mqtt.TopicLabel);
        Assert.Equal("Message", mqtt.MessageLabel);
        Assert.False(string.IsNullOrEmpty(mqtt.TopicHint));
        Assert.False(string.IsNullOrEmpty(mqtt.MessageHint));
    }

    // ---- Section, registration, diagnostics ----------------------------------------

    [Fact]
    public void Section_composes_the_five_tools_in_order()
    {
        using var section = new InfrastructureSectionViewModel(new FakeToolRunner(), Localizer);

        Assert.Equal(5, section.Tools.Count);
        Assert.IsType<MqttTestToolViewModel>(section.Tools[2]);
        Assert.Equal(InfrastructureToolKind.DbStats, section.Tools[0].Descriptor.Kind);
        Assert.Equal(InfrastructureToolKind.Runtime, section.Tools[4].Descriptor.Kind);
        Assert.Equal("Infrastructure", section.Title);
    }

    [Fact]
    public void Registration_exposes_the_stable_id_and_slug()
    {
        Assert.Equal("infrastructure-section", InfrastructureSectionRegistration.Id);
        Assert.Equal("InfrastructureSection", InfrastructureSectionRegistration.Slug);
        Assert.Equal("Infrastructure", InfrastructureSectionRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        var diagnostics = new InfrastructureSectionDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=InfrastructureSection" }, lines);
    }

    private sealed class FakeToolRunner : IInfrastructureToolRunner
    {
        private readonly Queue<InfrastructureToolOutcome> _outcomes = new();

        public object? LastBody { get; private set; }

        public int Calls { get; private set; }

        public TaskCompletionSource<InfrastructureToolOutcome>? Gate { get; set; }

        public FakeToolRunner Returns(InfrastructureToolOutcome outcome)
        {
            _outcomes.Enqueue(outcome);
            return this;
        }

        public Task<InfrastructureToolOutcome> RunAsync(
            InfrastructureToolDescriptor descriptor,
            object? body,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            LastBody = body;
            if (Gate is { } gate)
            {
                return gate.Task;
            }

            return Task.FromResult(_outcomes.Dequeue());
        }
    }
}
