using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TeslaFeatureFlagsPage"/> view — the native port of the
/// web page's data flow (web/src/features/admin/pages/TeslaFeatureFlagsPage.tsx). The web page is a thin
/// <c>PageContainer</c> wrapper with no query of its own: it renders the page <c>title</c> /
/// <c>subtitle</c> (the two parity strings <c>featureConfig.title</c> / <c>featureConfig.subtitle</c>) above the
/// shared <c>FeatureToggles</c> surface, which owns the feature-config read, the refresh mutation and the
/// loading / empty / error data states. This holder therefore exposes the localized page chrome the header binds
/// to and records the PII-safe <c>view.opened</c> diagnostic on first load; the hosted surface drives the data
/// lifecycle. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class TeslaFeatureFlagsPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly TeslaFeatureFlagsDiagnostics _diagnostics;

    private bool _isLoaded;
    private bool _disposed;

    /// <summary>Creates the holder over its localizer and (optional) diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TeslaFeatureFlagsPageViewModel(ILocalizer localizer, TeslaFeatureFlagsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _diagnostics = diagnostics ?? new TeslaFeatureFlagsDiagnostics();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The localized page title (web <c>featureConfig.title</c>).</summary>
    public string Title => TeslaFeatureFlagsRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>featureConfig.subtitle</c>).</summary>
    public string Subtitle => TeslaFeatureFlagsRegistration.Subtitle(_localizer);

    /// <summary>True once the surface has been opened and its diagnostic recorded (idempotent).</summary>
    public bool IsLoaded
    {
        get => _isLoaded;
        private set => Set(ref _isLoaded, value);
    }

    /// <summary>
    /// Mark the surface opened, emitting the PII-safe <c>view.opened</c> diagnostic exactly once. The page has no
    /// data query of its own — the hosted <c>FeatureToggles</c> surface runs the cache-then-network read — so this
    /// records the open and returns; re-invocations are no-ops.
    /// </summary>
    public Task LoadAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (_isLoaded || _disposed)
        {
            return Task.CompletedTask;
        }

        _diagnostics.RecordViewOpened();
        IsLoaded = true;
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        GC.SuppressFinalize(this);
    }

    private void Set(ref bool field, bool value, [CallerMemberName] string? name = null)
    {
        if (field == value)
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
