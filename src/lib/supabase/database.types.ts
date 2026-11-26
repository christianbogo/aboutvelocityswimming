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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      account_followed_athletes: {
        Row: {
          athlete_id: string
          is_primary: boolean
          user_id: string
        }
        Insert: {
          athlete_id: string
          is_primary?: boolean
          user_id: string
        }
        Update: {
          athlete_id?: string
          is_primary?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_followed_athletes_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "public_athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      account_profiles: {
        Row: {
          avatar_path: string | null
          bio: string
          user_id: string
          username: string
        }
        Insert: {
          avatar_path?: string | null
          bio?: string
          user_id: string
          username?: string
        }
        Update: {
          avatar_path?: string | null
          bio?: string
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      administrators: {
        Row: {
          user_id: string
        }
        Insert: {
          user_id: string
        }
        Update: {
          user_id?: string
        }
        Relationships: []
      }
      athlete_bests: {
        Row: {
          athlete_id: string
          data: Json
          event_code: string
        }
        Insert: {
          athlete_id: string
          data: Json
          event_code: string
        }
        Update: {
          athlete_id?: string
          data?: Json
          event_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_bests_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      athletes: {
        Row: {
          data: Json
          group_id: string | null
          id: string
          person_id: string
          team_id: string | null
        }
        Insert: {
          data: Json
          group_id?: string | null
          id: string
          person_id: string
          team_id?: string | null
        }
        Update: {
          data?: Json
          group_id?: string | null
          id?: string
          person_id?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "athletes_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "training_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athletes_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athletes_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          athlete_id: string | null
          data: Json
          id: string
          session_id: string | null
        }
        Insert: {
          athlete_id?: string | null
          data: Json
          id: string
          session_id?: string | null
        }
        Update: {
          athlete_id?: string | null
          data?: Json
          id?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "practice_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_coverage: {
        Row: {
          category: string
          checked_at: string
          gaps: string[]
          id: string
          meet_count: number
          scope: string
          source_url: string
          status: string
          year: number
        }
        Insert: {
          category: string
          checked_at?: string
          gaps?: string[]
          id: string
          meet_count?: number
          scope: string
          source_url: string
          status?: string
          year: number
        }
        Update: {
          category?: string
          checked_at?: string
          gaps?: string[]
          id?: string
          meet_count?: number
          scope?: string
          source_url?: string
          status?: string
          year?: number
        }
        Relationships: []
      }
      documents: {
        Row: {
          athlete_id: string | null
          data: Json
          id: string
          meet_id: string | null
          person_id: string | null
          team_id: string | null
          venue_id: string | null
        }
        Insert: {
          athlete_id?: string | null
          data: Json
          id: string
          meet_id?: string | null
          person_id?: string | null
          team_id?: string | null
          venue_id?: string | null
        }
        Update: {
          athlete_id?: string | null
          data?: Json
          id?: string
          meet_id?: string | null
          person_id?: string | null
          team_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_meet_id_fkey"
            columns: ["meet_id"]
            isOneToOne: false
            referencedRelation: "meets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_records: {
        Row: {
          data: Json
          path: string
          root: string | null
        }
        Insert: {
          data: Json
          path: string
          root?: string | null
        }
        Update: {
          data?: Json
          path?: string
          root?: string | null
        }
        Relationships: []
      }
      families: {
        Row: {
          data: Json
          id: string
        }
        Insert: {
          data: Json
          id: string
        }
        Update: {
          data?: Json
          id?: string
        }
        Relationships: []
      }
      family_emails: {
        Row: {
          email: string
          family_id: string
        }
        Insert: {
          email: string
          family_id: string
        }
        Update: {
          email?: string
          family_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_emails_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      family_people: {
        Row: {
          family_id: string
          person_id: string
          relationship: string
        }
        Insert: {
          family_id: string
          person_id: string
          relationship: string
        }
        Update: {
          family_id?: string
          person_id?: string
          relationship?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_people_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_people_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_entries: {
        Row: {
          data: Json
          effective_from: string | null
          effective_until: string | null
          ends_on: string | null
          id: string
          kind: string
          parent_id: string | null
          source_url: string
          starts_on: string | null
          title: string
          updated_at: string
        }
        Insert: {
          data: Json
          effective_from?: string | null
          effective_until?: string | null
          ends_on?: string | null
          id: string
          kind?: string
          parent_id?: string | null
          source_url?: string
          starts_on?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          data?: Json
          effective_from?: string | null
          effective_until?: string | null
          ends_on?: string | null
          id?: string
          kind?: string
          parent_id?: string | null
          source_url?: string
          starts_on?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_entries_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "knowledge_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_hours: {
        Row: {
          data: Json
          family_id: string | null
          id: string
        }
        Insert: {
          data: Json
          family_id?: string | null
          id: string
        }
        Update: {
          data?: Json
          family_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_hours_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      meets: {
        Row: {
          data: Json
          host_team_id: string | null
          id: string
          team_id: string | null
          venue_id: string | null
        }
        Insert: {
          data: Json
          host_team_id?: string | null
          id: string
          team_id?: string | null
          venue_id?: string | null
        }
        Update: {
          data?: Json
          host_team_id?: string | null
          id?: string
          team_id?: string | null
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meets_host_team_id_fkey"
            columns: ["host_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meets_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meets_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          data: Json
          id: string
          name: string | null
          team_id: string | null
        }
        Insert: {
          data: Json
          id: string
          name?: string | null
          team_id?: string | null
        }
        Update: {
          data?: Json
          id?: string
          name?: string | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "people_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      postings: {
        Row: {
          data: Json
          id: string
          meet_id: string | null
        }
        Insert: {
          data: Json
          id: string
          meet_id?: string | null
        }
        Update: {
          data?: Json
          id?: string
          meet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "postings_meet_id_fkey"
            columns: ["meet_id"]
            isOneToOne: false
            referencedRelation: "meets"
            referencedColumns: ["id"]
          },
        ]
      }
      practice_sessions: {
        Row: {
          data: Json
          group_id: string | null
          group_name: string | null
          id: string
          practice_date: string | null
        }
        Insert: {
          data: Json
          group_id?: string | null
          group_name?: string | null
          id: string
          practice_date?: string | null
        }
        Update: {
          data?: Json
          group_id?: string | null
          group_name?: string | null
          id?: string
          practice_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "practice_sessions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "training_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      public_athletes: {
        Row: {
          data: Json
          id: string
        }
        Insert: {
          data: Json
          id: string
        }
        Update: {
          data?: Json
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_athletes_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      public_relay_results: {
        Row: {
          data: Json
          id: string
          swim_date: string | null
          team_id: string
          times_course: string | null
          times_event: string | null
          times_meet: string | null
          times_time: number | null
        }
        Insert: {
          data: Json
          id: string
          swim_date?: string | null
          team_id: string
          times_course?: string | null
          times_event?: string | null
          times_meet?: string | null
          times_time?: number | null
        }
        Update: {
          data?: Json
          id?: string
          swim_date?: string | null
          team_id?: string
          times_course?: string | null
          times_event?: string | null
          times_meet?: string | null
          times_time?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "public_relay_results_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "relay_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_relay_results_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      public_swims: {
        Row: {
          athlete_id: string
          data: Json
          id: string
          swim_date: string
          times_age: number | null
          times_course: string | null
          times_event: string | null
          times_gender: string | null
          times_leg: number | null
          times_meet: string | null
          times_meet_name: string
          times_official: boolean | null
          times_relay: boolean | null
          times_split: boolean | null
          times_status: string | null
          times_team: string | null
          times_time: number | null
        }
        Insert: {
          athlete_id: string
          data: Json
          id: string
          swim_date: string
          times_age?: number | null
          times_course?: string | null
          times_event?: string | null
          times_gender?: string | null
          times_leg?: number | null
          times_meet?: string | null
          times_meet_name?: string
          times_official?: boolean | null
          times_relay?: boolean | null
          times_split?: boolean | null
          times_status?: string | null
          times_team?: string | null
          times_time?: number | null
        }
        Update: {
          athlete_id?: string
          data?: Json
          id?: string
          swim_date?: string
          times_age?: number | null
          times_course?: string | null
          times_event?: string | null
          times_gender?: string | null
          times_leg?: number | null
          times_meet?: string | null
          times_meet_name?: string
          times_official?: boolean | null
          times_relay?: boolean | null
          times_split?: boolean | null
          times_status?: string | null
          times_team?: string | null
          times_time?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "public_swims_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "public_athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_swims_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "swims"
            referencedColumns: ["id"]
          },
        ]
      }
      public_times_teams: {
        Row: {
          club_code: string | null
          id: string
          lsc_code: string
          name: string
        }
        Insert: {
          club_code?: string | null
          id: string
          lsc_code: string
          name: string
        }
        Update: {
          club_code?: string | null
          id?: string
          lsc_code?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_times_teams_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      registrations: {
        Row: {
          assignee_key: string | null
          data: Json
          family_id: string | null
          id: string
          posting_id: string | null
        }
        Insert: {
          assignee_key?: string | null
          data: Json
          family_id?: string | null
          id: string
          posting_id?: string | null
        }
        Update: {
          assignee_key?: string | null
          data?: Json
          family_id?: string | null
          id?: string
          posting_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "registrations_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registrations_posting_id_fkey"
            columns: ["posting_id"]
            isOneToOne: false
            referencedRelation: "postings"
            referencedColumns: ["id"]
          },
        ]
      }
      relay_results: {
        Row: {
          course: string
          data: Json
          event_code: string
          id: string
          meet_id: string | null
          status: string | null
          team_id: string
          time_ms: number | null
        }
        Insert: {
          course?: string
          data: Json
          event_code?: string
          id: string
          meet_id?: string | null
          status?: string | null
          team_id?: string
          time_ms?: number | null
        }
        Update: {
          course?: string
          data?: Json
          event_code?: string
          id?: string
          meet_id?: string | null
          status?: string | null
          team_id?: string
          time_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "relay_results_meet_id_fkey"
            columns: ["meet_id"]
            isOneToOne: false
            referencedRelation: "meets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relay_results_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      result_moderation: {
        Row: {
          flagged: boolean
          result_id: string
          result_type: string
          version: number
        }
        Insert: {
          flagged: boolean
          result_id: string
          result_type: string
          version: number
        }
        Update: {
          flagged?: boolean
          result_id?: string
          result_type?: string
          version?: number
        }
        Relationships: []
      }
      standard_cuts: {
        Row: {
          age_group: string
          course: string
          event_code: string
          gender: string
          standard_id: string
          tier: string
          time_ms: number
        }
        Insert: {
          age_group: string
          course: string
          event_code: string
          gender: string
          standard_id: string
          tier: string
          time_ms: number
        }
        Update: {
          age_group?: string
          course?: string
          event_code?: string
          gender?: string
          standard_id?: string
          tier?: string
          time_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "standard_cuts_standard_id_fkey"
            columns: ["standard_id"]
            isOneToOne: false
            referencedRelation: "standards"
            referencedColumns: ["id"]
          },
        ]
      }
      standards: {
        Row: {
          data: Json
          id: string
        }
        Insert: {
          data: Json
          id: string
        }
        Update: {
          data?: Json
          id?: string
        }
        Relationships: []
      }
      swims: {
        Row: {
          athlete_id: string
          course: string
          data: Json
          event_code: string
          id: string
          is_official: boolean
          is_relay: boolean
          meet_id: string
          parent_relay_result_id: string | null
          round: string
          status: string
          time_ms: number | null
        }
        Insert: {
          athlete_id?: string
          course?: string
          data: Json
          event_code?: string
          id: string
          is_official?: boolean
          is_relay?: boolean
          meet_id?: string
          parent_relay_result_id?: string | null
          round?: string
          status?: string
          time_ms?: number | null
        }
        Update: {
          athlete_id?: string
          course?: string
          data?: Json
          event_code?: string
          id?: string
          is_official?: boolean
          is_relay?: boolean
          meet_id?: string
          parent_relay_result_id?: string | null
          round?: string
          status?: string
          time_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "swims_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swims_meet_id_fkey"
            columns: ["meet_id"]
            isOneToOne: false
            referencedRelation: "meets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "swims_parent_relay_result_id_fkey"
            columns: ["parent_relay_result_id"]
            isOneToOne: false
            referencedRelation: "relay_results"
            referencedColumns: ["id"]
          },
        ]
      }
      team_record_holders: {
        Row: {
          age: number | null
          age_group: string
          athlete_id: string
          course: string
          event: string
          gender: string
          relay: boolean
          relay_age: string
          result_id: string
          result_type: string
          swim_date: string
          team: string
          time_ms: number
        }
        Insert: {
          age?: number | null
          age_group: string
          athlete_id: string
          course: string
          event: string
          gender: string
          relay: boolean
          relay_age: string
          result_id: string
          result_type: string
          swim_date: string
          team: string
          time_ms: number
        }
        Update: {
          age?: number | null
          age_group?: string
          athlete_id?: string
          course?: string
          event?: string
          gender?: string
          relay?: boolean
          relay_age?: string
          result_id?: string
          result_type?: string
          swim_date?: string
          team?: string
          time_ms?: number
        }
        Relationships: []
      }
      team_record_refresh_state: {
        Row: {
          id: boolean
          refreshed_at: string | null
        }
        Insert: {
          id?: boolean
          refreshed_at?: string | null
        }
        Update: {
          id?: boolean
          refreshed_at?: string | null
        }
        Relationships: []
      }
      teams: {
        Row: {
          data: Json
          id: string
          name: string | null
        }
        Insert: {
          data: Json
          id: string
          name?: string | null
        }
        Update: {
          data?: Json
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      times_ranking_bookmarks: {
        Row: {
          created_at: string
          filters: Json
          id: string
          name: string
          search: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filters: Json
          id?: string
          name: string
          search?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          search?: string
          user_id?: string
        }
        Relationships: []
      }
      training_groups: {
        Row: {
          id: string
          name: string
        }
        Insert: {
          id: string
          name: string
        }
        Update: {
          id?: string
          name?: string
        }
        Relationships: []
      }
      venues: {
        Row: {
          data: Json
          id: string
          team_id: string | null
        }
        Insert: {
          data: Json
          id: string
          team_id?: string | null
        }
        Update: {
          data?: Json
          id?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "venues_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      work_descriptions: {
        Row: {
          data: Json
          id: string
        }
        Insert: {
          data: Json
          id: string
        }
        Update: {
          data?: Json
          id?: string
        }
        Relationships: []
      }
      workshare_account_emails: {
        Row: {
          account_id: string
          email: string
        }
        Insert: {
          account_id: string
          email: string
        }
        Update: {
          account_id?: string
          email?: string
        }
        Relationships: [
          {
            foreignKeyName: "workshare_account_emails_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "workshare_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      workshare_account_requirements: {
        Row: {
          account_id: string
          apple_capital_hours_required: number | null
          general_hours_required: number | null
          season_id: string
          starlight_hours_required: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          apple_capital_hours_required?: number | null
          general_hours_required?: number | null
          season_id: string
          starlight_hours_required?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          apple_capital_hours_required?: number | null
          general_hours_required?: number | null
          season_id?: string
          starlight_hours_required?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workshare_account_requirements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "workshare_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workshare_account_requirements_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "workshare_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      workshare_accounts: {
        Row: {
          apple_capital_hours_required: number | null
          current_season: string | null
          full_name: string
          general_hours_required: number | null
          id: string
          is_archived: boolean
          starlight_hours_required: number | null
          updated_at: string
        }
        Insert: {
          apple_capital_hours_required?: number | null
          current_season?: string | null
          full_name: string
          general_hours_required?: number | null
          id?: string
          is_archived?: boolean
          starlight_hours_required?: number | null
          updated_at?: string
        }
        Update: {
          apple_capital_hours_required?: number | null
          current_season?: string | null
          full_name?: string
          general_hours_required?: number | null
          id?: string
          is_archived?: boolean
          starlight_hours_required?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      workshare_athletes: {
        Row: {
          account_id: string
          full_name: string
          id: string
          is_archived: boolean
          times_athlete_id: string | null
          training_group: string
        }
        ComputedFields: never
        Insert: {
          account_id: string
          full_name: string
          id?: string
          is_archived?: boolean
          times_athlete_id?: string | null
          training_group?: string
        }
        Update: {
          account_id?: string
          full_name?: string
          id?: string
          is_archived?: boolean
          times_athlete_id?: string | null
          training_group?: string
        }
        Relationships: [
          {
            foreignKeyName: "workshare_athletes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "workshare_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workshare_athletes_group_fkey"
            columns: ["training_group"]
            isOneToOne: false
            referencedRelation: "workshare_groups"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "workshare_athletes_times_athlete_id_fkey"
            columns: ["times_athlete_id"]
            isOneToOne: false
            referencedRelation: "athletes"
            referencedColumns: ["id"]
          },
        ]
      }
      workshare_groups: {
        Row: {
          coach: string
          id: string
          name: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          coach?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          coach?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      workshare_members: {
        Row: {
          family_id: string
          group_name: string
          id: string
          name: string
          source_ids: Json
          updated_at: string
        }
        Insert: {
          family_id: string
          group_name?: string
          id: string
          name: string
          source_ids?: Json
          updated_at?: string
        }
        Update: {
          family_id?: string
          group_name?: string
          id?: string
          name?: string
          source_ids?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workshare_members_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      workshare_seasons: {
        Row: {
          copy_from_season_id: string | null
          created_at: string
          ends_on: string
          id: string
          name: string
          starts_on: string
        }
        Insert: {
          copy_from_season_id?: string | null
          created_at?: string
          ends_on: string
          id: string
          name: string
          starts_on: string
        }
        Update: {
          copy_from_season_id?: string | null
          created_at?: string
          ends_on?: string
          id?: string
          name?: string
          starts_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "workshare_seasons_copy_from_season_id_fkey"
            columns: ["copy_from_season_id"]
            isOneToOne: false
            referencedRelation: "workshare_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
      workshare_ticket_create_keys: {
        Row: {
          id: string
          payload_fingerprint: string
        }
        Insert: {
          id: string
          payload_fingerprint: string
        }
        Update: {
          id?: string
          payload_fingerprint?: string
        }
        Relationships: []
      }
      workshare_tickets: {
        Row: {
          account_id: string
          category: string
          completed_on: string
          created_at: string
          description: string
          hours: number
          id: string
          season_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          category: string
          completed_on: string
          created_at?: string
          description: string
          hours: number
          id: string
          season_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          category?: string
          completed_on?: string
          created_at?: string
          description?: string
          hours?: number
          id?: string
          season_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workshare_tickets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "workshare_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workshare_tickets_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "workshare_ticket_create_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workshare_tickets_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "workshare_seasons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      app_records: {
        Row: {
          data: Json | null
          path: string | null
        }
        Relationships: []
      }
      ies_times_races: {
        Row: {
          age: number | null
          athlete_id: string | null
          athlete_name: string | null
          course: string | null
          date: string | null
          event: string | null
          gender: string | null
          id: string | null
          meet: string | null
          meet_id: string | null
          official: boolean | null
          relay: boolean | null
          relay_age: string | null
          relay_leg: number | null
          relay_name: string | null
          round: string | null
          split: boolean | null
          status: string | null
          team: string | null
          team_name: string | null
          time: number | null
        }
        Relationships: []
      }
      unflagged_times_relays: {
        Row: {
          data: Json | null
          id: string | null
          swim_date: string | null
          team_id: string | null
          times_course: string | null
          times_event: string | null
          times_meet: string | null
          times_time: number | null
        }
        Insert: {
          data?: Json | null
          id?: string | null
          swim_date?: string | null
          team_id?: string | null
          times_course?: string | null
          times_event?: string | null
          times_meet?: string | null
          times_time?: number | null
        }
        Update: {
          data?: Json | null
          id?: string | null
          swim_date?: string | null
          team_id?: string | null
          times_course?: string | null
          times_event?: string | null
          times_meet?: string | null
          times_time?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "public_relay_results_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "relay_results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_relay_results_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      unflagged_times_swims: {
        Row: {
          athlete_id: string | null
          data: Json | null
          id: string | null
          swim_date: string | null
          times_age: number | null
          times_course: string | null
          times_event: string | null
          times_gender: string | null
          times_leg: number | null
          times_meet: string | null
          times_meet_name: string | null
          times_official: boolean | null
          times_relay: boolean | null
          times_split: boolean | null
          times_status: string | null
          times_team: string | null
          times_time: number | null
        }
        Relationships: [
          {
            foreignKeyName: "public_swims_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "public_athletes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "public_swims_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "swims"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      manage_workshare_athletes: { Args: { input: Json }; Returns: Json }
      claim_shift_reminders: { Args: { dry_run?: boolean }; Returns: Json }
      commit_records: {
        Args: { reads: Json; writes: Json }
        Returns: undefined
      }
      create_workshare_season: { Args: { input: Json }; Returns: Json }
      create_workshare_ticket: { Args: { input: Json }; Returns: Json }
      delete_workshare_ticket: {
        Args: { expected_version: string; ticket_id: string }
        Returns: Json
      }
      export_records: {
        Args: { after_path?: string }
        Returns: {
          data: Json
          path: string
        }[]
      }
      finish_shift_reminder: {
        Args: {
          delivery_id?: string
          failure?: string
          registration_id: string
          reminder_date: string
        }
        Returns: undefined
      }
      get_account_athletes: {
        Args: { account_user_id: string }
        Returns: {
          id: string
          is_primary: boolean
          name: string
          team_name: string
        }[]
      }
      has_account_password: { Args: never; Returns: boolean }
      ies_meet_event_rows: {
        Args: { meet_id: string }
        Returns: {
          age_group: string
          course: string
          event: string
          event_key: string
          event_number: number
          gender: string
          id: string
          relay: boolean
          round: string
          status: string
          team: string
          time: number
        }[]
      }
      ies_meet_navigation_query: {
        Args: { input: Json; query_kind: string }
        Returns: Json
      }
      ies_my_times: { Args: { input?: Json }; Returns: Json }
      ies_my_times_all_time: { Args: { input?: Json }; Returns: Json }
      ies_my_times_bests: { Args: { input?: Json }; Returns: Json }
      ies_team_records: { Args: { team_id: string }; Returns: Json }
      ies_team_records_board: { Args: { input?: Json }; Returns: Json }
      ies_times_age: {
        Args: { age: number; relay: boolean; relay_age: string }
        Returns: string
      }
      ies_times_age_matches: {
        Args: { age: number; groups: Json; relay: boolean; relay_age: string }
        Returns: boolean
      }
      ies_times_age_range: { Args: { age_group: string }; Returns: unknown }
      ies_times_candidates: {
        Args: { input: Json }
        Returns: {
          athlete_id: string
          course: string
          date: string
          event: string
          id: string
          relay: boolean
          search_name: string
          time: number
        }[]
      }
      ies_times_filtered: {
        Args: { input: Json }
        Returns: {
          age: number | null
          athlete_id: string | null
          athlete_name: string | null
          course: string | null
          date: string | null
          event: string | null
          gender: string | null
          id: string | null
          meet: string | null
          meet_id: string | null
          official: boolean | null
          relay: boolean | null
          relay_age: string | null
          relay_leg: number | null
          relay_name: string | null
          round: string | null
          split: boolean | null
          status: string | null
          team: string | null
          team_name: string | null
          time: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "ies_times_races"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      ies_times_json: {
        Args: { r: Database["public"]["Views"]["ies_times_races"]["Row"] }
        Returns: Json
      }
      ies_times_json_id: { Args: { race_id: string }; Returns: Json }
      ies_times_query: {
        Args: { input?: Json; query_kind: string }
        Returns: Json
      }
      ies_times_ranking_years: { Args: { input?: Json }; Returns: Json }
      ies_times_recent: { Args: { input?: Json }; Returns: Json }
      import_meet_results: { Args: { input: Json }; Returns: Json }
      import_workshare_accounts: { Args: { input: Json }; Returns: Json }
      is_staff: { Args: never; Returns: boolean }
      is_workshare_staff: { Args: never; Returns: boolean }
      list_result_moderation: {
        Args: {
          include_restored?: boolean
          page_from?: number
          page_size?: number
        }
        Returns: Json
      }
      list_workshare_account_summaries: {
        Args: { season_id: string }
        Returns: Json
      }
      list_workshare_accounts: { Args: never; Returns: Json }
      list_workshare_seasons: { Args: never; Returns: Json }
      list_workshare_tickets: { Args: { input: Json }; Returns: Json }
      manage_result_records: { Args: { input: Json }; Returns: Json }
      moderate_result: {
        Args: {
          action: string
          expected_version: number
          note: string
          reason: string
          result_id: string
          result_type: string
        }
        Returns: Json
      }
      projection_counts: { Args: never; Returns: Json }
      query_records: {
        Args: {
          after_id?: string
          collection_path: string
          filters?: Json
          page_size?: number
          record_id?: string
        }
        Returns: {
          data: Json
          path: string
        }[]
      }
      race_moderation: {
        Args: { r: Database["public"]["Views"]["ies_times_races"]["Row"] }
        Returns: Json
      }
      read_my_workshare_summary: { Args: { season_id?: string }; Returns: Json }
      read_result_moderation: {
        Args: { result_id: string; result_type: string }
        Returns: Json
      }
      result_is_excluded: {
        Args: { kind: string; parent_id?: string; rid: string }
        Returns: boolean
      }
      save_account_athletes: {
        Args: {
          account_user_id: string
          favorite_ids?: string[]
          primary_id?: string
        }
        Returns: {
          id: string
          is_primary: boolean
          name: string
          team_name: string
        }[]
      }
      save_workshare_account: { Args: { input: Json }; Returns: Json }
      save_workshare_requirements: {
        Args: { account_id: string; input: Json }
        Returns: Json
      }
      search_account_athletes: {
        Args: { search_text: string }
        Returns: {
          id: string
          name: string
          team_name: string
        }[]
      }
      times_page: {
        Args: {
          course_filter?: string
          event_filter?: string
          mode?: string
          page_from?: number
          page_size?: number
        }
        Returns: Json
      }
      update_workshare_ticket: {
        Args: { input: Json; ticket_id: string }
        Returns: Json
      }
      workshare_action: {
        Args: { input?: Json; operation: string }
        Returns: Json
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
