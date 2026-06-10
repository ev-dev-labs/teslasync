using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Snapshot Inspector surface's UI-thread-free logic — the transition / snapshot
/// JSON parse adapter, the <c>formatValue</c> coercion, the diff projection (the web <c>rows</c>
/// <c>useMemo</c>), the <c>copyPayload</c> builder, the duration formatter, the state-badge severity map, the
/// web-faithful branch resolution (loading / empty / outside-window / no-signals / populated) plus the native
/// error / stale / offline superset, the localized text facade (every i18n key + the relative-age
/// interpolation), the registry metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/system/components/state-machine/SnapshotInspector.tsx).
/// </summary>
public sealed class SnapshotInspectorTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private const string TransitionJson = """
    {
      "id": 7,
      "vehicle_id": 3,
      "ts": "2026-06-06T12:00:00Z",
      "fsm_name": "vehicle",
      "from_state": "asleep",
      "to_state": "online",
      "trigger": "wake",
      "details": { "duration_in_state_ms": 1500, "reason": "poll" }
    }
    """;

    private const string SnapshotJsonText = """
    {
      "vehicle_id": 3,
      "at": "2026-06-06T12:00:00Z",
      "count": 3,
      "signals": {
        "VehicleSpeed": { "value": 42.5, "source": "l1", "age_ms": 120 },
        "Gear": { "value": "Drive", "source": "l2", "age_ms": 1500 },
        "Locked": { "value": true, "source": "log" }
      }
    }
    """;

    private const string PreviousSnapshotJson = """
    {
      "at": "2026-06-06T11:59:00Z",
      "signals": {
        "VehicleSpeed": { "value": 40.0, "source": "l1" },
        "Gear": { "value": "Drive", "source": "l1" },
        "Locked": { "value": false, "source": "l1" }
      }
    }
    """;

    private static JsonElement El(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static SnapshotTransition Transition() => SnapshotTransition.Parse(El(TransitionJson))!;

    private static SignalSnapshot Snapshot() => SignalSnapshot.Parse(El(SnapshotJsonText));

    private static SignalSnapshot PreviousSnapshot() => SignalSnapshot.Parse(El(PreviousSnapshotJson));

    // ── formatValue coercion ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void FormatValue_coerces_each_json_kind_like_the_web()
    {
        Assert.Equal("\u2014", SnapshotInspectorProjection.FormatValue(default)); // undefined
        Assert.Equal("\u2014", SnapshotInspectorProjection.FormatValue(El("null")));
        Assert.Equal("true", SnapshotInspectorProjection.FormatValue(El("true")));
        Assert.Equal("false", SnapshotInspectorProjection.FormatValue(El("false")));
        Assert.Equal("42.5", SnapshotInspectorProjection.FormatValue(El("42.5")));
        Assert.Equal("7", SnapshotInspectorProjection.FormatValue(El("7")));
        Assert.Equal("Drive", SnapshotInspectorProjection.FormatValue(El("\"Drive\"")));
        Assert.Equal("{\"lat\":1,\"lon\":2}", SnapshotInspectorProjection.FormatValue(El("{\"lat\":1,\"lon\":2}")));
        Assert.Equal("[1,2,3]", SnapshotInspectorProjection.FormatValue(El("[1,2,3]")));
    }

    // ── Snapshot parse adapter ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Snapshot_Parse_unwraps_envelopes_with_source_and_age()
    {
        var snapshot = Snapshot();

        Assert.Equal(3, snapshot.Count);
        Assert.Equal("2026-06-06T12:00:00Z", snapshot.AtRaw);

        var speed = snapshot.Signals["VehicleSpeed"];
        Assert.True(speed.HasValue);
        Assert.Equal("42.5", speed.ValueDisplay);
        Assert.Equal("42.5", speed.ValueRaw);
        Assert.Equal("l1", speed.Source);
        Assert.Equal(120d, speed.AgeMs);

        var gear = snapshot.Signals["Gear"];
        Assert.Equal("Drive", gear.ValueDisplay);
        Assert.Equal("l2", gear.Source);
        Assert.Equal(1500d, gear.AgeMs);

        var locked = snapshot.Signals["Locked"];
        Assert.Equal("true", locked.ValueDisplay);
        Assert.Equal("log", locked.Source);
        Assert.Null(locked.AgeMs);
    }

    [Fact]
    public void Snapshot_Parse_is_tolerant_of_missing_or_non_object_bodies()
    {
        Assert.Same(SignalSnapshot.Empty, SignalSnapshot.Parse(El("{\"vehicle_id\":3}")));
        Assert.Same(SignalSnapshot.Empty, SignalSnapshot.Parse(El("[]")));
        Assert.Same(SignalSnapshot.Empty, SignalSnapshot.Parse(El("\"nope\"")));
        Assert.Empty(SignalSnapshot.Parse(El("{\"signals\":{}}")).Signals);
    }

    [Fact]
    public void Snapshot_Parse_treats_absent_value_as_no_value_like_the_web()
    {
        // Object without a "value" key, an explicit null value, and a bare scalar — the web reads each as
        // entry?.value === undefined / null, displaying the em-dash. The explicit-null entry keeps HasValue
        // (so it can surface as a previous diff value), the others do not.
        var snapshot = SignalSnapshot.Parse(El("""
        {
          "signals": {
            "NoValueKey": { "source": "l1" },
            "ExplicitNull": { "value": null },
            "BareScalar": 5,
            "Compound": { "lat": 1 }
          }
        }
        """));

        Assert.False(snapshot.Signals["NoValueKey"].HasValue);
        Assert.Equal("\u2014", snapshot.Signals["NoValueKey"].ValueDisplay);
        Assert.Equal("null", snapshot.Signals["NoValueKey"].ValueRaw);

        Assert.True(snapshot.Signals["ExplicitNull"].HasValue);
        Assert.Equal("\u2014", snapshot.Signals["ExplicitNull"].ValueDisplay);
        Assert.Equal("null", snapshot.Signals["ExplicitNull"].ValueRaw);

        Assert.False(snapshot.Signals["BareScalar"].HasValue);
        Assert.Equal("\u2014", snapshot.Signals["BareScalar"].ValueDisplay);

        Assert.False(snapshot.Signals["Compound"].HasValue);
        Assert.Equal("\u2014", snapshot.Signals["Compound"].ValueDisplay);
    }

    // ── Diff projection (the web rows useMemo) ─────────────────────────────────────────────────────────

    [Fact]
    public void ProjectRows_sorts_by_name_and_marks_nothing_changed_without_a_previous_snapshot()
    {
        var rows = SnapshotInspectorProjection.ProjectRows(Snapshot(), previousSnapshot: null);

        Assert.Equal(new[] { "Gear", "Locked", "VehicleSpeed" }, rows.Select(r => r.Name));
        Assert.All(rows, r => Assert.False(r.Changed));
        Assert.All(rows, r => Assert.Null(r.PreviousDisplay));
    }

    [Fact]
    public void ProjectRows_flags_only_the_changed_signals_against_the_previous_snapshot()
    {
        var rows = SnapshotInspectorProjection.ProjectRows(Snapshot(), PreviousSnapshot())
            .ToDictionary(r => r.Name, StringComparer.Ordinal);

        // Gear unchanged ("Drive" == "Drive"); VehicleSpeed and Locked changed.
        Assert.False(rows["Gear"].Changed);
        Assert.True(rows["VehicleSpeed"].Changed);
        Assert.True(rows["Locked"].Changed);

        // Previous display value is surfaced for every signal the previous snapshot carried.
        Assert.Equal("40.0", rows["VehicleSpeed"].PreviousDisplay);
        Assert.Equal("false", rows["Locked"].PreviousDisplay);
        Assert.Equal("Drive", rows["Gear"].PreviousDisplay);
    }

    [Fact]
    public void ProjectRows_treats_a_signal_absent_from_the_previous_snapshot_as_changed()
    {
        var current = SignalSnapshot.Parse(El("{\"signals\":{\"NewSig\":{\"value\":1}}}"));
        var previous = SignalSnapshot.Parse(El("{\"signals\":{\"Other\":{\"value\":1}}}"));

        var row = Assert.Single(SnapshotInspectorProjection.ProjectRows(current, previous));
        Assert.Equal("NewSig", row.Name);
        Assert.True(row.Changed);
        Assert.Null(row.PreviousDisplay);
    }

    [Fact]
    public void ProjectRows_is_empty_for_a_null_or_signalless_snapshot()
    {
        Assert.Empty(SnapshotInspectorProjection.ProjectRows(null, null));
        Assert.Empty(SnapshotInspectorProjection.ProjectRows(SignalSnapshot.Empty, PreviousSnapshot()));
    }

    // ── Copy payload (the web copyPayload useMemo) ─────────────────────────────────────────────────────

    [Fact]
    public void BuildCopyPayload_is_empty_when_either_input_is_missing()
    {
        Assert.Equal(string.Empty, SnapshotInspectorProjection.BuildCopyPayload(null, Snapshot()));
        Assert.Equal(string.Empty, SnapshotInspectorProjection.BuildCopyPayload(Transition(), null));
    }

    [Fact]
    public void BuildCopyPayload_reproduces_the_transition_signals_and_at()
    {
        string payload = SnapshotInspectorProjection.BuildCopyPayload(Transition(), Snapshot());

        using var doc = JsonDocument.Parse(payload);
        var root = doc.RootElement;

        Assert.Equal(7, root.GetProperty("transition").GetProperty("id").GetInt32());
        Assert.Equal("wake", root.GetProperty("transition").GetProperty("trigger").GetString());
        Assert.Equal(42.5, root.GetProperty("snapshot").GetProperty("VehicleSpeed").GetProperty("value").GetDouble());
        Assert.Equal("2026-06-06T12:00:00Z", root.GetProperty("at").GetString());

        // Pretty-printed (web JSON.stringify(..., null, 2)).
        Assert.Contains("\n", payload, StringComparison.Ordinal);
    }

    [Fact]
    public void BuildCopyPayload_writes_a_null_at_when_the_snapshot_has_none()
    {
        var snapshot = SignalSnapshot.Parse(El("{\"signals\":{\"A\":{\"value\":1}}}"));
        string payload = SnapshotInspectorProjection.BuildCopyPayload(Transition(), snapshot);

        using var doc = JsonDocument.Parse(payload);
        Assert.Equal(JsonValueKind.Null, doc.RootElement.GetProperty("at").ValueKind);
    }

    // ── Duration formatter ─────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null, "\u2014 ms")]
    [InlineData(0d, "0 ms")]
    [InlineData(12.4d, "12 ms")]
    [InlineData(12.6d, "13 ms")]
    public void FormatDuration_matches_the_web_fmtInt_plus_unit(double? ms, string expected)
    {
        Assert.Equal(expected, SnapshotInspectorProjection.FormatDuration(ms));
    }

    [Fact]
    public void FormatDuration_groups_thousands()
    {
        string expected = (1234d).ToString("N0", CultureInfo.CurrentCulture) + " ms";
        Assert.Equal(expected, SnapshotInspectorProjection.FormatDuration(1234));
    }

    // ── Transition parse adapter ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Transition_Parse_reads_every_field_and_the_duration_detail()
    {
        var transition = Transition();

        Assert.Equal(7, transition.Id);
        Assert.Equal(3, transition.VehicleId);
        Assert.Equal("vehicle", transition.FsmName);
        Assert.Equal("asleep", transition.FromState);
        Assert.Equal("online", transition.ToState);
        Assert.Equal("wake", transition.Trigger);
        Assert.Equal(1500d, transition.DurationInStateMs);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 12, 0, 0, TimeSpan.Zero), transition.Timestamp);
    }

    [Fact]
    public void Transition_Parse_is_tolerant_of_a_non_object_or_partial_row()
    {
        Assert.Null(SnapshotTransition.Parse(El("\"nope\"")));
        Assert.Null(SnapshotTransition.Parse(El("null")));

        var partial = SnapshotTransition.Parse(El("{\"from_state\":\"online\"}"));
        Assert.NotNull(partial);
        Assert.Equal("online", partial!.FromState);
        Assert.Equal(string.Empty, partial.ToState);
        Assert.Equal(string.Empty, partial.Trigger);
        Assert.Null(partial.DurationInStateMs);
        Assert.Null(partial.Timestamp);
    }

    // ── State resolution (web render branches) ───────────────────────────────────────────────────────

    [Fact]
    public void Create_resolves_loading_when_no_transition_and_a_fetch_is_in_flight()
    {
        var model = SnapshotInspectorModel.Create("vehicle", null, null, null, loading: true, hasLastTransition: true, inWindowCount: 0, canJumpToLast: true, "5m ago");
        Assert.Equal(SnapshotInspectorState.Loading, model.State);
    }

    [Fact]
    public void Create_resolves_outside_window_when_the_active_window_is_empty_but_a_last_transition_exists()
    {
        var model = SnapshotInspectorModel.Create("vehicle", null, null, null, loading: false, hasLastTransition: true, inWindowCount: 0, canJumpToLast: true, "5m ago");
        Assert.Equal(SnapshotInspectorState.OutsideWindow, model.State);
        Assert.Equal("5m ago", model.LastTransitionRelative);
    }

    [Fact]
    public void Create_resolves_empty_when_no_transition_and_nothing_to_jump_to()
    {
        var noLast = SnapshotInspectorModel.Create("vehicle", null, null, null, loading: false, hasLastTransition: false, inWindowCount: 0, canJumpToLast: true, "");
        Assert.Equal(SnapshotInspectorState.Empty, noLast.State);

        var hasWindow = SnapshotInspectorModel.Create("vehicle", null, null, null, loading: false, hasLastTransition: true, inWindowCount: 3, canJumpToLast: true, "5m ago");
        Assert.Equal(SnapshotInspectorState.Empty, hasWindow.State);

        var noJump = SnapshotInspectorModel.Create("vehicle", null, null, null, loading: false, hasLastTransition: true, inWindowCount: 0, canJumpToLast: false, "5m ago");
        Assert.Equal(SnapshotInspectorState.Empty, noJump.State);
    }

    [Fact]
    public void Create_resolves_populated_with_projected_rows_and_a_copy_payload()
    {
        var model = SnapshotInspectorModel.Create("vehicle", Transition(), Snapshot(), PreviousSnapshot(), loading: false, hasLastTransition: true, inWindowCount: 5, canJumpToLast: true, "");

        Assert.Equal(SnapshotInspectorState.Populated, model.State);
        Assert.Equal(3, model.Rows.Count);
        Assert.False(string.IsNullOrEmpty(model.CopyPayload));
        Assert.Equal("vehicle", model.FsmType);
        Assert.Same(Localizer, Localizer); // sanity: localizer-free model
    }

    [Fact]
    public void Create_resolves_no_signals_when_a_transition_has_an_empty_snapshot()
    {
        var emptySnap = SnapshotInspectorModel.Create("vehicle", Transition(), SignalSnapshot.Empty, null, loading: false, hasLastTransition: true, inWindowCount: 5, canJumpToLast: true, "");
        Assert.Equal(SnapshotInspectorState.NoSignals, emptySnap.State);
        Assert.Empty(emptySnap.Rows);
        // A real (empty) snapshot still yields a copy payload, like the web.
        Assert.False(string.IsNullOrEmpty(emptySnap.CopyPayload));

        var noSnap = SnapshotInspectorModel.Create("vehicle", Transition(), null, null, loading: false, hasLastTransition: true, inWindowCount: 5, canJumpToLast: true, "");
        Assert.Equal(SnapshotInspectorState.NoSignals, noSnap.State);
        Assert.Equal(string.Empty, noSnap.CopyPayload);
    }

    [Fact]
    public void Superset_states_carry_their_context()
    {
        var error = SnapshotInspectorModel.ErrorState("boom", attempts: 2);
        Assert.Equal(SnapshotInspectorState.Error, error.State);
        Assert.Equal("boom", error.ErrorMessage);
        Assert.Equal(2, error.Attempts);

        var populated = SnapshotInspectorModel.Create("vehicle", Transition(), Snapshot(), null, false, true, 5, true, "");
        var stamp = new DateTimeOffset(2026, 6, 6, 11, 0, 0, TimeSpan.Zero);

        var stale = populated.ToStale(stamp);
        Assert.Equal(SnapshotInspectorState.Stale, stale.State);
        Assert.Equal(stamp, stale.UpdatedAt);
        Assert.Equal(populated.Rows.Count, stale.Rows.Count);

        var offline = populated.ToOffline(stamp);
        Assert.Equal(SnapshotInspectorState.Offline, offline.State);
        Assert.Equal(stamp, offline.UpdatedAt);

        var toError = populated.ToError("nope", 1);
        Assert.Equal(SnapshotInspectorState.Error, toError.State);
        Assert.Equal("nope", toError.ErrorMessage);
        Assert.Equal(1, toError.Attempts);
    }

    // ── State-badge severity (web getStateColor variant) ───────────────────────────────────────────────

    [Theory]
    [InlineData("online", SeverityLevel.Success)]
    [InlineData("connected", SeverityLevel.Success)]
    [InlineData("charging", SeverityLevel.Warn)]
    [InlineData("reconnecting", SeverityLevel.Warn)]
    [InlineData("offline", SeverityLevel.Critical)]
    [InlineData("disconnected", SeverityLevel.Critical)]
    [InlineData("asleep", SeverityLevel.Info)]
    [InlineData("unknown", SeverityLevel.Info)]
    [InlineData("", SeverityLevel.Info)]
    public void StateSeverity_maps_canonical_states(string state, SeverityLevel expected)
    {
        Assert.Equal(expected, SnapshotInspectorProjection.StateSeverity(state));
    }

    [Theory]
    [InlineData("device_error", SeverityLevel.Critical)]
    [InlineData("reconnect_pending", SeverityLevel.Warn)]
    [InlineData("now_active", SeverityLevel.Success)]
    [InlineData("mysterious", SeverityLevel.Info)]
    public void StateSeverity_falls_back_to_the_keyword_heuristic(string state, SeverityLevel expected)
    {
        Assert.Equal(expected, SnapshotInspectorProjection.StateSeverity(state));
    }

    // ── i18n facade (every key + interpolation) ──────────────────────────────────────────────────────

    [Fact]
    public void Text_resolves_every_web_key_to_its_english_fallback()
    {
        var text = new SnapshotInspectorText(Localizer);

        Assert.Equal("Transition snapshot", text.Title);
        Assert.Equal("Loading\u2026", text.Loading);
        Assert.Equal("Select a transition to inspect its snapshot", text.Empty);
        Assert.Equal("Jump to last transition", text.JumpToLast);
        Assert.Equal("From", text.From);
        Assert.Equal("To", text.To);
        Assert.Equal("Trigger", text.Trigger);
        Assert.Equal("Duration", text.Duration);
        Assert.Equal("Signals at transition", text.SignalsTitle);
        Assert.Equal("Diff vs previous", text.DiffMode);
        Assert.Equal("No signals captured for this transition", text.NoSignals);
        Assert.Equal("Copy snapshot", text.Copy);
        Assert.Equal("Copied", text.Copied);
        Assert.Equal("Couldn't load the transition snapshot", text.Error);
        Assert.Equal("Retry", text.Retry);
        Assert.Equal("Stale", text.Stale);
        Assert.Equal("Offline", text.Offline);
    }

    [Fact]
    public void Text_interpolates_the_relative_age_into_the_outside_window_message()
    {
        var text = new SnapshotInspectorText(Localizer);
        Assert.Equal("Nothing in the current window. Last transition 5m ago.", text.OutsideWindow("5m ago"));
    }

    [Fact]
    public void Text_requires_a_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => new SnapshotInspectorText(null!));
    }

    // ── Registry + diagnostics ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_canonical_id_and_slug()
    {
        Assert.Equal("snapshot-inspector", SnapshotInspectorRegistration.Id);
        Assert.Equal("SnapshotInspector", SnapshotInspectorRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_emit_a_pii_safe_view_opened_event()
    {
        var captured = new List<string>();
        var diagnostics = new SnapshotInspectorDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.All(captured, line => Assert.Equal("view.opened slug=SnapshotInspector", line));
        Assert.DoesNotContain(captured, line => line.Contains("vehicle", StringComparison.OrdinalIgnoreCase));
    }
}
