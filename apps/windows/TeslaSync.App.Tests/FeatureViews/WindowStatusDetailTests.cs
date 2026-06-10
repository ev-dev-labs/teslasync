using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SecurityAccess;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>WindowStatusDetail</c> feature surface's UI-thread-free logic — the
/// <c>parseWindowState</c> coercion ladder (the <c>asNonEmptyString</c> guard, the <c>closed</c>/<c>0</c> →
/// vent → open branches), the per-state token-brush mapping (web <c>windowColor</c> / <c>windowTextClass</c>),
/// the <c>WINDOW_KEYS</c> panel order and labels, the i18n key resolution (passthrough fallback and the resw
/// <c>translation.*</c> catalog form), the composed per-panel Narrator name, the no-data (all-Unknown) surface,
/// and the PII-safe diagnostics. Mirrors the web spec
/// (<c>web/src/features/admin/components/security-access/WindowStatusDetail.tsx</c> + <c>helpers.ts</c>). The
/// WinUI view itself (feature-views\WindowStatusDetail\WindowStatusDetail.cs) is exercised by the app build.
/// </summary>
public sealed class WindowStatusDetailTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static WindowStatusDetailModel Model(
        object? fd = null,
        object? fp = null,
        object? rd = null,
        object? rp = null) =>
        new(fd, fp, rd, rp);

    private static WindowStatusDetailDisplay Project(WindowStatusDetailModel model) =>
        WindowStatusDetailProjection.Project(model, Localizer);

    // ── parseWindowState parity (web helpers.ts) ────────────────────────────────────────────────────────

    [Theory]
    [InlineData("Closed", WindowState.Closed)]
    [InlineData("closed", WindowState.Closed)]
    [InlineData("CLOSED", WindowState.Closed)]   // web toLowerCase()
    [InlineData("0", WindowState.Closed)]
    [InlineData("Vent", WindowState.Venting)]
    [InlineData("venting", WindowState.Venting)]
    [InlineData("PartiallyVented", WindowState.Venting)] // web includes('vent')
    [InlineData("Open", WindowState.Open)]
    [InlineData("open", WindowState.Open)]
    [InlineData("1", WindowState.Open)]          // non-empty, not closed/0/vent → Open
    [InlineData("ajar", WindowState.Open)]       // any other non-empty string → Open (web redundant branch)
    [InlineData("", WindowState.Unknown)]        // empty string → asNonEmptyString null → Unknown
    public void ParseWindowState_matches_the_web_helper(string raw, WindowState expected) =>
        Assert.Equal(expected, WindowStatusDetailProjection.ParseWindowState(raw));

    [Fact]
    public void ParseWindowState_treats_non_string_values_as_unknown()
    {
        // Web asNonEmptyString keeps only non-empty strings; null and booleans collapse to Unknown.
        Assert.Equal(WindowState.Unknown, WindowStatusDetailProjection.ParseWindowState(null));
        Assert.Equal(WindowState.Unknown, WindowStatusDetailProjection.ParseWindowState(true));
        Assert.Equal(WindowState.Unknown, WindowStatusDetailProjection.ParseWindowState(false));
        Assert.Equal(WindowState.Unknown, WindowStatusDetailProjection.ParseWindowState(0));
    }

    // ── Token-brush mapping (web windowColor / windowTextClass traffic-light) ───────────────────────────

    [Theory]
    [InlineData(WindowState.Closed, "TsColorSuccessBrush")]
    [InlineData(WindowState.Venting, "TsColorWarningBrush")]
    [InlineData(WindowState.Open, "TsColorDangerBrush")]
    [InlineData(WindowState.Unknown, "TsColorTextMutedBrush")]
    public void AccentBrushKey_maps_each_state_to_its_token_brush(WindowState state, string expectedKey) =>
        Assert.Equal(expectedKey, WindowStatusDetailProjection.AccentBrushKey(state));

    // ── State caption key + fallback (web `admin.security.windowState.${lower}`, default = state) ────────

    [Theory]
    [InlineData(WindowState.Closed, "translation.admin.security.windowState.closed", "Closed")]
    [InlineData(WindowState.Venting, "translation.admin.security.windowState.venting", "Venting")]
    [InlineData(WindowState.Open, "translation.admin.security.windowState.open", "Open")]
    [InlineData(WindowState.Unknown, "translation.admin.security.windowState.unknown", "Unknown")]
    public void State_key_and_fallback_match_the_web_template(WindowState state, string key, string fallback)
    {
        Assert.Equal(key, WindowStatusDetailProjection.StateKey(state));
        Assert.Equal(fallback, WindowStatusDetailProjection.StateFallback(state));
    }

    // ── Per-state "snapshot": every window state renders a complete, distinct panel ─────────────────────

    [Fact]
    public void Closed_window_renders_a_complete_panel()
    {
        var panel = Project(Model(fd: "Closed")).Panels[0];

        Assert.Equal(WindowState.Closed, panel.State);
        Assert.Equal("TsColorSuccessBrush", panel.AccentBrushKey);
        Assert.Equal("Front Driver", panel.Label);
        Assert.Equal("Closed", panel.StateText);
        Assert.Equal("Front Driver: Closed", panel.AutomationName);
    }

    [Fact]
    public void Venting_window_renders_a_complete_panel()
    {
        var panel = Project(Model(fd: "Vent")).Panels[0];

        Assert.Equal(WindowState.Venting, panel.State);
        Assert.Equal("TsColorWarningBrush", panel.AccentBrushKey);
        Assert.Equal("Venting", panel.StateText);
        Assert.Equal("Front Driver: Venting", panel.AutomationName);
    }

    [Fact]
    public void Open_window_renders_a_complete_panel()
    {
        var panel = Project(Model(fd: "Open")).Panels[0];

        Assert.Equal(WindowState.Open, panel.State);
        Assert.Equal("TsColorDangerBrush", panel.AccentBrushKey);
        Assert.Equal("Open", panel.StateText);
        Assert.Equal("Front Driver: Open", panel.AutomationName);
    }

    [Fact]
    public void Unknown_window_renders_a_complete_panel()
    {
        var panel = Project(Model(fd: null)).Panels[0];

        Assert.Equal(WindowState.Unknown, panel.State);
        Assert.Equal("TsColorTextMutedBrush", panel.AccentBrushKey);
        Assert.Equal("Unknown", panel.StateText);
        Assert.Equal("Front Driver: Unknown", panel.AutomationName);
    }

    // ── Panel composition: order, labels, and per-slot parsing (web WINDOW_KEYS.map) ────────────────────

    [Fact]
    public void Panels_follow_the_web_window_keys_order_and_labels()
    {
        var panels = Project(Model()).Panels;

        Assert.Equal(4, panels.Count);
        Assert.Equal("Front Driver", panels[0].Label);
        Assert.Equal("Front Passenger", panels[1].Label);
        Assert.Equal("Rear Driver", panels[2].Label);
        Assert.Equal("Rear Passenger", panels[3].Label);
    }

    [Fact]
    public void Each_panel_parses_its_own_window_value()
    {
        var panels = Project(Model(fd: "Closed", fp: "Vent", rd: "Open", rp: null)).Panels;

        Assert.Equal(WindowState.Closed, panels[0].State);
        Assert.Equal(WindowState.Venting, panels[1].State);
        Assert.Equal(WindowState.Open, panels[2].State);
        Assert.Equal(WindowState.Unknown, panels[3].State);
    }

    // ── No-data surface: a missing `latest` (Empty model) renders every window as Unknown ───────────────

    [Fact]
    public void Empty_model_renders_every_window_as_unknown()
    {
        var panels = Project(WindowStatusDetailModel.Empty).Panels;

        Assert.Equal(4, panels.Count);
        Assert.All(panels, p => Assert.Equal(WindowState.Unknown, p.State));
        Assert.All(panels, p => Assert.Equal("Unknown", p.StateText));
        Assert.All(panels, p => Assert.Equal("TsColorTextMutedBrush", p.AccentBrushKey));
    }

    // ── Title ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Title_resolves_through_the_facade() =>
        Assert.Equal("Window Status Detail", Project(Model()).Title);

    // ── Accessibility: each panel carries a composed Narrator name ──────────────────────────────────────

    [Fact]
    public void Panel_automation_name_composes_label_and_state() =>
        Assert.Equal("Front Driver: Open", Project(Model(fd: "Open")).Panels[0].AutomationName);

    // ── i18n: the projection feeds the exact catalog keys the web uses ──────────────────────────────────

    [Fact]
    public void Projection_feeds_every_catalog_key()
    {
        var spy = new SpyLocalizer();

        WindowStatusDetailProjection.Project(Model(fd: "Closed", fp: "Vent", rd: "Open", rp: null), spy);

        Assert.Contains("translation.admin.security.windowDetail", spy.Keys);
        Assert.Contains("translation.admin.security.window.fd", spy.Keys);
        Assert.Contains("translation.admin.security.window.fp", spy.Keys);
        Assert.Contains("translation.admin.security.window.rd", spy.Keys);
        Assert.Contains("translation.admin.security.window.rp", spy.Keys);
        Assert.Contains("translation.admin.security.windowState.closed", spy.Keys);
        Assert.Contains("translation.admin.security.windowState.venting", spy.Keys);
        Assert.Contains("translation.admin.security.windowState.open", spy.Keys);
        Assert.Contains("translation.admin.security.windowState.unknown", spy.Keys);
    }

    [Fact]
    public void Title_resolves_from_the_resw_catalog_value()
    {
        // The catalog has only `…windowDetail`; the window / state keys are inline-fallback only (exactly as
        // the web catalog, which also lacks them), so they must resolve to their English fallbacks.
        var display = WindowStatusDetailProjection.Project(Model(fd: "Closed"), new ReswLocalizer());

        Assert.Equal("Window Status Detail", display.Title);    // from catalog
        Assert.Equal("Front Driver", display.Panels[0].Label);  // inline fallback
        Assert.Equal("Closed", display.Panels[0].StateText);    // inline fallback
    }

    [Fact]
    public void Projection_injects_no_english_when_the_facade_localizes()
    {
        // A fully localized facade proves the component contributes no hardcoded English — every visible
        // string flows through the i18n seam.
        var loc = new MapLocalizer(new Dictionary<string, string>
        {
            ["translation.admin.security.windowDetail"] = "ウィンドウ状態",
            ["translation.admin.security.window.fd"] = "運転席側前",
            ["translation.admin.security.windowState.closed"] = "閉",
        });

        var display = WindowStatusDetailProjection.Project(Model(fd: "Closed"), loc);

        Assert.Equal("ウィンドウ状態", display.Title);
        Assert.Equal("運転席側前", display.Panels[0].Label);
        Assert.Equal("閉", display.Panels[0].StateText);
        Assert.Equal("運転席側前: 閉", display.Panels[0].AutomationName);
    }

    // ── Diagnostics (P1/S11): view.opened slug=WindowStatusDetail, PII-safe ─────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new WindowStatusDetailDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WindowStatusDetail", captured[0]);
        Assert.Equal("view.opened slug=WindowStatusDetail", captured[1]);
    }

    [Fact]
    public void Diagnostics_never_leaks_window_state()
    {
        var captured = new List<string>();

        new WindowStatusDetailDiagnostics(captured.Add).RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("Open", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Closed", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Vent", line, StringComparison.Ordinal);
    }

    // ── Registration metadata ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("WindowStatusDetail", WindowStatusDetailRegistration.Slug);

    // ── Argument validation ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => WindowStatusDetailProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => WindowStatusDetailProjection.Project(Model(), null!));

    // ── Localizer doubles ───────────────────────────────────────────────────────────────────────────────

    /// <summary>Captures every key the projection resolves, returning the English fallback.</summary>
    private sealed class SpyLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    /// <summary>
    /// Resolves the <c>…windowDetail</c> key to its <c>Strings/{lang}/Resources.resw</c> English catalog value
    /// (as production does) and every other key to its English fallback — proving the projection feeds the
    /// exact catalog key, and that the window / state keys (absent from the catalog, exactly as on the web)
    /// still resolve via the fallback.
    /// </summary>
    private sealed class ReswLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key switch
        {
            WindowStatusDetailProjection.TitleKey => "Window Status Detail",
            _ => fallback,
        };
    }

    /// <summary>Resolves keys from a supplied map, falling back to the English default for the rest.</summary>
    private sealed class MapLocalizer(IReadOnlyDictionary<string, string> map) : ILocalizer
    {
        public string GetString(string key, string fallback) =>
            map.TryGetValue(key, out var value) ? value : fallback;
    }
}
