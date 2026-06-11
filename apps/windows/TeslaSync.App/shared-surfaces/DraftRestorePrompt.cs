using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Carries the in-app route a <see cref="DraftRestorePrompt"/> Resume action asks the host to navigate to — the
/// native analogue of the web component's <c>navigate(entry.route)</c>
/// (web/src/components/feedback/DraftRestorePrompt.tsx L161). The shell subscribes to
/// <see cref="DraftRestorePrompt.NavigationRequested"/> and performs the navigation; the surface stays a thin
/// renderer.
/// </summary>
public sealed class DraftRestoreNavigationRequestedEventArgs(string route) : EventArgs
{
    /// <summary>The in-app route to navigate to (web <c>entry.route</c>).</summary>
    public string Route { get; } = route;
}

/// <summary>
/// The native WinUI 3 draft-restore prompt surface — a parity port of the web <c>DraftRestorePrompt</c>
/// (web/src/components/feedback/DraftRestorePrompt.tsx). Mounted once globally (like the web component in
/// <c>Layout.tsx</c>), it surfaces unsaved <c>useFormDraft</c> work recovered after a crash / relaunch: a
/// compact bottom-left <see cref="TsGlassPanel"/> card (a warning chip, the "Unsaved drafts restored" title, a
/// pluralized count body and Review / Dismiss / close affordances) and, on Review, a Fluent
/// <see cref="TsModal"/> listing every draft with per-row Resume / Discard — reproducing the web surface's data,
/// composition, states and i18n. It collapses to nothing until the post-mount grace window elapses and a draft
/// actually surfaces (web one-shot mount effect), exactly like the web component returns <c>null</c>.
///
/// <para>
/// State coverage: the web source reads the client-side draft index synchronously (no network), so — like the
/// shipped <c>RecentlyViewedWidget</c> / <c>TimeStamp</c> siblings — it has no loading / error / stale / offline
/// chrome to reproduce. The states it actually has are reproduced in full: idle (nothing surfaced → the surface
/// collapses), the prompt card, the review modal listing the drafts, and the empty review state ("No drafts to
/// restore." once the last draft is discarded). All state flows through the shared
/// <see cref="DraftRestorePromptViewModel"/>; the view performs no I/O. Every label resolves through the i18n
/// facade, the card announces politely (web <c>role="status" aria-live="polite"</c>), the modal inherits the
/// <see cref="TsModal"/> focus trap + focus restoration, and every interactive control carries a Narrator name.
/// </para>
/// </summary>
public sealed partial class DraftRestorePrompt : ContentControl, IDisposable
{
    private const string WarningGlyph = "\uE7BA"; // Segoe Fluent Warning — web Lucide FileWarning.
    private const string CloseGlyph = "\uE8BB";   // Segoe Fluent ChromeClose — web Lucide X.
    private const double DefaultGracePeriodMs = 1500; // web PROMPT_GRACE_MS.
    private const double CardMaxWidth = 360;      // web max-w-sm.
    private const double CardMargin = 16;         // web bottom-4 left-4.
    private const double IconChipSize = 28;       // web rounded-md chip around the icon.
    private const double IconTintOpacity = 0.15;  // web bg-amber-300/15.
    private const double BorderTintOpacity = 0.3; // web border-amber-300/30.

    private readonly DraftRestorePromptViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly DispatcherTimer _graceTimer = new();

