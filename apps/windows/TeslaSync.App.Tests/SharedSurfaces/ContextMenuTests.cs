using System.Collections.Generic;
using System.ComponentModel;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the context-menu surface's UI-thread-free logic — the module store
/// (open/close/empty-skip/nonce/subscribe/reset), the viewport-overflow flip, the state-holder's projection +
/// activation, the PII-safe diagnostics and the registration / item / snapshot models. Mirrors the web spec
/// one-for-one (web/src/components/ui/ContextMenu.tsx). The WinUI part (<c>ContextMenuRoot</c> in
/// shared-surfaces/ContextMenu.cs, which projects the store into a Fluent MenuFlyout shown at the resolved
/// point) is exercised by the app build.
/// </summary>
public sealed class ContextMenuTests
{
    private static ContextMenuItem Item(string id, Action? onSelected = null, bool disabled = false) =>
        new(id, $"Label {id}", onSelected: onSelected, isDisabled: disabled);

    private static IReadOnlyList<ContextMenuItem> Items(params ContextMenuItem[] items) => items;

    // ── store: open publishes a snapshot (web openContextMenu) ───────────────────────────────────────────

    [Fact]
    public void Open_publishes_a_snapshot_with_the_items_and_coordinates()
    {
        var store = new ContextMenuController();
        ContextMenuSnapshot? received = null;
        using var sub = store.Subscribe(s => received = s);

        store.Open(Items(Item("a"), Item("b")), 12, 34);

        Assert.NotNull(received);
        Assert.Equal(2, received!.Items.Count);
        Assert.Equal(12, received.X);
        Assert.Equal(34, received.Y);
        Assert.Same(received, store.Current);
    }

    [Fact]
    public void Open_carries_the_restore_target_through_the_snapshot()
    {
        var store = new ContextMenuController();
        var target = new object();

        store.Open(Items(Item("a")), 0, 0, restoreTarget: target);

        Assert.Same(target, store.Current!.RestoreTarget);
    }

    // ── store: empty / null open is a no-op (web: if (!items || items.length === 0) return;) ─────────────

    [Fact]
    public void Open_with_no_items_is_a_silent_no_op()
    {
        var store = new ContextMenuController();
        var emits = new List<ContextMenuSnapshot?>();
        using var sub = store.Subscribe(emits.Add);

        store.Open(Array.Empty<ContextMenuItem>(), 5, 5);

        Assert.Null(store.Current);
        Assert.Empty(emits);
    }

    [Fact]
    public void Open_with_null_items_is_a_silent_no_op()
    {
        var store = new ContextMenuController();
        var emits = new List<ContextMenuSnapshot?>();
        using var sub = store.Subscribe(emits.Add);

        store.Open(null!, 5, 5);

        Assert.Null(store.Current);
        Assert.Empty(emits);
    }

    // ── store: monotonic nonce so identical re-opens still re-render (web nonceCounter) ──────────────────

    [Fact]
    public void Open_advances_the_nonce_on_every_open()
    {
        var store = new ContextMenuController();

        store.Open(Items(Item("a")), 1, 1);
        long first = store.Current!.Nonce;
        store.Open(Items(Item("a")), 1, 1);
        long second = store.Current!.Nonce;

        Assert.True(second > first);
    }

    [Fact]
    public void Reopening_identical_items_and_coordinates_publishes_a_distinct_snapshot()
    {
        var store = new ContextMenuController();
        var snapshots = new List<ContextMenuSnapshot?>();
        using var sub = store.Subscribe(snapshots.Add);

        var items = Items(Item("a"));
        store.Open(items, 7, 7);
        store.Open(items, 7, 7);

        Assert.Equal(2, snapshots.Count);
        Assert.NotSame(snapshots[0], snapshots[1]);
        Assert.NotEqual(snapshots[0]!.Nonce, snapshots[1]!.Nonce);
    }

    // ── store: defensive copy of the caller's list ───────────────────────────────────────────────────────

    [Fact]
    public void Open_snapshots_the_items_defensively()
    {
        var store = new ContextMenuController();
        var mutable = new List<ContextMenuItem> { Item("a") };

        store.Open(mutable, 0, 0);
        mutable.Add(Item("b"));

        Assert.Single(store.Current!.Items);
    }

    // ── store: close (web closeContextMenu) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Close_clears_the_snapshot_and_fans_out_null()
    {
        var store = new ContextMenuController();
        var emits = new List<ContextMenuSnapshot?>();
        using var sub = store.Subscribe(emits.Add);

        store.Open(Items(Item("a")), 0, 0);
        store.Close();

        Assert.Null(store.Current);
        Assert.Equal(2, emits.Count);
        Assert.NotNull(emits[0]);
        Assert.Null(emits[1]);
    }

