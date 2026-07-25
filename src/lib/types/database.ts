export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      contests: {
        Row: {
          added_by: string
          added_by_url: string
          date_added: string | null
          difficulty: number | null
          dislikes: number | null
          duration_seconds: number
          id: string
          likes: number | null
          name: string
          type: string | null
          url: string
        }
        Insert: {
          added_by: string
          added_by_url: string
          date_added?: string | null
          difficulty?: number | null
          dislikes?: number | null
          duration_seconds: number
          id?: string
          likes?: number | null
          name: string
          type?: string | null
          url: string
        }
        Update: {
          added_by?: string
          added_by_url?: string
          date_added?: string | null
          difficulty?: number | null
          dislikes?: number | null
          duration_seconds?: number
          id?: string
          likes?: number | null
          name?: string
          type?: string | null
          url?: string
        }
        Relationships: []
      }
      problems: {
        Row: {
          added_by: string
          added_by_url: string
          date_added: string
          difficulty: number | null
          dislikes: number
          id: string
          likes: number
          name: string
          solved: number | null
          tags: string[]
          type: string | null
          url: string
        }
        Insert: {
          added_by: string
          added_by_url: string
          date_added?: string
          difficulty?: number | null
          dislikes?: number
          id?: string
          likes?: number
          name: string
          solved?: number | null
          tags: string[]
          type?: string | null
          url: string
        }
        Update: {
          added_by?: string
          added_by_url?: string
          date_added?: string
          difficulty?: number | null
          dislikes?: number
          id?: string
          likes?: number
          name?: string
          solved?: number | null
          tags?: string[]
          type?: string | null
          url?: string
        }
        Relationships: []
      }
      user_contest_feedback: {
        Row: {
          contest_id: string
          created_at: string | null
          feedback_type: string
          id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          contest_id: string
          created_at?: string | null
          feedback_type: string
          id?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          contest_id?: string
          created_at?: string | null
          feedback_type?: string
          id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_contest_feedback_contest_id_fkey"
            columns: ["contest_id"]
            isOneToOne: false
            referencedRelation: "contests"
            referencedColumns: ["id"]
          },
        ]
      }
      user_contest_participation: {
        Row: {
          contest_id: string
          id: string
          participated_at: string | null
          user_id: string
        }
        Insert: {
          contest_id: string
          id?: string
          participated_at?: string | null
          user_id: string
        }
        Update: {
          contest_id?: string
          id?: string
          participated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_contest_participation_contest_id_fkey"
            columns: ["contest_id"]
            isOneToOne: false
            referencedRelation: "contests"
            referencedColumns: ["id"]
          },
        ]
      }
      user_platform_usernames: {
        Row: {
          codeforces_username: string | null
          created_at: string | null
          id: string
          kattis_username: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          codeforces_username?: string | null
          created_at?: string | null
          id?: string
          kattis_username?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          codeforces_username?: string | null
          created_at?: string | null
          id?: string
          kattis_username?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          created_at: string | null
          hide_from_leaderboard: boolean
          id: string
          theme: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          hide_from_leaderboard?: boolean
          id?: string
          theme?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          hide_from_leaderboard?: boolean
          id?: string
          theme?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_problem_feedback: {
        Row: {
          created_at: string | null
          feedback_type: string
          id: string
          problem_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          feedback_type: string
          id?: string
          problem_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          feedback_type?: string
          id?: string
          problem_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_problem_feedback_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      user_solved_problems: {
        Row: {
          id: string
          problem_id: string
          solved_at: string | null
          user_id: string
        }
        Insert: {
          id?: string
          problem_id: string
          solved_at?: string | null
          user_id: string
        }
        Update: {
          id?: string
          problem_id?: string
          solved_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_solved_problems_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "problems"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_leaderboard: {
        Args: never
        Returns: {
          avatar_url: string
          earliest_solves_sum: number
          github_url: string
          problems_solved: number
          rank: number
          user_id: string
          username: string
        }[]
      }
      get_user_solved_problems: {
        Args: { p_user_id: string }
        Returns: {
          problem_id: string
        }[]
      }
      update_contest_feedback: {
        Args: { p_contest_id: string; p_is_like: boolean }
        Returns: {
          added_by: string
          added_by_url: string
          date_added: string | null
          difficulty: number | null
          dislikes: number | null
          duration_seconds: number
          id: string
          likes: number | null
          name: string
          type: string | null
          url: string
        }[]
        SetofOptions: {
          from: "*"
          to: "contests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_problem_feedback: {
        Args: { p_is_like: boolean; p_problem_id: string }
        Returns: {
          added_by: string
          added_by_url: string
          date_added: string
          difficulty: number | null
          dislikes: number
          id: string
          likes: number
          name: string
          solved: number | null
          tags: string[]
          type: string | null
          url: string
        }[]
        SetofOptions: {
          from: "*"
          to: "problems"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
