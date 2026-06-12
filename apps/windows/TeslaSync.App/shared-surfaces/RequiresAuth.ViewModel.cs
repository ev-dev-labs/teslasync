using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RequiresAuth"/> view — the native port of the web
/// <c>RequiresAuth</c> body (web/src/components/feedback/RequiresAuth.tsx L68-106). It binds the
/// <see cref="IAuthModeSource"/> (the P1/S8 auth-mode seam, the web <c>useAuthMode()</c> read), recomputes the pure
/// <see cref="RequiresAuthProjection"/> whenever the contract moves, and raises <see cref="PropertyChanged"/> so the
/// view swaps between the wrapped children (forward-auth + capability enabled) and the gated notice (open mode, the
/// capability disabled, or a still-unresolved contract). The wrapped capability is fixed at construction (it would
/// fail the type-check to pass an unknown one, the web compile-time safety); the feature name is either supplied
/// explicitly (already-localized, the web <c>feature</c> prop) or resolved from the i18n catalogue. <see cref="Dispose"/>
/// unsubscribes from the seam (the web effect cleanup). The view performs no contract fetch of its own.
/// </summary>
public sealed class RequiresAuthViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IAuthModeSource _source;
    private readonly RequiresAuthCapability _capability;
    private readonly string? _feature;
    private RequiresAuthProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, auth-mode seam (P1/S8), capability, and optional feature name.</summary>
    /// <param name="localizer">The i18n facade the title / body / feature-name strings resolve through.</param>
    /// <param name="source">The auth-mode contract seam (web <c>useAuthMode()</c>).</param>
    /// <param name="capability">The capability the wrapped section needs (web <c>capability</c>).</param>
    /// <param name="feature">An already-localized feature name, or null to resolve it from the catalogue.</param>
    public RequiresAuthViewModel(
        ILocalizer localizer,
        IAuthModeSource source,
        RequiresAuthCapability capability,
        string? feature = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);

        _localizer = localizer;
        _source = source;
        _capability = capability;
        _feature = feature;

        _projection = Compute();
        _source.Changed += OnSeamChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>RequiresAuth</c>).</summary>
    public static string Slug => RequiresAuthRegistration.Slug;

    /// <summary>The current render projection (children-vs-notice gate + the resolved notice copy).</summary>
    public RequiresAuthProjection Projection => _projection;

    /// <summary>The capability the wrapped section needs (web <c>capability</c>).</summary>
    public RequiresAuthCapability Capability => _capability;

    /// <summary>Whether the wrapped children mount (web forward-auth + capability-enabled branch).</summary>
    public bool ShowChildren => _projection.ShowChildren;

    /// <summary>The already-localized feature name interpolated into the copy (web <c>feature</c>).</summary>
    public string Feature => _projection.Feature;

    /// <summary>The localized notice title (web <c>t('requiresAuth.title')</c>).</summary>
    public string Title => _projection.Title;

    /// <summary>The localized notice body, with or without the provider hint (web <c>body</c>).</summary>
    public string Body => _projection.Body;

    /// <summary>The accessible name a screen reader announces for the gated notice (title + body).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>The stable per-capability automation id for the gated notice (web <c>requires-auth-empty-{capability}</c>).</summary>
    public string EmptyAutomationId => _projection.EmptyAutomationId;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSeamChanged;
        GC.SuppressFinalize(this);
    }

    private RequiresAuthProjection Compute() =>
        RequiresAuthProjection.Project(_source.Current, _capability, _feature, _localizer);

    private void OnSeamChanged(object? sender, EventArgs e) => Reproject();

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
