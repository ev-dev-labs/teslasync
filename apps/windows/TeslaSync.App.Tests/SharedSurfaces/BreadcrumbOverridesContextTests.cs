using System;
using System.Collections.Generic;
using System.Linq;
using TeslaSync.App.SharedSurfaces.BreadcrumbOverridesContextSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the BreadcrumbOverridesContext surface's UI-thread-free logic — the shallow merge
/// (<see cref="BreadcrumbOverrideMerge"/>), the stable-content codec (<see cref="BreadcrumbOverridesSerialization"/>),
/// the registry seam (<see cref="BreadcrumbOverridesRegistry"/> / <see cref="NoOpBreadcrumbOverridesRegistry"/>), the
/// read-side <c>useBreadcrumbOverrides</c> holder (<see cref="BreadcrumbOverridesState"/>), the write-side
/// <c>useSetBreadcrumbOverrides</c> holder (<see cref="BreadcrumbOverridesPublisher"/>), the registration slug, the
/// accessibility contract and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/layout/BreadcrumbOverridesContext.tsx). The WinUI view (BreadcrumbOverridesContext.cs — the
/// attached-property context and the BreadcrumbOverridesProvider control) is exercised by the app build.
/// </summary>
public sealed class BreadcrumbOverridesContextTests
{
    // ── registration (diagnostics slug) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("BreadcrumbOverridesContext", BreadcrumbOverridesRegistration.Slug);

    // ── merge: the provider's `overrides` memo (shallow, truthy-only, later-wins) ──────────────────────────

    [Fact]
    public void Merge_of_no_maps_is_empty() =>
        Assert.Empty(BreadcrumbOverrideMerge.Merge(Array.Empty<IReadOnlyDictionary<string, string>?>()));

    [Fact]
    public void Merge_keeps_a_single_maps_entries()
    {
        IReadOnlyDictionary<string, string> merged = BreadcrumbOverrideMerge.Merge(new[] { Map(("/drives/:id", "Trip to office")) });

        Assert.Equal("Trip to office", merged["/drives/:id"]);
        Assert.Single(merged);
    }

    [Fact]
    public void Merge_lets_a_later_map_win_for_a_shared_key()
    {
        // web: `for (const map of registrations.values()) ... merged[k] = v` — a later map overwrites an earlier one.
        IReadOnlyDictionary<string, string> merged = BreadcrumbOverrideMerge.Merge(new[]
        {
            Map(("/drives/:id", "A")),
            Map(("/drives/:id", "B")),
        });

        Assert.Equal("B", merged["/drives/:id"]);
    }

    [Fact]
    public void Merge_skips_falsy_values_and_null_maps()
    {
        // web `if (v)` skips an empty label; a null registration map contributes nothing.
        IReadOnlyDictionary<string, string> merged = BreadcrumbOverrideMerge.Merge(new[]
        {
            null,
            Map(("/a", string.Empty), ("/b", "kept")),
        });

        Assert.False(merged.ContainsKey("/a"));
        Assert.Equal("kept", merged["/b"]);
        Assert.Single(merged);
    }

    [Fact]
    public void Merge_unions_distinct_keys_across_maps()
    {
        IReadOnlyDictionary<string, string> merged = BreadcrumbOverrideMerge.Merge(new[]
        {
            Map(("/a", "1")),
            Map(("/b", "2")),
        });

        Assert.Equal(2, merged.Count);
        Assert.Equal("1", merged["/a"]);
        Assert.Equal("2", merged["/b"]);
    }

    [Fact]
    public void AreEqual_compares_content_ordinally()
    {
        Assert.True(BreadcrumbOverrideMerge.AreEqual(Map(("/a", "1")), Map(("/a", "1"))));
        Assert.False(BreadcrumbOverrideMerge.AreEqual(Map(("/a", "1")), Map(("/a", "2"))));
        Assert.False(BreadcrumbOverrideMerge.AreEqual(Map(("/a", "1")), Map(("/a", "1"), ("/b", "2"))));
    }

    // ── serialization: the useSetBreadcrumbOverrides stable-content guard (order-independent JSON-compare) ──

