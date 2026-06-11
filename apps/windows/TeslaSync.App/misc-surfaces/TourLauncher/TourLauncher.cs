using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.MiscSurfaces;

/// <summary>
/// The native WinUI 3 <c>TourLauncher</c> misc surface — a parity port of
/// web/src/features/onboarding/TourLauncher.tsx. It reproduces the web component's controlled modal that lists
/// every tour in the static registry: a title bar ("Take a tour"), a muted subtitle, and one row per tour — a
/// status glyph (a check for a completed tour, otherwise a play glyph), the tour title with a "Recommended for
/// this page" chip on the tour matching the current route and a "Completed" chip when finished, the one-line
/// description, and a Start / Replay action (emphasised on the recommended row, web <c>variant="primary"</c>) —
/// followed by a footer "Reset all tours" action; the modal's Close button dismisses it. Because the web source
/// is a controlled component over a static registry + synchronous storage with no asynchronous read, there is
/// deliberately no loading / error / stale / offline chrome (the same shape as the sibling <c>WidgetPicker</c> /
/// <c>KioskOverlay</c> / <c>LegacyAlertRulesRedirect</c> surfaces); the only states are the populated list and a
/// defensive empty surface (never a blank box). All state, completion, route-recommendation and label
/// resolution flow through the shared <see cref="TourLauncherViewModel"/> / <see cref="TourLauncherProjection"/>;
/// the view never performs HTTP or storage. The modal is a <see cref="TsModal"/> (a WinUI
/// <see cref="ContentDialog"/>), so it inherits a focus trap, light dismiss and focus restoration; every string
/// resolves through the i18n facade, every interactive element carries a Narrator name, fonts scale with the
/// system text-scaling setting, and the dialog uses the system transition so reduced-motion is honoured.
/// </summary>
public sealed partial class TourLauncher : ContentControl, IDisposable
{
    private const double BodyMinWidth = 380;   // keep the registry rows readable in the modal
    private const double BodySpacing = 12;     // gap between subtitle / rows / footer
    private const double RowSpacing = 8;        // web `space-y-2`
    private const double RowContentSpacing = 4; // gap between title / chips / description in a row
    private const double RowColumnSpacing = 12; // web `gap-3`
    private const double RowPadding = 12;       // web `p-3`
    private const double ChipSpacing = 6;       // gap between the recommended / completed chips
    private const double IconColumnWidth = 28;  // status glyph column
    private const double IconSize = 18;         // web Lucide `h-4 w-4`
    private const double RowCornerRadius = 12;  // web `rounded-xl`
    private const double ChipFontSize = 11;     // web `text-[10px]` chip caption
    private const double FooterTopSpacing = 4;  // breathing room above the reset action

    private readonly TourLauncherViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _body = new() { Spacing = BodySpacing, MinWidth = BodyMinWidth };
    private readonly StackPanel _rows = new() { Spacing = RowSpacing };

    private TsModal? _dialog;
    private bool _showing;
    private bool _disposed;

    /// <summary>Creates the surface over its i18n facade, the completion + location seams, an optional catalogue and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="completion">The completion store (web localStorage helpers seam).</param>
    /// <param name="location">The current-location port (web <c>useLocation</c> seam).</param>
    /// <param name="tours">The tour catalogue; defaults to <see cref="TourLauncherCatalog.DefaultTours"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public TourLauncher(
        ILocalizer localizer,
        ITourCompletionStore completion,
        ITourLauncherLocation location,
        IReadOnlyList<TourLauncherEntry>? tours = null,
        TourLauncherDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new TourLauncherViewModel(localizer, completion, location, tours, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        // The launcher is a controller: it renders nothing inline (like the web modal when closed); the modal
        // it presents is the surface. A null Content keeps the element zero-size yet loaded (so it has a XamlRoot).
        IsTabStop = false;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The canonical diagnostics slug this surface registers under (<c>TourLauncher</c>).</summary>
    public static string Slug => TourLauncherRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public TourLauncherViewModel ViewModel => _viewModel;

    /// <summary>Open the launcher modal (web global open event — wired by the host's help button / command).</summary>
    public void Open() => _viewModel.Open();

    /// <summary>Close the launcher modal (web <c>onClose</c>).</summary>
    public void Close() => _viewModel.Close();

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        // The host may have requested open before the element had a XamlRoot; present now that it does.
        if (_viewModel.IsOpen && !_showing)
        {
            _ = PresentDialogAsync();
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        Marshal(() =>
        {
            switch (e.PropertyName)
            {
                case nameof(TourLauncherViewModel.IsOpen):
                    if (_viewModel.IsOpen)
                    {
                        _ = PresentDialogAsync();
                    }
                    else
                    {
                        DismissDialog();
                    }

                    break;

                case nameof(TourLauncherViewModel.Display):
                    if (_showing)
                    {
                        RebuildBody();
                    }

                    break;
            }
        });
    }

    private async Task PresentDialogAsync()
    {
        if (_showing || _disposed || XamlRoot is not { } xamlRoot)
        {
            return;
        }

        _showing = true;
        RebuildBody();

        var dialog = new TsModal
        {
            Title = _viewModel.Display.Title,
            CloseButtonText = _viewModel.Display.CloseLabel,
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = xamlRoot,
            Content = new ScrollViewer
            {
                Content = _body,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            },
        };
        AutomationProperties.SetName(dialog, _viewModel.Display.AutomationName);
        dialog.Closed += OnDialogClosed;
        _dialog = dialog;

        try
        {
            await dialog.ShowAsync();
        }
        catch (COMException)
        {
            // Another ContentDialog is already open on this XamlRoot — the host owns ordering; surface nothing.
            dialog.Closed -= OnDialogClosed;
            _showing = false;
            _dialog = null;
        }
    }

    private void OnDialogClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        sender.Closed -= OnDialogClosed;
        _showing = false;
        _dialog = null;

        // The user dismissed via the modal chrome (Close button / Esc / light dismiss); reflect it in the model.
        if (_viewModel.IsOpen)
        {
            _viewModel.Close();
        }
    }

