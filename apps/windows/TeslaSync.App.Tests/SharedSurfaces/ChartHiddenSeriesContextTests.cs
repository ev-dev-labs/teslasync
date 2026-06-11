using System;
using System.Collections.Generic;
using System.Linq;
using TeslaSync.App.SharedSurfaces.ChartHiddenSeriesContextSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ChartHiddenSeriesContext surface's UI-thread-free logic — the
/// <c>hidden_{chartKey}</c> parameter codec (<see cref="HiddenSeriesSerialization"/>), the <c>useSearchParams</c>
/// seam (<see cref="HiddenSeriesQueryStore"/> / <see cref="NoOpHiddenSeriesQueryStore"/>), the
/// <c>useHiddenSeries</c> state holder (<see cref="HiddenSeriesState"/>), the provider's null branch
/// (<see cref="ChartHiddenSeriesProviderModel"/>), the registration slug, the accessibility contract and the
/// PII-safe diagnostics. Mirrors the web spec one-for-one (web/src/components/charts/ChartHiddenSeriesContext.tsx,
/// web/src/hooks/useHiddenSeries.ts, web/src/hooks/useUrlState.ts). The WinUI view (ChartHiddenSeriesContext.cs —
/// the attached-property context and the ChartHiddenSeriesProvider control) is exercised by the app build.
/// </summary>
public sealed class ChartHiddenSeriesContextTests
{
    // ── registration (diagnostics slug + parameter naming convention) ────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ChartHiddenSeriesContext", ChartHiddenSeriesRegistration.Slug);

    [Fact]
    public void ParamName_uses_the_web_hidden_prefix()
    {
        // web: `${HIDDEN_PARAM_PREFIX}${chartKey}` with HIDDEN_PARAM_PREFIX = 'hidden_'.
        Assert.Equal("hidden_", ChartHiddenSeriesRegistration.ParamPrefix);
        Assert.Equal(',', ChartHiddenSeriesRegistration.Delimiter);
        Assert.Equal("hidden_battery-degradation-trend", ChartHiddenSeriesRegistration.ParamName("battery-degradation-trend"));
    }

    // ── adapter: HiddenSeriesSerialization (web useUrlArray parse/serialize + toggle canonicalisation) ─────

    [Fact]
    public void Parse_treats_null_and_empty_as_no_hidden_series()
    {
        // web useUrlArray parse: raw === '' ? [] : raw.split(','); an absent param reads as null.
        Assert.Empty(HiddenSeriesSerialization.Parse(null));
        Assert.Empty(HiddenSeriesSerialization.Parse(string.Empty));
    }

    [Fact]
    public void Parse_splits_the_comma_joined_value()
    {
        Assert.Equal(new[] { "health", "projected" }, HiddenSeriesSerialization.Parse("health,projected"));
        Assert.Equal(new[] { "health" }, HiddenSeriesSerialization.Parse("health"));
    }

    [Fact]
    public void Serialize_produces_the_canonical_sorted_deduplicated_join()
    {
        // web toggle: Array.from(set).sort() then useUrlArray serialize v.join(','); order-independent + unique.
        Assert.Equal("a,b", HiddenSeriesSerialization.Serialize(new[] { "b", "a" }));
        Assert.Equal("a,b", HiddenSeriesSerialization.Serialize(new[] { "a", "b" }));
        Assert.Equal("a,b", HiddenSeriesSerialization.Serialize(new[] { "b", "a", "b" }));
    }

    [Fact]
    public void Serialize_of_no_series_is_the_empty_string()
    {
        // The empty string is what the query store treats as "delete the parameter" (web omitDefault).
        Assert.Equal(string.Empty, HiddenSeriesSerialization.Serialize(Array.Empty<string>()));
    }

    [Fact]
    public void Parse_and_serialize_round_trip_to_the_same_membership()
    {
        string canonical = HiddenSeriesSerialization.Serialize(new[] { "projected", "health" });
        Assert.Equal("health,projected", canonical);
        Assert.Equal(new HashSet<string> { "health", "projected" }, HiddenSeriesSerialization.Parse(canonical).ToHashSet(StringComparer.Ordinal));
    }

    // ── source: HiddenSeriesQueryStore (web useSearchParams shared URL) ───────────────────────────────────

    [Fact]
    public void Store_returns_null_for_an_absent_parameter()
    {
        var store = new HiddenSeriesQueryStore();

        Assert.Null(store.Read("hidden_x"));
    }

