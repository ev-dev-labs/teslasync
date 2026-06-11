using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 bulk-actions toolbar surface — a parity port of the web <c>BulkActionsToolbar</c>
/// (web/src/components/data-display/BulkActionsToolbar.tsx). It renders a translucent <see cref="TsGlassPanel"/>
/// bar shown above a list while one or more rows are selected: a polite selection-count chip
/// (<see cref="TsBadge"/>), an optional item-noun + "of {{total}}" caption, the per-page action buttons
/// (<see cref="TsButton"/>, secondary or destructive per the action variant, each with its own pending
/// spinner) and a subtle clear-selection button, reproducing the web bar's data, composition, states and
/// i18n. The toolbar collapses itself when nothing is selected (web <c>count === 0 ? null</c>) so consumers can
/// mount it unconditionally. A confirm-bearing action is routed through the shared Fluent
/// <see cref="TsConfirmDialog"/> before its mutation runs (web <c>useConfirm()</c>), with the destructive
/// actions confirming as danger. All state flows through the shared <see cref="BulkActionsToolbarViewModel"/>;
/// the view never performs I/O. Every label resolves through the i18n facade, the region carries the toolbar
/// Narrator name, the count chip announces politely and each interactive control carries an accessible name.
///
/// <para>
/// State coverage: the web source is a presentational toolbar driven by injected selection + action callbacks
/// — it performs no data fetch, so it has no loading / error / stale / offline chrome to reproduce. The states
/// it actually has are reproduced in full: hidden (nothing selected → the bar collapses), visible (the count
/// chip + actions + clear), the optional noun / "of total" caption (only when an item-noun is supplied), the
/// per-action pending spinner (web <c>loading={pending[id]}</c>), the disabled action (web
/// <c>disabled</c> / feature gate) and the confirm-then-run vs confirm-cancelled branches for a confirm-bearing
/// action.
/// </para>
/// </summary>
public sealed partial class BulkActionsToolbar : ContentControl, IDisposable
{
    private const string ClearGlyph = "\uE894"; // Segoe Fluent "Clear" — clears the current selection (web X icon).
    private const double PanelPaddingX = 16;     // web px-4.
    private const double PanelPaddingY = 12;     // web py-3.

