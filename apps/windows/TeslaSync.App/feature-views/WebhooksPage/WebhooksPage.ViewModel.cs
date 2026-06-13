// Notifications / Webhooks page — UI-thread-free state holder.
using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="WebhooksPage"/> view — the native port of the web
/// page's (minimal) data flow (web/src/features/notifications/pages/WebhooksPage.tsx). The web page renders no API
/// query of its own; it only resolves its localized <c>PageContainer</c> title + subtitle and embeds the
/// <c>WebhookChannelsSection</c>. This holder therefore projects the localized chrome into a render-ready
/// <see cref="Display"/> and exposes the page lifecycle (<see cref="NotifyOpened"/> / <see cref="LoadAsync"/> /
/// <see cref="RefreshAsync"/>); the webhook list and its loading / empty / error states live in the embedded
/// section's own state holder. Drive it from one confinement (the UI thread).
/// </summary>
public sealed class WebhooksPageViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly WebhooksPageDiagnostics _diagnostics;
    private WebhooksDisplay _display;

    /// <summary>Creates the holder over the i18n facade and an optional PII-safe diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public WebhooksPageViewModel(ILocalizer localizer, WebhooksPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _diagnostics = diagnostics ?? new WebhooksPageDiagnostics();
        _display = BuildDisplay();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready page chrome the view binds to.</summary>
    public WebhooksDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>Record the one-time <c>view.opened</c> diagnostic (web component mount).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Resolve the page chrome. The page owns no remote read (the embedded section self-loads on mount), so this
    /// completes synchronously; it exists so the view's lifecycle matches every other W7 page.
    /// </summary>
    public Task LoadAsync()
    {
        Display = BuildDisplay();
        return Task.CompletedTask;
    }

    /// <summary>Re-resolve the localized chrome (e.g. after a language change). Completes synchronously.</summary>
    public Task RefreshAsync()
    {
        Display = BuildDisplay();
        return Task.CompletedTask;
    }

    private WebhooksDisplay BuildDisplay()
    {
        var title = WebhooksPageRegistration.Title(_localizer);
        var subtitle = WebhooksPageRegistration.Subtitle(_localizer);
        return new WebhooksDisplay(title, subtitle, title);
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