    [Fact]
    public void Serialize_of_null_or_empty_or_all_falsy_is_the_empty_string()
    {
        // web: `const serialised = map ? JSON.stringify(map) : ''`, and the merge drops falsy values.
        Assert.Equal(string.Empty, BreadcrumbOverridesSerialization.Serialize(null));
        Assert.Equal(string.Empty, BreadcrumbOverridesSerialization.Serialize(Map()));
        Assert.Equal(string.Empty, BreadcrumbOverridesSerialization.Serialize(Map(("/x", string.Empty))));
    }

    [Fact]
    public void Serialize_is_order_independent()
    {
        // Two inline literals with identical content compare equal regardless of construction order.
        Assert.Equal(
            BreadcrumbOverridesSerialization.Serialize(Map(("/a", "1"), ("/b", "2"))),
            BreadcrumbOverridesSerialization.Serialize(Map(("/b", "2"), ("/a", "1"))));
    }

    [Fact]
    public void Serialize_drops_falsy_entries_for_comparison()
    {
        Assert.Equal(
            BreadcrumbOverridesSerialization.Serialize(Map(("/a", "1"))),
            BreadcrumbOverridesSerialization.Serialize(Map(("/a", "1"), ("/b", string.Empty))));
    }

    [Fact]
    public void Serialize_distinguishes_different_content()
    {
        Assert.NotEqual(
            BreadcrumbOverridesSerialization.Serialize(Map(("/a", "1"))),
            BreadcrumbOverridesSerialization.Serialize(Map(("/a", "2"))));
    }

    [Fact]
    public void Serialize_is_collision_safe_across_delimiters()
    {
        // Length-prefixing means a key/value that contains ':' or '=' can never alias a different decomposition.
        Assert.NotEqual(
            BreadcrumbOverridesSerialization.Serialize(Map(("/a:b", "c"))),
            BreadcrumbOverridesSerialization.Serialize(Map(("/a", "b:c"))));
    }

    // ── registry: the provider's React state (register / unregister / merged overrides) ────────────────────

    [Fact]
    public void Registry_allocates_monotonic_positive_ids()
    {
        var registry = new BreadcrumbOverridesRegistry();

        int first = registry.CreateRegistrationId();
        int second = registry.CreateRegistrationId();

        Assert.True(first >= 1);
        Assert.True(second > first);
    }

    [Fact]
    public void Registry_set_and_remove_update_the_merged_overrides()
    {
        var registry = new BreadcrumbOverridesRegistry();
        int id = registry.CreateRegistrationId();

        registry.Register(id, Map(("/x", "A")));
        Assert.Equal("A", registry.MergedOverrides["/x"]);

        registry.Unregister(id);
        Assert.Empty(registry.MergedOverrides);
    }

    [Fact]
    public void Registry_raises_changed_only_when_the_merged_map_actually_changes()
    {
        var registry = new BreadcrumbOverridesRegistry();
        int changes = 0;
        registry.Changed += (_, _) => changes++;
        int id = registry.CreateRegistrationId();

        registry.Register(id, Map(("/x", "A")));   // change
        registry.Register(id, Map(("/x", "A")));   // identical merged → no change
        registry.Unregister(999);                 // unknown id → no change
        registry.Unregister(id);                  // change (back to empty)

        Assert.Equal(2, changes);
    }

    [Fact]
    public void Registry_snapshots_the_map_so_later_caller_mutation_does_not_leak()
    {
        var registry = new BreadcrumbOverridesRegistry();
        var map = new Dictionary<string, string>(StringComparer.Ordinal) { ["/x"] = "A" };
        int id = registry.CreateRegistrationId();
        registry.Register(id, map);

        map["/x"] = "MUTATED";

        Assert.Equal("A", registry.MergedOverrides["/x"]);
    }

    [Fact]
    public void Registry_shared_is_a_stable_singleton() =>
        Assert.Same(BreadcrumbOverridesRegistry.Shared, BreadcrumbOverridesRegistry.Shared);

    [Fact]
    public void NoOp_registry_is_inert_and_a_shared_singleton()
    {
        IBreadcrumbOverridesRegistry registry = NoOpBreadcrumbOverridesRegistry.Instance;
        int changes = 0;
        registry.Changed += (_, _) => changes++;

        registry.Register(registry.CreateRegistrationId(), Map(("/x", "A")));

        Assert.Empty(registry.MergedOverrides);
        Assert.Equal(0, changes);
        Assert.Equal(0, registry.CreateRegistrationId());
        Assert.Same(NoOpBreadcrumbOverridesRegistry.Instance, NoOpBreadcrumbOverridesRegistry.Instance);
    }

