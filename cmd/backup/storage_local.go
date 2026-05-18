package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// localUploader writes the dump + manifest to a mounted path (a PVC
// in the k8s deployment, a host bind-mount in docker-compose, or a
// loopback NFS share — all the same to this code).
type localUploader struct {
	cfg *Config
}

func newLocalUploader(cfg *Config) (*localUploader, error) {
	if err := os.MkdirAll(cfg.LocalPath, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir %s: %w", cfg.LocalPath, err)
	}
	return &localUploader{cfg: cfg}, nil
}

func (u *localUploader) Upload(_ context.Context, dumpPath, manifestPath string) error {
	dst := filepath.Join(u.cfg.LocalPath, filepath.Base(dumpPath))
	if err := moveOrCopy(dumpPath, dst); err != nil {
		return fmt.Errorf("publish dump: %w", err)
	}
	manifestDst := filepath.Join(u.cfg.LocalPath, filepath.Base(manifestPath))
	if err := moveOrCopy(manifestPath, manifestDst); err != nil {
		return fmt.Errorf("publish manifest: %w", err)
	}
	log.Info().Str("dump", dst).Str("manifest", manifestDst).Msg("local upload complete")
	return nil
}

// moveOrCopy renames if src + dst are on the same filesystem, else
// streams a copy. Temp dir is usually on the writable layer (/tmp)
// while the destination is the PVC, so a copy is the common case.
func moveOrCopy(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return os.Remove(src)
}

func (u *localUploader) EnforceRetention(_ context.Context, daily, weekly int) error {
	if daily <= 0 && weekly <= 0 {
		return nil
	}
	entries, err := os.ReadDir(u.cfg.LocalPath)
	if err != nil {
		return err
	}

	type dumpInfo struct {
		name string
		mod  time.Time
	}
	var dumps []dumpInfo
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".dump") {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		dumps = append(dumps, dumpInfo{name: e.Name(), mod: fi.ModTime()})
	}
	sort.Slice(dumps, func(i, j int) bool { return dumps[i].mod.After(dumps[j].mod) })

	// Tier classification: the newest `daily` files are the daily tier;
	// from the remainder we keep one per ISO week up to `weekly` weeks.
	keep := map[string]bool{}
	for i := 0; i < daily && i < len(dumps); i++ {
		keep[dumps[i].name] = true
	}
	seenWeek := map[string]bool{}
	weeklyKept := 0
	for i := daily; i < len(dumps) && weeklyKept < weekly; i++ {
		y, w := dumps[i].mod.ISOWeek()
		k := fmt.Sprintf("%d-%02d", y, w)
		if seenWeek[k] {
			continue
		}
		seenWeek[k] = true
		keep[dumps[i].name] = true
		weeklyKept++
	}

	for _, d := range dumps {
		if keep[d.name] {
			continue
		}
		dumpPath := filepath.Join(u.cfg.LocalPath, d.name)
		manifestPath := dumpPath + ".manifest.json"
		if err := os.Remove(dumpPath); err != nil && !os.IsNotExist(err) {
			log.Warn().Err(err).Str("path", dumpPath).Msg("retention: remove dump failed")
			continue
		}
		_ = os.Remove(manifestPath)
		log.Info().Str("file", d.name).Msg("retention: pruned old backup")
	}
	return nil
}