    [Fact]
    public void Close_when_already_closed_is_a_silent_no_op()
    {
        var store = new ContextMenuController();
        var emits = new List<ContextMenuSnapshot?>();
        using var sub = store.Subscribe(emits.Add);

        store.Close();

        Assert.Empty(emits);
    }

    // ── store: subscribe / unsubscribe / reset / shared ──────────────────────────────────────────────────

    [Fact]
    public void Subscribe_increments_listener_count_and_dispose_decrements_it()
    {
        var store = new ContextMenuController();
        Assert.Equal(0, store.ListenerCount);

        var sub = store.Subscribe(_ => { });
        Assert.Equal(1, store.ListenerCount);

        sub.Dispose();
        Assert.Equal(0, store.ListenerCount);
    }

    [Fact]
    public void Disposed_subscription_no_longer_receives_emits()
    {
        var store = new ContextMenuController();
        var emits = new List<ContextMenuSnapshot?>();
        var sub = store.Subscribe(emits.Add);

        sub.Dispose();
        store.Open(Items(Item("a")), 0, 0);

        Assert.Empty(emits);
    }

    [Fact]
    public void Subscription_dispose_is_idempotent()
    {
        var store = new ContextMenuController();
        var sub = store.Subscribe(_ => { });

        sub.Dispose();
        var ex = Record.Exception(sub.Dispose);

        Assert.Null(ex);
        Assert.Equal(0, store.ListenerCount);
    }

    [Fact]
    public void Subscribe_rejects_a_null_listener()
    {
        var store = new ContextMenuController();

        Assert.Throws<ArgumentNullException>(() => store.Subscribe(null!));
    }

    [Fact]
    public void ResetForTests_clears_listeners_and_state()
    {
        var store = new ContextMenuController();
        using var sub = store.Subscribe(_ => { });
        store.Open(Items(Item("a")), 0, 0);

        store.ResetForTests();

        Assert.Equal(0, store.ListenerCount);
        Assert.Null(store.Current);
    }

    [Fact]
    public void Shared_is_a_process_wide_singleton() =>
        Assert.Same(ContextMenuController.Shared, ContextMenuController.Shared);

    // ── placement: the viewport-overflow flip (web useLayoutEffect) ──────────────────────────────────────

    [Fact]
    public void Placement_keeps_the_anchor_when_the_menu_fits()
    {
        var point = ContextMenuPlacement.Resolve(x: 100, y: 100, menuWidth: 200, menuHeight: 150, viewportWidth: 1000, viewportHeight: 800);

        Assert.Equal(100, point.Left);
        Assert.Equal(100, point.Top);
    }

    [Fact]
    public void Placement_flips_the_left_when_the_right_edge_overflows()
    {
        // 950 + 200 + 8 > 1000 -> left = max(8, 950 - 200) = 750.
        var point = ContextMenuPlacement.Resolve(x: 950, y: 100, menuWidth: 200, menuHeight: 150, viewportWidth: 1000, viewportHeight: 800);

        Assert.Equal(750, point.Left);
        Assert.Equal(100, point.Top);
    }

    [Fact]
    public void Placement_flips_the_top_when_the_bottom_edge_overflows()
    {
        // 760 + 150 + 8 > 800 -> top = max(8, 760 - 150) = 610.
        var point = ContextMenuPlacement.Resolve(x: 100, y: 760, menuWidth: 200, menuHeight: 150, viewportWidth: 1000, viewportHeight: 800);

        Assert.Equal(100, point.Left);
        Assert.Equal(610, point.Top);
    }

    [Fact]
    public void Placement_flips_both_edges_when_the_menu_overflows_the_corner()
    {
        var point = ContextMenuPlacement.Resolve(x: 950, y: 760, menuWidth: 200, menuHeight: 150, viewportWidth: 1000, viewportHeight: 800);

        Assert.Equal(750, point.Left);
        Assert.Equal(610, point.Top);
    }

    [Fact]
    public void Placement_clamps_to_the_margin_when_the_flipped_anchor_would_go_negative()
    {
        // A wide menu near the right edge of a narrow viewport: 60 + 100 + 8 > 150 -> left = max(8, 60 - 100) = 8.
        var point = ContextMenuPlacement.Resolve(x: 60, y: 10, menuWidth: 100, menuHeight: 20, viewportWidth: 150, viewportHeight: 800);

        Assert.Equal(ContextMenuPlacement.ViewportMargin, point.Left);
    }

    [Fact]
    public void Placement_default_margin_is_eight() =>
        Assert.Equal(8, ContextMenuPlacement.ViewportMargin);

    // ── view-model: construction + projection (web useSyncExternalStore) ─────────────────────────────────

