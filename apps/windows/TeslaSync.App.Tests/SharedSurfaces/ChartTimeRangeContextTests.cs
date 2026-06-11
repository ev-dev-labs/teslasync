using System.Collections.Generic;
using System.ComponentModel;
using TeslaSync.App.SharedSurfaces.ChartTimeRangeContextSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ChartTimeRangeContext shared surface's UI-thread-free logic — the
/// <c>cursorSync.ts</c> external-store port (<see cref="CursorSyncStore"/>), the
/// <c>string | number | null</c> union (<see cref="CursorSyncValue"/>), the recharts sync-method wire
/// mapping (<see cref="ChartSyncMethods"/>), the provider/hook state holder
/// (<see cref="ChartTimeRangeProviderViewModel"/>), the outside-provider hook fallbacks
/// (<see cref="ChartSync"/>), the inert store (<see cref="NoOpCursorSyncStore"/>), the registration slug
/// and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/charts/ChartTimeRangeContext.tsx, web/src/components/charts/cursorSync.ts and their
/// tests). The bare WinUI view (ChartTimeRangeContext.cs — a transparent <see cref="AccessibilityView.Raw"/>
/// provider that returns its children unchanged and emits <c>view.opened</c> on Loaded) is exercised by the
/// app build.
///
/// Because chart cursor sync is a synchronous in-process coordination primitive (the web source reads no
/// network), the surface has no loading / error / stale / offline states; its observable states are the
/// <em>empty</em> (no chart hovered), <em>active</em> (a cursor value set) and outside-provider fallbacks,
/// all asserted below. The surface is anonymous (it renders no titles or labels), so there are no i18n keys
/// to resolve and no interactive elements to label — the only accessibility contract is the view's
/// transparency and the PII-safe diagnostics, covered here and by the app build.
/// </summary>
public sealed class ChartTimeRangeContextTests
{
    // ── registration (diagnostics slug, web anonymous component) ─────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ChartTimeRangeContext", ChartTimeRangeContextRegistration.Slug);

    // ── adapter: ChartSyncMethods (web 'index' | 'value' wire literals) ──────────────────────────────────

    [Fact]
    public void ToWire_maps_each_method_to_its_recharts_literal()
    {
        Assert.Equal("index", ChartSyncMethods.ToWire(ChartSyncMethod.Index));
        Assert.Equal("value", ChartSyncMethods.ToWire(ChartSyncMethod.Value));
    }

    [Theory]
    [InlineData("index", ChartSyncMethod.Index)]
    [InlineData("value", ChartSyncMethod.Value)]
    [InlineData("INDEX", ChartSyncMethod.Index)]
    [InlineData("Value", ChartSyncMethod.Value)]
    public void TryParse_accepts_the_recharts_literals_case_insensitively(string wire, ChartSyncMethod expected)
    {
        Assert.True(ChartSyncMethods.TryParse(wire, out ChartSyncMethod method));
        Assert.Equal(expected, method);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("nonsense")]
    public void TryParse_rejects_unknown_input_and_defaults_to_index(string? wire)
    {
        // web prop default is syncMethod = 'index'.
        Assert.False(ChartSyncMethods.TryParse(wire, out ChartSyncMethod method));
        Assert.Equal(ChartSyncMethod.Index, method);
    }

    // ── adapter: CursorSyncValue (web string | number | null union) ──────────────────────────────────────

    [Fact]
    public void None_is_the_default_and_is_none()
    {
        Assert.True(CursorSyncValue.None.IsNone);
        Assert.Equal(CursorSyncValueKind.None, CursorSyncValue.None.Kind);
        Assert.Equal(default, CursorSyncValue.None);
        Assert.Null(CursorSyncValue.None.Text);
        Assert.Null(CursorSyncValue.None.Number);
    }

    [Fact]
    public void OfText_carries_the_string_arm()
    {
        CursorSyncValue value = CursorSyncValue.OfText("12:34");

        Assert.Equal(CursorSyncValueKind.Text, value.Kind);
        Assert.False(value.IsNone);
        Assert.Equal("12:34", value.Text);
        Assert.Null(value.Number);
    }

    [Fact]
    public void OfNumber_carries_the_number_arm()
    {
        CursorSyncValue value = CursorSyncValue.OfNumber(1_717_000_000d);

        Assert.Equal(CursorSyncValueKind.Number, value.Kind);
        Assert.False(value.IsNone);
        Assert.Equal(1_717_000_000d, value.Number);
        Assert.Null(value.Text);
    }

