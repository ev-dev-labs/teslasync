using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the EditConflictBanner shared surface's UI-thread-free logic — the registration
/// metadata (slug, the banner / take-over / switch-hint automation ids mirroring the web data-testids, the ARIA
/// role/live contract, the warning variant + glyph, and the five i18n keys with the verbatim English fallbacks
/// the web t() calls render), the <see cref="EditLeaseSnapshot"/> helpers, the pure
/// <see cref="EditConflictBannerProjection"/> (visibility gating, the generic vs labelled body, the localized
/// action label / switch hint, the accessible-name contract and the peer-tab-id stamp), the
/// <see cref="EditConflictBannerViewModel"/> state holder (initial projection, reprojection, take-over
/// forwarding, subscription cleanup), the static seam and the full <see cref="EditLeaseCoordinator"/> election
/// protocol (self-grant on timeout, cross-window conflict, take-over, release re-election, request re-grant and
/// the deterministic tiebreaker), and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/feedback/EditConflictBanner.tsx + web/src/hooks/useEditLease.ts). The WinUI view itself
/// (shared-surfaces/EditConflictBanner.cs) is exercised by the app build.
/// </summary>
public sealed class EditConflictBannerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static EditLeaseSnapshot Conflict(string tabId = "peer-1", long claimedAt = 1000) =>
        new(false, new EditLeasePeer(tabId, claimedAt));

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("EditConflictBanner", EditConflictBannerRegistration.Slug);

    [Fact]
    public void Automation_ids_mirror_the_web_test_ids()
    {
        Assert.Equal("edit-conflict-banner", EditConflictBannerRegistration.BannerAutomationId);
        Assert.Equal("edit-conflict-take-over", EditConflictBannerRegistration.TakeOverAutomationId);
        Assert.Equal("edit-conflict-switch-hint", EditConflictBannerRegistration.SwitchHintAutomationId);
    }

    [Fact]
    public void Role_and_live_setting_describe_a_polite_status_region()
    {
        Assert.Equal("status", EditConflictBannerRegistration.StatusRole);
        Assert.Equal("polite", EditConflictBannerRegistration.LiveSetting);
    }

    [Fact]
    public void Variant_is_warning_matching_the_web_alert_banner()
    {
        Assert.Equal(CalloutVariant.Warning, EditConflictBannerRegistration.Variant);
        Assert.Equal(CalloutVariants.Glyph(CalloutVariant.Warning), EditConflictBannerRegistration.Glyph);
        Assert.Equal("TsColorWarningBrush", EditConflictBannerRegistration.AccentBrushKey);
    }

    [Fact]
    public void Election_timeout_matches_the_web_constant() =>
        Assert.Equal(TimeSpan.FromMilliseconds(250), EditConflictBannerRegistration.ElectionTimeout);

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        Assert.Equal("translation.editConflict.banner.title", EditConflictBannerRegistration.TitleKey);
        Assert.Equal("Another browser tab is editing this", EditConflictBannerRegistration.TitleFallback);
        Assert.Equal("translation.editConflict.banner.body", EditConflictBannerRegistration.BodyKey);
        Assert.Equal(
            "This resource is open in another tab of this browser. Saving here will overwrite changes made there.",
            EditConflictBannerRegistration.BodyFallback);
        Assert.Equal("translation.editConflict.banner.bodyWithLabel", EditConflictBannerRegistration.BodyWithLabelKey);
        Assert.Equal(
            "{0} is open in another tab of this browser. Saving here will overwrite changes made there.",
            EditConflictBannerRegistration.BodyWithLabelFallback);
        Assert.Equal("translation.editConflict.banner.takeOver", EditConflictBannerRegistration.TakeOverKey);
        Assert.Equal("Take over editing", EditConflictBannerRegistration.TakeOverFallback);
        Assert.Equal("translation.editConflict.banner.switchHint", EditConflictBannerRegistration.SwitchHintKey);
        Assert.Equal("Or switch to your other tab to keep editing there.", EditConflictBannerRegistration.SwitchHintFallback);
    }

    // ── lease snapshot ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Snapshot_none_is_not_a_conflict()
    {
        Assert.False(EditLeaseSnapshot.None.IsOwner);
        Assert.Null(EditLeaseSnapshot.None.OtherTab);
        Assert.False(EditLeaseSnapshot.None.IsConflict);
    }

    [Fact]
    public void Snapshot_owner_is_not_a_conflict()
    {
        Assert.True(EditLeaseSnapshot.Owner.IsOwner);
        Assert.False(EditLeaseSnapshot.Owner.IsConflict);
    }

    [Fact]
    public void Snapshot_is_a_conflict_only_when_a_peer_holds_and_we_do_not()
    {
        Assert.True(Conflict().IsConflict);
        // owner + a stray peer is still not a conflict — we own it (web isOwner short-circuit).
        Assert.False(new EditLeaseSnapshot(true, new EditLeasePeer("peer-1", 1000)).IsConflict);
    }

    // ── projection (per-state) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_collapsed_when_this_tab_owns_the_lease()
    {
        var projection = EditConflictBannerProjection.Project(EditLeaseSnapshot.Owner, null, Localizer);

        Assert.False(projection.IsVisible);
        Assert.Equal("polite", projection.LiveSetting);
    }

    [Fact]
    public void Projection_is_collapsed_when_no_peer_has_announced()
    {
        var projection = EditConflictBannerProjection.Project(EditLeaseSnapshot.None, null, Localizer);

        Assert.False(projection.IsVisible);
    }

    [Fact]
    public void Projection_is_shown_with_the_generic_copy_during_a_conflict()
    {
        var projection = EditConflictBannerProjection.Project(Conflict("peer-9"), null, Localizer);

        Assert.True(projection.IsVisible);
        Assert.Equal("Another browser tab is editing this", projection.Title);
        Assert.Equal(
            "This resource is open in another tab of this browser. Saving here will overwrite changes made there.",
            projection.Body);
        Assert.Equal("Take over editing", projection.TakeOverLabel);
        Assert.Equal("Or switch to your other tab to keep editing there.", projection.SwitchHint);
        Assert.Equal("peer-9", projection.OtherTabId);
    }

    [Fact]
    public void Projection_uses_the_labelled_body_when_a_resource_label_is_supplied()
    {
        var projection = EditConflictBannerProjection.Project(Conflict(), "Your settings", Localizer);

        Assert.True(projection.IsVisible);
        Assert.Equal(
            "Your settings is open in another tab of this browser. Saving here will overwrite changes made there.",
            projection.Body);
    }

    [Fact]
    public void Projection_accessible_name_is_the_heading_and_body()
    {
        // a11y: a screen reader announces the heading + body when the conflict banner drops in.
        var projection = EditConflictBannerProjection.Project(Conflict(), null, Localizer);

        Assert.Equal($"{projection.Title}. {projection.Body}", projection.AccessibleName);
    }

    [Fact]
    public void Projection_throws_when_inputs_are_null()
    {
        Assert.Throws<ArgumentNullException>(() => EditConflictBannerProjection.Project(null!, null, Localizer));
        Assert.Throws<ArgumentNullException>(() => EditConflictBannerProjection.Project(EditLeaseSnapshot.None, null, null!));
    }

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void View_model_initial_projection_reflects_the_seam()
    {
        var source = new StaticEditLeaseSource(Conflict("peer-2"));
        using var vm = new EditConflictBannerViewModel(Localizer, source);

        Assert.True(vm.IsVisible);
        Assert.Equal("peer-2", vm.OtherTabId);
        Assert.Equal("Take over editing", vm.TakeOverLabel);
    }

    [Fact]
    public void View_model_reprojects_when_the_lease_changes()
    {
        var source = new StaticEditLeaseSource(EditLeaseSnapshot.None);
        using var vm = new EditConflictBannerViewModel(Localizer, source);
        Assert.False(vm.IsVisible);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.Set(Conflict());

        Assert.True(vm.IsVisible);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_take_over_forwards_to_the_seam_claim()
    {
        var source = new StaticEditLeaseSource(Conflict());
        using var vm = new EditConflictBannerViewModel(Localizer, source);

        vm.TakeOver();

        Assert.Equal(1, source.ClaimCount);
        // After claiming we own the lease, so the banner collapses (web claim() clears otherTab).
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void View_model_uses_the_labelled_body_when_constructed_with_a_resource_label()
    {
        var source = new StaticEditLeaseSource(Conflict());
        using var vm = new EditConflictBannerViewModel(Localizer, source, "This automation");

        Assert.Equal(
            "This automation is open in another tab of this browser. Saving here will overwrite changes made there.",
            vm.Body);
    }

    [Fact]
    public void View_model_unsubscribes_on_dispose()
    {
        var source = new StaticEditLeaseSource(EditLeaseSnapshot.None);
        var vm = new EditConflictBannerViewModel(Localizer, source);
        vm.Dispose();

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        source.Set(Conflict());

        Assert.Equal(0, raised);
    }

    // ── static seam ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_source_set_raises_changed_and_moves_current()
    {
        var source = new StaticEditLeaseSource();
        Assert.False(source.Current.IsConflict);

        var raised = 0;
        source.Changed += (_, _) => raised++;
        source.Set(Conflict("peer-x"));

        Assert.Equal(1, raised);
        Assert.Equal("peer-x", source.Current.OtherTab!.TabId);
    }

    [Fact]
    public void Static_source_claim_takes_ownership_and_counts()
    {
        var source = new StaticEditLeaseSource(Conflict());
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Claim();

        Assert.True(source.Current.IsOwner);
        Assert.Null(source.Current.OtherTab);
        Assert.Equal(1, source.ClaimCount);
        Assert.Equal(1, raised);
    }

    // ── coordinator: the election protocol (the adapter unit test) ────────────────────────────────────────

    [Fact]
    public void Coordinator_self_grants_when_no_peer_responds()
    {
        var hub = new EditLeaseBusHub();
        var scheduler = new ManualEditLeaseScheduler();
        using var only = new EditLeaseCoordinator("settings/general", hub.Connect("solo"), scheduler, () => 1000);

        Assert.False(only.Current.IsOwner);

        scheduler.FireAll();

        Assert.True(only.Current.IsOwner);
        Assert.Null(only.Current.OtherTab);
    }

    [Fact]
    public void Coordinator_surfaces_a_conflict_to_the_late_window()
    {
        var hub = new EditLeaseBusHub();
        var scheduler = new ManualEditLeaseScheduler();
        using var a = new EditLeaseCoordinator("automation/42", hub.Connect("tab-a"), scheduler, () => 1000);
        using var b = new EditLeaseCoordinator("automation/42", hub.Connect("tab-b"), scheduler, () => 1000);

        scheduler.FireAll();

        Assert.True(a.Current.IsOwner);
        Assert.False(b.Current.IsOwner);
        Assert.True(b.Current.IsConflict);
        Assert.Equal("tab-a", b.Current.OtherTab!.TabId);
    }

    [Fact]
    public void Coordinator_take_over_flips_ownership_to_the_claiming_window()
    {
        var hub = new EditLeaseBusHub();
        var scheduler = new ManualEditLeaseScheduler();
        using var a = new EditLeaseCoordinator("alert-rules/list", hub.Connect("tab-a"), scheduler, () => 1000);
        using var b = new EditLeaseCoordinator("alert-rules/list", hub.Connect("tab-b"), scheduler, () => 1000);
        scheduler.FireAll();
        Assert.True(a.Current.IsOwner);

        b.Claim();

        Assert.True(b.Current.IsOwner);
        Assert.Null(b.Current.OtherTab);
        Assert.False(a.Current.IsOwner);
        Assert.True(a.Current.IsConflict);
        Assert.Equal("tab-b", a.Current.OtherTab!.TabId);
    }

    [Fact]
    public void Coordinator_re_elects_when_the_owning_window_releases()
    {
        var hub = new EditLeaseBusHub();
        var scheduler = new ManualEditLeaseScheduler();
        var a = new EditLeaseCoordinator("settings/anonymous/general", hub.Connect("tab-a"), scheduler, () => 1000);
        using var b = new EditLeaseCoordinator("settings/anonymous/general", hub.Connect("tab-b"), scheduler, () => 1000);
        scheduler.FireAll();
        Assert.True(b.Current.IsConflict);

        // The owner's window closes (web unmount → lease.released): the watcher drops the peer and re-elects.
        a.Dispose();

        Assert.False(b.Current.IsConflict);
        Assert.Null(b.Current.OtherTab);

        scheduler.FireAll();

        Assert.True(b.Current.IsOwner);
    }

    [Fact]
    public void Coordinator_answers_a_request_from_a_newly_opened_window()
    {
        var hub = new EditLeaseBusHub();
        var scheduler = new ManualEditLeaseScheduler();
        using var owner = new EditLeaseCoordinator("automation/42", hub.Connect("tab-owner"), scheduler, () => 1000);
        scheduler.FireAll();
        Assert.True(owner.Current.IsOwner);

        // A third window opens after the owner is established; its mount-time request must draw an immediate grant.
        using var late = new EditLeaseCoordinator("automation/42", hub.Connect("tab-late"), scheduler, () => 1000);

        Assert.True(late.Current.IsConflict);
        Assert.Equal("tab-owner", late.Current.OtherTab!.TabId);
    }

    [Fact]
    public void Coordinator_tiebreaker_yields_to_an_equal_claim_with_a_lower_tab_id()
    {
        var hub = new EditLeaseBusHub();
        var scheduler = new ManualEditLeaseScheduler();
        using var coordinator = new EditLeaseCoordinator("settings/general", hub.Connect("tab-zzz"), scheduler, () => 1000);
        scheduler.FireAll();
        Assert.True(coordinator.Current.IsOwner);

        // A peer announces the SAME claim instant with a lexicographically lower tab id — it wins the tiebreaker.
        var probe = hub.Connect("tab-aaa");
        probe.Publish(new EditLeaseMessage(EditLeaseMessageKind.Granted, "settings/general", "tab-aaa", 1000));

        Assert.False(coordinator.Current.IsOwner);
        Assert.Equal("tab-aaa", coordinator.Current.OtherTab!.TabId);
    }

    [Fact]
    public void Coordinator_tiebreaker_holds_ownership_against_an_equal_claim_with_a_higher_tab_id()
    {
        var hub = new EditLeaseBusHub();
        var scheduler = new ManualEditLeaseScheduler();
        using var coordinator = new EditLeaseCoordinator("settings/general", hub.Connect("tab-aaa"), scheduler, () => 1000);
        scheduler.FireAll();
        Assert.True(coordinator.Current.IsOwner);

        var probe = hub.Connect("tab-zzz");
        var reasserts = 0;
        probe.Received += message =>
        {
            if (message is { Kind: EditLeaseMessageKind.Granted, TabId: "tab-aaa" })
            {
                reasserts++;
            }
        };

        // A higher-tab-id peer with an equal claim loses; the owner re-asserts and keeps the lease.
        probe.Publish(new EditLeaseMessage(EditLeaseMessageKind.Granted, "settings/general", "tab-zzz", 1000));

        Assert.True(coordinator.Current.IsOwner);
        Assert.Equal(1, reasserts);
    }

    [Fact]
    public void Coordinator_ignores_messages_for_other_resources()
    {
        var hub = new EditLeaseBusHub();
        var scheduler = new ManualEditLeaseScheduler();
        using var coordinator = new EditLeaseCoordinator("settings/general", hub.Connect("tab-a"), scheduler, () => 1000);
        scheduler.FireAll();

        var probe = hub.Connect("tab-b");
        probe.Publish(new EditLeaseMessage(EditLeaseMessageKind.Granted, "a-different-resource", "tab-b", 5000));

        Assert.True(coordinator.Current.IsOwner);
        Assert.Null(coordinator.Current.OtherTab);
    }

    // ── bus ───────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Bus_delivers_to_other_endpoints_but_never_the_sender()
    {
        var hub = new EditLeaseBusHub();
        var a = hub.Connect("a");
        var b = hub.Connect("b");

        var aHeard = 0;
        var bHeard = 0;
        a.Received += _ => aHeard++;
        b.Received += _ => bHeard++;

        a.Publish(new EditLeaseMessage(EditLeaseMessageKind.Request, "k", "a", 0));

        Assert.Equal(0, aHeard);
        Assert.Equal(1, bHeard);
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_only_operational_lines_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new EditConflictBannerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordTakeOver();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.TakeOvers);
        Assert.Equal(
            new[] { "view.opened slug=EditConflictBanner", "edit-conflict.take-over slug=EditConflictBanner" },
            lines);
    }

    private sealed class ManualEditLeaseScheduler : IEditLeaseScheduler
    {
        private readonly List<Pending> _pending = new();

        public IDisposable Schedule(TimeSpan delay, Action callback)
        {
            var pending = new Pending(callback);
            _pending.Add(pending);
            return pending;
        }

        public void FireAll()
        {
            var due = _pending.Where(p => !p.Cancelled).ToArray();
            foreach (var pending in due)
            {
                pending.Cancelled = true;
                pending.Callback();
            }
        }

        private sealed class Pending : IDisposable
        {
            public Pending(Action callback) => Callback = callback;

            public Action Callback { get; }

            public bool Cancelled { get; set; }

            public void Dispose() => Cancelled = true;
        }
    }
}
