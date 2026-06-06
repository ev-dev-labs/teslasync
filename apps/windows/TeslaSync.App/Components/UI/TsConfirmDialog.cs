using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Tokenized confirmation dialog (mirrors the web <c>ConfirmDialog</c>). Wraps
/// <see cref="ContentDialog"/> with a <see cref="IsDestructive"/> flag that
/// signals the primary action as dangerous. Focus is restored to the invoking
/// element on close by the base dialog. Button labels and message are
/// consumer-supplied (localized).
/// </summary>
public partial class TsConfirmDialog : ContentDialog
{
    public static readonly DependencyProperty IsDestructiveProperty = DependencyProperty.Register(
        nameof(IsDestructive), typeof(bool), typeof(TsConfirmDialog),
        new PropertyMetadata(false, OnDestructiveChanged));

    public TsConfirmDialog()
    {
        DefaultButton = ContentDialogButton.Close;
    }

    /// <summary>When true the confirm action is presented as destructive and is
    /// not the focused default, so an accidental Enter does not trigger it.</summary>
    public bool IsDestructive
    {
        get => (bool)GetValue(IsDestructiveProperty);
        set => SetValue(IsDestructiveProperty, value);
    }

    private static void OnDestructiveChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var dialog = (TsConfirmDialog)d;
        dialog.DefaultButton = dialog.IsDestructive
            ? ContentDialogButton.Close
            : ContentDialogButton.Primary;
    }
}