    [Fact]
    public void OfText_rejects_null_but_allows_empty()
    {
        Assert.Throws<System.ArgumentNullException>(() => CursorSyncValue.OfText(null!));

        // web: '' ?? null === '' — an empty string is a real (non-null) label.
        CursorSyncValue empty = CursorSyncValue.OfText(string.Empty);
        Assert.False(empty.IsNone);
        Assert.Equal(string.Empty, empty.Text);
    }

    [Fact]
    public void Equality_is_by_arm_and_value()
    {
        Assert.Equal(CursorSyncValue.OfText("a"), CursorSyncValue.OfText("a"));
        Assert.Equal(CursorSyncValue.OfNumber(5d), CursorSyncValue.OfNumber(5d));
        Assert.Equal(CursorSyncValue.None, CursorSyncValue.None);

        Assert.NotEqual(CursorSyncValue.OfText("a"), CursorSyncValue.OfText("b"));
        Assert.NotEqual(CursorSyncValue.OfNumber(5d), CursorSyncValue.OfNumber(6d));
        Assert.NotEqual(CursorSyncValue.OfText("5"), CursorSyncValue.OfNumber(5d));
        Assert.NotEqual(CursorSyncValue.None, CursorSyncValue.OfNumber(0d));
    }

    [Fact]
    public void ToString_renders_each_arm()
    {
        Assert.Equal("12:34", CursorSyncValue.OfText("12:34").ToString());
        Assert.Equal("42", CursorSyncValue.OfNumber(42d).ToString());
        Assert.Equal("\u2014", CursorSyncValue.None.ToString());
    }

    // ── adapter: CursorSyncStore (web cursorSync.ts external store) ──────────────────────────────────────

    [Fact]
    public void GetPosition_defaults_to_none()
    {
        var store = new CursorSyncStore();
        Assert.Equal(CursorSyncValue.None, store.GetPosition("drive-detail"));
    }

    [Fact]
    public void SetPosition_round_trips_string_and_number_arms()
    {
        var store = new CursorSyncStore();

        store.SetPosition("a", CursorSyncValue.OfText("12:34"));
        Assert.Equal(CursorSyncValue.OfText("12:34"), store.GetPosition("a"));

        store.SetPosition("b", CursorSyncValue.OfNumber(42d));
        Assert.Equal(CursorSyncValue.OfNumber(42d), store.GetPosition("b"));
    }

    [Fact]
    public void SetPosition_none_clears_the_entry()
    {
        var store = new CursorSyncStore();
        store.SetPosition("a", CursorSyncValue.OfText("x"));

        store.SetPosition("a", CursorSyncValue.None);

        Assert.Equal(CursorSyncValue.None, store.GetPosition("a"));
    }

    [Fact]
    public void SetPosition_with_unchanged_value_does_not_fan_out()
    {
        var store = new CursorSyncStore();
        int notifications = 0;
        using IDisposable _ = store.Subscribe(() => notifications++);

        store.SetPosition("a", CursorSyncValue.OfNumber(1d));
        store.SetPosition("a", CursorSyncValue.OfNumber(1d)); // web: current === value -> no emit

        Assert.Equal(1, notifications);
    }

    [Fact]
    public void SetPosition_with_changed_value_fans_out()
    {
        var store = new CursorSyncStore();
        int notifications = 0;
        using IDisposable _ = store.Subscribe(() => notifications++);

        store.SetPosition("a", CursorSyncValue.OfNumber(1d));
        store.SetPosition("a", CursorSyncValue.OfNumber(2d));

        Assert.Equal(2, notifications);
    }

    [Fact]
    public void Clear_removes_and_fans_out_only_when_present()
    {
        var store = new CursorSyncStore();
        int notifications = 0;
        using IDisposable _ = store.Subscribe(() => notifications++);

        store.Clear("absent"); // web: if (!has) return; — no emit
        Assert.Equal(0, notifications);

        store.SetPosition("a", CursorSyncValue.OfText("x"));
        Assert.Equal(1, notifications);

        store.Clear("a");
        Assert.Equal(2, notifications);
        Assert.Equal(CursorSyncValue.None, store.GetPosition("a"));
    }

