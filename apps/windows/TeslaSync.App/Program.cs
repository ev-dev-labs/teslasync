using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;

namespace TeslaSync.App;

/// <summary>
/// Custom application entry point (replaces the XAML-generated <c>Main</c> via
/// <c>DISABLE_XAML_GENERATED_MAIN</c>). It registers the process as the single keyed
/// instance so that <c>teslasync://oauth/callback</c> protocol activations launched by
/// the system browser during sign-in (P2/W4-0001) are redirected to the already-running
/// app rather than spawning a second process that could never complete the awaiting
/// <see cref="Auth.WebAuthenticationBrowser"/> round-trip.
/// </summary>
public static partial class Program
{
    private const uint CwmoDefault = 0;
    private const uint Infinite = 0xFFFFFFFF;

    [STAThread]
    public static int Main(string[] args)
    {
        global::WinRT.ComWrappersSupport.InitializeComWrappers();

        // P2/W8-0003: when the Windows Widgets Board launches us to service the widget-provider COM
        // server, run the headless provider host instead of the interactive shell (no window, no SSE).
        if (Widgets.WidgetComServer.IsWidgetActivation(args))
        {
            Widgets.WidgetComServer.Run();
            return 0;
        }

        if (!ShouldStartThisInstance())
        {
            return 0;
        }

        Application.Start(static (p) =>
        {
            _ = p;
            var context = new DispatcherQueueSynchronizationContext(DispatcherQueue.GetForCurrentThread());
            System.Threading.SynchronizationContext.SetSynchronizationContext(context);
            _ = new App();
        });

        return 0;
    }

    private static bool ShouldStartThisInstance()
    {
        var activation = AppInstance.GetCurrent().GetActivatedEventArgs();
        var keyInstance = AppInstance.FindOrRegisterForKey("teslasync-main");

        if (keyInstance.IsCurrent)
        {
            keyInstance.Activated += OnInstanceActivated;
            return true;
        }

        RedirectActivationTo(activation, keyInstance);
        return false;
    }

    private static void OnInstanceActivated(object? sender, AppActivationArguments args)
    {
        if (Application.Current is App app)
        {
            app.OnRedirectedActivation(args);
        }
    }

    private static void RedirectActivationTo(AppActivationArguments args, AppInstance keyInstance)
    {
        var redirectEvent = CreateEventW(IntPtr.Zero, manualReset: 1, initialState: 0, name: null);
        _ = System.Threading.Tasks.Task.Run(() =>
        {
            keyInstance.RedirectActivationToAsync(args).AsTask().GetAwaiter().GetResult();
            SetEvent(redirectEvent);
        });

        var handles = new[] { redirectEvent };
        _ = CoWaitForMultipleObjects(CwmoDefault, Infinite, (uint)handles.Length, handles, out _);
    }

    [LibraryImport("kernel32.dll", SetLastError = true, StringMarshalling = StringMarshalling.Utf16, EntryPoint = "CreateEventW")]
    private static partial IntPtr CreateEventW(IntPtr attributes, int manualReset, int initialState, string? name);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    private static partial int SetEvent(IntPtr handle);

    [LibraryImport("ole32.dll")]
    private static partial int CoWaitForMultipleObjects(uint flags, uint timeoutMs, uint handleCount, IntPtr[] handles, out uint index);
}
