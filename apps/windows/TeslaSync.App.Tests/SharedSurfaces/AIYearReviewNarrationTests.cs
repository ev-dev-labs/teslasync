using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the year-in-review narration surface's UI-thread-free logic — the registration
/// metadata + AI feature-registry membership, the PII-safe diagnostics, the shared SSE frame parser the surface
/// streams through (the native port of useAiStream's parseSSEFrame/toTypedEvent), the <c>{ vehicle_id, year }</c>
/// request-body projection, and the view-model's gate / canStart / stream lifecycle state machine (idle →
/// streaming → done / error, duplicate-start no-op, cancel → idle, offline classification). Mirrors the web spec
/// (web/src/components/ai/AIYearReviewNarration.tsx + AIFeatureCard.tsx + useAiStream.ts). The defining parity
/// difference from the TCO sibling is reproduced here: <c>canStart={vehicleId != null}</c> enables on ANY
/// resolved id (including 0 / negative), and the card passes no empty-state hint. The WinUI view
/// (shared-surfaces/AIYearReviewNarration.cs) is exercised by the app build.
/// </summary>
public sealed class AIYearReviewNarrationTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration + registry membership ───────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AIYearReviewNarration", AIYearReviewNarrationRegistration.Slug);

    [Fact]
    public void Feature_id_is_present_in_the_canonical_registry()
    {
        Assert.True(AIYearReviewNarrationRegistration.IsRegisteredFeature(AIYearReviewNarrationRegistration.FeatureId));
        Assert.Contains(AiFeatureRegistry.Features, m => m.Id == AIYearReviewNarrationRegistration.FeatureId);
    }

    [Fact]
    public void Feature_id_is_the_web_slug() =>
        Assert.Equal("yir-narration", AIYearReviewNarrationRegistration.FeatureId);

    [Fact]
    public void Root_automation_id_matches_the_web_off_mode_test_id() =>
        Assert.Equal("ai-feature-yir-narration-root", AIYearReviewNarrationRegistration.RootAutomationId);

    [Fact]
    public void Unknown_feature_id_is_not_registered() =>
        Assert.False(AIYearReviewNarrationRegistration.IsRegisteredFeature("not-a-real-feature"));

    [Fact]
    public void Narrate_path_is_the_web_endpoint_without_the_version_prefix() =>
        Assert.Equal("/ai/analytics/year-in-review/narrate", AIYearReviewNarrationRegistration.NarratePath);

    // ── diagnostics: view.opened, PII-safe ───────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AIYearReviewNarrationDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AIYearReviewNarration", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AIYearReviewNarrationDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── shared SSE parser (web parseSSEFrame / toTypedEvent) the narration stream rides on ───────────────

    [Fact]
    public void Parser_reads_a_delta_frame()
    {
        var ev = AiNarrationSseParser.ParseFrame("event: delta\ndata: {\"text\":\"Your 2024 \"}");

        Assert.NotNull(ev);
        Assert.Equal(AiNarrationEventKind.Delta, ev!.Kind);
        Assert.Equal("Your 2024 ", ev.Text);
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

    // ── view-model: initial state + canStart (web canStart={vehicleId != null}) ──────────────────────────

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
    [InlineData(0L, true)]
    [InlineData(-3L, true)]
    [InlineData(7L, true)]
    public void CanStart_requires_only_a_resolved_vehicle(long? vehicleId, bool expected)
    {
        // Parity guard: unlike the TCO sibling (which needs vehicle_id > 0), the year-in-review card enables on
        // ANY resolved id — web `canStart={vehicleId != null}`.
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId);

        Assert.Equal(expected, vm.CanStart);
        Assert.Equal(expected, vm.IsActionEnabled);
    }

    [Fact]
    public void Setting_vehicle_id_reevaluates_can_start()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: null);
        Assert.False(vm.CanStart);

        var canStartChanged = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(vm.CanStart))
            {
                canStartChanged = true;
            }
        };

        vm.VehicleId = 42;

        Assert.True(vm.CanStart);
        Assert.True(vm.IsActionEnabled);
        Assert.True(canStartChanged);
    }

    // ── view-model: request-body projection (web useMemo { vehicle_id, year }) ───────────────────────────

    [Fact]
    public async Task Start_sends_vehicle_id_and_year_in_the_request_body()
    {
        var transport = new FakeYearReviewTransport(AiNarrationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport, year: 2024);

        await vm.StartAsync();

        Assert.Equal(1, transport.OpenCount);
        Assert.NotNull(transport.LastRequest);
        Assert.Equal(7, transport.LastRequest!.VehicleId);
        Assert.Equal(2024, transport.LastRequest.Year);
    }

    [Fact]
    public async Task Start_streams_for_a_zero_vehicle_id_and_sends_zero()
    {
        // canStart is true at 0 (web vehicleId != null), and the body sends vehicle_id: vehicleId ?? 0 = 0.
        var transport = new FakeYearReviewTransport(AiNarrationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 0L, transport, year: 2023);

        await vm.StartAsync();

        Assert.Equal(1, transport.OpenCount);
        Assert.Equal(0, transport.LastRequest!.VehicleId);
        Assert.Equal(2023, transport.LastRequest.Year);
        Assert.Equal(AiNarrationStreamState.Done, vm.State);
    }

    [Fact]
    public void Year_defaults_to_the_previous_calendar_year()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7);

        Assert.Equal(DateTime.Now.Year - 1, vm.Year);
    }

    [Fact]
    public void Year_can_be_overridden_at_construction()
    {
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, year: 2020);

        Assert.Equal(2020, vm.Year);
    }

    [Fact]
    public async Task Setting_year_takes_effect_on_the_next_run()
    {
        var transport = new FakeYearReviewTransport(AiNarrationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport, year: 2024);
        vm.Year = 2019;

        await vm.StartAsync();

        Assert.Equal(2019, transport.LastRequest!.Year);
    }

    // ── view-model: stream lifecycle (web useAiStream) ───────────────────────────────────────────────────

    [Fact]
    public async Task Start_streams_deltas_into_text_then_completes_done()
    {
        var transport = new FakeYearReviewTransport(
            AiNarrationStreamEvent.Delta("Your year covered "),
            AiNarrationStreamEvent.Delta("12,000 km."),
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

        Assert.Equal("Your year covered 12,000 km.", vm.NarrationText);
        Assert.Equal(AiNarrationStreamState.Done, vm.State);
        Assert.True(thinkingAtStreamStart);
        Assert.False(vm.IsThinking);
        Assert.Equal(1, transport.OpenCount);
        Assert.Equal(7, transport.LastRequest?.VehicleId);
    }

    [Fact]
    public async Task Start_marks_done_when_the_stream_closes_without_a_terminal_event()
    {
        var transport = new FakeYearReviewTransport(AiNarrationStreamEvent.Delta("partial"));
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiNarrationStreamState.Done, vm.State);
        Assert.Equal("partial", vm.NarrationText);
    }

    [Fact]
    public async Task Start_is_a_no_op_without_a_resolved_vehicle()
    {
        var transport = new FakeYearReviewTransport(AiNarrationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: null, transport);

        await vm.StartAsync();

        Assert.Equal(AiNarrationStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Start_is_a_no_op_when_the_gate_is_closed()
    {
        var transport = new FakeYearReviewTransport(AiNarrationStreamEvent.Done());
        using var vm = NewViewModel(StaticAiFeatureGate.Off, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiNarrationStreamState.Idle, vm.State);
        Assert.Equal(0, transport.OpenCount);
    }

    [Fact]
    public async Task Duplicate_start_while_streaming_is_a_no_op()
    {
        var transport = new FakeYearReviewTransport { HoldOpen = true };
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
        var transport = new FakeYearReviewTransport(
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
        var transport = new FakeYearReviewTransport(
            AiNarrationStreamEvent.Error("stream_network", AiNarrationErrorReason.Network));
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiNarrationStreamState.Error, vm.State);
        Assert.True(vm.IsOffline);
        Assert.Equal(AIYearReviewNarrationRegistration.OfflineFallback, vm.DisplayErrorText);
    }

    [Fact]
    public async Task Confirm_request_frame_pauses_the_stream()
    {
        var transport = new FakeYearReviewTransport(AiNarrationStreamEvent.ConfirmRequest());
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        await vm.StartAsync();

        Assert.Equal(AiNarrationStreamState.PausedConfirm, vm.State);
    }

    [Fact]
    public async Task Cancel_returns_an_in_flight_stream_to_idle()
    {
        var transport = new FakeYearReviewTransport(AiNarrationStreamEvent.Delta("started")) { HoldOpen = true };
        using var vm = NewViewModel(StaticAiFeatureGate.On, vehicleId: 7, transport);

        var run = vm.StartAsync();
        vm.Cancel();
        await run;

        Assert.Equal(AiNarrationStreamState.Idle, vm.State);
    }

    [Fact]
    public async Task Error_then_retry_clears_the_prior_error()
    {
        var transport = new FakeYearReviewTransport(
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

        Assert.Equal("Helix narration", vm.Title);
        Assert.Equal("Generate narration", vm.ButtonLabel);
        Assert.Equal("Helix", vm.BadgeLabel);
        Assert.Equal("Ask Helix", vm.AskHelixLabel);
        Assert.Contains("recap of your year", vm.Description, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Action_label_flips_to_the_thinking_copy_while_streaming()
    {
        var transport = new FakeYearReviewTransport { HoldOpen = true };
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

        Assert.Equal("Ask Helix \u00b7 Generate narration", vm.ActionAutomationName);
    }

    private static AIYearReviewNarrationViewModel NewViewModel(
        IAiFeatureGate gate,
        long? vehicleId,
        IAiYearReviewNarrationStreamTransport? transport = null,
        int? year = null) =>
        new(transport ?? new FakeYearReviewTransport(), gate, Localizer, vehicleId, year);

    /// <summary>
    /// A scripted <see cref="IAiYearReviewNarrationStreamTransport"/> for headless lifecycle tests: yields a fixed
    /// event sequence and (optionally) holds the stream open afterwards so cancel / duplicate-start paths are
    /// exercised deterministically. Records the open count and the last request body so the
    /// <c>{ vehicle_id, year }</c> projection is asserted.
    /// </summary>
    private sealed class FakeYearReviewTransport : IAiYearReviewNarrationStreamTransport
    {
        private AiNarrationStreamEvent[] _events;
        private int _openCount;

        public FakeYearReviewTransport(params AiNarrationStreamEvent[] events) => _events = events;

        /// <summary>When true the stream stays open after the scripted events until cancelled.</summary>
        public bool HoldOpen { get; init; }

        public int OpenCount => Volatile.Read(ref _openCount);

        public AiYearReviewNarrationRequest? LastRequest { get; private set; }

        public void Reset(params AiNarrationStreamEvent[] events) => _events = events;

        public async IAsyncEnumerable<AiNarrationStreamEvent> StreamAsync(
            AiYearReviewNarrationRequest request,
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