    [Fact]
    public void ViewModel_subscribes_to_the_store_on_construction()
    {
        var store = new ContextMenuController();

        using var vm = new ContextMenuRootViewModel(store, PassthroughLocalizer.Instance);

        Assert.Equal(1, store.ListenerCount);
    }

    [Fact]
    public void ViewModel_starts_closed()
    {
        using var vm = new ContextMenuRootViewModel(new ContextMenuController(), PassthroughLocalizer.Instance);

        Assert.False(vm.IsOpen);
        Assert.Null(vm.Current);
    }

    [Fact]
    public void ViewModel_seeds_from_an_already_open_store()
    {
        var store = new ContextMenuController();
        store.Open(Items(Item("a")), 1, 2);

        using var vm = new ContextMenuRootViewModel(store, PassthroughLocalizer.Instance);

        Assert.True(vm.IsOpen);
        Assert.NotNull(vm.Current);
    }

    [Fact]
    public void ViewModel_projects_open_and_raises_change_notifications()
    {
        var store = new ContextMenuController();
        using var vm = new ContextMenuRootViewModel(store, PassthroughLocalizer.Instance);
        var changed = new List<string?>();
        var pulses = new List<ContextMenuSnapshot?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        vm.SnapshotChanged += (_, s) => pulses.Add(s);

        store.Open(Items(Item("a")), 0, 0);

        Assert.True(vm.IsOpen);
        Assert.Contains(nameof(ContextMenuRootViewModel.Current), changed);
        Assert.Contains(nameof(ContextMenuRootViewModel.IsOpen), changed);
        Assert.Single(pulses);
        Assert.NotNull(pulses[0]);
    }

    [Fact]
    public void ViewModel_pulses_on_reopen_without_re_raising_is_open()
    {
        var store = new ContextMenuController();
        using var vm = new ContextMenuRootViewModel(store, PassthroughLocalizer.Instance);
        store.Open(Items(Item("a")), 0, 0);

        var changed = new List<string?>();
        var pulses = new List<ContextMenuSnapshot?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        vm.SnapshotChanged += (_, s) => pulses.Add(s);

        store.Open(Items(Item("a")), 0, 0); // re-open while already open

        Assert.Single(pulses);
        Assert.Contains(nameof(ContextMenuRootViewModel.Current), changed);
        Assert.DoesNotContain(nameof(ContextMenuRootViewModel.IsOpen), changed);
    }

    [Fact]
    public void ViewModel_projects_close()
    {
        var store = new ContextMenuController();
        using var vm = new ContextMenuRootViewModel(store, PassthroughLocalizer.Instance);
        store.Open(Items(Item("a")), 0, 0);

        store.Close();

        Assert.False(vm.IsOpen);
        Assert.Null(vm.Current);
    }

    // ── view-model: the menu accessible name (web aria-label, a11y) ──────────────────────────────────────

    [Fact]
    public void MenuLabel_falls_back_to_the_web_english_copy()
    {
        using var vm = new ContextMenuRootViewModel(new ContextMenuController(), PassthroughLocalizer.Instance);

        Assert.Equal("Context menu", vm.MenuLabel);
    }

    [Fact]
    public void MenuLabel_resolves_through_the_localizer_with_the_web_key()
    {
        var localizer = new RecordingLocalizer((_, _) => "menu localisée");
        using var vm = new ContextMenuRootViewModel(new ContextMenuController(), localizer);

        string label = vm.MenuLabel;

        Assert.Equal("menu localisée", label);
        Assert.Contains(("translation.contextMenu.menuLabel", "Context menu"), localizer.Calls);
    }

    // ── view-model: activation (web invoke) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Invoke_closes_the_menu_then_runs_the_action()
    {
        var store = new ContextMenuController();
        using var vm = new ContextMenuRootViewModel(store, PassthroughLocalizer.Instance);
        bool openWhenInvoked = true;
        var item = new ContextMenuItem("a", "Delete", onSelected: () => openWhenInvoked = store.Current is not null);
        store.Open(Items(item), 0, 0);

        vm.Invoke(item);

        Assert.False(store.Current is not null); // store closed
        Assert.False(openWhenInvoked);           // action observed the menu already closed (web ordering)
    }

    [Fact]
    public void Invoke_ignores_a_disabled_item()
    {
        var store = new ContextMenuController();
        using var vm = new ContextMenuRootViewModel(store, PassthroughLocalizer.Instance);
        bool ran = false;
        var item = Item("a", onSelected: () => ran = true, disabled: true);
        store.Open(Items(item), 0, 0);

        vm.Invoke(item);

        Assert.False(ran);                 // web: if (item.disabled) return;
        Assert.NotNull(store.Current);     // a disabled item does not close the menu
    }

