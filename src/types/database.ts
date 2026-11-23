export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type WebSubStatus = 'pending' | 'active' | 'expired';

export type GenreTag = 'Phim AI' | 'HH2D';

export type ChannelDefaultCategory = 'AUTO' | 'HH2D' | 'PHIM_AI';

export type CinemaFormat = 'Anime / Hoạt hình' | 'Phim Người Đóng';

export type VideoType = 'episode' | 'full_movie' | 'trailer';

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected';

export type UserSeriesStatus = 'following' | 'completed' | 'hidden';

export type UserSeriesStatusRow = {
  id: string;
  user_id: string;
  channel_id: string;
  series_key: string;
  status: UserSeriesStatus;
  updated_at: string;
  created_at: string;
};

export type UserWatchLaterRow = {
  id: string;
  user_id: string;
  video_id: string;
  created_at: string;
};

export type ExploreCacheRow = {
  user_id: string;
  keywords: string[];
  items: Json;
  updated_at: string;
};

export type AccessRequestRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  message: string | null;
  status: AccessRequestStatus;
  reviewed_at: string | null;
  created_at: string;
};

export type AllowedEmailRow = {
  email: string;
  note: string | null;
  is_active: boolean;
  created_at: string;
};

export type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  last_synced_at: string | null;
  last_cinema_sync_at?: string | null;
  created_at: string;
};

export type ChannelRow = {
  channel_id: string;
  title: string;
  thumbnail_url: string | null;
  custom_url: string | null;
  is_subscribed?: boolean | null;
  default_category?: ChannelDefaultCategory | null;
  websub_status: WebSubStatus;
  websub_expires_at: string | null;
  next_page_token?: string | null;
  sync_page_token?: string | null;
  is_fully_synced?: boolean | null;
  updated_at: string;
};

export type UserChannelRow = {
  id: string;
  user_id: string;
  channel_id: string;
  is_selected: boolean;
  genre_tag: GenreTag;
  genre_tags: GenreTag[] | null;
  created_at: string;
};

export type VideoRow = {
  video_id: string;
  channel_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  published_at: string;
  duration_seconds: number;
  is_short: boolean;
  video_type: VideoType;
  detected_genre: GenreTag | null;
  series_name: string | null;
  episode_number: number | null;
  ai_summary: string | null;
  insight_data?: Json | null;
  is_manual_tag?: boolean;
  is_theatrical_movie?: boolean | null;
  theatrical_release_year?: number | null;
  cinema_format?: CinemaFormat | null;
  cinema_genres?: string[] | null;
  is_unavailable?: boolean | null;
  created_at: string;
};

export type WatchProgressRow = {
  id: string;
  user_id: string;
  video_id: string;
  progress_seconds: number;
  is_completed: boolean;
  last_watched_at: string;
};

export type Database = {
  public: {
    Tables: {
      allowed_emails: {
        Row: AllowedEmailRow;
        Insert: {
          email: string;
          note?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          email?: string;
          note?: string | null;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: ProfileRow;
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          last_synced_at?: string | null;
          last_cinema_sync_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          last_synced_at?: string | null;
          last_cinema_sync_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      channels: {
        Row: ChannelRow;
        Insert: {
          channel_id: string;
          title: string;
          thumbnail_url?: string | null;
          custom_url?: string | null;
          is_subscribed?: boolean | null;
          default_category?: ChannelDefaultCategory | null;
          websub_status?: WebSubStatus;
          websub_expires_at?: string | null;
          next_page_token?: string | null;
          updated_at?: string;
        };
        Update: {
          channel_id?: string;
          title?: string;
          thumbnail_url?: string | null;
          custom_url?: string | null;
          is_subscribed?: boolean | null;
          default_category?: ChannelDefaultCategory | null;
          websub_status?: WebSubStatus;
          websub_expires_at?: string | null;
          next_page_token?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_channels: {
        Row: UserChannelRow;
        Insert: {
          id?: string;
          user_id: string;
          channel_id: string;
          is_selected?: boolean;
          genre_tag?: GenreTag;
          genre_tags?: GenreTag[] | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          channel_id?: string;
          is_selected?: boolean;
          genre_tag?: GenreTag;
          genre_tags?: GenreTag[] | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_channels_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_channels_channel_id_fkey';
            columns: ['channel_id'];
            isOneToOne: false;
            referencedRelation: 'channels';
            referencedColumns: ['channel_id'];
          },
        ];
      };
      videos: {
        Row: VideoRow;
        Insert: {
          video_id: string;
          channel_id: string;
          title: string;
          description?: string | null;
          thumbnail_url?: string | null;
          published_at: string;
          duration_seconds?: number;
          is_short?: boolean;
          video_type?: VideoType;
          detected_genre?: GenreTag | null;
          series_name?: string | null;
          episode_number?: number | null;
          ai_summary?: string | null;
          insight_data?: Json | null;
          is_manual_tag?: boolean;
          is_theatrical_movie?: boolean | null;
          theatrical_release_year?: number | null;
          cinema_format?: CinemaFormat | null;
          cinema_genres?: string[] | null;
          created_at?: string;
        };
        Update: {
          video_id?: string;
          channel_id?: string;
          title?: string;
          description?: string | null;
          thumbnail_url?: string | null;
          published_at?: string;
          duration_seconds?: number;
          is_short?: boolean;
          video_type?: VideoType;
          detected_genre?: GenreTag | null;
          series_name?: string | null;
          episode_number?: number | null;
          ai_summary?: string | null;
          insight_data?: Json | null;
          is_manual_tag?: boolean;
          is_theatrical_movie?: boolean | null;
          theatrical_release_year?: number | null;
          cinema_format?: CinemaFormat | null;
          cinema_genres?: string[] | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'videos_channel_id_fkey';
            columns: ['channel_id'];
            isOneToOne: false;
            referencedRelation: 'channels';
            referencedColumns: ['channel_id'];
          },
        ];
      };
      watch_progress: {
        Row: WatchProgressRow;
        Insert: {
          id?: string;
          user_id: string;
          video_id: string;
          progress_seconds?: number;
          is_completed?: boolean;
          last_watched_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          video_id?: string;
          progress_seconds?: number;
          is_completed?: boolean;
          last_watched_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'watch_progress_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'watch_progress_video_id_fkey';
            columns: ['video_id'];
            isOneToOne: false;
            referencedRelation: 'videos';
            referencedColumns: ['video_id'];
          },
        ];
      };
      access_requests: {
        Row: AccessRequestRow;
        Insert: {
          id?: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          message?: string | null;
          status?: AccessRequestStatus;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          message?: string | null;
          status?: AccessRequestStatus;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      explore_cache: {
        Row: ExploreCacheRow;
        Insert: {
          user_id: string;
          keywords?: string[];
          items?: Json;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          keywords?: string[];
          items?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'explore_cache_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      user_series_status: {
        Row: UserSeriesStatusRow;
        Insert: {
          id?: string;
          user_id: string;
          channel_id: string;
          series_key: string;
          status: UserSeriesStatus;
          updated_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          channel_id?: string;
          series_key?: string;
          status?: UserSeriesStatus;
          updated_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_series_status_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      user_watch_later: {
        Row: UserWatchLaterRow;
        Insert: {
          id?: string;
          user_id: string;
          video_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          video_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_watch_later_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_watch_later_video_id_fkey';
            columns: ['video_id'];
            isOneToOne: false;
            referencedRelation: 'videos';
            referencedColumns: ['video_id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
