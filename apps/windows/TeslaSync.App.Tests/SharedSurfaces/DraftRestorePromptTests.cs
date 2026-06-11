using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the DraftRestorePrompt surface's UI-thread-free logic — the registration slug +
/// i18n keys/fallbacks (<see cref="DraftRestorePromptRegistration"/>), the relative-time + plural-body +
/// saved-at adapters (<see cref="DraftRestoreFormatting"/> / <see cref="DraftRestoreProjection"/>), the
/// observable in-memory store (<see cref="InMemoryDraftStore"/>), the grace-period evaluation + cross-window
/// suppression + session-guard + review / resume / discard / live-prune state machine
/// (<see cref="DraftRestorePromptViewModel"/>) and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/feedback/DraftRestorePrompt.tsx + lib/draftIndex + lib/broadcast + lib/dateFormat). The
/// WinUI view (DraftRestorePrompt.cs, which composes a TsGlassPanel card + a TsModal review dialog) is exercised
/// by the app build.
/// </summary>
public sealed class DraftRestorePromptTests
{
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private sealed class RecordingNavigator : IDraftRestoreNavigator
    {
        public List<string> Routes { get; } = new();

        public void Navigate(string route) => Routes.Add(route);
    }

    private static DraftEntry Entry(string key, int minutesAgo, string? label = null, string? route = null) =>
        new(
            StorageKey: $"teslasync:draft:v1:{key}",
            Key: key,
            Version: 1,
            Label: label ?? string.Empty,
            Route: route ?? $"/{key}",
            SavedAt: Now.AddMinutes(-minutesAgo));

    private static (DraftRestorePromptViewModel Vm, InMemoryDraftStore Store, InMemoryDraftPresenceSource Presence,
        InMemoryDraftPromptSessionGuard Guard, RecordingNavigator Navigator) NewViewModel(
            IEnumerable<DraftEntry>? seed = null,
            ILocalizer? localizer = null,
            DraftRestorePromptDiagnostics? diagnostics = null,
            bool skipSessionGuard = false)
    {
        var store = new InMemoryDraftStore();
        foreach (DraftEntry e in seed ?? Array.Empty<DraftEntry>())
        {
            store.Register(e);
        }

        var presence = new InMemoryDraftPresenceSource();
        var guard = new InMemoryDraftPromptSessionGuard();
        var navigator = new RecordingNavigator();
        var vm = new DraftRestorePromptViewModel(
            store,
            presence,
            guard,
            navigator,
            localizer ?? PassthroughLocalizer.Instance,
            diagnostics,
            () => Now,
            skipSessionGuard);
        return (vm, store, presence, guard, navigator);
    }

    // ── registration (diagnostics slug + i18n keys/fallbacks, web verbatim) ──────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("DraftRestorePrompt", DraftRestorePromptRegistration.Slug);