    private void DismissDialog() => _dialog?.Hide();

    private void RebuildBody()
    {
        TourLauncherDisplay display = _viewModel.Display;
        _body.Children.Clear();

        if (display.State == TourLauncherState.Empty)
        {
            _body.Children.Add(new TsEmptyState
            {
                IconGlyph = TourLauncherRegistration.AvailableGlyph,
                Message = display.EmptyMessage,
            });
            return;
        }

        _body.Children.Add(new Caption { Value = display.Subtitle });

        _rows.Children.Clear();
        foreach (TourRowView row in display.Rows)
        {
            _rows.Children.Add(BuildRow(row));
        }

        _body.Children.Add(_rows);
        _body.Children.Add(BuildFooter(display));
    }

    private Border BuildRow(TourRowView row)
    {
        var icon = new FontIcon
        {
            Glyph = row.StatusGlyph,
            FontSize = IconSize,
            Foreground = row.IsCompleted ? DisplayTokens.Brush("TsColorSuccessBrush") : DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var content = new StackPanel { Spacing = RowContentSpacing, VerticalAlignment = VerticalAlignment.Center };
        content.Children.Add(new PanelTitle { Value = row.Title });

        if (row.RecommendedBadge is not null || row.CompletedBadge is not null)
        {
            var chips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = ChipSpacing };
            if (row.RecommendedBadge is { } recommended)
            {
                chips.Children.Add(BuildChip(recommended, StatusKind.Info));
            }

            if (row.CompletedBadge is { } completed)
            {
                chips.Children.Add(BuildChip(completed, StatusKind.Success));
            }

            content.Children.Add(chips);
        }

        content.Children.Add(new Caption { Value = row.Description });

        var action = new TsButton
        {
            Variant = row.IsRecommended ? ButtonVariant.Primary : ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = row.ActionLabel,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(action, row.ActionAutomationName);
        string tourId = row.Id;
        action.Click += (_, _) => _viewModel.StartTour(tourId);

        var grid = new Grid { ColumnSpacing = RowColumnSpacing };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(IconColumnWidth) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(icon, 0);
        Grid.SetColumn(content, 1);
        Grid.SetColumn(action, 2);
        grid.Children.Add(icon);
        grid.Children.Add(content);
        grid.Children.Add(action);

        var border = new Border
        {
            Padding = new Thickness(RowPadding),
            CornerRadius = new CornerRadius(RowCornerRadius),
            BorderThickness = new Thickness(1),
            BorderBrush = row.IsRecommended ? DisplayTokens.Accent : DisplayTokens.Border,
            Background = DisplayTokens.Surface,
            Child = grid,
        };
        AutomationProperties.SetName(border, row.AutomationName);
        return border;
    }

    private static TsBadge BuildChip(string text, StatusKind status)
    {
        var badge = new TsBadge
        {
            Status = status,
            Content = new TextBlock { Text = text, FontSize = ChipFontSize },
        };
        AutomationProperties.SetAccessibilityView(badge, AccessibilityView.Raw);
        return badge;
    }

    private StackPanel BuildFooter(TourLauncherDisplay display)
    {
        var reset = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = TourLauncherRegistration.ResetGlyph,
            Text = display.ResetAllLabel,
        };
        AutomationProperties.SetName(reset, display.ResetAllLabel);
        reset.Click += OnResetClick;

        return new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Margin = new Thickness(0, FooterTopSpacing, 0, 0),
            Children = { reset },
        };
    }

    private void OnResetClick(object sender, RoutedEventArgs e) => _viewModel.ResetAll();

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

    /// <summary>Dismiss any open modal, detach from the view-model and stop responding (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        DismissDialog();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new TourLauncherAutomationPeer(this);

    private sealed class TourLauncherAutomationPeer(TourLauncher owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? ((TourLauncher)Owner)._viewModel.Display.Title : name;
        }
    }
}
