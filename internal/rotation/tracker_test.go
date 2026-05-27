package rotation

import (
	"testing"
)

func TestFingerprint_Deterministic(t *testing.T) {
	tr := &Tracker{pepper: []byte("pep")}
	a := tr.Fingerprint("secret-a")
	b := tr.Fingerprint("secret-a")
	c := tr.Fingerprint("secret-b")
	if a != b {
		t.Fatalf("same secret yielded different fp: %s != %s", a, b)
	}
	if a == c {
		t.Fatalf("different secrets yielded same fp: %s == %s", a, c)
	}
	if len(a) != 64 {
		t.Fatalf("expected 64-char hex sha256, got %d", len(a))
	}
}

func TestFingerprint_PepperMatters(t *testing.T) {
	tr1 := &Tracker{pepper: []byte("pep1")}
	tr2 := &Tracker{pepper: []byte("pep2")}
	a := tr1.Fingerprint("secret")
	b := tr2.Fingerprint("secret")
	if a == b {
		t.Fatal("different peppers should yield different fingerprints")
	}
}

func TestSeverityFor_AgeBased(t *testing.T) {
	th := Thresholds{WarnDays: 30, CriticalDays: 90}
	cases := []struct {
		ageDays int
		want    Severity
	}{
		{0, SeverityOK},
		{29, SeverityOK},
		{30, SeverityWarn},
		{89, SeverityWarn},
		{90, SeverityCritical},
		{500, SeverityCritical},
	}
	for _, c := range cases {
		got, _ := severityFor(KindDatabasePassword, c.ageDays, nil, th)
		if got != c.want {
			t.Errorf("ageDays=%d: got %s, want %s", c.ageDays, got, c.want)
		}
	}
}

func TestSeverityFor_CertDaysToExpiry(t *testing.T) {
	th := Thresholds{WarnDays: 60, CriticalDays: 14}
	cases := []struct {
		days int
		want Severity
	}{
		{120, SeverityOK},
		{61, SeverityOK},
		{60, SeverityWarn},
		{15, SeverityWarn},
		{14, SeverityCritical},
		{-5, SeverityCritical},
	}
	for _, c := range cases {
		days := c.days
		got, _ := severityFor(KindMQTTMTLSCert, 0, &days, th)
		if got != c.want {
			t.Errorf("days=%d: got %s, want %s", c.days, got, c.want)
		}
	}
}

func TestSeverityRank_Ordering(t *testing.T) {
	if severityRank(SeverityCritical) <= severityRank(SeverityWarn) {
		t.Fatal("critical must rank > warn")
	}
	if severityRank(SeverityWarn) <= severityRank(SeverityOK) {
		t.Fatal("warn must rank > ok")
	}
	if severityRank(SeverityOK) <= severityRank(SeverityUnknown) {
		t.Fatal("ok must rank > unknown")
	}
}

func TestDefaultThresholds_PerKind(t *testing.T) {
	if DefaultThresholds(KindMQTTMTLSCert).CriticalDays != 14 {
		t.Error("MQTT cert critical should be 14d (rotation urgency)")
	}
	if DefaultThresholds(KindDatabasePassword).WarnDays != 180 {
		t.Error("DB password warn should be 180d")
	}
}