    [Theory]
    [InlineData(DraftRestorePromptRegistration.PromptTitleKey, "draft.recovery.promptTitle")]
    [InlineData(DraftRestorePromptRegistration.PromptBodyKey, "draft.recovery.promptBody")]
    [InlineData(DraftRestorePromptRegistration.ReviewKey, "draft.recovery.review")]
    [InlineData(DraftRestorePromptRegistration.DismissKey, "draft.recovery.dismiss")]
    [InlineData(DraftRestorePromptRegistration.CloseKey, "draft.recovery.close")]
    [InlineData(DraftRestorePromptRegistration.ModalTitleKey, "draft.recovery.modalTitle")]
    [InlineData(DraftRestorePromptRegistration.ModalBodyKey, "draft.recovery.modalBody")]
    [InlineData(DraftRestorePromptRegistration.EmptyKey, "draft.recovery.empty")]
    [InlineData(DraftRestorePromptRegistration.FallbackLabelKey, "draft.recovery.fallbackLabel")]
    [InlineData(DraftRestorePromptRegistration.SavedAtKey, "draft.recovery.savedAt")]
    [InlineData(DraftRestorePromptRegistration.ResumeKey, "draft.recovery.resume")]
    [InlineData(DraftRestorePromptRegistration.DiscardKey, "draft.recovery.discard")]
    public void I18n_keys_match_the_web_keys(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(DraftRestorePromptRegistration.PromptTitleFallback, "Unsaved drafts restored")]
    [InlineData(DraftRestorePromptRegistration.ReviewFallback, "Review")]
    [InlineData(DraftRestorePromptRegistration.DismissFallback, "Dismiss")]
    [InlineData(DraftRestorePromptRegistration.CloseFallback, "Close")]
    [InlineData(DraftRestorePromptRegistration.ModalTitleFallback, "Restore unsaved drafts")]
    [InlineData(DraftRestorePromptRegistration.EmptyFallback, "No drafts to restore.")]
    [InlineData(DraftRestorePromptRegistration.FallbackLabelFallback, "Unsaved draft")]
    [InlineData(DraftRestorePromptRegistration.SavedAtFallback, "Saved {{when}}")]
    [InlineData(DraftRestorePromptRegistration.ResumeFallback, "Resume")]
    [InlineData(DraftRestorePromptRegistration.DiscardFallback, "Discard")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    // ── adapter: relative-time tiers (web formatRelativeTime) ────────────────────────────────────────────

    [Fact]
    public void Relative_time_under_a_minute_reads_just_now() =>
        Assert.Equal("Just now", DraftRestoreFormatting.FormatRelativeTime(Now.AddSeconds(-30), Now, CultureInfo.InvariantCulture));

    [Fact]
    public void Relative_time_future_instant_reads_just_now() =>
        Assert.Equal("Just now", DraftRestoreFormatting.FormatRelativeTime(Now.AddMinutes(5), Now, CultureInfo.InvariantCulture));

    [Fact]
    public void Relative_time_minutes_tier() =>
        Assert.Equal("5m ago", DraftRestoreFormatting.FormatRelativeTime(Now.AddMinutes(-5), Now, CultureInfo.InvariantCulture));

    [Fact]
    public void Relative_time_hours_tier() =>
        Assert.Equal("2h ago", DraftRestoreFormatting.FormatRelativeTime(Now.AddMinutes(-150), Now, CultureInfo.InvariantCulture));

    [Fact]
    public void Relative_time_over_a_day_falls_back_to_absolute_date()
    {
        var savedAt = new DateTimeOffset(2026, 6, 1, 2, 30, 0, TimeSpan.Zero);
        Assert.Equal("Jun 1, 02:30 AM", DraftRestoreFormatting.FormatRelativeTime(savedAt, Now, CultureInfo.InvariantCulture));
    }

    // ── adapter: plural body + saved-at interpolation (web i18next tokens) ───────────────────────────────

    [Fact]
    public void Prompt_body_singular_template_for_one_draft() =>
        Assert.Equal(
            "You have 1 unsaved draft from a previous session.",
            DraftRestorePromptRegistration.FormatPromptBody(PassthroughLocalizer.Instance, 1));

    [Fact]
    public void Prompt_body_plural_template_for_many_drafts() =>
        Assert.Equal(
            "You have 3 unsaved drafts from a previous session.",
            DraftRestorePromptRegistration.FormatPromptBody(PassthroughLocalizer.Instance, 3));

    [Fact]
    public void Saved_at_interpolates_the_when_token() =>
        Assert.Equal("Saved 5m ago", DraftRestorePromptRegistration.FormatSavedAt("Saved {{when}}", "5m ago"));

    [Fact]
    public void Saved_at_interpolates_the_native_positional_token() =>
        Assert.Equal("Saved 5m ago", DraftRestorePromptRegistration.FormatSavedAt("Saved {0}", "5m ago"));

    // ── adapter: projection (label fallback + saved-at caption + a11y name) ──────────────────────────────

    [Fact]
    public void Projection_applies_the_label_fallback_when_the_label_is_blank()
    {
        var rows = DraftRestoreProjection.Project(
            new[] { Entry("alertstudio:rule:42", 5) },
            Now,
            CultureInfo.InvariantCulture,
            PassthroughLocalizer.Instance);

        Assert.Single(rows);
        Assert.Equal("Unsaved draft", rows[0].Label);
        Assert.Equal("Saved 5m ago", rows[0].SavedAtText);
        Assert.Equal("Unsaved draft, Saved 5m ago", rows[0].AutomationName);
    }

    [Fact]
    public void Projection_keeps_an_explicit_label()
    {
        var rows = DraftRestoreProjection.Project(
            new[] { Entry("alertstudio:rule:42", 5, label: "Brake-temp alert") },
            Now,
            CultureInfo.InvariantCulture,
            PassthroughLocalizer.Instance);

        Assert.Equal("Brake-temp alert", rows[0].Label);
    }

    // ── store adapter: ordering, discard, change signal (web getDrafts / discardDraftEnvelope) ───────────

    [Fact]
    public void Store_returns_drafts_newest_first()
    {
        var store = new InMemoryDraftStore();
        store.Register(Entry("a", 60));
        store.Register(Entry("b", 5));
        store.Register(Entry("c", 30));

        var drafts = store.GetDrafts();

        Assert.Equal(new[] { "b", "c", "a" }, drafts.Select(d => d.Key).ToArray());
    }

    [Fact]
    public void Store_discard_removes_the_entry_and_raises_changed()
    {
        var store = new InMemoryDraftStore();
        store.Register(Entry("a", 5));
        bool raised = false;
        store.Changed += (_, _) => raised = true;

        store.DiscardDraft("teslasync:draft:v1:a");

        Assert.Empty(store.GetDrafts());
        Assert.True(raised);
    }

    [Fact]
    public void Store_discard_of_unknown_key_is_a_noop()
    {
        var store = new InMemoryDraftStore();
        store.Register(Entry("a", 5));
        bool raised = false;
        store.Changed += (_, _) => raised = true;

        store.DiscardDraft("teslasync:draft:v1:missing");

        Assert.Single(store.GetDrafts());
        Assert.False(raised);
    }

    // ── state: idle until the grace evaluation surfaces a draft (web mount effect) ───────────────────────

    [Fact]
    public void Starts_idle()
    {
        var (vm, _, _, _, _) = NewViewModel(new[] { Entry("a", 5) });

        Assert.Equal(DraftRestoreState.Idle, vm.State);
        Assert.False(vm.IsPromptVisible);
    }

    [Fact]
    public void Surfaces_the_prompt_after_evaluation_when_a_draft_exists()
    {
        var (vm, _, _, _, _) = NewViewModel(new[] { Entry("a", 5) });

        vm.BeginEvaluation();
        vm.CompleteEvaluation();

        Assert.Equal(DraftRestoreState.Prompt, vm.State);
        Assert.True(vm.IsPromptVisible);
        Assert.Equal(1, vm.Count);
    }

    [Fact]
    public void Stays_idle_when_there_are_no_drafts()
    {
        var (vm, _, _, _, _) = NewViewModel();

        vm.BeginEvaluation();
        vm.CompleteEvaluation();

        Assert.Equal(DraftRestoreState.Idle, vm.State);
    }

    [Fact]
    public void Evaluation_is_one_shot()
    {
        var (vm, store, _, _, _) = NewViewModel();

        vm.BeginEvaluation();
        vm.CompleteEvaluation();
        Assert.Equal(DraftRestoreState.Idle, vm.State);

        // A draft registered after the one-shot evaluation does not re-surface (web evaluatedRef).
        store.Register(Entry("late", 1));
        vm.BeginEvaluation();
        vm.CompleteEvaluation();

        Assert.Equal(DraftRestoreState.Idle, vm.State);
    }

    // ── state: session guard one-shot (web sessionStorage flag) ──────────────────────────────────────────

    [Fact]
    public void Session_guard_suppresses_the_prompt_for_the_session()
    {
        var (vm, _, _, guard, _) = NewViewModel(new[] { Entry("a", 5) });
        guard.MarkDismissed();

        vm.BeginEvaluation();
        vm.CompleteEvaluation();

        Assert.Equal(DraftRestoreState.Idle, vm.State);
    }

    [Fact]
    public void Skip_session_guard_surfaces_even_when_dismissed()
    {
        var (vm, _, _, guard, _) = NewViewModel(new[] { Entry("a", 5) }, skipSessionGuard: true);
        guard.MarkDismissed();

        vm.BeginEvaluation();
        vm.CompleteEvaluation();

        Assert.Equal(DraftRestoreState.Prompt, vm.State);
    }

    // ── state: cross-window presence suppression (web formDraft.acquired / released) ─────────────────────

    [Fact]
    public void Cross_window_acquired_suppresses_that_draft()
    {
        var (vm, _, presence, _, _) = NewViewModel(new[] { Entry("a", 5), Entry("b", 5) });

        vm.BeginEvaluation();
        presence.Acquire("teslasync:draft:v1:a");
        vm.CompleteEvaluation();

        Assert.Equal(DraftRestoreState.Prompt, vm.State);
        Assert.Equal(1, vm.Count);
        Assert.Equal("b", vm.Drafts[0].Key);
    }

    [Fact]
    public void All_drafts_claimed_by_peers_keeps_the_prompt_hidden()
    {
        var (vm, _, presence, _, _) = NewViewModel(new[] { Entry("a", 5) });

        vm.BeginEvaluation();
        presence.Acquire("teslasync:draft:v1:a");
        vm.CompleteEvaluation();

        Assert.Equal(DraftRestoreState.Idle, vm.State);
    }

    [Fact]
    public void Released_cancels_the_suppression()
    {
        var (vm, _, presence, _, _) = NewViewModel(new[] { Entry("a", 5) });

        vm.BeginEvaluation();
        presence.Acquire("teslasync:draft:v1:a");
        presence.Release("teslasync:draft:v1:a");
        vm.CompleteEvaluation();

        Assert.Equal(DraftRestoreState.Prompt, vm.State);
        Assert.Equal(1, vm.Count);
    }

    // ── state: review modal (web handleReview) ───────────────────────────────────────────────────────────

    [Fact]
    public void Review_opens_the_modal_and_projects_rows()
    {
        var (vm, _, _, _, _) = NewViewModel(new[] { Entry("a", 5, label: "Alert rule") });
        vm.BeginEvaluation();
        vm.CompleteEvaluation();

        vm.Review();

        Assert.Equal(DraftRestoreState.Review, vm.State);
        Assert.True(vm.IsReviewOpen);
        Assert.Single(vm.Rows);
        Assert.Equal("Alert rule", vm.Rows[0].Label);
    }

    [Fact]
    public void Review_is_a_noop_while_idle()
    {
        var (vm, _, _, _, _) = NewViewModel(new[] { Entry("a", 5) });

        vm.Review();

        Assert.Equal(DraftRestoreState.Idle, vm.State);
    }

    // ── state: discard (web handleDiscard) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Discard_removes_the_draft_from_the_store_and_prunes_the_row()
    {
        var (vm, store, _, _, _) = NewViewModel(new[] { Entry("a", 5), Entry("b", 10) });
        vm.BeginEvaluation();
        vm.CompleteEvaluation();
        vm.Review();

        DraftEntry first = vm.Drafts[0];
        vm.Discard(first);

        Assert.Equal(DraftRestoreState.Review, vm.State);
        Assert.Equal(1, vm.Count);
        Assert.DoesNotContain(store.GetDrafts(), d => d.StorageKey == first.StorageKey);
    }

    [Fact]
    public void Discarding_the_last_draft_closes_the_surface()
    {
        var (vm, _, _, _, _) = NewViewModel(new[] { Entry("a", 5) });
        vm.BeginEvaluation();
        vm.CompleteEvaluation();
        vm.Review();

        vm.Discard(vm.Drafts[0]);

        Assert.Equal(DraftRestoreState.Idle, vm.State);
        Assert.Equal(0, vm.Count);
    }

    [Fact]
    public void Discard_does_not_set_the_session_guard()
    {
        var (vm, _, _, guard, _) = NewViewModel(new[] { Entry("a", 5) });
        vm.BeginEvaluation();
        vm.CompleteEvaluation();
        vm.Review();

        vm.Discard(vm.Drafts[0]);

        Assert.False(guard.IsDismissed);
    }

    // ── state: resume (web handleResume) ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Resume_navigates_marks_the_guard_and_closes()
    {
        var (vm, _, _, guard, navigator) = NewViewModel(new[] { Entry("a", 5, route: "/alert-studio?id=42") });
        vm.BeginEvaluation();
        vm.CompleteEvaluation();
        vm.Review();

        vm.Resume(vm.Drafts[0]);

        Assert.Equal(new[] { "/alert-studio?id=42" }, navigator.Routes.ToArray());
        Assert.True(guard.IsDismissed);
        Assert.Equal(DraftRestoreState.Idle, vm.State);
    }

    // ── state: dismiss (web handleDismiss) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Dismiss_marks_the_guard_and_closes()
    {
        var (vm, _, _, guard, _) = NewViewModel(new[] { Entry("a", 5) });
        vm.BeginEvaluation();
        vm.CompleteEvaluation();

        vm.Dismiss();

        Assert.True(guard.IsDismissed);
        Assert.Equal(DraftRestoreState.Idle, vm.State);
    }

    // ── state: live index prune while reviewing (web subscribeDraftIndex effect) ─────────────────────────

    [Fact]
    public void Sibling_window_discard_prunes_the_open_modal()
    {
        var (vm, store, _, _, _) = NewViewModel(new[] { Entry("a", 5), Entry("b", 10) });
        vm.BeginEvaluation();
        vm.CompleteEvaluation();
        vm.Review();

        // A peer window discards draft "a" — the store change must prune the row here.
        store.DiscardDraft("teslasync:draft:v1:a");

        Assert.Equal(1, vm.Count);
        Assert.Equal("b", vm.Drafts[0].Key);
        Assert.Equal(DraftRestoreState.Review, vm.State);
    }

    [Fact]
    public void Sibling_window_discarding_all_closes_the_modal()
    {
        var (vm, store, _, _, _) = NewViewModel(new[] { Entry("a", 5) });
        vm.BeginEvaluation();
        vm.CompleteEvaluation();
        vm.Review();

        store.DiscardDraft("teslasync:draft:v1:a");

        Assert.Equal(DraftRestoreState.Idle, vm.State);
    }

    [Fact]
    public void Store_changes_are_ignored_before_the_modal_opens()
    {
        var (vm, store, _, _, _) = NewViewModel(new[] { Entry("a", 5) });
        vm.BeginEvaluation();
        vm.CompleteEvaluation();

        // In the prompt (card) state the web does not subscribe to the index — a peer discard does not prune.
        store.DiscardDraft("teslasync:draft:v1:a");

        Assert.Equal(DraftRestoreState.Prompt, vm.State);
        Assert.Equal(1, vm.Count);
    }

    // ── accessibility: every label resolves through the i18n facade (P1/S10) ─────────────────────────────

    [Fact]
    public void Labels_resolve_through_the_localizer_keys()
    {
        var localizer = new RecordingLocalizer();
        var (vm, _, _, _, _) = NewViewModel(new[] { Entry("a", 5) }, localizer: localizer);
        vm.BeginEvaluation();
        vm.CompleteEvaluation();
        vm.Review();

        Assert.Equal("Unsaved drafts restored", vm.PromptTitle);
        Assert.Equal("Review", vm.ReviewLabel);
        Assert.Equal("Dismiss", vm.DismissLabel);
        Assert.Equal("Close", vm.CloseLabel);
        Assert.Equal("Restore unsaved drafts", vm.ModalTitle);
        Assert.Equal("No drafts to restore.", vm.EmptyMessage);
        Assert.Equal("Resume", vm.ResumeLabel);
        Assert.Equal("Discard", vm.DiscardLabel);

        // Reading the rows triggers the per-row saved-at + fallback-label keys.
        Assert.Equal("Saved 5m ago", vm.Rows[0].SavedAtText);

        Assert.Contains("draft.recovery.promptTitle", localizer.RequestedKeys);
        Assert.Contains("draft.recovery.review", localizer.RequestedKeys);
        Assert.Contains("draft.recovery.modalTitle", localizer.RequestedKeys);
        Assert.Contains("draft.recovery.savedAt", localizer.RequestedKeys);
    }

    // ── diagnostics (P1/S11): view.opened with the surface slug ──────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_when_the_prompt_surfaces()
    {
        string? captured = null;
        var diagnostics = new DraftRestorePromptDiagnostics(value => captured = value);
        var (vm, _, _, _, _) = NewViewModel(new[] { Entry("a", 5) }, diagnostics: diagnostics);

        vm.BeginEvaluation();
        vm.CompleteEvaluation();

        Assert.Equal("view.opened slug=DraftRestorePrompt", captured);
        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_not_recorded_when_nothing_surfaces()
    {
        var diagnostics = new DraftRestorePromptDiagnostics();
        var (vm, _, _, _, _) = NewViewModel(diagnostics: diagnostics);

        vm.BeginEvaluation();
        vm.CompleteEvaluation();

        Assert.Equal(0, diagnostics.ViewsOpened);
    }
}
