package trippacket

import "time"

const MaxReceiptsPerDrive = 10

type Version struct {
	ID       int64 `json:"id"`
	Revision int64 `json:"revision"`
}

func (v Version) Valid() bool {
	return v.ID > 0 && v.Revision > 0
}

type Plan struct {
	Version
	TimeZone         string     `json:"time_zone"`
	Paused           bool       `json:"paused"`
	NextCheckAt      *time.Time `json:"next_check_at"`
	ReviewedThrough  *time.Time `json:"-"`
	DismissedThrough *time.Time `json:"-"`
}

func (p Plan) Location() (*time.Location, bool) {
	if p.TimeZone == "" || p.TimeZone == "Local" || len(p.TimeZone) > 80 {
		return nil, false
	}
	loc, err := time.LoadLocation(p.TimeZone)
	return loc, err == nil
}

type Entry struct {
	DriveID  int64     `json:"drive_id"`
	Purpose  Purpose   `json:"purpose"`
	Receipts []Receipt `json:"receipts"`
}

type receiptEntryKey struct {
	day, reference, currency string
}

func (e Entry) Valid() bool {
	if e.DriveID <= 0 || (e.Purpose != "" && !e.Purpose.Valid()) ||
		len(e.Receipts) > MaxReceiptsPerDrive || (e.Purpose != Business && len(e.Receipts) > 0) {
		return false
	}
	keys := make(map[receiptEntryKey]struct{}, len(e.Receipts))
	for _, r := range e.Receipts {
		if !r.Valid() || r.DriveID != e.DriveID {
			return false
		}
		key := receiptEntryKey{r.Day, receiptReferenceFold.String(r.Reference), r.Currency}
		if _, exists := keys[key]; exists {
			return false
		}
		keys[key] = struct{}{}
	}
	return true
}

type Review struct {
	Plan    *Plan      `json:"plan"`
	Entry   *Entry     `json:"entry"`
	Packet  *Packet    `json:"packet"`
	Digest  string     `json:"digest,omitempty"`
	Expires *time.Time `json:"expires_at,omitempty"`
}