    // ── read holder: useBreadcrumbOverrides ────────────────────────────────────────────────────────────────

    [Fact]
    public void State_starts_empty_when_nothing_is_registered()
    {
        using var state = new BreadcrumbOverridesState(new BreadcrumbOverridesRegistry());

        Assert.Empty(state.MergedOverrides);
    }

    [Fact]
    public void State_reflects_a_registration_and_raises_property_changed()
    {
        var registry = new BreadcrumbOverridesRegistry();
        using var state = new BreadcrumbOverridesState(registry);
        var changed = new List<string?>();
        state.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        using var publisher = new BreadcrumbOverridesPublisher(registry);
        publisher.Set(Map(("/drives/:id", "Trip to office")));

        Assert.Equal("Trip to office", state.MergedOverrides["/drives/:id"]);
        Assert.Contains(nameof(BreadcrumbOverridesState.MergedOverrides), changed);
    }

    [Fact]
    public void State_reads_a_pre_seeded_registry()
    {
        var registry = new BreadcrumbOverridesRegistry();
        using var publisher = new BreadcrumbOverridesPublisher(registry);
        publisher.Set(Map(("/x", "A")));

        using var state = new BreadcrumbOverridesState(registry);

        Assert.Equal("A", state.MergedOverrides["/x"]);
    }

    [Fact]
    public void State_does_not_raise_when_the_merged_map_is_unchanged()
    {
        var registry = new StubRegistry();
        using var state = new BreadcrumbOverridesState(registry);
        int changes = 0;
        state.PropertyChanged += (_, _) => changes++;

        registry.RaiseWithoutChange();

        Assert.Equal(0, changes);
    }

    [Fact]
    public void State_dispose_unsubscribes_from_the_registry()
    {
        var registry = new BreadcrumbOverridesRegistry();
        var state = new BreadcrumbOverridesState(registry);
        state.Dispose();

        registry.Register(registry.CreateRegistrationId(), Map(("/x", "A")));

        Assert.Empty(state.MergedOverrides);
    }

    [Fact]
    public void State_rejects_a_null_registry() =>
        Assert.Throws<ArgumentNullException>(() => new BreadcrumbOverridesState(null!));

    // ── write holder: useSetBreadcrumbOverrides ────────────────────────────────────────────────────────────

    [Fact]
    public void Publisher_registers_a_map_and_it_appears_in_the_merged_overrides()
    {
        var registry = new BreadcrumbOverridesRegistry();
        using var publisher = new BreadcrumbOverridesPublisher(registry);

        publisher.Set(Map(("/x", "A")));

        Assert.True(publisher.IsRegistered);
        Assert.Equal("A", registry.MergedOverrides["/x"]);
    }

    [Fact]
    public void Publisher_is_a_no_op_for_content_equal_maps()
    {
        var registry = new BreadcrumbOverridesRegistry();
        using var publisher = new BreadcrumbOverridesPublisher(registry);
        int changes = 0;
        registry.Changed += (_, _) => changes++;

        publisher.Set(Map(("/x", "A")));   // registers (1 change)
        int? id = publisher.RegistrationId;
        publisher.Set(Map(("/x", "A")));   // identical content → no churn

        Assert.Equal(1, changes);
        Assert.Equal(id, publisher.RegistrationId);
    }

    [Fact]
    public void Publisher_bumps_the_id_when_content_changes_so_the_page_wins()
    {
        // web: a changed `serialised` re-runs the effect — cleanup unregisters the old id, the next effect allocates a
        // fresh nextId++, moving this page to the end of the merge order.
        var registry = new BreadcrumbOverridesRegistry();
        using var publisher = new BreadcrumbOverridesPublisher(registry);

        publisher.Set(Map(("/x", "A")));
        int? first = publisher.RegistrationId;
        publisher.Set(Map(("/x", "B")));
        int? second = publisher.RegistrationId;

        Assert.NotNull(first);
        Assert.NotNull(second);
        Assert.True(second > first);
        Assert.Equal("B", registry.MergedOverrides["/x"]);
    }

