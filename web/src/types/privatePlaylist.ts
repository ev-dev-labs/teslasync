export type PlaylistSaveStatus = 'preview' | 'saving' | 'saved' | 'rejected' | 'created_only' | 'unknown';

export interface PlaylistCandidate {
  position: number;
  title: string;
  artist: string;
  duration_s: number;
  observed_at: string;
  suggested: boolean;
}

export interface PlaylistDraft {
  id: number;
  vehicle_id: number;
  departure_at: string;
  target_duration_s: number;
  created_at: string;
  expires_at: string;
  paused: boolean;
  snoozed_until?: string;
  status: PlaylistSaveStatus;
  playlist_id?: string;
  candidates: PlaylistCandidate[];
}

export interface PlaylistReview {
  draft: PlaylistDraft | null;
  spotify_available: boolean;
  spotify_connected: boolean;
}

export interface PlaylistSetup {
  departure_at: string;
  target_duration_s: number;
  confirmed: boolean;
}

export interface SavePrivatePlaylist {
  name: string;
  selection: { position: number; spotify_track_link: string }[];
  confirmed: boolean;
}
