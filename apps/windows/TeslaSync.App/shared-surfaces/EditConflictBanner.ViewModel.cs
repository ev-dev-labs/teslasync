using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="EditConflictBanner"/> view — the native port of the
/// web component body (web/src/components/feedback/EditConflictBanner.tsx L42-104). It binds the i18n facade and
/// the P1/S8 <see cref="IEditLeaseSource"/> (the web <c>useEditLease(resourceKey)</c>), recomputes the pure
/// <see cref="EditConflictBannerProjection"/> whenever ownership moves, and raises <see cref="PropertyChanged"/>
/// so the view shows/hides the banner. <see cref="TakeOver"/> forwards to the seam's <c>Claim()</c> (the web
/// "Take over editing" <c>onClick={claim}</c>); <see cref="Dispose"/> unsubscribes (the web effect cleanup). The
/// view performs no cross-tab work and reads no lease itself — it observes <see cref="Projection"/>. The optional
/// <c>resourceLabel</c> is the already-localized noun the labelled body interpolates (web <c>resourceLabel</c>
/// prop); a switch hint that is informational only mirrors the web note that browsers expose no programmatic
/// "focus another tab" API. Drive it from one confinement (the UI thread); it is not internally synchronized.
/// </summary>
public sealed class EditConflictBannerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IEditLeaseSource _source;
    private readonly string? _resourceLabel;
    private EditConflictBannerProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, lease seam (P1/S8) and optional resource label.</summary>
    /// <param name="localizer">The i18n facade every string resolves through (web <c>useTranslation</c>).</param>
    /// <param name="source">The edit-lease state-holder seam (web <c>useEditLease</c>).</param>
    /// <param name="resourceLabel">Optional already-localized resource noun (web <c>resourceLabel</c> prop).</param>
    public EditConflictBannerViewModel(ILocalizer localizer, IEditLeaseSource source, string? resourceLabel = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);

        _localizer = localizer;
        _source = source;
        _resourceLabel = resourceLabel;

        _projection = Compute();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>EditConflictBanner</c>).</summary>
    public static string Slug => EditConflictBannerRegistration.Slug;

    /// <summary>The current render projection (visibility + localized copy + accessible name + live setting).</summary>
    public EditConflictBannerProjection Projection => _projection;

    /// <summary>Whether the banner is shown (web <c>!isOwner &amp;&amp; otherTab</c>).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The localized banner heading (web <c>title</c>).</summary>
    public string Title => _projection.Title;

    /// <summary>The localized body copy (web <c>body</c>).</summary>
    public string Body => _projection.Body;

    /// <summary>The localized take-over action label (web <c>takeOver</c>).</summary>
    public string TakeOverLabel => _projection.TakeOverLabel;

    /// <summary>The localized switch-to-other-tab hint (web <c>switchHint</c>).</summary>
    public string SwitchHint => _projection.SwitchHint;

    /// <summary>The accessible name the status region announces (the heading and body).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>The peer's tab id the view stamps for automation/diagnostics (web <c>data-other-tab-id</c>).</summary>
    public string OtherTabId => _projection.OtherTabId;

    /// <summary>Forcibly take over the edit lease (web <c>claim()</c> behind "Take over editing").</summary>
    public void TakeOver()
    {
        if (_disposed)
        {
            return;
        }

        _source.Claim();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    private EditConflictBannerProjection Compute() =>
        EditConflictBannerProjection.Project(_source.Current, _resourceLabel, _localizer);

    private void OnSourceChanged(object? sender, EventArgs e) => Reproject();

    private void Reproject()
    {
        if (_disposed)
        {
            return;
        }

        var next = Compute();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
