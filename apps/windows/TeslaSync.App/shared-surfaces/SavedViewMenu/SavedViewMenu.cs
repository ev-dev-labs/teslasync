using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 saved-view menu surface — a parity port of the web <c>SavedViewMenu</c>
/// (web/src/components/data-display/SavedViewMenu.tsx). It renders the web component's three coordinated
/// pieces as one control: a trigger <see cref="TsButton"/> whose label collapses to the active view's name
/// (primary treatment) when the current querystring matches a saved view (else "Saved views", secondary);
/// a <see cref="Flyout"/> popover listing the route's views (pinned-first, server order) with per-row apply /
/// set-default / pin / rename / delete affordances, a header "Manage views" link and a footer "Save current
/// view…" action; and an applied <see cref="TsBadge"/> with a clear-filters button shown while a view is
/// active. Saving / renaming use the shared Fluent <see cref="TsModal"/>; deletion confirms through
/// <see cref="TsConfirmDialog"/> (destructive). The native flyout supplies the light-dismiss + Escape close the
/// web source wires by hand. All state flows through the shared <see cref="SavedViewMenuViewModel"/>; the view
/// performs no I/O. Every label resolves through the i18n facade and every interactive control carries a
/// Narrator name.
///
/// <para>
/// State coverage: the popover body reproduces every <see cref="SavedViewMenuContentState"/> — loading
/// (skeleton chrome), list (the interactive rows), empty (<see cref="TsEmptyState"/> + "Save current view…")
/// and error (<see cref="TsQueryError"/> + retry) — plus the <see cref="SavedViewFreshness"/> stale / offline
/// chip overlaid on a cached value, so no state is ever a hidden surface. The web component only renders
/// empty-vs-list; the native surface honours the full state matrix the underlying query exposes.
/// </para>
/// </summary>
public sealed partial class SavedViewMenu : ContentControl, IDisposable
{
    private const string BookmarkGlyph = "\uE8A4";      // Segoe Fluent "Bookmarks" — the trigger icon (web Bookmark / BookmarkCheck).
    private const string StarOutlineGlyph = "\uE734";   // "FavoriteStar" — set-as-default (web Star outline).
    private const string StarFilledGlyph = "\uE735";    // "FavoriteStarFill" — is-default marker (web filled Star).
    private const string PinGlyph = "\uE718";           // "Pin" — pin a view (web Pin).
    private const string UnpinGlyph = "\uE77A";         // "UnPin" — unpin a view (web PinOff).
    private const string RenameGlyph = "\uE70F";        // "Edit" — rename a view (web Pencil).
    private const string DeleteGlyph = "\uE74D";        // "Delete" — delete a view (web Trash2).
    private const string AddGlyph = "\uE710";           // "Add" — save current view (web Plus).
    private const string ClearGlyph = "\uE894";         // "Clear" — clear the applied view (web X).

    private const double PopoverWidth = 288;            // web w-72.
    private const double ActionIconSize = 14;

    private readonly SavedViewMenuViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _trigger = new()
    {
        Size = ControlSize.Small,
        IconGlyph = BookmarkGlyph,
    };

