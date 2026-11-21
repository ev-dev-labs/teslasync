package smartmedia

import (
	"fmt"
	"time"
)

type SpotifyGrant struct {
	AccessToken string
	ExpiresIn   time.Duration
}

type CatalogTrack struct {
	ID        string
	Title     string
	Artists   []string
	DurationS int
}

type SpotifyFailure struct {
	Operation string
	Status    int
	Unknown   bool
}

func (failure *SpotifyFailure) Error() string {
	return fmt.Sprintf("Spotify %s did not confirm success (status=%d)", failure.Operation, failure.Status)
}
