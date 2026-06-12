using System.Threading.Tasks;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the PinButton surface's UI-thread-free logic — the registration slug + i18n
/// keys / fallbacks + token keys (<see cref="PinButtonRegistration"/>), the <see cref="PinItemType"/> → wire
/// mapping and the <see cref="PinButtonSize"/> → pixel metrics, the pin seam (<see cref="IPinStore"/> with its
/// in-memory and delegate implementations), and the per-state view-model: the derived pinned flag and its
/// reprojection on the seam's <c>Changed</c>, the toggle routing (success → "Pinned" / "Unpinned" toast,
/// failure → "Failed to pin" / "Failed to unpin" toast with the error detail, re-entrant drop while pending),
/// the in-flight disable, the icon / tooltip / accessible-name / visible-label / foreground-brush projections,
/// and the PII-safe diagnostics (<see cref="PinButtonViewModel"/>, <see cref="PinButtonDiagnostics"/>). Mirrors
/// the web spec one-for-one (web/src/components/ui/PinButton.tsx, web/src/api/hooks/usePinned.ts). The WinUI view
/// (PinButton.cs, which composes a ghost button + Toggle-pattern peer + the platform glyph/brush projection) is
/// exercised by the app build.
/// </summary>
public sealed class PinButtonTests
{
    private const PinItemType Vehicle = PinItemType.Vehicle;

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static PinButtonViewModel NewViewModel(
        IPinStore? store = null,
        PinItemType itemType = PinItemType.Vehicle,
        string itemId = "1",
        string? context = null,
        ILocalizer? localizer = null,
        IToastController? toast = null) =>
        new(
            store ?? new InMemoryPinStore(),
            itemType,
            itemId,
            context,
            localizer ?? PassthroughLocalizer.Instance,
            toast);

    // ── registration (diagnostics slug + i18n keys/fallbacks + token keys, web verbatim) ──────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("PinButton", PinButtonRegistration.Slug);

    [Theory]
    [InlineData(PinButtonRegistration.PinKey, "translation.pin.pin")]
    [InlineData(PinButtonRegistration.UnpinKey, "translation.pin.unpin")]
    [InlineData(PinButtonRegistration.PinnedKey, "translation.pin.pinned")]
    [InlineData(PinButtonRegistration.PinnedSuccessKey, "translation.toast.pin.pinned.success")]
    [InlineData(PinButtonRegistration.UnpinnedSuccessKey, "translation.toast.pin.unpinned.success")]
    [InlineData(PinButtonRegistration.PinFailedKey, "translation.toast.pin.pinned.error")]
    [InlineData(PinButtonRegistration.UnpinFailedKey, "translation.toast.pin.unpinned.error")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Fact]
    public void I18n_fallbacks_match_the_web_english_copy()
    {
        // Asserted as a Fact (not a Theory) because several fallbacks legitimately share the same English text
        // ("Pinned" is both the pinned label and the pin-success toast), which would collide as duplicate InlineData.
        Assert.Equal("Pin", PinButtonRegistration.PinFallback);
        Assert.Equal("Unpin", PinButtonRegistration.UnpinFallback);
        Assert.Equal("Pinned", PinButtonRegistration.PinnedFallback);
        Assert.Equal("Pinned", PinButtonRegistration.PinnedSuccessFallback);
        Assert.Equal("Unpinned", PinButtonRegistration.UnpinnedSuccessFallback);
        Assert.Equal("Failed to pin", PinButtonRegistration.PinFailedFallback);
        Assert.Equal("Failed to unpin", PinButtonRegistration.UnpinFailedFallback);
    }

    [Fact]
    public void Brush_keys_match_the_web_amber_and_muted_colours()
    {
        Assert.Equal("TsColorWarningBrush", PinButtonRegistration.PinnedBrushKey); // web text-amber-300
        Assert.Equal("TsColorTextMutedBrush", PinButtonRegistration.IdleBrushKey); // web text-[var(--text-muted)]
    }

    // ── wire mapping (web PinnedItemType union → snake_case contract) ──────────────────────────────────────

