// Package trippacket assembles evidence for a private, explicitly classified trip packet.
package trippacket

import (
	"cmp"
	"math"
	"slices"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/cases"
)

const (
	MaxDrives   = 1_024
	MaxReceipts = 2_048
)

type Purpose string

const (
	Business Purpose = "business"
	Commute  Purpose = "commute"
	Personal Purpose = "personal"
)

func (p Purpose) Valid() bool {
	return p == Business || p == Commute || p == Personal
}

type Drive struct {
	ID        int64     `json:"drive_id"`
	StartedAt time.Time `json:"started_at"`
	EndedAt   time.Time `json:"ended_at"`
	DistanceM *float64  `json:"distance_m"`
	Purpose   Purpose   `json:"-"`
}

type Receipt struct {
	DriveID     int64  `json:"drive_id"`
	Day         string `json:"receipt_day"`
	Reference   string `json:"reference"`
	Currency    string `json:"currency"`
	AmountMinor int64  `json:"amount_minor"`
}

func (r Receipt) Valid() bool {
	day, err := time.Parse(time.DateOnly, r.Day)
	if err != nil || day.Year() <= 0 || day.Format(time.DateOnly) != r.Day || r.DriveID <= 0 ||
		r.Reference == "" || len(r.Reference) > 120 || strings.TrimSpace(r.Reference) != r.Reference ||
		strings.IndexFunc(r.Reference, unicode.IsControl) >= 0 ||
		len(r.Currency) != 3 || r.AmountMinor <= 0 || r.AmountMinor > 1_000_000_000 {
		return false
	}
	for _, c := range r.Currency {
		if c < 'A' || c > 'Z' {
			return false
		}
	}
	return true
}

var receiptReferenceFold = cases.Fold()

type Packet struct {
	From                      time.Time `json:"from"`
	Through                   time.Time `json:"through"`
	BusinessDrives            []Drive   `json:"business_drives"`
	MatchedReceipts           []Receipt `json:"matched_receipts"`
	UnclassifiedDriveIDs      []int64   `json:"unclassified_drive_ids,omitempty"`
	UnclassifiedDriveCount    int       `json:"unclassified_drive_count"`
	MissingDistanceCount      int       `json:"business_drives_without_distance"`
	UnmatchedReceipts         int       `json:"unmatched_receipts"`
	ObservedBusinessDistanceM float64   `json:"observed_business_distance_m"`
}

type Outcome string

const (
	Ready      Outcome = "ready"
	NoBusiness Outcome = "no_business_tags"
	Partial    Outcome = "missing_business_evidence"
	Uncertain  Outcome = "uncertain_coverage"
)

type driveDays struct {
	first, last string
}

func Prepare(from, through time.Time, drives []Drive, receipts []Receipt) (*Packet, Outcome) {
	first := time.Date(from.Year(), from.Month(), 1, 0, 0, 0, 0, from.Location())
	if from.IsZero() || !from.Equal(first) || !through.Equal(first.AddDate(0, 1, 0)) ||
		len(drives) > MaxDrives || len(receipts) > MaxReceipts {
		return nil, Uncertain
	}
	packet := &Packet{
		From: from, Through: through.In(from.Location()), BusinessDrives: []Drive{},
		MatchedReceipts: []Receipt{}, UnclassifiedDriveIDs: []int64{},
	}
	seen := make(map[int64]struct{}, len(drives))
	business := make(map[int64]driveDays)
	for _, d := range drives {
		if _, exists := seen[d.ID]; exists || d.ID <= 0 || d.StartedAt.Before(from) ||
			!d.StartedAt.Before(through) || !d.EndedAt.After(d.StartedAt) {
			return nil, Uncertain
		}
		seen[d.ID] = struct{}{}
		switch d.Purpose {
		case Business:
			business[d.ID] = driveDays{d.StartedAt.In(from.Location()).Format(time.DateOnly), d.EndedAt.In(from.Location()).Format(time.DateOnly)}
			// A completed drive can carry zero when distance integration failed.
			if d.DistanceM == nil || math.IsNaN(*d.DistanceM) || *d.DistanceM <= 0 || *d.DistanceM > 10_000_000 {
				d.DistanceM = nil
				packet.MissingDistanceCount++
			} else {
				packet.ObservedBusinessDistanceM += *d.DistanceM
			}
			packet.BusinessDrives = append(packet.BusinessDrives, d)
		case Personal, Commute:
		default:
			packet.UnclassifiedDriveIDs = append(packet.UnclassifiedDriveIDs, d.ID)
		}
	}
	if len(business) == 0 {
		return nil, NoBusiness
	}
	references := make(map[string]int, len(receipts))
	for _, r := range receipts {
		if r.Valid() {
			references[receiptReferenceFold.String(r.Reference)]++
		}
	}
	for _, r := range receipts {
		days, eligible := business[r.DriveID]
		if !eligible || !r.Valid() || r.Day < days.first || r.Day > days.last || references[receiptReferenceFold.String(r.Reference)] != 1 {
			packet.UnmatchedReceipts++
			continue
		}
		packet.MatchedReceipts = append(packet.MatchedReceipts, r)
	}
	if len(packet.BusinessDrives) == packet.MissingDistanceCount && len(packet.MatchedReceipts) == 0 {
		return nil, Partial
	}
	slices.SortFunc(packet.BusinessDrives, func(a, b Drive) int {
		if diff := a.StartedAt.Compare(b.StartedAt); diff != 0 {
			return diff
		}
		return cmp.Compare(a.ID, b.ID)
	})
	slices.Sort(packet.UnclassifiedDriveIDs)
	packet.UnclassifiedDriveCount = len(packet.UnclassifiedDriveIDs)
	slices.SortFunc(packet.MatchedReceipts, func(a, b Receipt) int {
		if diff := cmp.Compare(a.DriveID, b.DriveID); diff != 0 {
			return diff
		}
		if diff := strings.Compare(a.Currency, b.Currency); diff != 0 {
			return diff
		}
		return strings.Compare(a.Reference, b.Reference)
	})
	return packet, Ready
}
