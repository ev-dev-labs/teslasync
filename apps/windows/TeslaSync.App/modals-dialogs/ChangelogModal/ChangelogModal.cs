using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation.Collections;
using Windows.Storage;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 "What's new" changelog modal — a parity port of
/// web/src/components/feedback/ChangelogModal.tsx. It subclasses the shared <see cref="TsModal"/>
/// (a tokenized <c>ContentDialog</c> with a focus trap, light dismiss and focus restoration) and reproduces
/// the web composition: a localized title, a first-visit / since-last-visit subtitle, a scrollable list of
/// collapsible release entries (version + badge + date header over Keep-a-Changelog sections with colour-coded
/// dots), and the two acknowledged actions — "View full changelog" (opens the releases page) and "Got it".
/// Every state from the shared seam renders (loading skeleton, loaded body, empty surface, retryable error,
/// plus stale / offline chips); all data flows through the shared <see cref="ChangelogModalViewModel"/> so the
/// view never performs I/O, every string resolves through the i18n facade, and every readout carries a
/// Narrator name.
/// </summary>
public sealed partial class ChangelogModal : TsModal, IDisposable
{
    private const string ChangelogGlyph = "\uE789"; // Segoe Fluent — Megaphone / what's new
    private const double DotSize = 7;

    private readonly ChangelogModalViewModel _viewModel;
    private readonly ChangelogModalDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly ScrollViewer _bodyHost = new();

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the modal over its data source, acknowledgement store, localizer and diagnostics.</summary>
    /// <param name="source">The changelog source (catalog + seen-version).</param>
    /// <param name="store">The acknowledgement persistence seam.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    /// <param name="clock">Optional clock seam for the auto-show throttle.</param>
    public ChangelogModal(
        IChangelogSource source,
        IChangelogAcknowledgementStore store,
        ILocalizer localizer,
        ChangelogModalDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new ChangelogModalDiagnostics();
        _viewModel = new ChangelogModalViewModel(source, store, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        Title = _viewModel.Title;
        PrimaryButtonText = _viewModel.GotItText;
        SecondaryButtonText = _viewModel.ViewFullText;
        DefaultButton = ContentDialogButton.Primary;

        _bodyHost.VerticalScrollMode = ScrollMode.Auto;
        _bodyHost.VerticalScrollBarVisibility = ScrollBarVisibility.Auto;
        _bodyHost.HorizontalScrollMode = ScrollMode.Disabled;
        _bodyHost.HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled;
        _bodyHost.MaxHeight = 480;
        _bodyHost.MinWidth = 460;

        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Opened += OnOpened;
        PrimaryButtonClick += OnGotItClick;
        SecondaryButtonClick += OnViewFullClick;
        Closed += OnClosed;

        Render();
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>ChangelogModal</c>).</summary>
    public static string Slug => ChangelogModalRegistration.Slug;

    /// <summary>The state holder driving the surface (exposed for host auto-show gating).</summary>
    public ChangelogModalViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory wiring the embedded <see cref="ChangelogCatalog"/> through a
    /// <c>ApplicationData.LocalSettings</c>-backed acknowledgement store — the production composition the host
    /// uses to present the modal.
    /// </summary>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnosticsSink">Optional PII-safe diagnostics sink.</param>
    /// <param name="clock">Optional clock seam for the auto-show throttle.</param>
    public static ChangelogModal Create(
        ILocalizer localizer,
        Action<string>? diagnosticsSink = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var store = new LocalSettingsChangelogAcknowledgementStore();
        var source = new ChangelogSource(store, clock: clock);
        return new ChangelogModal(source, store, localizer, new ChangelogModalDiagnostics(diagnosticsSink), clock);
    }

    private void OnOpened(ContentDialog sender, ContentDialogOpenedEventArgs args)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
        _viewModel.StampShown();
        _ = _viewModel.LoadAsync();
    }

    // Web parity: "Got it" marks the latest version seen so the unseen dot clears across the app.
    private void OnGotItClick(ContentDialog sender, ContentDialogButtonClickEventArgs args) =>
        _viewModel.MarkSeen();

    // Web parity: "View full changelog" marks seen and opens the releases page in the browser.
    private void OnViewFullClick(ContentDialog sender, ContentDialogButtonClickEventArgs args)
    {
        _viewModel.MarkSeen();
        if (Uri.TryCreate(ChangelogModalRegistration.ReleasesUrl, UriKind.Absolute, out var uri))
        {
            _ = Windows.System.Launcher.LaunchUriAsync(uri);
        }
    }

    private void OnClosed(ContentDialog sender, ContentDialogClosedEventArgs args) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        Title = _viewModel.Title;
        PrimaryButtonText = _viewModel.GotItText;
        SecondaryButtonText = _viewModel.ViewFullText;