    private readonly TsGlassPanel _card = new() { MaxWidth = CardMaxWidth };
    private readonly Border _iconChip = new();
    private readonly PanelTitle _title = new();
    private readonly Text _body = new();
    private readonly TsButton _review = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small };
    private readonly TsButton _dismiss = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };
    private readonly TsButton _close = new() { Variant = ButtonVariant.Icon, Size = ControlSize.Small, IconGlyph = CloseGlyph };

    private TsModal? _dialog;
    private bool _showing;
    private bool _allowProgrammaticClose;
    private bool _started;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface over the passthrough localizer and the shared in-memory draft store — the
    /// native analogue of mounting the web component in an isolated host. Production callers use the seam
    /// constructor.
    /// </summary>
    public DraftRestorePrompt()
        : this(PassthroughLocalizer.Instance, InMemoryDraftStore.Shared)
    {
    }

    /// <summary>Creates the surface over the i18n facade, the draft seams (P1/S8), the navigator and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="store">The draft-index seam (web <c>getDrafts</c> / <c>discardDraftEnvelope</c> / <c>subscribeDraftIndex</c>).</param>
    /// <param name="presence">The cross-window presence seam; when null no peers are assumed (single-window host).</param>
    /// <param name="guard">The one-shot session guard; when null the shared per-launch guard is used.</param>
    /// <param name="navigator">The Resume navigation seam; when null Resume raises <see cref="NavigationRequested"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="gracePeriodMs">The post-mount grace window (web <c>PROMPT_GRACE_MS</c>); production callers leave the default.</param>
    public DraftRestorePrompt(
        ILocalizer localizer,
        IDraftStore store,
        IDraftPresenceSource? presence = null,
        IDraftPromptSessionGuard? guard = null,
        IDraftRestoreNavigator? navigator = null,
        DraftRestorePromptDiagnostics? diagnostics = null,
        double gracePeriodMs = DefaultGracePeriodMs)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(store);

        _viewModel = new DraftRestorePromptViewModel(
            store,
            presence ?? NullDraftPresenceSource.Instance,
            guard ?? InMemoryDraftPromptSessionGuard.Shared,
            navigator ?? new DelegateDraftRestoreNavigator(RaiseNavigationRequested),
            localizer,
            diagnostics);

        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _graceTimer.Interval = TimeSpan.FromMilliseconds(gracePeriodMs > 0 ? gracePeriodMs : DefaultGracePeriodMs);
        _graceTimer.Tick += OnGraceTimerTick;

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Bottom;
        Margin = new Thickness(CardMargin);

        BuildCardChrome();
        Content = _card;

        _review.Click += OnReviewClicked;
        _dismiss.Click += OnDismissClicked;
        _close.Click += OnDismissClicked;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>Raised when a Resume action asks the host to navigate to a draft's route (web <c>navigate(entry.route)</c>).</summary>
    public event EventHandler<DraftRestoreNavigationRequestedEventArgs>? NavigationRequested;

    /// <summary>The canonical surface slug (<c>DraftRestorePrompt</c>).</summary>
    public static string Slug => DraftRestorePromptRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public DraftRestorePromptViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _graceTimer.Stop();
        _graceTimer.Tick -= OnGraceTimerTick;
        _review.Click -= OnReviewClicked;
        _dismiss.Click -= OnDismissClicked;
        _close.Click -= OnDismissClicked;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        DismissDialog();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DraftRestorePromptAutomationPeer(this);

    private void RaiseNavigationRequested(string route) =>
        NavigationRequested?.Invoke(this, new DraftRestoreNavigationRequestedEventArgs(route));

    private void BuildCardChrome()
    {
        var icon = new FontIcon
        {
            Glyph = WarningGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush("TsColorWarningBrush"),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        _iconChip.Width = IconChipSize;
        _iconChip.Height = IconChipSize;
        _iconChip.CornerRadius = DisplayTokens.Radius("TsRadiusMd", 6);
        _iconChip.Background = TintBrush(IconTintOpacity);
        _iconChip.VerticalAlignment = VerticalAlignment.Top;
        _iconChip.Child = icon;

        _title.Value = _viewModel.PromptTitle;

        _body.Value = _viewModel.PromptBody;
        _body.Foreground = DisplayTokens.TextSecondary;
        _body.Margin = new Thickness(0, 2, 0, 0);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Margin = new Thickness(0, 8, 0, 0),
        };
        actions.Children.Add(_review);
        actions.Children.Add(_dismiss);

        var textColumn = new StackPanel { Spacing = 0 };
        textColumn.Children.Add(_title);
        textColumn.Children.Add(_body);
        textColumn.Children.Add(actions);
        Grid.SetColumn(textColumn, 1);

        Grid.SetColumn(_iconChip, 0);

        _close.VerticalAlignment = VerticalAlignment.Top;
        Grid.SetColumn(_close, 2);

        var layout = new Grid { ColumnSpacing = 12 };
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Auto) });
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Auto) });
        layout.Children.Add(_iconChip);
        layout.Children.Add(textColumn);
        layout.Children.Add(_close);

        _card.Padding = new Thickness(12);
        _card.BorderBrush = TintBrush(BorderTintOpacity);
        _card.Content = layout;

        // web role="status" aria-live="polite": the card announces its appearance politely.
        AutomationProperties.SetLiveSetting(_card, AutomationLiveSetting.Polite);
    }

    private static SolidColorBrush TintBrush(double opacity)
    {
        if (DisplayTokens.Brush("TsColorWarningBrush") is SolidColorBrush warning)
        {
            return new SolidColorBrush(warning.Color) { Opacity = opacity };
        }

        return new SolidColorBrush(Microsoft.UI.Colors.Transparent);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;

        // web mount effect: collect cross-window presence during the grace window, then evaluate.
        _viewModel.BeginEvaluation();
        _graceTimer.Start();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnGraceTimerTick(object? sender, object e)
    {
        _graceTimer.Stop();
        _viewModel.CompleteEvaluation();
    }

    private void OnReviewClicked(object sender, RoutedEventArgs e) => _viewModel.Review();

    private void OnDismissClicked(object sender, RoutedEventArgs e) => _viewModel.Dismiss();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        if (_disposed)
        {
            return;
        }

        // The card is shown only in the prompt state (web showPrompt && !reviewOpen).
        Visibility = _viewModel.State == DraftRestoreState.Idle ? Visibility.Collapsed : Visibility.Visible;
        _card.Visibility = _viewModel.IsPromptVisible ? Visibility.Visible : Visibility.Collapsed;

        _title.Value = _viewModel.PromptTitle;
        _body.Value = _viewModel.PromptBody;
        _review.Text = _viewModel.ReviewLabel;
        _dismiss.Text = _viewModel.DismissLabel;
        AutomationProperties.SetName(_review, _viewModel.ReviewLabel);
        AutomationProperties.SetName(_dismiss, _viewModel.DismissLabel);
        AutomationProperties.SetName(_close, _viewModel.CloseLabel);
        AutomationProperties.SetName(_card, _viewModel.PromptAutomationName);

        if (_viewModel.IsReviewOpen && !_showing)
        {
            _ = PresentDialogAsync();
        }
        else if (!_viewModel.IsReviewOpen && _showing)
        {
            DismissDialog();
        }
        else if (_showing && _dialog is not null)
        {
            ApplyDialogContent(_dialog);
        }
    }

    private async System.Threading.Tasks.Task PresentDialogAsync()
    {
        if (_showing || _disposed || XamlRoot is not { } xamlRoot)
        {
            return;
        }

        _showing = true;
        _allowProgrammaticClose = false;

        var dialog = new TsModal { XamlRoot = xamlRoot };
        ApplyDialogContent(dialog);
        dialog.Closed += OnDialogClosed;
        _dialog = dialog;

        try
        {
            await dialog.ShowAsync();
        }
        catch (COMException)
        {
            // Another ContentDialog already owns this XamlRoot — the host owns ordering; surface nothing.
            dialog.Closed -= OnDialogClosed;
            _showing = false;
            _dialog = null;
        }
    }

    private void ApplyDialogContent(TsModal dialog)
    {
        dialog.Title = _viewModel.ModalTitle;
        dialog.CloseButtonText = _viewModel.CloseLabel;
        dialog.Content = BuildModalBody();
        AutomationProperties.SetName(dialog, _viewModel.ModalTitle);
    }

    private StackPanel BuildModalBody()
    {
        var body = new StackPanel { Spacing = 16, MinWidth = 320 };
        body.Children.Add(new Text
        {
            Value = _viewModel.ModalBody,
            Foreground = DisplayTokens.TextSecondary,
        });

        if (!_viewModel.HasDrafts)
        {
            // web empty branch: "No drafts to restore."
            var empty = new Text
            {
                Value = _viewModel.EmptyMessage,
                Foreground = DisplayTokens.TextMuted,
            };
            AutomationProperties.SetName(empty, _viewModel.EmptyMessage);
            body.Children.Add(empty);
            return body;
        }

        var list = new StackPanel { Spacing = 8 };
        IReadOnlyList<DraftEntry> drafts = _viewModel.Drafts;
        IReadOnlyList<DraftRestoreRow> rows = _viewModel.Rows;
        for (int i = 0; i < drafts.Count && i < rows.Count; i++)
        {
            list.Children.Add(BuildRow(drafts[i], rows[i]));
        }

        body.Children.Add(list);
        return body;
    }

    private Border BuildRow(DraftEntry entry, DraftRestoreRow row)
    {
        var label = new Text { Value = row.Label, Foreground = DisplayTokens.TextPrimary };
        var when = new Caption { Value = row.SavedAtText };

        var textColumn = new StackPanel { Spacing = 0, VerticalAlignment = VerticalAlignment.Center };
        textColumn.Children.Add(label);
        textColumn.Children.Add(when);
        Grid.SetColumn(textColumn, 0);

        var resume = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Size = ControlSize.Small,
            Text = _viewModel.ResumeLabel,
        };
        AutomationProperties.SetName(resume, string.Create(System.Globalization.CultureInfo.CurrentCulture, $"{_viewModel.ResumeLabel}: {row.Label}"));
        resume.Click += (_, _) => _viewModel.Resume(entry);

        var discard = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = _viewModel.DiscardLabel,
        };
        AutomationProperties.SetName(discard, string.Create(System.Globalization.CultureInfo.CurrentCulture, $"{_viewModel.DiscardLabel}: {row.Label}"));
        discard.Click += (_, _) => _viewModel.Discard(entry);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        actions.Children.Add(resume);
        actions.Children.Add(discard);
        Grid.SetColumn(actions, 1);

        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Auto) });
        grid.Children.Add(textColumn);
        grid.Children.Add(actions);

        var border = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 6),
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Background = DisplayTokens.Surface,
            Padding = new Thickness(12, 8, 12, 8),
            Child = grid,
        };
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private void OnDialogClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        sender.Closed -= OnDialogClosed;
        bool wasProgrammatic = _allowProgrammaticClose;
        _showing = false;
        _allowProgrammaticClose = false;
        _dialog = null;

        // A user dismissal (Esc / backdrop / Close button) maps to the web Modal onClose → handleDismiss; a
        // programmatic Hide (Resume / Discard / Dismiss already moved the state) needs no further action.
        if (!wasProgrammatic && !_disposed)
        {
            _viewModel.Dismiss();
        }
    }

    private void DismissDialog()
    {
        if (_dialog is null)
        {
            return;
        }

        _allowProgrammaticClose = true;
        _dialog.Hide();
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    private sealed class DraftRestorePromptAutomationPeer(DraftRestorePrompt owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((DraftRestorePrompt)Owner).ViewModel.PromptTitle : name;
        }
    }
}