    [Fact]
    public void Store_round_trips_a_written_value()
    {
        var store = new HiddenSeriesQueryStore();

        store.Write("hidden_x", "a,b");

        Assert.Equal("a,b", store.Read("hidden_x"));
    }

    [Fact]
    public void Store_deletes_the_parameter_on_an_empty_write()
    {
        var store = new HiddenSeriesQueryStore();
        store.Write("hidden_x", "a");

        store.Write("hidden_x", string.Empty);
        Assert.Null(store.Read("hidden_x"));

        store.Write("hidden_x", "a");
        store.Write("hidden_x", null);
        Assert.Null(store.Read("hidden_x"));
    }

    [Fact]
    public void Store_raises_changed_only_when_the_value_actually_changes()
    {
        var store = new HiddenSeriesQueryStore();
        int changes = 0;
        store.Changed += (_, _) => changes++;

        store.Write("hidden_x", "a");     // change
        store.Write("hidden_x", "a");     // no-op
        store.Write("hidden_x", "a,b");   // change
        store.Write("hidden_x", null);    // change (delete)
        store.Write("hidden_x", null);    // no-op (already absent)

        Assert.Equal(3, changes);
    }

    [Fact]
    public void Store_shared_is_a_stable_singleton() =>
        Assert.Same(HiddenSeriesQueryStore.Shared, HiddenSeriesQueryStore.Shared);

    [Fact]
    public void NoOp_store_is_inert_and_a_shared_singleton()
    {
        IHiddenSeriesQueryStore store = NoOpHiddenSeriesQueryStore.Instance;
        int changes = 0;
        store.Changed += (_, _) => changes++;

        store.Write("hidden_x", "a");

        Assert.Null(store.Read("hidden_x"));
        Assert.Equal(0, changes);
        Assert.Same(NoOpHiddenSeriesQueryStore.Instance, NoOpHiddenSeriesQueryStore.Instance);
    }

    // ── state holder: empty state (web hidden = new Set() over an absent param) ───────────────────────────

    [Fact]
    public void State_starts_empty_when_no_series_are_hidden()
    {
        using var state = new HiddenSeriesState(new HiddenSeriesQueryStore(), "trend");

        Assert.Empty(state.Hidden);
        Assert.False(state.IsHidden("health"));
        Assert.Equal("trend", state.ChartKey);
    }

    // ── state holder: active state (web toggle hides a series, persisting canonical to the URL) ────────────

    [Fact]
    public void Toggle_hides_a_series_and_persists_the_canonical_value()
    {
        var store = new HiddenSeriesQueryStore();
        using var state = new HiddenSeriesState(store, "trend");

        state.Toggle("health");

        Assert.True(state.IsHidden("health"));
        Assert.Equal(new[] { "health" }, state.Hidden);
        Assert.Equal("health", store.Read("hidden_trend"));
    }

    [Fact]
    public void Toggle_twice_shows_the_series_again_and_drops_the_parameter()
    {
        var store = new HiddenSeriesQueryStore();
        using var state = new HiddenSeriesState(store, "trend");

        state.Toggle("health");
        state.Toggle("health");

        Assert.False(state.IsHidden("health"));
        Assert.Empty(state.Hidden);
        Assert.Null(store.Read("hidden_trend"));
    }

    [Fact]
    public void Toggling_two_series_writes_a_canonical_sorted_url_value()
    {
        var store = new HiddenSeriesQueryStore();
        using var state = new HiddenSeriesState(store, "trend");

        state.Toggle("projected");
        state.Toggle("health");

        // web: toggling A then B yields the same URL as B then A (sorted output).
        Assert.Equal("health,projected", store.Read("hidden_trend"));
        Assert.Equal(new HashSet<string> { "health", "projected" }, state.Hidden.ToHashSet(StringComparer.Ordinal));
    }

    [Fact]
    public void Reset_clears_every_hidden_flag_and_drops_the_parameter()
    {
        var store = new HiddenSeriesQueryStore();
        using var state = new HiddenSeriesState(store, "trend");
        state.Toggle("health");
        state.Toggle("projected");

        state.Reset();

        Assert.Empty(state.Hidden);
        Assert.Null(store.Read("hidden_trend"));
    }

    // ── state holder: restored-from-deep-link (web reads existing ?hidden_{chartKey} on mount) ─────────────

    [Fact]
    public void State_restores_hidden_series_from_a_pre_seeded_deep_link()
    {
        var store = new HiddenSeriesQueryStore();
        store.Write("hidden_trend", "projected,health");

        using var state = new HiddenSeriesState(store, "trend");

        Assert.True(state.IsHidden("health"));
        Assert.True(state.IsHidden("projected"));
        Assert.Equal(2, state.Hidden.Count);
    }

