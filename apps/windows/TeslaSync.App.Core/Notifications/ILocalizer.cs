namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// The localization seam the notification layer composes display strings through (P2/W8-0001, ADR-016
/// i18n). The WinUI app adapts this to its resource pipeline (<c>Strings/{lang}/Resources.resw</c> via
/// the shell <c>Localization</c> bridge); headless callers and unit tests use
/// <see cref="PassthroughLocalizer"/>, which returns the supplied English fallback so toast/jump-list
/// composition is verified row-for-row without a resource host.
/// </summary>
public interface ILocalizer
{
    /// <summary>Resolves <paramref name="key"/> to a localized string, or returns <paramref name="fallback"/>.</summary>
    string GetString(string key, string fallback);
}

/// <summary>
/// An <see cref="ILocalizer"/> that always returns the English fallback (the headless / unit-test
/// default). It still flows every label through a single keyed call site so the resource keys are
/// asserted in tests and resolved for real in the app.
/// </summary>
public sealed class PassthroughLocalizer : ILocalizer
{
    /// <summary>The shared singleton instance.</summary>
    public static PassthroughLocalizer Instance { get; } = new();

    private PassthroughLocalizer()
    {
    }

    /// <inheritdoc />
    public string GetString(string key, string fallback) => fallback;
}
