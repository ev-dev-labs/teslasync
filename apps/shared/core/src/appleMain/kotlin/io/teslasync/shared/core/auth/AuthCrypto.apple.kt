package io.teslasync.shared.core.auth

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.convert
import kotlinx.cinterop.usePinned
import platform.posix.arc4random_buf

@OptIn(ExperimentalForeignApi::class)
internal actual fun secureRandomBytes(size: Int): ByteArray {
    if (size == 0) return ByteArray(0)
    val bytes = ByteArray(size)
    bytes.usePinned { pinned ->
        // arc4random_buf is the platform CSPRNG on Apple targets (no seeding required).
        arc4random_buf(pinned.addressOf(0), size.convert())
    }
    return bytes
}