    [Fact]
    public void Publisher_clears_the_registration_for_an_empty_map()
    {
        var registry = new BreadcrumbOverridesRegistry();
        using var publisher = new BreadcrumbOverridesPublisher(registry);
        publisher.Set(Map(("/x", "A")));

        publisher.Set(null);

        Assert.False(publisher.IsRegistered);
        Assert.Empty(registry.MergedOverrides);
    }

    [Fact]
    public void Publisher_dispose_unregisters()
    {
        var registry = new BreadcrumbOverridesRegistry();
        var publisher = new BreadcrumbOverridesPublisher(registry);
        publisher.Set(Map(("/x", "A")));

        publisher.Dispose();

        Assert.Empty(registry.MergedOverrides);
    }

    [Fact]
    public void Publisher_set_after_dispose_throws()
    {
        var publisher = new BreadcrumbOverridesPublisher(new BreadcrumbOverridesRegistry());
        publisher.Dispose();

        Assert.Throws<ObjectDisposedException>(() => publisher.Set(Map(("/x", "A"))));
    }

    [Fact]
    public void Publisher_rejects_a_null_registry() =>
        Assert.Throws<ArgumentNullException>(() => new BreadcrumbOverridesPublisher(null!));

    [Fact]
    public void Two_publishers_resolve_a_shared_key_in_favour_of_the_later_registration()
    {
        var registry = new BreadcrumbOverridesRegistry();
        using var first = new BreadcrumbOverridesPublisher(registry);
        using var second = new BreadcrumbOverridesPublisher(registry);

        first.Set(Map(("/x", "first")));
        second.Set(Map(("/x", "second")));

        Assert.Equal("second", registry.MergedOverrides["/x"]);
    }

    // ── accessibility: the provider is a transparent wrapper (web bare fragment, no accessible node) ─────────

    [Fact]
    public void Provider_contributes_no_accessible_node_of_its_own() =>
        Assert.False(BreadcrumbOverridesAccessibility.ProviderContributesAccessibleNode);

    // ── diagnostics (view.opened / overrides.registered / overrides.unregistered — PII-safe) ────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BreadcrumbOverridesDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BreadcrumbOverridesContext", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_count_register_and_unregister_without_leaking_key_or_label()
    {
        var lines = new List<string>();
        var diagnostics = new BreadcrumbOverridesDiagnostics(lines.Add);
        var registry = new BreadcrumbOverridesRegistry();
        using var publisher = new BreadcrumbOverridesPublisher(registry, diagnostics);

        // The label is intentionally PII-shaped (a location), exactly like the web doc-comment example.
        publisher.Set(Map(("/drives/:id", "196th Street → Northeast 90th")));
        publisher.Set(null);

        Assert.Equal(1, diagnostics.Registered);
        Assert.Equal(1, diagnostics.Unregistered);
        Assert.Equal(
            new[]
            {
                "overrides.registered slug=BreadcrumbOverridesContext",
                "overrides.unregistered slug=BreadcrumbOverridesContext",
            },
            lines);
        Assert.DoesNotContain(
            lines,
            line => line.Contains("196th", StringComparison.Ordinal)
                || line.Contains("Northeast", StringComparison.Ordinal)
                || line.Contains("drives", StringComparison.Ordinal));
    }

    private static IReadOnlyDictionary<string, string> Map(params (string Key, string Value)[] entries)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach ((string key, string value) in entries)
        {
            map[key] = value;
        }

        return map;
    }

    /// <summary>A registry double that can raise <see cref="Changed"/> without altering its (empty) overrides.</summary>
    private sealed class StubRegistry : IBreadcrumbOverridesRegistry
    {
        private static readonly IReadOnlyDictionary<string, string> Empty =
            new Dictionary<string, string>(StringComparer.Ordinal);

        public event EventHandler? Changed;

        public IReadOnlyDictionary<string, string> MergedOverrides => Empty;

        public int CreateRegistrationId() => 1;

        public void Register(int id, IReadOnlyDictionary<string, string> map)
        {
        }

        public void Unregister(int id)
        {
        }

        public void RaiseWithoutChange() => Changed?.Invoke(this, EventArgs.Empty);
    }
}
