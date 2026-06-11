using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The native WinUI 3 <c>CommandSelectDialog</c> surface — a parity port of
/// web/src/features/system/components/CommandSelectDialog.tsx. It presents a tokenized <see cref="TsModal"/>
/// (a <see cref="ContentDialog"/> that already provides the focus trap, Escape-to-dismiss and focus restoration this
/// overlay tier requires) whose body stacks the web composition: a leading icon + title header (web <c>def.icon</c>
/// + <c>t(def.labelKey, def.labelFallback)</c>) over a vertical list of option buttons (web
/// <c>sc.options.map(…)</c>) — each a full-width <see cref="TsButton"/> showing the resolved option label and an
/// optional verbatim description sub-line (web <c>{opt.description &amp;&amp; …}</c>). Choosing an option raises
/// <see cref="Selected"/> with the option value (web <c>onSelect(opt.value)</c>) and closes; the dialog's Cancel
/// button (web <c>t('common.cancel', 'Cancel')</c>) and Escape raise <see cref="Cancelled"/>. Every state the web
/// can be in is rendered — the option list, the in-flight <see cref="CommandSelectDialogViewModel.Loading"/> state
/// (web <c>loading</c> disables every option button) and a defensive empty branch (no options → a friendly
/// <see cref="TsEmptyState"/>, never a blank box) — so none is a hidden surface. The web component performs no read
/// query (its data arrives via props), so there is no error / stale / offline state to fetch. The view holds no
/// business logic and performs no HTTP — it binds the shared <see cref="CommandSelectDialogViewModel"/>; every string
/// resolves through the i18n facade, each interactive element carries a Narrator name, and the surface adds no
/// bespoke motion so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class CommandSelectDialog : ContentControl, IDisposable
{
    private const double FormMinWidth = 360;
    private const double FormMaxHeight = 520;
    private const double SectionSpacing = 16;
    private const double OptionSpacing = 8;
    private const double HeaderSpacing = 12;
    private const double OptionLabelSpacing = 2;
    private const double IconFontSize = 20;

    private readonly CommandSelectDialogViewModel _viewModel;
    private readonly DispatcherQueue? _dispatcher;
    private readonly StackPanel _form = new() { Spacing = SectionSpacing, MinWidth = FormMinWidth };
    private readonly StackPanel _optionsPanel = new() { Spacing = OptionSpacing };
    private readonly List<TsButton> _optionButtons = new();

    private TsModal? _dialog;
    private bool _started;
    private bool _shown;
    private bool _closeRaised;
    private bool _disposed;

    /// <summary>Creates the surface over the command-select request, the localizer and a diagnostics sink.</summary>
    /// <param name="request">The command-select request (title, icon, options) — web <c>def</c> + <c>def.selectConfig</c>.</param>
    /// <param name="localizer">The i18n facade resolving every string.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics sink.</param>
    public CommandSelectDialog(
        CommandSelectRequest request,
        ILocalizer localizer,
        CommandSelectDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(localizer);

        _viewModel = new CommandSelectDialogViewModel(request, localizer, diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Top;
        AutomationProperties.SetAutomationId(this, "command-select-dialog");
        AutomationProperties.SetName(this, _viewModel.Title);

        BuildForm();
        Content = _form;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.SelectRequested += OnViewModelSelectRequested;
        _viewModel.CloseRequested += OnViewModelCloseRequested;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>Raised when the user chooses an option with that option's value (web <c>onSelect(opt.value)</c>).</summary>
    public event EventHandler<string>? Selected;

    /// <summary>Raised when the user cancels / dismisses without choosing (web <c>onClose</c>).</summary>
    public event EventHandler? Cancelled;

    /// <summary>Raised once the modal has closed (for any reason): select, cancel, or dismiss.</summary>
    public event EventHandler? Closed;

    /// <summary>The canonical surface slug (<c>CommandSelectDialog</c>).</summary>
    public static string SurfaceId => CommandSelectRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting — e.g. the parent drives <c>Loading</c>).</summary>
    public CommandSelectDialogViewModel ViewModel => _viewModel;

    /// <summary>
    /// Present the modal over <paramref name="xamlRoot"/> (web <c>&lt;Modal open&gt;</c>). Idempotent: a second
    /// call while the dialog is showing is a no-op. Resolves when the modal has closed.
    /// </summary>
    public async Task ShowAsync(XamlRoot xamlRoot)
    {
        ArgumentNullException.ThrowIfNull(xamlRoot);
        if (_shown || _disposed)
        {
            return;
        }

        _shown = true;
        var dialog = new TsModal
        {
            CloseButtonText = _viewModel.CancelLabel,
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = xamlRoot,
            Content = new ScrollViewer
            {
                Content = _form,
                VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                HorizontalScrollMode = ScrollMode.Disabled,
                MaxHeight = FormMaxHeight,
            },
        };
        AutomationProperties.SetAutomationId(dialog, "command-select-dialog-surface");
        AutomationProperties.SetName(dialog, _viewModel.Title);
        dialog.CloseButtonClick += OnCloseButtonClick;
        dialog.Closed += OnDialogClosed;
        _dialog = dialog;

        try
        {
            await dialog.ShowAsync();
        }
        catch (COMException)
        {
            // Another ContentDialog is already open on this XamlRoot — the host owns ordering; surface nothing.
            _shown = false;
            _dialog = null;
        }
    }

    /// <summary>Detach from the view-model, dismiss the dialog and release handlers (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.SelectRequested -= OnViewModelSelectRequested;
        _viewModel.CloseRequested -= OnViewModelCloseRequested;
        _dialog?.Hide();
    }

    private void BuildForm()
    {
        _form.Children.Add(BuildHeader());

        if (_viewModel.HasOptions)
        {
            BuildOptions();
            _form.Children.Add(_optionsPanel);
        }
        else
        {
            _form.Children.Add(BuildEmptyState());
        }
    }

    private StackPanel BuildHeader()
    {
        var icon = new FontIcon { Glyph = _viewModel.IconGlyph, FontSize = IconFontSize };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw); // decorative — title carries the name

        var title = new PanelTitle { Value = _viewModel.Title, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetAutomationId(title, "command-select-dialog-title");

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = HeaderSpacing,
            VerticalAlignment = VerticalAlignment.Center,
        };
        header.Children.Add(icon);
        header.Children.Add(title);
        return header;
    }

    private void BuildOptions()
    {
        foreach (var option in _viewModel.Options)
        {
            var button = BuildOptionButton(option);
            _optionButtons.Add(button);
            _optionsPanel.Children.Add(button);
        }
    }

    private TsButton BuildOptionButton(CommandSelectResolvedOption option)
    {
        var button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Medium,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            IsEnabled = _viewModel.CanSelect,
        };

        var column = new StackPanel { Spacing = OptionLabelSpacing, HorizontalAlignment = HorizontalAlignment.Stretch };
        column.Children.Add(new Text { Value = option.Label });
        if (option.HasDescription)
        {
            column.Children.Add(new Caption { Value = option.Description! });
        }

        button.Content = column;
        AutomationProperties.SetName(button, option.Label);
        if (option.HasDescription)
        {
            AutomationProperties.SetFullDescription(button, option.Description!);
        }

        button.Click += (_, _) => OnOptionClick(option.Value);
        return button;
    }

    private TsEmptyState BuildEmptyState()
    {
        var empty = new TsEmptyState { Message = _viewModel.EmptyMessage };
        AutomationProperties.SetAutomationId(empty, "command-select-dialog-empty");
        return empty;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _viewModel.NotifyOpened();
        if (XamlRoot is { } xamlRoot)
        {
            _ = ShowAsync(xamlRoot);
        }
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnOptionClick(string value)
    {
        if (_viewModel.Select(value))
        {
            // Selection is terminal for this dialog (the parent reacts to onSelect); close it (web open=false).
            _dialog?.Hide();
        }
    }

    private void OnCloseButtonClick(ContentDialog sender, ContentDialogButtonClickEventArgs args) =>
        // Map the dialog's dismiss affordance (Cancel button + Escape) to the web onClose handler; never block it.
        _viewModel.RequestClose();

    private void OnViewModelSelectRequested(object? sender, string value) =>
        Selected?.Invoke(this, value);

    private void OnViewModelCloseRequested(object? sender, EventArgs e) =>
        Marshal(() =>
        {
            Cancelled?.Invoke(this, EventArgs.Empty);
            _dialog?.Hide();
        });

    private void OnDialogClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        sender.CloseButtonClick -= OnCloseButtonClick;
        sender.Closed -= OnDialogClosed;
        _dialog = null;
        RaiseClosed();
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(() => ApplyViewModelState(e.PropertyName));

    private void ApplyViewModelState(string? propertyName)
    {
        switch (propertyName)
        {
            case nameof(CommandSelectDialogViewModel.CanSelect):
                foreach (var button in _optionButtons)
                {
                    button.IsEnabled = _viewModel.CanSelect;
                }

                break;
            default:
                break;
        }
    }

    private void RaiseClosed()
    {
        if (_closeRaised)
        {
            return;
        }

        _closeRaised = true;
        Closed?.Invoke(this, EventArgs.Empty);
    }

    private void Marshal(DispatcherQueueHandler action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(action);
        }
        else
        {
            action();
        }
    }
}
