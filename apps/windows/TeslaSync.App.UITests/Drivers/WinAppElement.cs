namespace TeslaSync.App.UITests.Drivers;

/// <summary>
/// A handle to a single element in the application's UI Automation tree, returned by
/// <see cref="WinAppDriverClient"/> finds. It forwards interaction and inspection back to the owning
/// client so tests can read it fluently (click, type, text, control type, focus, accessible name).
/// </summary>
public sealed class WinAppElement(WinAppDriverClient client, string id)
{
    private readonly WinAppDriverClient _client = client ?? throw new ArgumentNullException(nameof(client));

    /// <summary>The WebDriver element id.</summary>
    public string Id { get; } = id ?? throw new ArgumentNullException(nameof(id));

    /// <summary>Invoke the element's default action.</summary>
    public Task ClickAsync(CancellationToken cancellationToken = default)
        => _client.ClickAsync(Id, cancellationToken);

    /// <summary>Type <paramref name="text"/> into the element.</summary>
    public Task SendKeysAsync(string text, CancellationToken cancellationToken = default)
        => _client.SendKeysAsync(Id, text, cancellationToken);

    /// <summary>Read the element's visible text.</summary>
    public Task<string> GetTextAsync(CancellationToken cancellationToken = default)
        => _client.GetTextAsync(Id, cancellationToken);

    /// <summary>Read a UIA attribute (e.g. <c>Name</c>, <c>IsEnabled</c>, <c>HasKeyboardFocus</c>).</summary>
    public Task<string?> GetAttributeAsync(string name, CancellationToken cancellationToken = default)
        => _client.GetAttributeAsync(Id, name, cancellationToken);

    /// <summary>Read the element's accessible name.</summary>
    public Task<string?> GetNameAsync(CancellationToken cancellationToken = default)
        => _client.GetAttributeAsync(Id, "Name", cancellationToken);

    /// <summary>Read the element's reported UIA control type.</summary>
    public Task<string> GetControlTypeAsync(CancellationToken cancellationToken = default)
        => _client.GetControlTypeAsync(Id, cancellationToken);

    /// <summary>True when the element currently holds keyboard focus.</summary>
    public Task<bool> HasKeyboardFocusAsync(CancellationToken cancellationToken = default)
        => _client.HasKeyboardFocusAsync(Id, cancellationToken);

    /// <summary>True when the element advertises itself as keyboard-focusable in the UIA tree.</summary>
    public async Task<bool> IsKeyboardFocusableAsync(CancellationToken cancellationToken = default)
    {
        var raw = await _client.GetAttributeAsync(Id, "IsKeyboardFocusable", cancellationToken).ConfigureAwait(false);
        return bool.TryParse(raw, out var value) && value;
    }

    /// <summary>True when the element is enabled (interactive) per the UIA tree.</summary>
    public async Task<bool> IsEnabledAsync(CancellationToken cancellationToken = default)
    {
        var raw = await _client.GetAttributeAsync(Id, "IsEnabled", cancellationToken).ConfigureAwait(false);
        return !bool.TryParse(raw, out var value) || value;
    }
}