    // ── state holder: change notification (web re-render on a useSearchParams update) ─────────────────────

    [Fact]
    public void State_raises_property_changed_on_toggle()
    {
        var store = new HiddenSeriesQueryStore();
        using var state = new HiddenSeriesState(store, "trend");
        var changed = new List<string?>();
        state.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        state.Toggle("health");

        Assert.Contains(nameof(HiddenSeriesState.Hidden), changed);
    }

    [Fact]
    public void State_reflects_an_external_store_change()
    {
        var store = new HiddenSeriesQueryStore();
        using var state = new HiddenSeriesState(store, "trend");
        int changes = 0;
        state.PropertyChanged += (_, _) => changes++;

        // A different surface (or a pasted link) writes the same shared parameter.
        store.Write("hidden_trend", "health");

        Assert.True(state.IsHidden("health"));
        Assert.Equal(1, changes);
    }

    [Fact]
    public void State_does_not_raise_when_the_membership_is_unchanged()
    {
        var store = new RaisingStore();
        using var state = new HiddenSeriesState(store, "trend");
        int changes = 0;
        state.PropertyChanged += (_, _) => changes++;

        store.RaiseWithoutChange();

        Assert.Equal(0, changes);
    }

    [Fact]
    public void State_dispose_unsubscribes_from_the_store()
    {
        var store = new HiddenSeriesQueryStore();
        var state = new HiddenSeriesState(store, "trend");
        state.Dispose();

        store.Write("hidden_trend", "health");

        Assert.Empty(state.Hidden);
    }

    [Fact]
    public void State_rejects_a_null_store_and_an_empty_chart_key()
    {
        Assert.Throws<ArgumentNullException>(() => new HiddenSeriesState(null!, "trend"));
        Assert.Throws<ArgumentException>(() => new HiddenSeriesState(new HiddenSeriesQueryStore(), string.Empty));
    }

    // ── provider model: the not-opted-in (null) branch (web if (!chartKey) children(null)) ────────────────

    [Fact]
    public void Provider_model_returns_null_when_the_chart_did_not_opt_in()
    {
        var store = new HiddenSeriesQueryStore();

        Assert.Null(ChartHiddenSeriesProviderModel.Create(store, null));
        Assert.Null(ChartHiddenSeriesProviderModel.Create(store, string.Empty));
    }

    [Fact]
    public void Provider_model_creates_state_bound_to_the_chart_key()
    {
        var store = new HiddenSeriesQueryStore();

        using HiddenSeriesState? state = ChartHiddenSeriesProviderModel.Create(store, "trend");

        Assert.NotNull(state);
        state!.Toggle("health");
        Assert.Equal("health", store.Read("hidden_trend"));
    }

    // ── accessibility: the provider is a transparent wrapper (web bare fragment, no accessible node) ──────

    [Fact]
    public void Provider_contributes_no_accessible_node_of_its_own() =>
        Assert.False(ChartHiddenSeriesAccessibility.ProviderContributesAccessibleNode);

    // ── diagnostics (view.opened / series.toggled / series.reset — PII-safe, never the key) ───────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChartHiddenSeriesDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChartHiddenSeriesContext", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_count_toggles_and_resets_without_leaking_the_key()
    {
        var lines = new List<string>();
        var diagnostics = new ChartHiddenSeriesDiagnostics(lines.Add);
        var store = new HiddenSeriesQueryStore();
        using var state = new HiddenSeriesState(store, "battery-degradation-trend", diagnostics);

        state.Toggle("health");
        state.Reset();

        Assert.Equal(1, diagnostics.Toggled);
        Assert.Equal(1, diagnostics.Resets);
        Assert.Equal(new[] { "series.toggled slug=ChartHiddenSeriesContext", "series.reset slug=ChartHiddenSeriesContext" }, lines);
        Assert.DoesNotContain(lines, line => line.Contains("health", StringComparison.Ordinal) || line.Contains("battery", StringComparison.Ordinal));
    }

    /// <summary>A store that can raise <see cref="Changed"/> without altering its value, to exercise the holder's no-op guard.</summary>
    private sealed class RaisingStore : IHiddenSeriesQueryStore
    {
        public event EventHandler? Changed;

        public string? Read(string paramName) => null;

        public void Write(string paramName, string? value)
        {
        }

        public void RaiseWithoutChange() => Changed?.Invoke(this, EventArgs.Empty);
    }
}
