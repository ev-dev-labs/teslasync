package io.teslasync.shared.core.platform

import android.util.Log

public actual fun platformName(): String = "Android ${android.os.Build.VERSION.SDK_INT}"

public actual fun platformLog(message: String) {
    Log.d("TeslaSync", message)
}
