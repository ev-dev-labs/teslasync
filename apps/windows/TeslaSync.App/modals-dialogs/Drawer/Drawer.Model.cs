using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// Edge a <see cref="Drawer"/> slides in from — the native, WinUI-free mirror of the web <c>Drawer</c>
/// <c>side</c> union (<c>'left' | 'right'</c>, web/src/components/ui/Drawer.tsx). Declared in the surface's own
/// namespace (rather than reusing the atomic <c>TeslaSync.App.Components.UI.DrawerSide</c>) so the surface's
/// state holder and projection stay free of any WinUI dependency and can be asserted headlessly.
/// </summary>
public enum DrawerSide
{
    /// <summary>Anchored to the left edge (web <c>side='left'</c>).</summary>
    Left,

    /// <summary>Anchored to the right edge (web <c>side='right'</c>) — the web default.</summary>
    Right,
}

/// <summary>
/// Canonical metadata, dimensions and i18n keys for the <c>Drawer</c> modal/dialog surface — the native mirror
/// of <c>web/src/components/ui/Drawer.tsx</c>. The web component is a low-level presentational container: its
/// only literals are the dialog's fallback accessible name (<c>aria-label={title || 'Panel'}</c>) and the close
/// affordance (<c>aria-label="Close"</c>). Both are keyed here (with the web literal as the English fallback) so
/// the native view and view-model resolve every string through the i18n facade. UI-free so every key, fallback
/// and bound is asserted in tests.
/// </summary>
public static class DrawerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Drawer";

    /// <summary>
    /// Drawer pane width in effective pixels — the web <c>max-w-md</c> cap (28rem = 448px) the <c>w-full</c>
    /// panel is bounded by. The view clamps this to the window width so a narrow window shows a full-width pane.
    /// </summary>
    public const double DefaultPaneWidth = 448;

    /// <summary>The default edge the drawer slides in from (web <c>side = 'right'</c>).</summary>
    public const DrawerSide DefaultSide = DrawerSide.Right;

    /// <summary>Close affordance label (web close button <c>aria-label="Close"</c>).</summary>
    public static string CloseLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.close", "Close");

    /// <summary>Dialog fallback accessible name (web <c>aria-label={title || 'Panel'}</c>).</summary>
    public static string PanelLabel(ILocalizer localizer) =>
        Require(localizer).GetString("common.panel", "Panel");

    /// <summary>Friendly empty-body message shown when no content is supplied (so the body is never blank).</summary>
    public static string EmptyMessage(ILocalizer localizer) =>
        Require(localizer).GetString("common.noData", "No data available");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// Pure, WinUI-free projections for the <c>Drawer</c> surface — the native analogue of the web component's
/// conditional render branches: the dialog accessible name (<c>aria-label={title || 'Panel'}</c>) and the
/// header gate (<c>{title &amp;&amp; ...}</c>). Asserted headlessly so the view-model never resolves a literal.
/// </summary>
public static class DrawerProjection
{
    /// <summary>
    /// The dialog's accessible name — the native analogue of <c>aria-label={title || 'Panel'}</c>: the trimmed
    /// title when present, else the localized <paramref name="panelFallback"/>.
    /// </summary>
    public static string ResolveAccessibleName(string? title, string panelFallback)
    {
        ArgumentNullException.ThrowIfNull(panelFallback);
        string trimmed = (title ?? string.Empty).Trim();
        return trimmed.Length > 0 ? trimmed : panelFallback;
    }

    /// <summary>True when a non-empty title is supplied (web <c>{title &amp;&amp; &lt;header&gt;}</c>): the header renders.</summary>
    public static bool HasTitle(string? title) => !string.IsNullOrWhiteSpace(title);
}

/// <summary>
/// PII-safe diagnostics for the <c>Drawer</c> surface (P1/S11 diagnostics contract). Records only operational
/// counters with the surface slug — never the title or any hosted content — so a diagnostics line can never leak
/// surface content. Thread-safe.
/// </summary>
public sealed class DrawerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _closes;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DrawerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the surface has been closed / dismissed.</summary>
    public long Closes => Interlocked.Read(ref _closes);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Drawer</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"view.opened slug={DrawerRegistration.Slug}"));
    }

    /// <summary>Record that the surface was closed (web <c>onClose</c>), emitting <c>drawer.closed slug=Drawer</c>.</summary>
    public void RecordClosed()
    {
        Interlocked.Increment(ref _closes);
        _sink?.Invoke(string.Create(CultureInfo.InvariantCulture, $"drawer.closed slug={DrawerRegistration.Slug}"));
    }
}
