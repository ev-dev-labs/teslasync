package io.teslasync.android.notifications

/** A [SystemNotificationPresenter] fake that records every [NotificationContent] it was asked to post. */
class FakeSystemNotificationPresenter : SystemNotificationPresenter {
    val shown = mutableListOf<NotificationContent>()

    override fun show(content: NotificationContent) {
        shown.add(content)
    }
}