    [Fact]
    public void Subscribe_dispose_stops_further_deliveries()
    {
        var store = new CursorSyncStore();
        int notifications = 0;
        IDisposable subscription = store.Subscribe(() => notifications++);

        store.SetPosition("a", CursorSyncValue.OfNumber(1d));
        Assert.Equal(1, notifications);

        subscription.Dispose();
        store.SetPosition("a", CursorSyncValue.OfNumber(2d));

        Assert.Equal(1, notifications);
    }

    [Fact]
    public void Listener_count_reflects_the_live_subscriber_set()
    {
        var store = new CursorSyncStore();
        Assert.Equal(0, store.ListenerCount);

        IDisposable subscription = store.Subscribe(() => { });
        Assert.Equal(1, store.ListenerCount);

        subscription.Dispose();
        Assert.Equal(0, store.ListenerCount);
    }

    [Fact]
    public void Multiple_listeners_are_all_notified()
    {
        var store = new CursorSyncStore();
        int a = 0;
        int b = 0;
        using IDisposable subA = store.Subscribe(() => a++);
        using IDisposable subB = store.Subscribe(() => b++);

        store.SetPosition("k", CursorSyncValue.OfNumber(1d));

        Assert.Equal(1, a);
        Assert.Equal(1, b);
    }

    [Fact]
    public void Reset_drops_positions_and_listeners()
    {
        var store = new CursorSyncStore();
        int notifications = 0;
        store.Subscribe(() => notifications++);
        store.SetPosition("a", CursorSyncValue.OfText("x"));

        store.Reset();

        Assert.Equal(0, store.ListenerCount);
        Assert.Equal(CursorSyncValue.None, store.GetPosition("a"));
        store.SetPosition("a", CursorSyncValue.OfText("y"));
        Assert.Equal(1, notifications); // the pre-reset listener is gone
    }

    [Fact]
    public void Shared_store_is_a_stable_singleton() =>
        Assert.Same(CursorSyncStore.Shared, CursorSyncStore.Shared);

    // ── ChartTimeRangeProviderViewModel: context value (web useChartSync) ─────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_syncId_and_default_index_method()
    {
        using var viewModel = new ChartTimeRangeProviderViewModel("test-page", store: new CursorSyncStore());

        // web: useChartSync() === { syncId: 'test-page', syncMethod: 'index' }.
        Assert.Equal(new ChartSyncContextValue("test-page", ChartSyncMethod.Index), viewModel.Context);
        Assert.Equal("test-page", viewModel.SyncId);
        Assert.Equal(ChartSyncMethod.Index, viewModel.SyncMethod);
    }

    [Fact]
    public void ViewModel_honors_an_explicit_sync_method()
    {
        using var viewModel = new ChartTimeRangeProviderViewModel("x", ChartSyncMethod.Value, new CursorSyncStore());

        Assert.Equal(new ChartSyncContextValue("x", ChartSyncMethod.Value), viewModel.Context);
        Assert.Equal(ChartSyncMethod.Value, viewModel.SyncMethod);
    }

    [Fact]
    public void ViewModel_context_is_stable_across_reads()
    {
        using var viewModel = new ChartTimeRangeProviderViewModel("stable", store: new CursorSyncStore());

        // web memoizes the context value so consumers don't re-render unnecessarily.
        Assert.Equal(viewModel.Context, viewModel.Context);
        Assert.Equal("stable", viewModel.Context.SyncId);
    }

    [Fact]
    public void ViewModel_rejects_a_null_or_empty_syncId()
    {
        Assert.Throws<System.ArgumentNullException>(() => new ChartTimeRangeProviderViewModel(null!));
        Assert.Throws<System.ArgumentException>(() => new ChartTimeRangeProviderViewModel(string.Empty));
    }

    // ── ChartTimeRangeProviderViewModel: synced cursor props (web useSyncedCursor) ────────────────────────

    [Fact]
    public void SyncedCursor_is_populated_inside_a_provider()
    {
        using var viewModel = new ChartTimeRangeProviderViewModel("drive-detail", store: new CursorSyncStore());
        SyncedCursorProps props = viewModel.SyncedCursor;

        // web: useSyncedCursor() === { syncId, syncMethod, onMouseMove }.
        Assert.False(props.IsEmpty);
        Assert.Equal("drive-detail", props.SyncId);
        Assert.Equal(ChartSyncMethod.Index, props.SyncMethod);
        Assert.NotNull(props.OnMouseMove);
    }