    [Theory]
    [InlineData(PinItemType.Vehicle, "vehicle")]
    [InlineData(PinItemType.Widget, "widget")]
    [InlineData(PinItemType.AlertRule, "alert_rule")]
    [InlineData(PinItemType.Location, "location")]
    [InlineData(PinItemType.Geofence, "geofence")]
    [InlineData(PinItemType.Automation, "automation")]
    [InlineData(PinItemType.Dashboard, "dashboard")]
    [InlineData(PinItemType.Command, "command")]
    public void WireValue_maps_each_type_to_its_backend_contract_string(PinItemType type, string expected) =>
        Assert.Equal(expected, PinItemTypes.WireValue(type));

    // ── sizing metrics (web SIZE_CLASS / ICON_CLASS) ──────────────────────────────────────────────────────

    [Theory]
    [InlineData(PinButtonSize.Small, 14d)]
    [InlineData(PinButtonSize.Medium, 16d)]
    public void IconSize_matches_the_web_icon_class(PinButtonSize size, double expected) =>
        Assert.Equal(expected, PinButtonMetrics.IconSize(size));

    [Theory]
    [InlineData(PinButtonSize.Small, 28d)]
    [InlineData(PinButtonSize.Medium, 32d)]
    public void BoxSize_matches_the_web_size_class(PinButtonSize size, double expected) =>
        Assert.Equal(expected, PinButtonMetrics.BoxSize(size));

    // ── state: unpinned-idle (web isPinned === false) ─────────────────────────────────────────────────────

    [Fact]
    public void Unpinned_shows_the_pin_icon_muted_with_the_pin_tooltip()
    {
        PinButtonViewModel vm = NewViewModel();

        Assert.False(vm.IsPinned);
        Assert.False(vm.ShowUnpinIcon);                                   // web Icon = Pin
        Assert.Equal("Pin", vm.TooltipLabel);                            // web tooltipLabel = 'Pin'
        Assert.Equal("Pin", vm.AccessibleName);                          // web aria-label = tooltipLabel
        Assert.Equal("TsColorTextMutedBrush", vm.ForegroundBrushKey);    // web text-[var(--text-muted)]
    }

    [Fact]
    public void Unpinned_hides_the_visible_label_until_show_label_is_set()
    {
        PinButtonViewModel vm = NewViewModel();

        Assert.Null(vm.VisibleLabel);                                    // web showLabel default false

        vm.ShowLabel = true;
        Assert.Equal("Pin", vm.VisibleLabel);                            // web showLabel && (isPinned ? 'Pinned' : 'Pin')
    }

    // ── state: pinned (web isPinned === true) ─────────────────────────────────────────────────────────────

    [Fact]
    public void Pinned_shows_the_unpin_icon_amber_with_the_unpin_tooltip()
    {
        var store = new InMemoryPinStore();
        store.Seed(Vehicle, null, "1");
        PinButtonViewModel vm = NewViewModel(store);

        Assert.True(vm.IsPinned);
        Assert.True(vm.ShowUnpinIcon);                                   // web Icon = PinOff
        Assert.Equal("Unpin", vm.TooltipLabel);                          // web tooltipLabel = 'Unpin'
        Assert.Equal("Unpin", vm.AccessibleName);
        Assert.Equal("TsColorWarningBrush", vm.ForegroundBrushKey);      // web text-amber-300
    }

    [Fact]
    public void Pinned_visible_label_reads_pinned_not_unpin()
    {
        var store = new InMemoryPinStore();
        store.Seed(Vehicle, null, "1");
        PinButtonViewModel vm = NewViewModel(store);
        vm.ShowLabel = true;

        // web: the visible label uses the STATE word 'Pinned', distinct from the action word 'Unpin' in the tooltip.
        Assert.Equal("Pinned", vm.VisibleLabel);
        Assert.Equal("Unpin", vm.TooltipLabel);
    }

    // ── toggle: pin success (web onSuccess, pin: true) ────────────────────────────────────────────────────

    [Fact]
    public async Task Toggle_pins_an_unpinned_item_and_announces_the_pinned_toast()
    {
        var store = new InMemoryPinStore();
        var toast = new ToastController();
        PinButtonViewModel vm = NewViewModel(store, toast: toast);

        PinToggleOutcome outcome = await vm.ToggleAsync();

        Assert.Equal(PinToggleOutcome.Pinned, outcome);
        Assert.True(vm.IsPinned);                                        // re-read via the seam's Changed
        Assert.True(store.IsPinned(Vehicle, "1", null));                 // the write reached the store
        ToastItem item = Assert.Single(toast.Snapshot);
        Assert.Equal(CalloutVariant.Success, item.Variant);
        Assert.Equal("Pinned", item.Title);
    }