    [Fact]
    public void Invoke_contains_a_throwing_handler_and_still_closes()
    {
        var store = new ContextMenuController();
        using var vm = new ContextMenuRootViewModel(store, PassthroughLocalizer.Instance);
        var item = new ContextMenuItem("a", "Boom", onSelected: () => throw new InvalidOperationException("handler blew up"));
        store.Open(Items(item), 0, 0);

        var ex = Record.Exception(() => vm.Invoke(item));

        Assert.Null(ex);               // web wraps the handler in try/catch
        Assert.Null(store.Current);    // the menu was closed before the throwing handler ran
    }

    [Fact]
    public void Invoke_rejects_a_null_item()
    {
        using var vm = new ContextMenuRootViewModel(new ContextMenuController(), PassthroughLocalizer.Instance);

        Assert.Throws<ArgumentNullException>(() => vm.Invoke(null!));
    }

    [Fact]
    public void ViewModel_close_closes_the_store()
    {
        var store = new ContextMenuController();
        using var vm = new ContextMenuRootViewModel(store, PassthroughLocalizer.Instance);
        store.Open(Items(Item("a")), 0, 0);

        vm.Close();

        Assert.Null(store.Current);
    }

    // ── view-model: lifecycle ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Disposed_view_model_unsubscribes_and_stops_projecting()
    {
        var store = new ContextMenuController();
        var vm = new ContextMenuRootViewModel(store, PassthroughLocalizer.Instance);

        vm.Dispose();
        Assert.Equal(0, store.ListenerCount);

        store.Open(Items(Item("a")), 0, 0);
        Assert.Null(vm.Current);
    }

    [Fact]
    public void View_model_dispose_is_idempotent()
    {
        var vm = new ContextMenuRootViewModel(new ContextMenuController(), PassthroughLocalizer.Instance);

        vm.Dispose();
        var ex = Record.Exception(vm.Dispose);

        Assert.Null(ex);
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() => new ContextMenuRootViewModel(null!, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() => new ContextMenuRootViewModel(new ContextMenuController(), null!));
    }

    // ── diagnostics: view.opened, PII-safe (never the item labels / coordinates) ─────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug_only()
    {
        var lines = new List<string>();
        var diagnostics = new ContextMenuDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ContextMenu", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new ContextMenuDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ContextMenu", ContextMenuRegistration.Slug);

    [Fact]
    public void Registration_menu_label_key_and_fallback_match_the_web_source()
    {
        Assert.Equal("translation.contextMenu.menuLabel", ContextMenuRegistration.MenuLabelKey);
        Assert.Equal("Context menu", ContextMenuRegistration.MenuLabelFallback);
    }

    [Fact]
    public void Registration_danger_brush_key_is_the_token_key() =>
        Assert.Equal("TsColorDangerBrush", ContextMenuRegistration.DangerBrushKey);

    // ── item / snapshot models ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Item_carries_all_caller_supplied_fields()
    {
        var item = new ContextMenuItem(
            "delete",
            "Delete",
            onSelected: () => { },
            iconGlyph: "\uE74D",
            isDisabled: true,
            isDestructive: true,
            shortcut: "Ctrl+D");

        Assert.Equal("delete", item.Id);
        Assert.Equal("Delete", item.Label);
        Assert.NotNull(item.OnSelected);
        Assert.Equal("\uE74D", item.IconGlyph);
        Assert.True(item.IsDisabled);
        Assert.True(item.IsDestructive);
        Assert.Equal("Ctrl+D", item.Shortcut);
    }

    [Fact]
    public void Item_defaults_are_an_enabled_non_destructive_action()
    {
        var item = new ContextMenuItem("a", "Label");

        Assert.Null(item.OnSelected);
        Assert.Null(item.IconGlyph);
        Assert.False(item.IsDisabled);
        Assert.False(item.IsDestructive);
        Assert.Null(item.Shortcut);
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void Item_rejects_an_empty_id(string? id) =>
        // ArgumentException.ThrowIfNullOrEmpty throws ArgumentNullException (a subclass) for null and
        // ArgumentException for empty; ThrowsAny accepts both.
        Assert.ThrowsAny<ArgumentException>(() => new ContextMenuItem(id!, "Label"));

    [Fact]
    public void Item_rejects_a_null_label() =>
        Assert.Throws<ArgumentNullException>(() => new ContextMenuItem("a", null!));

    [Fact]
    public void Snapshot_rejects_null_items() =>
        Assert.Throws<ArgumentNullException>(() => new ContextMenuSnapshot(null!, 0, 0, 1, null));

    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly Func<string, string, string>? _resolve;

        public RecordingLocalizer(Func<string, string, string>? resolve = null) => _resolve = resolve;

        public List<(string Key, string Fallback)> Calls { get; } = [];

        public string GetString(string key, string fallback)
        {
            Calls.Add((key, fallback));
            return _resolve?.Invoke(key, fallback) ?? fallback;
        }
    }
}
