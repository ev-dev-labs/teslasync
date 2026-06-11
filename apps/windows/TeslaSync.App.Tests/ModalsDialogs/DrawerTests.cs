using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the Drawer modal-dialog surface's UI-thread-free logic — the registration metadata
/// (slug, pane-width cap, default edge), the accessible-name / header-gate projections that mirror the web
/// <c>aria-label={title || 'Panel'}</c> + <c>{title &amp;&amp; ...}</c> branches, the state-holder view-model's
/// open / close lifecycle (idempotent transitions, the Opened / Closed events that mirror <c>open</c> +
/// <c>onClose</c>, and the title / side / slot-occupancy state), the i18n key + fallback contract that doubles
/// as the Narrator-label source, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/ui/Drawer.tsx). The WinUI view itself (Drawer.cs) is exercised by the app build.
/// </summary>
public sealed class DrawerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Registration metadata ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_canonical_metadata()
    {
        Assert.Equal("Drawer", DrawerRegistration.Slug);
        Assert.Equal(448d, DrawerRegistration.DefaultPaneWidth);
        Assert.Equal(DrawerSide.Right, DrawerRegistration.DefaultSide);
    }

    // ── Projection: accessible name (web aria-label={title || 'Panel'}) ──────────────────────────────────

    [Theory]
    [InlineData("Filters", "Filters")]
    [InlineData("  Filters  ", "Filters")]
    public void ResolveAccessibleName_uses_the_trimmed_title_when_present(string title, string expected) =>
        Assert.Equal(expected, DrawerProjection.ResolveAccessibleName(title, "Panel"));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ResolveAccessibleName_falls_back_to_the_panel_label_when_blank(string? title) =>
        Assert.Equal("Panel", DrawerProjection.ResolveAccessibleName(title, "Panel"));

    // ── Projection: header gate (web {title && ...}) ─────────────────────────────────────────────────────

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData("Filters", true)]
    [InlineData("  Filters  ", true)]
    public void HasTitle_requires_a_non_empty_trimmed_title(string? title, bool expected) =>
        Assert.Equal(expected, DrawerProjection.HasTitle(title));

    // ── View-model: initial (closed) state ───────────────────────────────────────────────────────────────

    [Fact]
    public void Initial_state_matches_web_defaults()
    {
        var vm = new DrawerViewModel(Localizer);

        Assert.False(vm.IsOpen);
        Assert.Equal(DrawerSide.Right, vm.Side);
        Assert.False(vm.HasTitle);
        Assert.False(vm.HasContent);
        Assert.False(vm.HasFooter);
        Assert.Equal(string.Empty, vm.Title);
        Assert.Equal("Panel", vm.AccessibleName);
    }

    [Fact]
    public void Constructor_honours_the_supplied_side()
    {
        var vm = new DrawerViewModel(Localizer, DrawerSide.Left);

        Assert.Equal(DrawerSide.Left, vm.Side);
    }

    // ── View-model: open lifecycle (web open = true) ─────────────────────────────────────────────────────

    [Fact]
    public void Open_sets_state_raises_opened_and_records_once()
    {
        var lines = new List<string>();
        var diag = new DrawerDiagnostics(lines.Add);
        var vm = new DrawerViewModel(Localizer, DrawerSide.Right, diag);
        int opens = 0;
        var changed = new List<string?>();
        vm.Opened += (_, _) => opens++;
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Open();

        Assert.True(vm.IsOpen);
        Assert.Equal(1, opens);
        Assert.Equal(1, diag.ViewsOpened);
        Assert.Equal("view.opened slug=Drawer", Assert.Single(lines));
        Assert.Contains(nameof(DrawerViewModel.IsOpen), changed);
    }

    [Fact]
    public void Open_is_idempotent_while_already_open()
    {
        var diag = new DrawerDiagnostics();
        var vm = new DrawerViewModel(Localizer, DrawerSide.Right, diag);
        int opens = 0;
        vm.Opened += (_, _) => opens++;

        vm.Open();
        vm.Open();

        Assert.True(vm.IsOpen);
        Assert.Equal(1, opens);
        Assert.Equal(1, diag.ViewsOpened);
    }

    // ── View-model: close lifecycle (web onClose) ────────────────────────────────────────────────────────

    [Fact]
    public void Close_after_open_clears_state_raises_closed_and_records_once()
    {
        var lines = new List<string>();
        var diag = new DrawerDiagnostics(lines.Add);
        var vm = new DrawerViewModel(Localizer, DrawerSide.Right, diag);
        int closes = 0;
        vm.Closed += (_, _) => closes++;
        vm.Open();
        lines.Clear();

        vm.Close();

        Assert.False(vm.IsOpen);
        Assert.Equal(1, closes);
        Assert.Equal(1, diag.Closes);
        Assert.Equal("drawer.closed slug=Drawer", Assert.Single(lines));
    }

    [Fact]
    public void Close_when_never_opened_is_a_no_op()
    {
        var diag = new DrawerDiagnostics();
        var vm = new DrawerViewModel(Localizer, DrawerSide.Right, diag);
        int closes = 0;
        vm.Closed += (_, _) => closes++;

        vm.Close();

        Assert.False(vm.IsOpen);
        Assert.Equal(0, closes);
        Assert.Equal(0, diag.Closes);
    }

    [Fact]
    public void Close_is_idempotent_while_already_closed()
    {
        var diag = new DrawerDiagnostics();
        var vm = new DrawerViewModel(Localizer, DrawerSide.Right, diag);
        int closes = 0;
        vm.Closed += (_, _) => closes++;
        vm.Open();

        vm.Close();
        vm.Close();

        Assert.Equal(1, closes);
        Assert.Equal(1, diag.Closes);
    }

    // ── View-model: title drives header gate + accessible name (web title) ───────────────────────────────

    [Fact]
    public void Setting_title_updates_header_gate_and_accessible_name()
    {
        var vm = new DrawerViewModel(Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Title = "  Filters  ";

        Assert.True(vm.HasTitle);
        Assert.Equal("Filters", vm.AccessibleName);
        Assert.Contains(nameof(DrawerViewModel.HasTitle), changed);
        Assert.Contains(nameof(DrawerViewModel.AccessibleName), changed);
    }

    [Fact]
    public void Clearing_title_restores_the_panel_fallback_name()
    {
        var vm = new DrawerViewModel(Localizer) { Title = "Filters" };

        vm.Title = string.Empty;

        Assert.False(vm.HasTitle);
        Assert.Equal("Panel", vm.AccessibleName);
    }

    // ── View-model: side + slot occupancy raise change ───────────────────────────────────────────────────

    [Fact]
    public void Setting_side_raises_change()
    {
        var vm = new DrawerViewModel(Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Side = DrawerSide.Left;

        Assert.Equal(DrawerSide.Left, vm.Side);
        Assert.Contains(nameof(DrawerViewModel.Side), changed);
    }

    [Fact]
    public void Setting_slot_occupancy_raises_change()
    {
        var vm = new DrawerViewModel(Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.HasContent = true;
        vm.HasFooter = true;

        Assert.True(vm.HasContent);
        Assert.True(vm.HasFooter);
        Assert.Contains(nameof(DrawerViewModel.HasContent), changed);
        Assert.Contains(nameof(DrawerViewModel.HasFooter), changed);
    }

    // ── Diagnostics (PII-safe, P1/S11) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emit_only_the_slug_without_content()
    {
        var lines = new List<string>();
        var diag = new DrawerDiagnostics(lines.Add);
        var vm = new DrawerViewModel(Localizer, DrawerSide.Right, diag) { Title = "Secret vehicle name" };

        vm.Open();
        vm.Close();

        Assert.Equal(["view.opened slug=Drawer", "drawer.closed slug=Drawer"], lines);
        Assert.DoesNotContain(lines, line => line.Contains("Secret", StringComparison.Ordinal));
    }

    [Fact]
    public void RecordViewOpened_and_RecordClosed_track_counters()
    {
        var diag = new DrawerDiagnostics();

        diag.RecordViewOpened();
        diag.RecordClosed();

        Assert.Equal(1, diag.ViewsOpened);
        Assert.Equal(1, diag.Closes);
    }

    // ── i18n key + fallback contract (the Narrator-label source) ─────────────────────────────────────────

    [Fact]
    public void Every_label_routes_through_a_common_key()
    {
        var recorder = new RecordingLocalizer();
        var vm = new DrawerViewModel(recorder);

        _ = vm.CloseLabel;
        _ = vm.EmptyMessage;
        _ = vm.AccessibleName; // empty title resolves the panel fallback key

        Assert.NotEmpty(recorder.Keys);
        Assert.All(
            recorder.Keys,
            key => Assert.True(
                key.StartsWith("common.", StringComparison.Ordinal),
                $"key '{key}' is not under common.*"));
    }

    [Fact]
    public void English_fallbacks_match_the_web_literals()
    {
        Assert.Equal("Close", DrawerRegistration.CloseLabel(Localizer));
        Assert.Equal("Panel", DrawerRegistration.PanelLabel(Localizer));
        Assert.Equal("No data available", DrawerRegistration.EmptyMessage(Localizer));
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