    // ── toggle: unpin success (web onSuccess, pin: false) ─────────────────────────────────────────────────

    [Fact]
    public async Task Toggle_unpins_a_pinned_item_and_announces_the_unpinned_toast()
    {
        var store = new InMemoryPinStore();
        store.Seed(Vehicle, null, "1");
        var toast = new ToastController();
        PinButtonViewModel vm = NewViewModel(store, toast: toast);
        Assert.True(vm.IsPinned);

        PinToggleOutcome outcome = await vm.ToggleAsync();

        Assert.Equal(PinToggleOutcome.Unpinned, outcome);
        Assert.False(vm.IsPinned);
        Assert.False(store.IsPinned(Vehicle, "1", null));
        ToastItem item = Assert.Single(toast.Snapshot);
        Assert.Equal(CalloutVariant.Success, item.Variant);
        Assert.Equal("Unpinned", item.Title);
    }

    [Fact]
    public async Task Toggle_raises_property_changed_for_the_pinned_dependent_projections()
    {
        var store = new InMemoryPinStore();
        PinButtonViewModel vm = NewViewModel(store);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.ToggleAsync();

        Assert.Contains(nameof(PinButtonViewModel.IsPinned), changed);
        Assert.Contains(nameof(PinButtonViewModel.ShowUnpinIcon), changed);
        Assert.Contains(nameof(PinButtonViewModel.TooltipLabel), changed);
        Assert.Contains(nameof(PinButtonViewModel.VisibleLabel), changed);
        Assert.Contains(nameof(PinButtonViewModel.ForegroundBrushKey), changed);
    }

    // ── toggle: failure (web onError — error toast with the error message as the detail line) ─────────────

    [Fact]
    public async Task Toggle_failure_to_pin_announces_the_failed_to_pin_toast_with_the_error_detail()
    {
        var ex = new InvalidOperationException("HTTP 500: pinned_items insert failed");
        var store = new DelegatePinStore((_, _, _) => false, (_, _, _, _) => Task.FromException(ex));
        var toast = new ToastController();
        PinButtonViewModel vm = NewViewModel(store, toast: toast);

        PinToggleOutcome outcome = await vm.ToggleAsync();

        Assert.Equal(PinToggleOutcome.Failed, outcome);
        Assert.False(vm.IsPinned);                                       // failure leaves the state unchanged
        ToastItem item = Assert.Single(toast.Snapshot);
        Assert.Equal(CalloutVariant.Danger, item.Variant);
        Assert.Equal("Failed to pin", item.Title);
        Assert.Equal("HTTP 500: pinned_items insert failed", item.Message); // web error(e, …) detail = e.message
    }

    [Fact]
    public async Task Toggle_failure_to_unpin_announces_the_failed_to_unpin_toast()
    {
        var ex = new InvalidOperationException("network down");
        var store = new DelegatePinStore((_, _, _) => true, (_, _, _, _) => Task.FromException(ex));
        var toast = new ToastController();
        PinButtonViewModel vm = NewViewModel(store, toast: toast);
        Assert.True(vm.IsPinned);

        PinToggleOutcome outcome = await vm.ToggleAsync();

        Assert.Equal(PinToggleOutcome.Failed, outcome);
        ToastItem item = Assert.Single(toast.Snapshot);
        Assert.Equal(CalloutVariant.Danger, item.Variant);
        Assert.Equal("Failed to unpin", item.Title);
        Assert.Equal("network down", item.Message);
    }

    // ── toggle: re-entrancy + in-flight disable (web toggle.isPending) ────────────────────────────────────

    [Fact]
    public async Task Toggle_is_dropped_while_a_toggle_is_already_in_flight()
    {
        var gate = new TaskCompletionSource();
        var store = new DelegatePinStore((_, _, _) => false, (_, _, _, _) => gate.Task);
        PinButtonViewModel vm = NewViewModel(store);

        Task<PinToggleOutcome> inFlight = vm.ToggleAsync();

        // web: disabled={toggle.isPending} — the trigger is non-interactive while a toggle runs.
        Assert.True(vm.IsPending);
        Assert.False(vm.IsEnabled);

        // web: if (toggle.isPending) return — a second activation is dropped immediately.
        Assert.Equal(PinToggleOutcome.Ignored, await vm.ToggleAsync());

        gate.SetResult();
        Assert.Equal(PinToggleOutcome.Pinned, await inFlight);
        Assert.False(vm.IsPending);
        Assert.True(vm.IsEnabled);
    }

