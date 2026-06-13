using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>ChannelsPage</c> view — the native port of the web page's
/// data flow (web/src/features/notifications/pages/ChannelsPage.tsx). The web page renders no data of its own: it
/// is a titled, copy-link <c>PageContainer</c> shell that hosts the <c>NotificationChannelsView</c> (which owns its
/// own reads). So this holder's only responsibility is to resolve the page chrome — the title and subtitle (web
/// <c>t('notifications.channels.title' | 'notifications.channels.subtitle')</c>, the title also being the web
/// <c>usePageTitle</c> document title) — through the injected <see cref="ILocalizer"/> and project them into
/// <see cref="ChannelsPageDisplay"/>. <see cref="LoadAsync"/> / <see cref="RefreshAsync"/> exist for the page
/// lifecycle contract; with no backing data source they simply re-resolve the localized chrome (so a locale change
/// re-projects). Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ChannelsPageViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly ChannelsPageDiagnostics _diagnostics;

    private ChannelsPageDisplay _display;

    /// <summary>Creates the holder over its localizer and (optional) diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ChannelsPageViewModel(ILocalizer localizer, ChannelsPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ChannelsPageDiagnostics();
        _display = ChannelsPageDisplay.Project(_localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready chrome the view binds to.</summary>
    public ChannelsPageDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The localized page title (web <c>notifications.channels.title</c>).</summary>
    public string Title => _display.Title;

    /// <summary>The localized page subtitle (web <c>notifications.channels.subtitle</c>).</summary>
    public string Subtitle => _display.Subtitle;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Re-resolve the localized chrome (web query mount / refetch seam); there is no backend read.</summary>
    public Task LoadAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        Display = ChannelsPageDisplay.Project(_localizer);
        return Task.CompletedTask;
    }

    /// <summary>Reload the surface (web query refetch / Retry); equivalent to <see cref="LoadAsync"/>.</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        if (name == nameof(Display))
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Title)));
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Subtitle)));
        }
    }
}
