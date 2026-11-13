/**
 * Supabase database types for the schema in supabase/complete_schema.sql.
 * Keep these definitions in sync with the SQL migrations when the schema changes.
 */

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type TimestampFields = {
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        {
          id: string;
          full_name: string;
          username: string | null;
          bio: string;
          avatar_url: string | null;
          is_private: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id: string;
          full_name?: string;
          username?: string | null;
          bio?: string;
          avatar_url?: string | null;
          is_private?: boolean;
          created_at?: string;
          updated_at?: string;
        }
      >;
      user_follows: Table<
        TimestampFields & {
          id: string;
          follower_id: string;
          following_id: string;
          status: 'accepted' | 'pending';
          accepted_at: string | null;
        },
        {
          id?: string;
          follower_id: string;
          following_id: string;
          status?: 'accepted' | 'pending';
          accepted_at?: string | null;
          created_at?: string;
        }
      >;
      social_posts: Table<
        TimestampFields & {
          id: string;
          user_id: string;
          caption: string;
          media_url: string;
          media_path: string;
          media_type: 'image' | 'video';
          cover_url: string | null;
          cover_path: string | null;
        },
        {
          id?: string;
          user_id: string;
          caption?: string;
          media_url: string;
          media_path: string;
          media_type?: 'image' | 'video';
          cover_url?: string | null;
          cover_path?: string | null;
          created_at?: string;
        }
      >;
      social_post_likes: Table<
        TimestampFields & { post_id: string; user_id: string },
        { post_id: string; user_id: string; created_at?: string }
      >;
      social_post_comments: Table<
        TimestampFields & {
          id: string;
          post_id: string;
          user_id: string;
          body: string;
          is_hidden: boolean;
          hidden_at: string | null;
          hidden_by: string | null;
          edited_at: string | null;
        },
        {
          id?: string;
          post_id: string;
          user_id: string;
          body: string;
          is_hidden?: boolean;
          hidden_at?: string | null;
          hidden_by?: string | null;
          edited_at?: string | null;
          created_at?: string;
        }
      >;
      social_saved_posts: Table<
        { post_id: string; user_id: string; saved_at: string },
        { post_id: string; user_id: string; saved_at?: string }
      >;
      social_stories: Table<
        TimestampFields & {
          id: string;
          user_id: string;
          media_url: string;
          media_path: string;
          media_type: 'image' | 'video';
          audio_url: string | null;
          audio_path: string | null;
          music_title: string | null;
          music_artist: string | null;
          music_source: string | null;
          expires_at: string;
        },
        {
          id?: string;
          user_id: string;
          media_url: string;
          media_path: string;
          media_type?: 'image' | 'video';
          audio_url?: string | null;
          audio_path?: string | null;
          music_title?: string | null;
          music_artist?: string | null;
          music_source?: string | null;
          created_at?: string;
          expires_at?: string;
        }
      >;
      social_story_views: Table<
        { story_id: string; viewer_id: string; viewed_at: string },
        { story_id: string; viewer_id: string; viewed_at?: string }
      >;
      social_story_replies: Table<
        TimestampFields & {
          id: string;
          story_id: string;
          sender_id: string;
          recipient_id: string;
          body: string;
        },
        {
          id?: string;
          story_id: string;
          sender_id: string;
          recipient_id: string;
          body: string;
          created_at?: string;
        }
      >;
      social_story_likes: Table<
        TimestampFields & { story_id: string; user_id: string },
        { story_id: string; user_id: string; created_at?: string }
      >;
      social_music_tracks: Table<
        TimestampFields & {
          id: string;
          title: string;
          artist: string;
          audio_url: string;
          cover_url: string | null;
          duration_seconds: number;
          is_active: boolean;
        },
        {
          id?: string;
          title: string;
          artist: string;
          audio_url: string;
          cover_url?: string | null;
          duration_seconds?: number;
          is_active?: boolean;
          created_at?: string;
        }
      >;
      social_conversations: Table<
        {
          id: string;
          participant_one: string;
          participant_two: string;
          last_message: string;
          last_message_at: string;
          created_at: string;
        },
        {
          id?: string;
          participant_one: string;
          participant_two: string;
          last_message?: string;
          last_message_at?: string;
          created_at?: string;
        }
      >;
      social_messages: Table<
        TimestampFields & {
          id: string;
          conversation_id: string;
          sender_id: string;
          receiver_id: string;
          text: string;
          media_type: 'image' | 'video' | null;
          media_path: string | null;
          read_at: string | null;
        },
        {
          id?: string;
          conversation_id: string;
          sender_id: string;
          receiver_id: string;
          text: string;
          media_type?: 'image' | 'video' | null;
          media_path?: string | null;
          read_at?: string | null;
          created_at?: string;
        }
      >;
      social_message_reactions: Table<
        {
          message_id: string;
          user_id: string;
          emoji: string;
          created_at: string;
        },
        {
          message_id: string;
          user_id: string;
          emoji: string;
          created_at?: string;
        }
      >;
      profile_contacts: Table<
        {
          user_id: string;
          phone: string | null;
          updated_at: string;
        },
        {
          user_id: string;
          phone?: string | null;
          updated_at?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      get_profile_stats: {
        Args: { target_user_id: string };
        Returns: {
          posts_count: number;
          followers_count: number;
          following_count: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