    [Fact]
    public void OnMouseMove_writes_the_active_label_into_the_store()
    {
        var store = new CursorSyncStore();
        using var viewModel = new ChartTimeRangeProviderViewModel("m1", store: store);

        viewModel.OnMouseMove(ChartMouseState.WithActiveLabel(CursorSyncValue.OfText("12:34")));
        Assert.Equal(CursorSyncValue.OfText("12:34"), store.GetPosition("m1"));

        // web: { activeLabel: undefined } -> next = null -> clears.
        viewModel.OnMouseMove(ChartMouseState.Empty);
        Assert.Equal(CursorSyncValue.None, store.GetPosition("m1"));
    }

    [Fact]
    public void OnMouseMove_with_a_null_state_clears_the_cursor()
    {
        var store = new CursorSyncStore();
        using var viewModel = new ChartTimeRangeProviderViewModel("m1", store: store);
        viewModel.OnMouseMove(ChartMouseState.WithActiveLabel(CursorSyncValue.OfNumber(7d)));

        viewModel.OnMouseMove(null); // web onMouseMove(null) -> state?.activeLabel ?? null === null

        Assert.Equal(CursorSyncValue.None, store.GetPosition("m1"));
    }

    [Fact]
    public void OnMouseMove_after_dispose_is_a_no_op()
    {
        var store = new CursorSyncStore();
        var viewModel = new ChartTimeRangeProviderViewModel("m1", store: store);
        viewModel.Dispose();

        viewModel.OnMouseMove(ChartMouseState.WithActiveLabel(CursorSyncValue.OfText("late")));

        Assert.Equal(CursorSyncValue.None, store.GetPosition("m1"));
    }

    // ── ChartTimeRangeProviderViewModel: reference-line state (web useSyncedReferenceLineX) ───────────────

    [Fact]
    public void EmptyState_reference_line_starts_none_before_any_hover()
    {
        using var viewModel = new ChartTimeRangeProviderViewModel("m2", store: new CursorSyncStore());

        // web: useSyncedReferenceLineX() === null before any chart in the group has been hovered.
        Assert.Equal(CursorSyncValue.None, viewModel.SyncedReferenceLineX);
    }

    [Fact]
    public void ActiveState_reference_line_tracks_the_store_and_raises_change()
    {
        var store = new CursorSyncStore();
        using var viewModel = new ChartTimeRangeProviderViewModel("m2", store: store);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        store.SetPosition("m2", CursorSyncValue.OfNumber(42d));
        Assert.Equal(CursorSyncValue.OfNumber(42d), viewModel.SyncedReferenceLineX);

        store.SetPosition("m2", CursorSyncValue.None);
        Assert.Equal(CursorSyncValue.None, viewModel.SyncedReferenceLineX);

        Assert.Equal(2, changed.Count);
        Assert.All(changed, name => Assert.Equal(nameof(ChartTimeRangeProviderViewModel.SyncedReferenceLineX), name));
    }

    [Fact]
    public void Reference_line_does_not_raise_for_a_different_syncId()
    {
        var store = new CursorSyncStore();
        using var viewModel = new ChartTimeRangeProviderViewModel("mine", store: store);
        int changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        // web useSyncExternalStore bails out when this syncId's snapshot is unchanged.
        store.SetPosition("someone-else", CursorSyncValue.OfNumber(99d));

        Assert.Equal(0, changes);
        Assert.Equal(CursorSyncValue.None, viewModel.SyncedReferenceLineX);
    }

    [Fact]
    public void Reference_line_seeds_from_a_pre_existing_sibling_cursor()
    {
        var store = new CursorSyncStore();
        store.SetPosition("group", CursorSyncValue.OfNumber(5d));

        using var viewModel = new ChartTimeRangeProviderViewModel("group", store: store);

        // web initial useSyncExternalStore snapshot reads whatever a sibling chart already set.
        Assert.Equal(CursorSyncValue.OfNumber(5d), viewModel.SyncedReferenceLineX);
    }

    // ── ChartTimeRangeProviderViewModel: unmount behavior (web clearCursorSync) ──────────────────────────

