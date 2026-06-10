package io.teslasync.shared.core.platform

import platform.Foundation.NSProcessInfo

public actual fun platformName(): String = NSProcessInfo.processInfo.operatingSystemVersionString

public actual fun platformLog(message: String) {
    println("[TeslaSync] $message")
}
