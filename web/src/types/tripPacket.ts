export type TripPacketPurpose = '' | 'business' | 'commute' | 'personal';

export interface TripPacketVersion {
  id: number;
  revision: number;
}

export interface TripPacketPlan extends TripPacketVersion {
  time_zone: string;
  paused: boolean;
  next_check_at: string | null;
}

export interface TripPacketReceipt {
  drive_id: number;
  receipt_day: string;
  reference: string;
  currency: string;
  amount_minor: number;
}

export interface TripPacketEntry {
  drive_id: number;
  purpose: TripPacketPurpose;
  receipts: TripPacketReceipt[];
}

export interface TripPacketDrive {
  drive_id: number;
  started_at: string;
  ended_at: string;
  distance_m: number | null;
}

export interface TripPacket {
  from: string;
  through: string;
  business_drives: TripPacketDrive[];
  matched_receipts: TripPacketReceipt[];
  unclassified_drive_ids?: number[];
  unclassified_drive_count: number;
  business_drives_without_distance: number;
  unmatched_receipts: number;
  observed_business_distance_m: number;
}

export interface TripPacketReview {
  plan: TripPacketPlan | null;
  entry: TripPacketEntry | null;
  packet: TripPacket | null;
  digest?: string;
  expires_at?: string;
}