    [Fact]
    public async Task Pending_resets_after_a_failed_toggle()
    {
        var store = new DelegatePinStore(
            (_, _, _) => false, (_, _, _, _) => Task.FromException(new InvalidOperationException("boom")));
        PinButtonViewModel vm = NewViewModel(store);

        await vm.ToggleAsync();

        Assert.False(vm.IsPending);                                      // web: finally → isPending clears
        Assert.True(vm.IsEnabled);
    }

    // ── seam isolation: type / context buckets (web usePinned(type, context)) ─────────────────────────────

    [Fact]
    public void Pins_are_scoped_to_their_context_bucket()
    {
        var store = new InMemoryPinStore();
        store.Seed(Vehicle, "dashboard-7", "1");

        // The default (null) context bucket does not see a pin made in the 'dashboard-7' bucket.
        Assert.False(NewViewModel(store, context: null).IsPinned);
        Assert.True(NewViewModel(store, context: "dashboard-7").IsPinned);
    }

    [Fact]
    public void Pins_are_scoped_to_their_type_bucket()
    {
        var store = new InMemoryPinStore();
        store.Seed(PinItemType.Widget, null, "1");

        // Same id, different domain bucket → not pinned.
        Assert.False(NewViewModel(store, itemType: PinItemType.Vehicle).IsPinned);
        Assert.True(NewViewModel(store, itemType: PinItemType.Widget).IsPinned);
    }

    // ── reprojection: external pin-set change (web usePinned query moving) ─────────────────────────────────

    [Fact]
    public async Task An_external_pin_change_reprojects_the_view_model()
    {
        var store = new InMemoryPinStore();
        PinButtonViewModel vm = NewViewModel(store);
        Assert.False(vm.IsPinned);

        var raised = false;
        vm.PropertyChanged += (_, _) => raised = true;

        // Another surface pins the same item — the seam raises Changed and this view-model re-reads.
        await store.SetPinnedAsync(Vehicle, "1", null, true);

        Assert.True(vm.IsPinned);
        Assert.True(raised);
    }

    // ── toast gating: no overlay degrades gracefully (web useOptionalToast-style null) ────────────────────

    [Fact]
    public async Task Toggle_without_a_toast_overlay_still_succeeds()
    {
        PinButtonViewModel vm = NewViewModel(toast: null);

        PinToggleOutcome outcome = await vm.ToggleAsync();

        Assert.Equal(PinToggleOutcome.Pinned, outcome);
        Assert.True(vm.IsPinned);
    }

    // ── i18n: every label flows through the localizer (no hardcoded English) ──────────────────────────────

    [Fact]
    public void Every_label_resolves_through_the_localizer()
    {
        var localizer = new RecordingLocalizer();
        PinButtonViewModel vm = NewViewModel(localizer: localizer);

        _ = vm.PinLabel;
        _ = vm.UnpinLabel;
        _ = vm.PinnedLabel;

        Assert.Contains(PinButtonRegistration.PinKey, localizer.RequestedKeys);
        Assert.Contains(PinButtonRegistration.UnpinKey, localizer.RequestedKeys);
        Assert.Contains(PinButtonRegistration.PinnedKey, localizer.RequestedKeys);
    }

    // ── constructor guards + lifetime ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Constructor_rejects_null_required_seams_but_allows_a_null_toast()
    {
        IPinStore store = new InMemoryPinStore();
        ILocalizer localizer = PassthroughLocalizer.Instance;

        Assert.Throws<ArgumentNullException>(() => new PinButtonViewModel(null!, Vehicle, "1", null, localizer));
        Assert.Throws<ArgumentNullException>(() => new PinButtonViewModel(store, Vehicle, null!, null, localizer));
        Assert.Throws<ArgumentNullException>(() => new PinButtonViewModel(store, Vehicle, "1", null, null!));

        // A null toast is valid — the web useOptionalToast()-style degradation for isolated hosts.
        var vm = new PinButtonViewModel(store, Vehicle, "1", null, localizer, null);
        Assert.NotNull(vm);
    }

