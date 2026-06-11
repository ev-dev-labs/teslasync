using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 feature-flag edit / create drawer — a parity port of
/// web/src/features/admin/components/feature-flags/FlagEditDrawer.tsx. The web component is a controlled,
/// write-only side-sheet that powers BOTH "edit existing flag" (a seeded, locked key) AND "create new flag" (an
/// editable key): a free-form JSON value textarea whose parse state disables the Save button and surfaces an
/// inline helper error, plus an audit-required reason. The native counterpart hosts the tokenized
/// <see cref="TsDrawer"/> (the native mirror of the web <c>Drawer</c>: a light-dismiss side sheet that provides
/// the Escape / backdrop dismiss this overlay tier requires) and drives it from the shared
/// <see cref="FlagEditDrawerViewModel"/>; the view never performs HTTP and there is no read query, so it has no
/// loading / stale / offline chrome. Every state the form can be in is rendered — the create-vs-edit title and
/// key editability + immutable note, the value "required" / "invalid JSON" helper error, and the in-flight
/// (saving) state that disables the buttons and spins the Save button — so none is a hidden surface. Every string
/// resolves through the i18n facade, each field + button carries a Narrator name, and the surface adds no custom
/// motion so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class FlagEditDrawer : ContentControl, IDisposable
{
    private readonly FlagEditDrawerViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsDrawer _drawer = new() { Side = DrawerSide.Right, PaneWidth = 460 };
    private readonly Grid _root = new() { RowSpacing = 16, MinWidth = 360, Padding = new Thickness(20) };
    private readonly PanelTitle _title = new();
    private readonly TsInput _keyBox = new();
    private readonly Text _keyNote = new() { Value = string.Empty, Visibility = Visibility.Collapsed };
    private readonly TsTextarea _valueBox = new() { MinHeight = 168 };
    private readonly ErrorText _valueError = new() { Value = string.Empty, Visibility = Visibility.Collapsed };
    private readonly TsInput _reasonBox = new();
    private readonly TsButton _cancel = new() { Variant = ButtonVariant.Secondary };
    private readonly TsButton _save = new() { Variant = ButtonVariant.Primary };

    private bool _syncing;
    private bool _disposed;

    /// <summary>Creates the drawer over the i18n facade and (optional) PII-safe diagnostics sink.</summary>
    public FlagEditDrawer(ILocalizer localizer, FlagEditDrawerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new FlagEditDrawerViewModel(localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        BuildLayout();
        IsTabStop = false;
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        Unloaded += OnUnloaded;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;

        Content = _drawer;
        SyncAll();
    }

    /// <summary>The view-model the drawer binds to (exposed for host wiring and tests of the view contract).</summary>
    public FlagEditDrawerViewModel ViewModel => _viewModel;

    /// <summary>The diagnostics surface slug this view registers under.</summary>
    public static string Slug => FlagEditDrawerRegistration.Slug;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        GC.SuppressFinalize(this);
    }

    private void BuildLayout()
    {
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        _root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        _root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        Grid.SetRow(_title, 0);
        _root.Children.Add(_title);

        _keyBox.TextChanged += OnKeyChanged;
        _valueBox.TextChanged += OnValueChanged;
        _reasonBox.TextChanged += OnReasonChanged;

        var keyStack = new StackPanel { Spacing = 8 };
        keyStack.Children.Add(_keyBox);
        keyStack.Children.Add(_keyNote);

        var valueStack = new StackPanel { Spacing = 8 };
        valueStack.Children.Add(_valueBox);
        valueStack.Children.Add(_valueError);

        var body = new StackPanel { Spacing = 16 };
        body.Children.Add(WrapPanel(keyStack));
        body.Children.Add(WrapPanel(valueStack));
        body.Children.Add(WrapPanel(_reasonBox));

        var scroll = new ScrollViewer
        {
            Content = body,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
        Grid.SetRow(scroll, 1);
        _root.Children.Add(scroll);

        _cancel.Click += OnCancelClick;
        _save.Click += OnSaveClick;
        var footer = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        footer.Children.Add(_cancel);
        footer.Children.Add(_save);
        Grid.SetRow(footer, 2);
        _root.Children.Add(footer);

        _drawer.DrawerContent = _root;
        _drawer.RegisterPropertyChangedCallback(TsDrawer.IsOpenProperty, OnDrawerIsOpenChanged);
    }

    private static TsGlassPanel WrapPanel(UIElement content) =>
        new() { Padding = new Thickness(16), Content = content };

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(SyncAll);
        }
        else
        {
            SyncAll();
        }
    }

    private void SyncAll()
    {
        _syncing = true;
        try
        {
            _title.Value = _viewModel.Title;
            AutomationProperties.SetName(_root, _viewModel.Title);

            _keyBox.Header = _viewModel.KeyLabel;
            _keyBox.Hint = _viewModel.KeyPrompt;
            _keyBox.IsEnabled = _viewModel.KeyEditable;
            AutomationProperties.SetName(_keyBox, _viewModel.KeyLabel);
            if (_keyBox.Text != _viewModel.KeyInput)
            {
                _keyBox.Text = _viewModel.KeyInput;
            }

            _keyNote.Value = _viewModel.KeyImmutableNote;
            _keyNote.Visibility = _viewModel.ShowKeyImmutableNote ? Visibility.Visible : Visibility.Collapsed;

            _valueBox.Header = _viewModel.ValueLabel;
            _valueBox.Hint = _viewModel.ValuePrompt;
            AutomationProperties.SetName(_valueBox, _viewModel.ValueLabel);
            if (_valueBox.Text != _viewModel.ValueInput)
            {
                _valueBox.Text = _viewModel.ValueInput;
            }

            _valueError.Value = _viewModel.ValueError ?? string.Empty;
            _valueError.Visibility = _viewModel.HasValueError ? Visibility.Visible : Visibility.Collapsed;

            _reasonBox.Header = _viewModel.ReasonLabel;
            _reasonBox.Hint = _viewModel.ReasonPrompt;
            AutomationProperties.SetName(_reasonBox, _viewModel.ReasonLabel);
            if (_reasonBox.Text != _viewModel.Reason)
            {
                _reasonBox.Text = _viewModel.Reason;
            }

            _cancel.Text = _viewModel.CancelLabel;
            _cancel.IsEnabled = _viewModel.CancelEnabled;
            AutomationProperties.SetName(_cancel, _viewModel.CancelLabel);

            // Set the busy state before the enabled state so the final IsEnabled reflects the save gate, not
            // TsButton's loading auto-restore.
            _save.Text = _viewModel.SaveLabel;
            _save.IsLoading = _viewModel.Saving;
            _save.IsEnabled = _viewModel.CanSave;
            AutomationProperties.SetName(_save, _viewModel.SaveLabel);

            if (_drawer.IsOpen != _viewModel.IsOpen)
            {
                _drawer.IsOpen = _viewModel.IsOpen;
            }
        }
        finally
        {
            _syncing = false;
        }
    }

    private void OnKeyChanged(object sender, TextChangedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        _viewModel.KeyInput = _keyBox.Text;
    }

    private void OnValueChanged(object sender, TextChangedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        _viewModel.ValueInput = _valueBox.Text;
    }

    private void OnReasonChanged(object sender, TextChangedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        _viewModel.Reason = _reasonBox.Text;
    }

    private void OnCancelClick(object sender, RoutedEventArgs e) => _viewModel.RequestClose();

    private void OnSaveClick(object sender, RoutedEventArgs e) => _viewModel.RequestSave();

    private void OnDrawerIsOpenChanged(DependencyObject sender, DependencyProperty dp)
    {
        // Map the drawer's light-dismiss (Escape / backdrop click) to the web onClose handler.
        if (_syncing || _drawer.IsOpen || !_viewModel.IsOpen)
        {
            return;
        }

        _viewModel.RequestClose();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();
}
