using System.ComponentModel;
using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DraftRecoveryBanner"/> view — the native port of the
/// web component body (web/src/components/feedback/DraftRecoveryBanner.tsx L40-98). It binds the i18n facade and
/// the P1/S8 <see cref="IDraftRecoverySource"/> (the web data props), owns the banner's internal
/// <c>dismissed</c> flag (the web <c>useState</c>), recomputes the pure <see cref="DraftRecoveryBannerProjection"/>
/// whenever the draft snapshot or the dismissed flag changes, and raises <see cref="PropertyChanged"/> so the
/// view shows/hides the banner. <see cref="UseDraft"/> forwards to the seam's <see cref="IDraftRecoverySource.Restore"/>
/// (the web <c>handleRestore</c>: <c>setDismissed(true); onRestore?.()</c>); <see cref="Discard"/> forwards to
/// <see cref="IDraftRecoverySource.Discard"/> (the web <c>handleDiscard</c>: <c>setDismissed(true); onDiscard()</c>).
/// Both collapse the banner.
/// <para>
/// The dismissed flag is sticky for the lifetime of the holder, exactly as the web <c>dismissed</c> state
/// persists for the component's mount (a new draft surfaces by remounting / rebinding a fresh holder, the native
/// analogue of the web banner being re-keyed per editor session). The view performs no I/O and reads no draft
/// itself — it observes <see cref="Projection"/>. Drive it from one confinement (the UI thread); it is not
/// internally synchronised. Dispose it to detach from the bound seam.
/// </para>
/// </summary>
public sealed class DraftRecoveryBannerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IDraftRecoverySource _source;
    private readonly Func<DateTimeOffset> _clock;
    private bool _dismissed;
    private DraftRecoveryBannerProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, the draft-recovery seam (P1/S8) and an injectable clock.</summary>
    /// <param name="localizer">The i18n facade every string resolves through (web <c>useTranslation</c>).</param>
    /// <param name="source">The draft-recovery state-holder seam (web data props + <c>onRestore</c> / <c>onDiscard</c>).</param>
    /// <param name="clock">Test seam for "now" used by the relative-time copy — defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public DraftRecoveryBannerViewModel(ILocalizer localizer, IDraftRecoverySource source, Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);

        _localizer = localizer;
        _source = source;
        _clock = clock ?? (() => DateTimeOffset.Now);

        _projection = Compute();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>DraftRecoveryBanner</c>).</summary>
    public static string Slug => DraftRecoveryBannerRegistration.Slug;

    /// <summary>The current render projection (visibility + localized copy + accessible name + live setting).</summary>
    public DraftRecoveryBannerProjection Projection => _projection;

    /// <summary>Whether the banner is shown (web <c>hasDraft &amp;&amp; !dismissed</c>).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The composed, localized banner message (web <c>message</c>).</summary>
    public string Message => _projection.Message;

    /// <summary>The localized relative-time phrase interpolated into the copy (web <c>when</c>).</summary>
    public string WhenText => _projection.WhenText;

    /// <summary>The localized "Use draft" action label (web <c>t('draft.useDraft')</c>).</summary>
    public string UseDraftLabel => _projection.UseDraftLabel;

    /// <summary>The localized "Discard draft" action label (web <c>t('draft.discardDraft')</c>).</summary>
    public string DiscardLabel => _projection.DiscardLabel;

    /// <summary>The accessible name the status region announces (the banner message).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>
    /// Accept the restored draft (web <c>handleRestore</c>): mark the banner dismissed and forward to the seam's
    /// <see cref="IDraftRecoverySource.Restore"/> (the optional web <c>onRestore</c>). The banner collapses.
    /// </summary>
    public void UseDraft()
    {
        if (_disposed)
        {
            return;
        }

        _dismissed = true;
        _source.Restore();
        Reproject();
    }

    /// <summary>
    /// Discard the restored draft (web <c>handleDiscard</c>): mark the banner dismissed and forward to the seam's
    /// <see cref="IDraftRecoverySource.Discard"/> (the required web <c>onDiscard</c>). The banner collapses.
    /// </summary>
    public void Discard()
    {
        if (_disposed)
        {
            return;
        }

        _dismissed = true;
        _source.Discard();
        Reproject();
    }

    /// <summary>
    /// Re-raise the projection (the native analogue of react-i18next re-rendering after the active language
    /// changes). The dismissed flag and the bound snapshot are unaffected.
    /// </summary>
    public void Reload()
    {
        if (_disposed)
        {
            return;
        }

        _projection = Compute();
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
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

    private DraftRecoveryBannerProjection Compute() =>
        DraftRecoveryBannerProjection.Project(_source.Current, _dismissed, _clock(), CultureInfo.CurrentCulture, _localizer);

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
