package models

import "time"

// PushSubscription represents a browser push notification subscription.
type PushSubscription struct {
	ID        int       `json:"id" db:"id"`
	Endpoint  string    `json:"endpoint" db:"endpoint"`
	P256dh    string    `json:"p256dh" db:"p256dh"`
	Auth      string    `json:"auth" db:"auth"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// PushSubscriptionRequest is the payload sent by the browser when subscribing.
type PushSubscriptionRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

// PushUnsubscribeRequest is the payload sent when removing a subscription.
type PushUnsubscribeRequest struct {
	Endpoint string `json:"endpoint"`
}