        switch (_viewModel.State)
        {
            case ChangelogModalState.Loading:
                Content = BuildLoading();
                break;

            case ChangelogModalState.Empty:
                Content = BuildEmpty();
                break;

            case ChangelogModalState.Error:
                Content = BuildError();
                break;

            default:
                _bodyHost.Content = BuildBody();
                Content = _bodyHost;
                break;
        }
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12, MinWidth = 460, Padding = new Thickness(0, 4, 0, 4) };
        column.Children.Add(new TsSkeleton { BlockHeight = 14 });
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 64 });
        }

        AutomationProperties.SetName(column, _viewModel.LoadingText);
        LiveRegion.Configure(column);
        LiveRegion.Announce(column);
        return column;
    }

    private TsEmptyState BuildEmpty() => new()
    {
        IconGlyph = ChangelogGlyph,
        Message = _viewModel.EmptyMessage,
        MinWidth = 460,
    };

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _viewModel.EmptyMessage,
            ActionText = _viewModel.RetryText,
            AttemptCount = _viewModel.Attempts,
            MinWidth = 460,
        };
        error.ActionInvoked += OnErrorRetry;
        return error;
    }

    private void OnErrorRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private StackPanel BuildBody()
    {
        var display = _viewModel.Display;
        var column = new StackPanel { Spacing = 16, MinWidth = 460, Padding = new Thickness(0, 4, 0, 4) };

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        header.Children.Add(new Subhead
        {
            Value = display?.Subtitle ?? string.Empty,
            VerticalAlignment = VerticalAlignment.Center,
        });

        var chip = BuildFreshnessChip();
        if (chip is not null)
        {
            header.Children.Add(chip);
        }

        column.Children.Add(header);

        foreach (var entry in display?.VisibleEntries ?? [])
        {
            column.Children.Add(BuildEntry(entry));
        }

        AutomationProperties.SetName(column, display?.AutomationName ?? _viewModel.Title);
        return column;
    }

    // Native addition over the web (which reads static data): surface the cache freshness through a chip so the
    // stale / offline states never render a silently degraded body.
    private TsBadge? BuildFreshnessChip()
    {
        if (_viewModel.State == ChangelogModalState.Offline)
        {
            return MakeChip(_viewModel.OfflineText, StatusKind.Neutral);
        }

        if (_viewModel.State == ChangelogModalState.Stale)
        {
            return MakeChip(_viewModel.StaleText, StatusKind.Warning);
        }

        return null;
    }

    private static TsBadge MakeChip(string text, StatusKind status)
    {
        var chip = new TsBadge { Status = status, Content = text, Dot = true };
        AutomationProperties.SetName(chip, text);
        return chip;
    }

    private static TsAccordion BuildEntry(ChangelogEntryDisplay entry)
    {
        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 10,
            VerticalAlignment = VerticalAlignment.Center,
        };
        header.Children.Add(new Code { Value = entry.VersionLabel, VerticalAlignment = VerticalAlignment.Center });
        var badge = new TsBadge { Status = entry.BadgeStatus, Content = entry.BadgeLabel };
        AutomationProperties.SetName(badge, entry.BadgeLabel);
        header.Children.Add(badge);
        header.Children.Add(new Caption { Value = entry.Date, VerticalAlignment = VerticalAlignment.Center });

        var body = new StackPanel { Spacing = 12 };
        foreach (var section in entry.Sections)
        {
            body.Children.Add(BuildSection(section));
        }

        var accordion = new TsAccordion
        {
            Header = header,
            Content = body,
            IsExpanded = entry.DefaultExpanded,
        };
        AutomationProperties.SetName(accordion, entry.AutomationName);
        return accordion;
    }

    private static StackPanel BuildSection(ChangelogSectionDisplay section)
    {
        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(new Label { Value = section.Label });

        foreach (var item in section.Items)
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            row.Children.Add(new Ellipse
            {
                Width = DotSize,
                Height = DotSize,
                Fill = DisplayTokens.Brush(StatusResources.AccentBrushKey(section.DotStatus)),
                VerticalAlignment = VerticalAlignment.Top,
                Margin = new Thickness(0, 6, 0, 0),
            });
            row.Children.Add(new Text { Value = item, VerticalAlignment = VerticalAlignment.Top });
            column.Children.Add(row);
        }

        return column;
    }

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Opened -= OnOpened;
        PrimaryButtonClick -= OnGotItClick;
        SecondaryButtonClick -= OnViewFullClick;
        Closed -= OnClosed;
        _viewModel.Dispose();
    }

    /// <summary>
    /// The <c>ApplicationData.LocalSettings</c>-backed acknowledgement store — the WinUI binding of the web
    /// <c>useChangelog</c> localStorage keys. Best-effort: an identity-less / unpackaged context returns the
    /// unseen defaults and silently no-ops writes rather than throwing.
    /// </summary>
    private sealed class LocalSettingsChangelogAcknowledgementStore : IChangelogAcknowledgementStore
    {
        private const string SeenVersionKey = "teslasync.changelog.seenVersion";
        private const string LastShownKey = "teslasync.changelog.lastShownAt";
        private const string OnboardedKey = "teslasync.onboarded";

        public string? GetSeenVersion()
        {
            var seen = TryValues()?[SeenVersionKey] as string;
            return string.IsNullOrEmpty(seen) ? null : seen;
        }

        public void SetSeenVersion(string version)
        {
            ArgumentNullException.ThrowIfNull(version);
            var values = TryValues();
            if (values is not null)
            {
                values[SeenVersionKey] = version;
            }
        }

        public DateTimeOffset? GetLastShownAt() =>
            TryValues()?[LastShownKey] is long ms ? DateTimeOffset.FromUnixTimeMilliseconds(ms) : null;

        public void SetLastShownAt(DateTimeOffset when)
        {
            var values = TryValues();
            if (values is not null)
            {
                values[LastShownKey] = when.ToUnixTimeMilliseconds();
            }
        }

        public bool HasCompletedOnboarding() => TryValues()?.ContainsKey(OnboardedKey) == true;

        private static IPropertySet? TryValues()
        {
            try
            {
                return ApplicationData.Current.LocalSettings.Values;
            }
            catch (InvalidOperationException)
            {
                // Unpackaged / identity-less context — behave as a never-seen, no-op store.
                return null;
            }
        }
    }
}
