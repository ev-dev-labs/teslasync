using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the Total-Cost-of-Ownership narration surface's UI-thread-free logic — the
/// registration metadata + AI feature-registry membership, the PII-safe diagnostics, the shared SSE frame parser
/// the surface streams through (the native port of useAiStream's parseSSEFrame/toTypedEvent), and the view-model's
/// gate / canStart / empty-hint / stream lifecycle state machine (idle → streaming → done / error, duplicate-start
/// no-op, cancel → idle, offline classification). Mirrors the web spec
/// (web/src/components/ai/AITCONarration.tsx + AIFeatureCard.tsx + useAiStream.ts). The WinUI view
/// (shared-surfaces/AITCONarration.cs) is exercised by the app build.
/// </summary>
public sealed class AITCONarrationTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration + registry membership ───────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AITCONarration", AITCONarrationRegistration.Slug);

    [Fact]
    public void Feature_id_is_present_in_the_canonical_registry()
    {
        Assert.True(AITCONarrationRegistration.IsRegisteredFeature(AITCONarrationRegistration.FeatureId));
        Assert.Contains(AiFeatureRegistry.Features, m => m.Id == AITCONarrationRegistration.FeatureId);
    }

    [Fact]
    public void Feature_id_is_the_web_slug() =>
        Assert.Equal("tco-narration", AITCONarrationRegistration.FeatureId);

    [Fact]
    public void Root_automation_id_matches_the_web_off_mode_test_id() =>
        Assert.Equal("ai-feature-tco-narration-root", AITCONarrationRegistration.RootAutomationId);

    [Fact]
    public void Unknown_feature_id_is_not_registered() =>
        Assert.False(AITCONarrationRegistration.IsRegisteredFeature("not-a-real-feature"));

    [Fact]
    public void Narrate_path_is_the_web_endpoint_without_the_version_prefix() =>
        Assert.Equal("/ai/analytics/tco/narrate", AITCONarrationRegistration.NarratePath);

    // ── diagnostics: view.opened, PII-safe ───────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AITCONarrationDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AITCONarration", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AITCONarrationDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── shared SSE parser (web parseSSEFrame / toTypedEvent) the TCO stream rides on ─────────────────────

    [Fact]
    public void Parser_reads_a_delta_frame()
    {
        var ev = AiNarrationSseParser.ParseFrame("event: delta\ndata: {\"text\":\"Your EV \"}");

        Assert.NotNull(ev);
        Assert.Equal(AiNarrationEventKind.Delta, ev!.Kind);
        Assert.Equal("Your EV ", ev.Text);
    }

    [Fact]
    public void Parser_reads_a_done_frame()
    {
        var ev = AiNarrationSseParser.ParseFrame("event: done\ndata: {\"finish_reason\":\"stop\",\"usage\":{\"in\":1,\"out\":2}}");

        Assert.NotNull(ev);
        Assert.Equal(AiNarrationEventKind.Done, ev!.Kind);
    }

    [Fact]
    public void Parser_reads_an_error_frame_with_its_message()
    {
        var ev = AiNarrationSseParser.ParseFrame("event: error\ndata: {\"message\":\"rate_limited\"}");

        Assert.NotNull(ev);
        Assert.Equal(AiNarrationEventKind.Error, ev!.Kind);
        Assert.Equal("rate_limited", ev.Message);
    }

    [Theory]
    [InlineData("event: delta\ndata: not-json")]
    [InlineData("data: {\"text\":\"x\"}")] // no event line
    [InlineData("event: mystery\ndata: {\"text\":\"x\"}")] // unknown event type
    public void Parser_returns_null_for_malformed_or_unknown_frames(string frame) =>
        Assert.Null(AiNarrationSseParser.ParseFrame(frame));

    // ── view-model: gate (web withAiFeature / useAiEnabled) ──────────────────────────────────────────────

    [Fact]
    public void Gate_off_keeps_the_surface_closed()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.Off, vehicleId: 7);

        Assert.False(vm.IsGateOpen);
    }

    [Fact]
    public void Gate_on_opens_the_surface()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7);

        Assert.True(vm.IsGateOpen);
    }

    // ── view-model: initial state + canStart (web haveInputs) + empty hint (web emptyHint) ───────────────

    [Fact]
    public void Initial_state_is_idle_with_no_output()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7);

        Assert.Equal(AiNarrationStreamState.Idle, vm.State);
        Assert.Equal(string.Empty, vm.NarrationText);
        Assert.False(vm.HasOutput);
        Assert.False(vm.IsThinking);
        Assert.False(vm.IsError);
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData(0L, false)]
    [InlineData(-3L, false)]
    [InlineData(7L, true)]
    public void CanStart_requires_a_positive_vehicle_id(long? vehicleId, bool expected)
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId);

        Assert.Equal(expected, vm.CanStart);
        Assert.Equal(expected, vm.IsActionEnabled);
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData(0L, true)]
    [InlineData(7L, false)]
    public void Empty_hint_shows_only_while_no_vehicle_is_in_scope(long? vehicleId, bool expectedHint)
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId);

        Assert.Equal(expectedHint, vm.ShowNoVehicleHint);
        Assert.Equal("Pick a vehicle above to enable Helix.", vm.NoVehicleHint);
    }

    [Fact]
    public void Setting_vehicle_id_reevaluates_can_start_and_hides_the_hint()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: null);
        Assert.False(vm.CanStart);
        Assert.True(vm.ShowNoVehicleHint);

        var hintChanged = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.ShowNoVehicleHint))
            {
                hintChanged = true;
            }
        };

        vm.VehicleId = 42;

        Assert.True(vm.CanStart);
        Assert.True(vm.IsActionEnabled);
        Assert.False(vm.ShowNoVehicleHint);
        Assert.True(hintChanged);
    }

    // ── view-model: stream lifecycle (web useAiStream) ───────────────────────────────────────────────────

    [Fact]
    public async Task Start_streams_deltas_into_text_then_completes_done()
    {
        var transport = new FakeNarrationTransport(
            AiNarrationStreamEvent.Delta("Your EV cost "),
            AiNarrationStreamEvent.Delta("$42 this month."),
            AiNarrationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);
        bool thinkingAtStreamStart = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.State) && vm.State == AiNarrationStreamState.Streaming)
            {
                thinkingAtStreamStart = vm.IsThinking;
            }
        };

        await vm.StartAsync();

        Assert.Equal("Your EV cost $42 this month.", vm.NarrationText);
        Assert.Equal(AiNarrationStreamState.Done, vm.State);
        Assert.True(thinkingAtStreamStart);
        Assert.False(vm.IsThinking);
        Assert.Equal(1, transport.OpenCount);
        Assert.Equal(7, transport.LastRequest?.VehicleId);
    }

    [Fact]
    public async Task Start_marks_done_when_the_stream_closes_without_a_terminal_event()
    {
        var transport = new FakeNarrationTransport(AiNarrationStreamEvent.Delta("partial"));
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiNarrationStreamState.Done, vm.State);
        Assert.Equal("partial", vm.NarrationText);
    }

    [Fact]
    public async Task Start_is_a_no_op_without_a_resolved_vehicle()
    {
        var transport = new FakeNarrationTransport(AiNarrationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: null, transport);

        await vm.StartAsync();

        Assert.Equal(AiNarrationStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_when_the_gate_is_closed()
    {
        var transport = new FakeNarrationTransport(AiNarrationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.Off, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiNarrationStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Duplicate_start_while_streaming_is_a_no_op()
    {
        var transport = new FakeNarrationTransport { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        var first = vm.StartAsync();
        var second = vm.StartAsync();

        await second; // the second call returns immediately without opening a second stream.
        Assert.Equal(AiNarrationStreamState.Streaming, vm.State);
        Assert.Equal(1, transport.OpenCount);

        vm.Cancel();
        await first;
    }

    [Fact]
    public async Task Error_frame_moves_to_the_error_surface_with_the_helix_message()
    {
        var transport = new FakeNarrationTransport(
            AiNarrationStreamEvent.Error("rate_limited", AiNarrationErrorReason.Stream));
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiNarrationStreamState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.IsOffline);
        Assert.Equal("Helix error: rate_limited", vm.DisplayErrorText);
    }

    [Fact]
    public async Task Network_failure_shows_the_offline_message()
    {
        var transport = new FakeNarrationTransport(
            AiNarrationStreamEvent.Error("stream_network", AiNarrationErrorReason.Network));
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiNarrationStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        Assert.Equal(AITCONarrationRegistration.OfflineFallback, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Confirm_request_frame_pauses_the_stream()
    {
        var transport = new FakeNarrationTransport(AiNarrationStreamEvent.ConfirmRequest());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiNarrationStreamState.PausedConfirm, vm.State);
    }

    [Fact]
    public async Task Cancel_returns_an_in_flight_stream_to_idle()
    {
        var transport = new FakeNarrationTransport(AiNarrationStreamEvent.Delta("started")) { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        var run = vm.StartAsync();
        vm.Cancel();
        await run;

        Assert.Equal(AiNarrationStreamState.Idle, vm.State);
    }

    [Fact]
    public async Task Error_then_retry_clears_the_prior_error()
    {
        var transport = new FakeNarrationTransport(
            AiNarrationStreamEvent.Error("boom", AiNarrationErrorReason.Stream));
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);
        await vm.StartAsync();
        Assert.Equal(AiNarrationStreamState.Error, vm.State);

        transport.Reset(AiNarrationStreamEvent.Delta("recovered"), AiNarrationStreamEvent.Done());
        await vm.StartAsync();

        Assert.Equal(AiNarrationStreamState.Done, vm.State);
        Assert.Equal("recovered", vm.NarrationText);
        Assert.False(vm.IsError);
    }

    // ── view-model: i18n + accessibility labels ──────────────────────────────────────────────────────────

    [Fact]
    public void Labels_resolve_to_the_web_fallback_copy()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7);

        Assert.Equal("Explain my total cost of ownership", vm.Title);
        Assert.Equal("Explain ownership cost", vm.ButtonLabel);
        Assert.Equal("Helix", vm.BadgeLabel);
        Assert.Equal("Ask Helix", vm.AskHelixLabel);
        Assert.Equal("Pick a vehicle above to enable Helix.", vm.NoVehicleHint);
        Assert.Contains("operating-cost", vm.Description, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("cumulative savings", vm.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Action_label_flips_to_the_thinking_copy_while_streaming()
    {
        var transport = new FakeNarrationTransport { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        Assert.Equal("Ask Helix", vm.ActionLabel);

        var run = vm.StartAsync();
        Assert.Equal("Helix is thinking\u2026", vm.ActionLabel);

        vm.Cancel();
        await run;
    }

    [Fact]
    public void Action_automation_name_composes_the_helix_cta_and_verb()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7);

        Assert.Equal("Ask Helix \u00b7 Explain ownership cost", vm.ActionAutomationName);
    }

    private static AITCONarrationViewModel NewViewModel(
        IAiFeatureGate gate,
        long? vehicleId,
        IAiNarrationStreamTransport? transport = null) =>
        new(transport ?? new FakeNarrationTransport(), gate, Localizer, vehicleId);

    /// <summary>
    /// A scripted <see cref="IAiNarrationStreamTransport"/> for headless lifecycle tests: yields a fixed event
    /// sequence and (optionally) holds the stream open afterwards so cancel / duplicate-start paths are
    /// exercised deterministically. Records the open count and the last request body.
    /// </summary>
    private sealed class FakeNarrationTransport : IAiNarrationStreamTransport
    {
        private AiNarrationStreamEvent[] _events;
        private int _openCount;

        public FakeNarrationTransport(params AiNarrationStreamEvent[] events) => _events = events;

        /// <summary>When true the stream stays open after the scripted events until cancelled.</summary>
        public bool HoldOpen { get; init; }

        public int OpenCount => Volatile.Read(ref _openCount);

        public AiNarrationRequest? LastRequest { get; private set; }

        public void Reset(params AiNarrationStreamEvent[] events) => _events = events;

        public async IAsyncEnumerable<AiNarrationStreamEvent> StreamAsync(
            AiNarrationRequest request,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _openCount);
            LastRequest = request;

            foreach (var ev in _events)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return ev;
            }

            if (HoldOpen)
            {
                await Task.Delay(Timeout.Infinite, cancellationToken).ConfigureAwait(false);
            }
        }
    }
}