    private readonly BulkActionsToolbarViewModel _viewModel;
    private readonly BulkActionsToolbarDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsGlassPanel _panel = new();
    private readonly Grid _layout = new();
    private readonly StackPanel _countGroup = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsBadge _countChip = new() { Status = StatusKind.Info };
    private readonly TextBlock _nounText = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly StackPanel _actionsGroup = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _clear = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = ClearGlyph,
    };

    private readonly Dictionary<string, TsButton> _actionButtons = new(StringComparer.Ordinal);

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface with no actions, the inert confirmer and the passthrough localizer — the
    /// native analogue of mounting the web component with an empty selection in an isolated host. Production
    /// callers use the seam constructor.
    /// </summary>
    public BulkActionsToolbar()
        : this(Array.Empty<BulkAction>(), PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its action list, localizer, optional item-noun, confirm seam and diagnostics.</summary>
    /// <param name="actions">The per-page action definitions, rendered in order (web <c>actions</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="itemNoun">Optional singular/plural noun (web <c>itemNoun</c>); when null the noun caption is hidden.</param>
    /// <param name="confirmer">The confirm seam (web <c>useConfirm()</c>); when null a <see cref="DialogBulkActionConfirmer"/> over this surface's XamlRoot is used.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public BulkActionsToolbar(
        IReadOnlyList<BulkAction> actions,
        ILocalizer localizer,
        BulkItemNoun? itemNoun = null,
        IBulkActionConfirmer? confirmer = null,
        BulkActionsToolbarDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(actions);
        ArgumentNullException.ThrowIfNull(localizer);

        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _diagnostics = diagnostics ?? new BulkActionsToolbarDiagnostics();
        IBulkActionConfirmer effectiveConfirmer = confirmer ?? new DialogBulkActionConfirmer(() => XamlRoot, localizer);
        _viewModel = new BulkActionsToolbarViewModel(actions, effectiveConfirmer, localizer, itemNoun);

        IsTabStop = false;

        // The count chip announces selection-count changes politely (web aria-live="polite").
        AutomationProperties.SetLiveSetting(_countChip, AutomationLiveSetting.Polite);

        // The noun caption is the secondary-text colour (web text-[var(--text-secondary)]).
        _nounText.Foreground = (Brush)Application.Current.Resources["TsColorTextSecondaryBrush"];

        _layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Auto) });
        _layout.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _layout.ColumnSpacing = 12;

        _countGroup.Children.Add(_countChip);
        _countGroup.Children.Add(_nounText);
        Grid.SetColumn(_countGroup, 0);

        // The actions group is pushed to the trailing edge (web ml-auto).
        Grid.SetColumn(_actionsGroup, 1);

        _layout.Children.Add(_countGroup);
        _layout.Children.Add(_actionsGroup);

        _panel.Padding = new Thickness(PanelPaddingX, PanelPaddingY, PanelPaddingX, PanelPaddingY);
        _panel.Content = _layout;
        Content = _panel;

        // The web root is a region landmark with an aria-label; carry the name on the panel and expose a Group
        // automation peer so Narrator reports the toolbar as a named region.
        AutomationProperties.SetName(_panel, _viewModel.ToolbarLabel);

        _clear.Click += OnClearClicked;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.ActionStateChanged += OnActionStateChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        BuildActionButtons();
        Render();
    }

    /// <summary>The canonical surface slug (<c>BulkActionsToolbar</c>).</summary>
    public static string Slug => BulkActionsToolbarRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public BulkActionsToolbarViewModel ViewModel => _viewModel;

    /// <summary>Raised when the user activates the clear button (web <c>onClear</c>); the host clears its selection.</summary>
    public event EventHandler? SelectionCleared;

    /// <summary>Replace the current selection (and optional total), re-rendering the toolbar (web prop change).</summary>
    public void SetSelection(IReadOnlyList<BulkSelectionId> selectedIds, int? total = null) =>
        _viewModel.SetSelection(selectedIds, total);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _clear.Click -= OnClearClicked;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.ActionStateChanged -= OnActionStateChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new BulkActionsToolbarAutomationPeer(this);

    private void OnClearClicked(object sender, RoutedEventArgs e)
    {
        _viewModel.RequestClear();
        SelectionCleared?.Invoke(this, EventArgs.Empty);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void OnActionStateChanged(object? sender, string id)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => UpdateActionButton(id));
        }
        else
        {
            UpdateActionButton(id);
        }
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
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
        // The bar collapses entirely when nothing is selected (web count === 0 ? null).
        Visibility = _viewModel.IsVisible ? Visibility.Visible : Visibility.Collapsed;

        _countChip.Content = _viewModel.CountLabel;
        AutomationProperties.SetName(_countChip, _viewModel.CountLabel);

        // The noun (+ optional "of total") caption is shown only when an item-noun was supplied (web {itemNoun && ...}).
        if (_viewModel.HasNoun)
        {
            _nounText.Visibility = Visibility.Visible;
            _nounText.Text = _viewModel.HasTotal
                ? _viewModel.NounText + " " + _viewModel.OfTotalLabel
                : _viewModel.NounText;
        }
        else
        {
            _nounText.Visibility = Visibility.Collapsed;
            _nounText.Text = string.Empty;
        }

        _clear.Text = _viewModel.ClearLabel;
        AutomationProperties.SetName(_clear, _viewModel.ClearLabel);
        AutomationProperties.SetName(_panel, _viewModel.ToolbarLabel);

        foreach (BulkAction action in _viewModel.Actions)
        {
            UpdateActionButton(action.Id);
        }
    }

    private void BuildActionButtons()
    {
        _actionsGroup.Children.Clear();
        _actionButtons.Clear();

        foreach (BulkAction action in _viewModel.Actions)
        {
            var button = new TsButton
            {
                Variant = BulkActionsToolbarViewModel.ButtonVariantFor(action),
                Size = ControlSize.Small,
                Text = action.Label,
                IconGlyph = action.IconGlyph,
            };

            AutomationProperties.SetName(button, action.Label);

            // web data-bulk-action={action.id} — expose it as the automation id for UI-automation hooks.
            AutomationProperties.SetAutomationId(button, action.Id);

            BulkAction current = action;
            button.Click += (_, _) => _viewModel.Invoke(current);

            _actionButtons[action.Id] = button;
            _actionsGroup.Children.Add(button);
        }

        // The clear button is always last (web data-bulk-action="clear").
        AutomationProperties.SetAutomationId(_clear, "clear");
        _actionsGroup.Children.Add(_clear);
    }

    private void UpdateActionButton(string id)
    {
        if (!_actionButtons.TryGetValue(id, out TsButton? button))
        {
            return;
        }

        BulkAction? action = FindAction(id);
        if (action is null)
        {
            return;
        }

        // Order matters: TsButton forces IsEnabled=false while loading and restores it when loading clears, so
        // set IsLoading first and then apply the action's true enabled state (web disabled={disabled || pending}).
        button.IsLoading = _viewModel.IsActionPending(id);
        button.IsEnabled = _viewModel.IsActionEnabled(action);
    }

    private BulkAction? FindAction(string id)
    {
        foreach (BulkAction action in _viewModel.Actions)
        {
            if (string.Equals(action.Id, id, StringComparison.Ordinal))
            {
                return action;
            }
        }

        return null;
    }

    private sealed class BulkActionsToolbarAutomationPeer : FrameworkElementAutomationPeer
    {
        public BulkActionsToolbarAutomationPeer(BulkActionsToolbar owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((BulkActionsToolbar)Owner).ViewModel.ToolbarLabel
                : name;
        }
    }
}

