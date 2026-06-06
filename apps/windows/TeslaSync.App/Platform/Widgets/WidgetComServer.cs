using System.Threading;

namespace TeslaSync.App.Widgets;

/// <summary>
/// Hosts the widget-provider COM server (P2/W8-0003). When the Windows widget host launches the app
/// with <see cref="ComServerArgument"/>, <see cref="Program"/> calls <see cref="Run"/> instead of
/// starting the interactive shell: it registers the <see cref="TeslaSyncWidgetProvider"/> class factory
/// on a dedicated multi-threaded-apartment thread (so incoming provider calls are dispatched without a
/// UI message pump) and keeps the process alive until the host releases it. No window is shown and no
/// SSE stream is opened — the provider reads only cached state.
/// </summary>
internal static class WidgetComServer
{
    /// <summary>The activation argument the manifest's widget COM ExeServer passes.</summary>
    public const string ComServerArgument = "-RegisterProcessAsComServer";

    /// <summary>True when <paramref name="args"/> indicate a widget-provider COM-server launch.</summary>
    public static bool IsWidgetActivation(string[]? args) =>
        args is not null && Array.Exists(args, a => string.Equals(a, ComServerArgument, StringComparison.OrdinalIgnoreCase));

    /// <summary>Registers the provider and blocks the process serving widget requests until released.</summary>
    public static void Run()
    {
        // COM servers must service calls on an MTA thread; the WinUI launch path owns the STA, so the
        // provider gets its own apartment. ComWrappers is already initialized by Program.Main.
        var thread = new Thread(ServeUntilReleased)
        {
            Name = "TeslaSyncWidgetComServer",
            IsBackground = false,
        };
        thread.SetApartmentState(ApartmentState.MTA);
        thread.Start();
        thread.Join();
    }

    private static void ServeUntilReleased()
    {
        var factory = new WidgetProviderFactory<TeslaSyncWidgetProvider>();
        uint cookie = WidgetComInterop.RegisterClassObject(typeof(TeslaSyncWidgetProvider).GUID, factory);
        try
        {
            // The widget host owns this process's lifetime: it terminates us once the last widget that
            // uses the provider is removed. Until then we stay resident so the class object is reachable.
            using var resident = new ManualResetEventSlim(false);
            resident.Wait();
        }
        finally
        {
            WidgetComInterop.RevokeClassObject(cookie);
        }
    }
}
