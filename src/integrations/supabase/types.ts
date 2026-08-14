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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      attendance_records: {
        Row: {
          class_date: string
          created_at: string
          id: string
          note: string | null
          status: string
          subject_id: string
          user_id: string
        }
        Insert: {
          class_date: string
          created_at?: string
          id?: string
          note?: string | null
          status?: string
          subject_id: string
          user_id: string
        }
        Update: {
          class_date?: string
          created_at?: string
          id?: string
          note?: string | null
          status?: string
          subject_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_connections: {
        Row: {
          account_email: string | null
          created_at: string
          id: string
          last_sync_at: string | null
          provider: string
          status: string
          user_id: string
        }
        Insert: {
          account_email?: string | null
          created_at?: string
          id?: string
          last_sync_at?: string | null
          provider: string
          status?: string
          user_id: string
        }
        Update: {
          account_email?: string | null
          created_at?: string
          id?: string
          last_sync_at?: string | null
          provider?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      calendar_events: {
        Row: {
          created_at: string
          ends_at: string | null
          external_id: string | null
          id: string
          kind: string
          location: string | null
          source: string
          starts_at: string
          subject_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          external_id?: string | null
          id?: string
          kind?: string
          location?: string | null
          source?: string
          starts_at: string
          subject_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          external_id?: string | null
          id?: string
          kind?: string
          location?: string | null
          source?: string
          starts_at?: string
          subject_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_checkins: {
        Row: {
          checkin_date: string
          completed_plan: string | null
          created_at: string
          focus_rating: number | null
          hardest_subject_id: string | null
          id: string
          pending_note: string | null
          studied_minutes: number | null
          user_id: string
        }
        Insert: {
          checkin_date?: string
          completed_plan?: string | null
          created_at?: string
          focus_rating?: number | null
          hardest_subject_id?: string | null
          id?: string
          pending_note?: string | null
          studied_minutes?: number | null
          user_id: string
        }
        Update: {
          checkin_date?: string
          completed_plan?: string | null
          created_at?: string
          focus_rating?: number | null
          hardest_subject_id?: string | null
          id?: string
          pending_note?: string | null
          studied_minutes?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_checkins_hardest_subject_id_fkey"
            columns: ["hardest_subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_topics: {
        Row: {
          exam_id: string
          topic_id: string
          user_id: string
        }
        Insert: {
          exam_id: string
          topic_id: string
          user_id: string
        }
        Update: {
          exam_id?: string
          topic_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_topics_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_topics_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          content: string | null
          created_at: string
          exam_at: string
          id: string
          kind: string
          subject_id: string | null
          title: string
          updated_at: string
          user_id: string
          weight: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          exam_at: string
          id?: string
          kind?: string
          subject_id?: string | null
          title: string
          updated_at?: string
          user_id: string
          weight?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          exam_at?: string
          id?: string
          kind?: string
          subject_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          weight?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exams_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      focus_sessions: {
        Row: {
          actual_minutes: number | null
          created_at: string
          ended_at: string | null
          id: string
          plan_session_id: string | null
          planned_minutes: number
          started_at: string
          status: string
          subject_id: string | null
          topic_id: string | null
          user_id: string
        }
        Insert: {
          actual_minutes?: number | null
          created_at?: string
          ended_at?: string | null
          id?: string
          plan_session_id?: string | null
          planned_minutes?: number
          started_at?: string
          status?: string
          subject_id?: string | null
          topic_id?: string | null
          user_id: string
        }
        Update: {
          actual_minutes?: number | null
          created_at?: string
          ended_at?: string | null
          id?: string
          plan_session_id?: string | null
          planned_minutes?: number
          started_at?: string
          status?: string
          subject_id?: string | null
          topic_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "focus_sessions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "focus_sessions_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          active: boolean
          created_at: string
          id: string
          metric: string
          period: string
          subject_id: string | null
          target: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          metric?: string
          period?: string
          subject_id?: string | null
          target: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          metric?: string
          period?: string
          subject_id?: string | null
          target?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      grades: {
        Row: {
          created_at: string
          exam_id: string | null
          graded_on: string
          id: string
          max_score: number
          score: number
          subject_id: string
          term: string | null
          title: string
          user_id: string
          weight: number
        }
        Insert: {
          created_at?: string
          exam_id?: string | null
          graded_on?: string
          id?: string
          max_score?: number
          score: number
          subject_id: string
          term?: string | null
          title: string
          user_id: string
          weight?: number
        }
        Update: {
          created_at?: string
          exam_id?: string | null
          graded_on?: string
          id?: string
          max_score?: number
          score?: number
          subject_id?: string
          term?: string | null
          title?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "grades_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grades_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          classes: boolean
          daily_summary: boolean
          enabled: boolean
          exams: boolean
          goals: boolean
          monthly_summary: boolean
          overdue: boolean
          quiet_end: string
          quiet_start: string
          study_sessions: boolean
          tasks: boolean
          updated_at: string
          user_id: string
          weekly_summary: boolean
        }
        Insert: {
          classes?: boolean
          daily_summary?: boolean
          enabled?: boolean
          exams?: boolean
          goals?: boolean
          monthly_summary?: boolean
          overdue?: boolean
          quiet_end?: string
          quiet_start?: string
          study_sessions?: boolean
          tasks?: boolean
          updated_at?: string
          user_id: string
          weekly_summary?: boolean
        }
        Update: {
          classes?: boolean
          daily_summary?: boolean
          enabled?: boolean
          exams?: boolean
          goals?: boolean
          monthly_summary?: boolean
          overdue?: boolean
          quiet_end?: string
          quiet_start?: string
          study_sessions?: boolean
          tasks?: boolean
          updated_at?: string
          user_id?: string
          weekly_summary?: boolean
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          category: string
          created_at: string
          dedupe_key: string | null
          dismissed_at: string | null
          id: string
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          category?: string
          created_at?: string
          dedupe_key?: string | null
          dismissed_at?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          category?: string
          created_at?: string
          dedupe_key?: string | null
          dismissed_at?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      plan_sessions: {
        Row: {
          created_at: string
          duration_minutes: number
          exam_id: string | null
          generated: boolean
          id: string
          kind: string
          priority: number
          reason: string | null
          session_date: string
          start_time: string | null
          status: string
          subject_id: string | null
          task_id: string | null
          topic_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_minutes?: number
          exam_id?: string | null
          generated?: boolean
          id?: string
          kind?: string
          priority?: number
          reason?: string | null
          session_date: string
          start_time?: string | null
          status?: string
          subject_id?: string | null
          task_id?: string | null
          topic_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          duration_minutes?: number
          exam_id?: string | null
          generated?: boolean
          id?: string
          kind?: string
          priority?: number
          reason?: string | null
          session_date?: string
          start_time?: string | null
          status?: string
          subject_id?: string | null
          task_id?: string | null
          topic_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_sessions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_sessions_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_sessions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_sessions_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          attendance_target: number
          created_at: string
          daily_load_limit_minutes: number
          full_name: string | null
          grade_pass: number
          grade_scale_max: number
          id: string
          stage: string
          timezone: string
          updated_at: string
          weekly_study_target_minutes: number
        }
        Insert: {
          attendance_target?: number
          created_at?: string
          daily_load_limit_minutes?: number
          full_name?: string | null
          grade_pass?: number
          grade_scale_max?: number
          id: string
          stage?: string
          timezone?: string
          updated_at?: string
          weekly_study_target_minutes?: number
        }
        Update: {
          attendance_target?: number
          created_at?: string
          daily_load_limit_minutes?: number
          full_name?: string | null
          grade_pass?: number
          grade_scale_max?: number
          id?: string
          stage?: string
          timezone?: string
          updated_at?: string
          weekly_study_target_minutes?: number
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      quiz_answers: {
        Row: {
          attempt_id: string
          correct_answer: string | null
          created_at: string
          explanation: string | null
          given_answer: string | null
          id: string
          is_correct: boolean | null
          options: Json | null
          question: string
          seconds_spent: number | null
          topic_id: string | null
          user_id: string
        }
        Insert: {
          attempt_id: string
          correct_answer?: string | null
          created_at?: string
          explanation?: string | null
          given_answer?: string | null
          id?: string
          is_correct?: boolean | null
          options?: Json | null
          question: string
          seconds_spent?: number | null
          topic_id?: string | null
          user_id: string
        }
        Update: {
          attempt_id?: string
          correct_answer?: string | null
          created_at?: string
          explanation?: string | null
          given_answer?: string | null
          id?: string
          is_correct?: boolean | null
          options?: Json | null
          question?: string
          seconds_spent?: number | null
          topic_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_answers_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "quiz_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quiz_answers_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      quiz_attempts: {
        Row: {
          correct_count: number | null
          created_at: string
          difficulty: string
          duration_seconds: number | null
          finished_at: string | null
          id: string
          question_count: number
          status: string
          subject_id: string | null
          user_id: string
        }
        Insert: {
          correct_count?: number | null
          created_at?: string
          difficulty?: string
          duration_seconds?: number | null
          finished_at?: string | null
          id?: string
          question_count?: number
          status?: string
          subject_id?: string | null
          user_id: string
        }
        Update: {
          correct_count?: number | null
          created_at?: string
          difficulty?: string
          duration_seconds?: number | null
          finished_at?: string | null
          id?: string
          question_count?: number
          status?: string
          subject_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          completed_at: string | null
          created_at: string
          due_on: string
          id: string
          reason: string | null
          source: string
          status: string
          topic_id: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          due_on: string
          id?: string
          reason?: string | null
          source?: string
          status?: string
          topic_id: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          due_on?: string
          id?: string
          reason?: string | null
          source?: string
          status?: string
          topic_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      subject_schedules: {
        Row: {
          created_at: string
          end_time: string
          id: string
          room: string | null
          start_time: string
          subject_id: string
          user_id: string
          weekday: number
        }
        Insert: {
          created_at?: string
          end_time: string
          id?: string
          room?: string | null
          start_time: string
          subject_id: string
          user_id: string
          weekday: number
        }
        Update: {
          created_at?: string
          end_time?: string
          id?: string
          room?: string | null
          start_time?: string
          subject_id?: string
          user_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "subject_schedules_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          archived: boolean
          attendance_goal: number | null
          color: string
          created_at: string
          grade_goal: number | null
          id: string
          name: string
          room: string | null
          short_name: string | null
          teacher: string | null
          term: string | null
          updated_at: string
          user_id: string
          weekly_hours: number | null
        }
        Insert: {
          archived?: boolean
          attendance_goal?: number | null
          color?: string
          created_at?: string
          grade_goal?: number | null
          id?: string
          name: string
          room?: string | null
          short_name?: string | null
          teacher?: string | null
          term?: string | null
          updated_at?: string
          user_id: string
          weekly_hours?: number | null
        }
        Update: {
          archived?: boolean
          attendance_goal?: number | null
          color?: string
          created_at?: string
          grade_goal?: number | null
          id?: string
          name?: string
          room?: string | null
          short_name?: string | null
          teacher?: string | null
          term?: string | null
          updated_at?: string
          user_id?: string
          weekly_hours?: number | null
        }
        Relationships: []
      }
      subtasks: {
        Row: {
          created_at: string
          done: boolean
          id: string
          task_id: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          done?: boolean
          id?: string
          task_id: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          done?: boolean
          id?: string
          task_id?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subtasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string | null
          estimated_minutes: number | null
          id: string
          priority: string
          status: string
          subject_id: string | null
          title: string
          topic_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          estimated_minutes?: number | null
          id?: string
          priority?: string
          status?: string
          subject_id?: string | null
          title: string
          topic_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string | null
          estimated_minutes?: number | null
          id?: string
          priority?: string
          status?: string
          subject_id?: string | null
          title?: string
          topic_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      topics: {
        Row: {
          created_at: string
          id: string
          last_review: string | null
          mastery: number
          next_review: string | null
          notes: string | null
          position: number
          status: string
          subject_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_review?: string | null
          mastery?: number
          next_review?: string | null
          notes?: string | null
          position?: number
          status?: string
          subject_id: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_review?: string | null
          mastery?: number
          next_review?: string | null
          notes?: string | null
          position?: number
          status?: string
          subject_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