    [Fact]
    public async Task Dispose_detaches_from_the_seam()
    {
        var store = new InMemoryPinStore();
        var vm = NewViewModel(store);
        vm.Dispose();

        var raised = false;
        vm.PropertyChanged += (_, _) => raised = true;
        await store.SetPinnedAsync(Vehicle, "1", null, true);

        Assert.False(raised);
    }

    // ── seam: InMemoryPinStore ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task InMemory_store_toggles_membership_and_raises_changed()
    {
        var store = new InMemoryPinStore();
        var changes = 0;
        store.Changed += (_, _) => changes++;

        Assert.False(store.IsPinned(Vehicle, "1", null));

        await store.SetPinnedAsync(Vehicle, "1", null, true);
        Assert.True(store.IsPinned(Vehicle, "1", null));
        Assert.Equal(1, changes);

        await store.SetPinnedAsync(Vehicle, "1", null, false);
        Assert.False(store.IsPinned(Vehicle, "1", null));
        Assert.Equal(2, changes);
    }

    [Fact]
    public async Task InMemory_store_no_op_write_does_not_raise_changed()
    {
        var store = new InMemoryPinStore();
        store.Seed(Vehicle, null, "1");
        var changes = 0;
        store.Changed += (_, _) => changes++;

        // Already pinned → pinning again is a no-op (no membership change, no Changed).
        await store.SetPinnedAsync(Vehicle, "1", null, true);

        Assert.Equal(0, changes);
        Assert.True(store.IsPinned(Vehicle, "1", null));
    }

    [Fact]
    public async Task InMemory_store_rejects_a_null_item_id()
    {
        var store = new InMemoryPinStore();

        Assert.Throws<ArgumentNullException>(() => store.IsPinned(Vehicle, null!, null));
        await Assert.ThrowsAsync<ArgumentNullException>(() => store.SetPinnedAsync(Vehicle, null!, null, true));
    }

    // ── seam: DelegatePinStore ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Delegate_store_forwards_the_read_predicate()
    {
        var store = new DelegatePinStore(
            (type, id, ctx) => type == Vehicle && id == "1" && ctx == null,
            (_, _, _, _) => Task.CompletedTask);

        Assert.True(store.IsPinned(Vehicle, "1", null));
        Assert.False(store.IsPinned(Vehicle, "2", null));
    }

    [Fact]
    public async Task Delegate_store_raises_changed_only_after_a_successful_write()
    {
        var ok = new DelegatePinStore((_, _, _) => false, (_, _, _, _) => Task.CompletedTask);
        var okChanges = 0;
        ok.Changed += (_, _) => okChanges++;
        await ok.SetPinnedAsync(Vehicle, "1", null, true);
        Assert.Equal(1, okChanges);

        var fail = new DelegatePinStore(
            (_, _, _) => false, (_, _, _, _) => Task.FromException(new InvalidOperationException("x")));
        var failChanges = 0;
        fail.Changed += (_, _) => failChanges++;
        await Assert.ThrowsAsync<InvalidOperationException>(() => fail.SetPinnedAsync(Vehicle, "1", null, true));
        Assert.Equal(0, failChanges);
    }

    [Fact]
    public void Delegate_store_requires_both_delegates()
    {
        Assert.Throws<ArgumentNullException>(
            () => new DelegatePinStore(null!, (_, _, _, _) => Task.CompletedTask));
        Assert.Throws<ArgumentNullException>(
            () => new DelegatePinStore((_, _, _) => false, null!));
    }

    [Fact]
    public void Delegate_store_notify_changed_raises_for_external_updates()
    {
        var store = new DelegatePinStore((_, _, _) => false, (_, _, _, _) => Task.CompletedTask);
        var raised = false;
        store.Changed += (_, _) => raised = true;

        store.NotifyChanged();

        Assert.True(raised);
    }

    // ── diagnostics: PII-safe view.opened (P1/S11) ────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emits_view_opened_with_the_surface_slug()
    {
        var events = new List<string>();
        var diagnostics = new PinButtonDiagnostics(events.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=PinButton", Assert.Single(events));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens_and_has_a_safe_default_sink()
    {
        var diagnostics = new PinButtonDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