    private readonly Flyout _flyout = new() { Placement = FlyoutPlacementMode.BottomEdgeAlignedRight };
    private readonly TsBadge _appliedBadge = new() { Status = StatusKind.Info, Visibility = Visibility.Collapsed };
    private readonly TextBlock _appliedText = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _clearButton = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = ClearGlyph,
    };

    private bool _opened;
    private bool _popoverOpen;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface bound to the inert seams (no store data, no router, no mutations) and
    /// the passthrough localizer — the native analogue of mounting the web component with no callbacks in an
    /// isolated host. Production callers use the seam constructor.
    /// </summary>
    public SavedViewMenu()
        : this(
            new SavedViewsStore(),
            InertSavedViewMutations.Instance,
            InertSavedViewApplier.Instance,
            AnnouncerBus.Shared,
            PassthroughLocalizer.Instance,
            "/",
            string.Empty)
    {
    }

    /// <summary>Creates the surface over its read / write / apply / announcer / i18n seams, the route and the current querystring.</summary>
    /// <param name="store">The saved-views read seam (web <c>useSavedViews(route)</c>).</param>
    /// <param name="mutations">The create / update / delete / set-default seam (web mutation hooks).</param>
    /// <param name="applier">The URL-apply seam (web <c>onApply</c> prop).</param>
    /// <param name="announcer">The screen-reader announcer bus (web <c>useAnnouncer</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="route">The SPA route this menu manages views for (web <c>route</c> prop).</param>
    /// <param name="currentQuery">The page's current canonical querystring (web <c>currentQuery</c> prop).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SavedViewMenu(
        ISavedViewsStore store,
        ISavedViewMutations mutations,
        ISavedViewApplier applier,
        IAnnouncerBus announcer,
        ILocalizer localizer,
        string route,
        string currentQuery = "",
        SavedViewMenuDiagnostics? diagnostics = null)
    {
        _viewModel = new SavedViewMenuViewModel(store, mutations, applier, announcer, localizer, route, currentQuery, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;

        _trigger.Flyout = _flyout;

        var badgeRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        badgeRow.Children.Add(_appliedText);
        badgeRow.Children.Add(_clearButton);
        _appliedBadge.Content = badgeRow;

        _root.Children.Add(_trigger);
        _root.Children.Add(_appliedBadge);
        Content = _root;

        _clearButton.Click += OnClearClicked;
        _flyout.Opened += OnFlyoutOpened;
        _flyout.Closed += OnFlyoutClosed;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>SavedViewMenu</c>).</summary>
    public static string Slug => SavedViewMenuRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public SavedViewMenuViewModel ViewModel => _viewModel;

    /// <summary>The page's current querystring (web <c>currentQuery</c> prop); set it when the URL changes.</summary>
    public string CurrentQuery
    {
        get => _viewModel.CurrentQuery;
        set => _viewModel.CurrentQuery = value;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _clearButton.Click -= OnClearClicked;
        _flyout.Opened -= OnFlyoutOpened;
        _flyout.Closed -= OnFlyoutClosed;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new SavedViewMenuAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _viewModel.NotifyOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnClearClicked(object sender, RoutedEventArgs e) => _viewModel.Clear();

    private void OnFlyoutOpened(object? sender, object e)
    {
        _popoverOpen = true;
        _viewModel.OpenMenu();
        RebuildPopover();
    }

    private void OnFlyoutClosed(object? sender, object e)
    {
        _popoverOpen = false;
        _viewModel.CloseMenu();
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => ScheduleRender();

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
        _trigger.Variant = _viewModel.TriggerIsActive ? ButtonVariant.Primary : ButtonVariant.Secondary;
        _trigger.Text = _viewModel.TriggerLabel;
        AutomationProperties.SetName(_trigger, _viewModel.TriggerLabel);

        bool active = _viewModel.HasActiveView;
        _appliedBadge.Visibility = active ? Visibility.Visible : Visibility.Collapsed;
        if (active)
        {
            _appliedText.Text = _viewModel.AppliedBadgeLabel + ": " + _viewModel.AppliedBadgeText;
            AutomationProperties.SetName(_clearButton, _viewModel.ClearAppliedLabel);
            ToolTipService.SetToolTip(_clearButton, _viewModel.ClearAppliedLabel);
        }

        if (_popoverOpen)
        {
            RebuildPopover();
        }
    }

    private void RebuildPopover()
    {
        var panel = new StackPanel { Width = PopoverWidth, Spacing = 8, Padding = new Thickness(8) };

        panel.Children.Add(BuildHeader());

        if (_viewModel.Freshness != SavedViewFreshness.Fresh)
        {
            panel.Children.Add(BuildFreshnessChip());
        }

        panel.Children.Add(_viewModel.ContentState switch
        {
            SavedViewMenuContentState.Loading => BuildLoading(),
            SavedViewMenuContentState.Error => BuildError(),
            SavedViewMenuContentState.Empty => BuildEmpty(),
            _ => BuildList(isManage: false),
        });

        panel.Children.Add(BuildFooter());

        _flyout.Content = panel;
    }

    private Grid BuildHeader()
    {
        var header = new Grid();
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new TextBlock
        {
            Text = _viewModel.Title,
            FontSize = 11,
            FontWeight = FontWeights.SemiBold,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = Brush("TsColorTextSecondaryBrush"),
        };
        Grid.SetColumn(title, 0);
        header.Children.Add(title);

        if (_viewModel.HasViews)
        {
            var manage = new TsButton
            {
                Variant = ButtonVariant.Subtle,
                Size = ControlSize.Small,
                Text = _viewModel.ManageLabel,
            };
            AutomationProperties.SetName(manage, _viewModel.ManageLabel);
            manage.Click += async (_, _) =>
            {
                _flyout.Hide();
                await ShowManageDialogAsync();
            };
            Grid.SetColumn(manage, 1);
            header.Children.Add(manage);
        }

        return header;
    }

    private TsBadge BuildFreshnessChip()
    {
        bool offline = _viewModel.Freshness == SavedViewFreshness.Offline;
        var chip = new TsBadge
        {
            Status = offline ? StatusKind.Danger : StatusKind.Warning,
            Dot = true,
            Content = offline ? _viewModel.OfflineLabel : _viewModel.StaleLabel,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(chip, offline ? _viewModel.OfflineLabel : _viewModel.StaleLabel);
        return chip;
    }

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 6 };
        AutomationProperties.SetName(column, _viewModel.LoadingLabel);
        for (int i = 0; i < 3; i++)
        {
            column.Children.Add(new TsSkeleton { BlockHeight = 28 });
        }

        return column;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Title = _viewModel.LoadErrorLabel,
            ActionText = _viewModel.RetryLabel,
        };
        error.ActionInvoked += (_, _) => _viewModel.Refresh();
        return error;
    }

    private TsEmptyState BuildEmpty()
    {
        var empty = new TsEmptyState
        {
            Message = _viewModel.EmptyLabel,
            ActionText = _viewModel.SaveCurrentLabel,
        };
        empty.ActionInvoked += async (_, _) =>
        {
            _flyout.Hide();
            await ShowSaveDialogAsync();
        };
        return empty;
    }

    private ScrollViewer BuildList(bool isManage)
    {
        var list = new StackPanel { Spacing = 2 };
        foreach (SavedView view in _viewModel.Views)
        {
            list.Children.Add(BuildRow(view, isManage));
        }

        return new ScrollViewer
        {
            Content = list,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            MaxHeight = isManage ? 420 : 288,
        };
    }

    private Grid BuildRow(SavedView view, bool isManage)
    {
        var row = new Grid { ColumnSpacing = 2, Padding = new Thickness(2) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        for (int i = 0; i < 4; i++)
        {
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        }

        var apply = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = view.Name,
            IconGlyph = view.IsDefault ? StarFilledGlyph : null,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(apply, view.Name);
        ToolTipService.SetToolTip(apply, isManage ? _viewModel.QueryTooltipFor(view) : view.Name);
        apply.Click += (_, _) =>
        {
            _viewModel.Apply(view);
            _flyout.Hide();
        };
        Grid.SetColumn(apply, 0);
        row.Children.Add(apply);

        TsButton defaultToggle = ActionButton(view.IsDefault ? StarFilledGlyph : StarOutlineGlyph, _viewModel.DefaultLabelFor(view));
        defaultToggle.Click += async (_, _) => await _viewModel.ToggleDefaultAsync(view);
        Grid.SetColumn(defaultToggle, 1);
        row.Children.Add(defaultToggle);

        TsButton pinToggle = ActionButton(view.IsPinned ? UnpinGlyph : PinGlyph, _viewModel.PinLabelFor(view));
        pinToggle.Click += async (_, _) => await _viewModel.TogglePinAsync(view);
        Grid.SetColumn(pinToggle, 2);
        row.Children.Add(pinToggle);

        TsButton rename = ActionButton(RenameGlyph, _viewModel.RenameLabel);
        rename.Click += async (_, _) =>
        {
            _flyout.Hide();
            await ShowRenameDialogAsync(view);
        };
        Grid.SetColumn(rename, 3);
        row.Children.Add(rename);

        TsButton delete = ActionButton(DeleteGlyph, _viewModel.DeleteLabel);
        delete.Click += async (_, _) =>
        {
            _flyout.Hide();
            await ShowDeleteDialogAsync(view);
        };
        Grid.SetColumn(delete, 4);
        row.Children.Add(delete);

        return row;
    }

    private TsButton BuildFooter()
    {
        var save = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = _viewModel.SaveCurrentLabel,
            IconGlyph = AddGlyph,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        AutomationProperties.SetName(save, _viewModel.SaveCurrentLabel);
        save.Click += async (_, _) =>
        {
            _flyout.Hide();
            await ShowSaveDialogAsync();
        };
        return save;
    }

    private static TsButton ActionButton(string glyph, string label)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = glyph,
            FontSize = ActionIconSize,
        };
        AutomationProperties.SetName(button, label);
        ToolTipService.SetToolTip(button, label);
        return button;
    }

    private async Task ShowSaveDialogAsync()
    {
        if (XamlRoot is null)
        {
            return;
        }

        var input = new TsInput
        {
            Hint = _viewModel.NameHint,
            Header = _viewModel.NameLabel,
            MaxLength = 80,
        };
        var toggle = new TsToggle { Header = _viewModel.MakeDefaultLabel };
        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(input);
        body.Children.Add(toggle);

        var dialog = new TsModal
        {
            Title = _viewModel.SaveCurrentLabel,
            Content = body,
            PrimaryButtonText = _viewModel.SaveLabel,
            CloseButtonText = _viewModel.CancelLabel,
            IsPrimaryButtonEnabled = false,
            XamlRoot = XamlRoot,
        };
        input.TextChanged += (_, _) => dialog.IsPrimaryButtonEnabled = _viewModel.CanSave(input.Text);
        dialog.PrimaryButtonClick += async (_, args) =>
        {
            if (!_viewModel.CanSave(input.Text))
            {
                args.Cancel = true;
                return;
            }

            var deferral = args.GetDeferral();
            await _viewModel.SaveAsync(input.Text, toggle.IsOn);
            deferral.Complete();
        };

        await dialog.ShowAsync();
    }

    private async Task ShowRenameDialogAsync(SavedView view)
    {
        if (XamlRoot is null)
        {
            return;
        }

        var input = new TsInput
        {
            Text = view.Name,
            Hint = _viewModel.NameHint,
            Header = _viewModel.NameLabel,
            MaxLength = 80,
        };

        var dialog = new TsModal
        {
            Title = _viewModel.RenameTitle,
            Content = input,
            PrimaryButtonText = _viewModel.SaveLabel,
            CloseButtonText = _viewModel.CancelLabel,
            XamlRoot = XamlRoot,
        };
        dialog.IsPrimaryButtonEnabled = _viewModel.CanRename(input.Text);
        input.TextChanged += (_, _) => dialog.IsPrimaryButtonEnabled = _viewModel.CanRename(input.Text);
        dialog.PrimaryButtonClick += async (_, args) =>
        {
            if (!_viewModel.CanRename(input.Text))
            {
                args.Cancel = true;
                return;
            }

            var deferral = args.GetDeferral();
            await _viewModel.RenameAsync(view, input.Text);
            deferral.Complete();
        };

        await dialog.ShowAsync();
    }

    private async Task ShowManageDialogAsync()
    {
        if (XamlRoot is null)
        {
            return;
        }

        UIElement body = _viewModel.HasViews
            ? BuildList(isManage: true)
            : new TsEmptyState { Message = _viewModel.EmptyLabel };

        var dialog = new TsModal
        {
            Title = _viewModel.ManageLabel,
            Content = body,
            CloseButtonText = _viewModel.CloseLabel,
            XamlRoot = XamlRoot,
        };

        await dialog.ShowAsync();
    }

    private async Task ShowDeleteDialogAsync(SavedView view)
    {
        if (XamlRoot is null)
        {
            return;
        }

        var dialog = new TsConfirmDialog
        {
            Title = _viewModel.DeleteTitle,
            Content = _viewModel.DeleteConfirmMessageFor(view),
            PrimaryButtonText = _viewModel.DeleteLabel,
            CloseButtonText = _viewModel.CancelLabel,
            IsDestructive = true,
            XamlRoot = XamlRoot,
        };
        dialog.PrimaryButtonClick += async (_, args) =>
        {
            var deferral = args.GetDeferral();
            await _viewModel.DeleteAsync(view);
            deferral.Complete();
        };

        await dialog.ShowAsync();
    }

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out object? value) && value is Brush brush ? brush : null;

    private sealed class SavedViewMenuAutomationPeer : FrameworkElementAutomationPeer
    {
        public SavedViewMenuAutomationPeer(SavedViewMenu owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((SavedViewMenu)Owner).ViewModel.Title
                : name;
        }
    }
}
