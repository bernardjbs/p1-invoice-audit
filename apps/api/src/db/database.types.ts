export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
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
  public: {
    Tables: {
      audit_runs: {
        Row: {
          engine: string
          finished_at: string | null
          id: string
          invoice_id: string
          overall: string | null
          started_at: string
          variance_pct: number | null
        }
        Insert: {
          engine: string
          finished_at?: string | null
          id?: string
          invoice_id: string
          overall?: string | null
          started_at?: string
          variance_pct?: number | null
        }
        Update: {
          engine?: string
          finished_at?: string | null
          id?: string
          invoice_id?: string
          overall?: string | null
          started_at?: string
          variance_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_runs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      check_results: {
        Row: {
          audit_run_id: string
          check_type: string | null
          evidence: Json | null
          id: string
          verdict: string | null
        }
        Insert: {
          audit_run_id: string
          check_type?: string | null
          evidence?: Json | null
          id?: string
          verdict?: string | null
        }
        Update: {
          audit_run_id?: string
          check_type?: string | null
          evidence?: Json | null
          id?: string
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "check_results_audit_run_id_fkey"
            columns: ["audit_run_id"]
            isOneToOne: false
            referencedRelation: "audit_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_rates: {
        Row: {
          contract_id: string
          description: string | null
          id: string
          item_code: string
          rate_aud: number
          unit: string | null
        }
        Insert: {
          contract_id: string
          description?: string | null
          id?: string
          item_code: string
          rate_aud: number
          unit?: string | null
        }
        Update: {
          contract_id?: string
          description?: string | null
          id?: string
          item_code?: string
          rate_aud?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_rates_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          ends_on: string | null
          id: string
          msa_ref: string | null
          starts_on: string | null
          title: string
          vendor_id: string
        }
        Insert: {
          ends_on?: string | null
          id?: string
          msa_ref?: string | null
          starts_on?: string | null
          title: string
          vendor_id: string
        }
        Update: {
          ends_on?: string | null
          id?: string
          msa_ref?: string | null
          starts_on?: string | null
          title?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          description: string | null
          id: string
          invoice_id: string
          item_code: string | null
          line_total_aud: number | null
          qty: number | null
          unit_price_aud: number | null
        }
        Insert: {
          description?: string | null
          id?: string
          invoice_id: string
          item_code?: string | null
          line_total_aud?: number | null
          qty?: number | null
          unit_price_aud?: number | null
        }
        Update: {
          description?: string | null
          id?: string
          invoice_id?: string
          item_code?: string | null
          line_total_aud?: number | null
          qty?: number | null
          unit_price_aud?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          contract_id: string | null
          due_date: string | null
          gst_aud: number | null
          id: string
          invoice_date: string | null
          invoice_number: string
          pdf_path: string | null
          po_id: string | null
          status: string
          subtotal_aud: number | null
          total_aud: number | null
          vendor_id: string
        }
        Insert: {
          contract_id?: string | null
          due_date?: string | null
          gst_aud?: number | null
          id?: string
          invoice_date?: string | null
          invoice_number: string
          pdf_path?: string | null
          po_id?: string | null
          status?: string
          subtotal_aud?: number | null
          total_aud?: number | null
          vendor_id: string
        }
        Update: {
          contract_id?: string | null
          due_date?: string | null
          gst_aud?: number | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string
          pdf_path?: string | null
          po_id?: string | null
          status?: string
          subtotal_aud?: number | null
          total_aud?: number | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      po_lines: {
        Row: {
          id: string
          item_code: string | null
          po_id: string
          qty: number | null
          unit_price_aud: number | null
        }
        Insert: {
          id?: string
          item_code?: string | null
          po_id: string
          qty?: number | null
          unit_price_aud?: number | null
        }
        Update: {
          id?: string
          item_code?: string | null
          po_id?: string
          qty?: number | null
          unit_price_aud?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "po_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          id: string
          po_number: string
          status: string | null
          total_aud: number | null
          vendor_id: string
        }
        Insert: {
          id?: string
          po_number: string
          status?: string | null
          total_aud?: number | null
          vendor_id: string
        }
        Update: {
          id?: string
          po_number?: string
          status?: string | null
          total_aud?: number | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      review_decisions: {
        Row: {
          audit_run_id: string | null
          decided_at: string
          decision: string | null
          id: string
          invoice_id: string
          note: string | null
        }
        Insert: {
          audit_run_id?: string | null
          decided_at?: string
          decision?: string | null
          id?: string
          invoice_id: string
          note?: string | null
        }
        Update: {
          audit_run_id?: string | null
          decided_at?: string
          decision?: string | null
          id?: string
          invoice_id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_decisions_audit_run_id_fkey"
            columns: ["audit_run_id"]
            isOneToOne: false
            referencedRelation: "audit_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_decisions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          abn: string | null
          id: string
          is_approved: boolean
          name: string
        }
        Insert: {
          abn?: string | null
          id?: string
          is_approved?: boolean
          name: string
        }
        Update: {
          abn?: string | null
          id?: string
          is_approved?: boolean
          name?: string
        }
        Relationships: []
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