    [Fact]
    public void Dispose_clears_this_syncId_cursor()
    {
        var store = new CursorSyncStore();
        var viewModel = new ChartTimeRangeProviderViewModel("m3", store: store);
        store.SetPosition("m3", CursorSyncValue.OfText("lingering"));
        Assert.Equal(CursorSyncValue.OfText("lingering"), store.GetPosition("m3"));

        viewModel.Dispose();

        // web: ChartTimeRangeProvider unmount -> clearCursorSync(syncId).
        Assert.Equal(CursorSyncValue.None, store.GetPosition("m3"));
    }

    [Fact]
    public void Dispose_is_idempotent()
    {
        var store = new CursorSyncStore();
        var viewModel = new ChartTimeRangeProviderViewModel("m3", store: store);

        viewModel.Dispose();
        Exception? error = Record.Exception(viewModel.Dispose);

        Assert.Null(error);
        Assert.Equal(0, store.ListenerCount);
    }

    // ── ChartSync facade: outside-provider hook fallbacks (web standalone-safe returns) ──────────────────

    [Fact]
    public void UseChartSync_returns_null_outside_a_provider_and_the_context_inside()
    {
        Assert.Null(ChartSync.UseChartSync(null));

        using var viewModel = new ChartTimeRangeProviderViewModel("p", store: new CursorSyncStore());
        Assert.Equal(viewModel.Context, ChartSync.UseChartSync(viewModel));
    }

    [Fact]
    public void UseSyncedCursor_returns_empty_outside_a_provider_and_props_inside()
    {
        SyncedCursorProps outside = ChartSync.UseSyncedCursor(null);
        Assert.True(outside.IsEmpty);
        Assert.Null(outside.SyncId);
        Assert.Null(outside.SyncMethod);
        Assert.Null(outside.OnMouseMove);
        Assert.Same(SyncedCursorProps.Empty, outside);

        using var viewModel = new ChartTimeRangeProviderViewModel("p", store: new CursorSyncStore());
        Assert.False(ChartSync.UseSyncedCursor(viewModel).IsEmpty);
    }

    [Fact]
    public void UseSyncedReferenceLineX_returns_none_outside_a_provider_and_the_value_inside()
    {
        Assert.Equal(CursorSyncValue.None, ChartSync.UseSyncedReferenceLineX(null));

        var store = new CursorSyncStore();
        using var viewModel = new ChartTimeRangeProviderViewModel("p", store: store);
        store.SetPosition("p", CursorSyncValue.OfNumber(3d));
        Assert.Equal(CursorSyncValue.OfNumber(3d), ChartSync.UseSyncedReferenceLineX(viewModel));
    }

    // ── NoOpCursorSyncStore: inert fallback (web undefined-syncId path) ──────────────────────────────────

    [Fact]
    public void NoOp_store_is_inert()
    {
        ICursorSyncStore store = NoOpCursorSyncStore.Instance;
        int notifications = 0;
        using IDisposable _ = store.Subscribe(() => notifications++);

        store.SetPosition("a", CursorSyncValue.OfText("ignored"));
        store.Clear("a");

        Assert.Equal(CursorSyncValue.None, store.GetPosition("a"));
        Assert.Equal(0, notifications);
    }

    [Fact]
    public void NoOp_store_is_a_shared_singleton() =>
        Assert.Same(NoOpCursorSyncStore.Instance, NoOpCursorSyncStore.Instance);

    // ── diagnostics + accessibility/privacy contract (view.opened, PII-safe — never the cursor value) ────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChartTimeRangeContextDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChartTimeRangeContext", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new ChartTimeRangeContextDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_never_emit_the_cursor_value()
    {
        // The surface is an anonymous, non-interactive provider: its only diagnostic is the operational
        // view.opened event. Cursor labels (which can carry user-facing X-axis text) are never logged, so
        // the PII-safe accessibility/privacy contract holds regardless of what gets hovered.
        var lines = new List<string>();
        var diagnostics = new ChartTimeRangeContextDiagnostics(lines.Add);
        var store = new CursorSyncStore();
        using var viewModel = new ChartTimeRangeProviderViewModel("private", store: store);

        viewModel.OnMouseMove(ChartMouseState.WithActiveLabel(CursorSyncValue.OfText("Home 12:34")));
        diagnostics.RecordViewOpened();

        Assert.All(lines, line => Assert.DoesNotContain("Home", line, System.StringComparison.Ordinal));
        Assert.Equal("view.opened slug=ChartTimeRangeContext", Assert.Single(lines));
    }
}