/// <summary>
/// The real WinUI confirmation seam — the native analogue of the web <c>useConfirm()</c> dialog
/// (web/src/hooks/useConfirm.ts + web/src/components/ui/ConfirmDialog.tsx). It shows the shared Fluent
/// <see cref="TsConfirmDialog"/> over the surface's <see cref="XamlRoot"/> and resolves
/// <see langword="true"/> only when the user picks the primary (confirm) button. A danger intent marks the
/// dialog destructive so an accidental Enter does not trigger the action. When no XamlRoot is available yet
/// (the surface is not in a live tree) the prompt resolves <see langword="false"/>, leaving the action inert.
/// </summary>
public sealed class DialogBulkActionConfirmer : IBulkActionConfirmer
{
    private const string ConfirmKey = "translation.confirm.confirm";
    private const string ConfirmFallback = "Confirm";
    private const string CancelKey = "translation.confirm.cancel";
    private const string CancelFallback = "Cancel";

    private readonly Func<XamlRoot?> _xamlRoot;
    private readonly ILocalizer _localizer;

    /// <summary>Creates the confirmer over a XamlRoot accessor (resolved lazily) and the i18n facade.</summary>
    public DialogBulkActionConfirmer(Func<XamlRoot?> xamlRoot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(xamlRoot);
        ArgumentNullException.ThrowIfNull(localizer);
        _xamlRoot = xamlRoot;
        _localizer = localizer;
    }

    /// <inheritdoc />
    public async Task<bool> ConfirmAsync(BulkActionConfirmation confirmation, BulkActionConfirmIntent intent)
    {
        ArgumentNullException.ThrowIfNull(confirmation);

        XamlRoot? root = _xamlRoot();
        if (root is null)
        {
            return false;
        }

        var dialog = new TsConfirmDialog
        {
            Title = confirmation.Title,
            Content = confirmation.Description,
            PrimaryButtonText = string.IsNullOrEmpty(confirmation.ConfirmLabel)
                ? _localizer.GetString(ConfirmKey, ConfirmFallback)
                : confirmation.ConfirmLabel,
            CloseButtonText = _localizer.GetString(CancelKey, CancelFallback),
            IsDestructive = intent == BulkActionConfirmIntent.Danger,
            XamlRoot = root,
        };

        ContentDialogResult result = await dialog.ShowAsync();
        return result == ContentDialogResult.Primary;
    }
}
