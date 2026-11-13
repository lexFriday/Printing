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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          new_values: Json | null
          old_values: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      cash_sales: {
        Row: {
          collection_date: string
          created_at: string
          created_by: string | null
          customer_name: string | null
          description: string
          gross_amount: number
          id: string
          invoice_reference: string | null
          or_number: string
          updated_at: string
          vat_amount: number
        }
        Insert: {
          collection_date?: string
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          description: string
          gross_amount: number
          id?: string
          invoice_reference?: string | null
          or_number: string
          updated_at?: string
          vat_amount?: number
        }
        Update: {
          collection_date?: string
          created_at?: string
          created_by?: string | null
          customer_name?: string | null
          description?: string
          gross_amount?: number
          id?: string
          invoice_reference?: string | null
          or_number?: string
          updated_at?: string
          vat_amount?: number
        }
        Relationships: []
      }
      check_voucher_revisions: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          job_expense_id: string
          new_values: Json
          previous_values: Json
          reason: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          job_expense_id: string
          new_values: Json
          previous_values: Json
          reason: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          job_expense_id?: string
          new_values?: Json
          previous_values?: Json
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "check_voucher_revisions_job_expense_id_fkey"
            columns: ["job_expense_id"]
            isOneToOne: false
            referencedRelation: "job_expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_contacts: {
        Row: {
          contact_name: string
          created_at: string
          created_by: string | null
          customer_id: string
          department: string | null
          email: string | null
          id: string
          is_active: boolean
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          contact_name: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          department?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          contact_name?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          department?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_operational_summaries"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          contact_number: string | null
          contact_person: string
          created_at: string
          customer_code: string
          customer_name: string
          email: string | null
          id: string
          notes: string | null
          tin_number: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_number?: string | null
          contact_person: string
          created_at?: string
          customer_code?: string
          customer_name: string
          email?: string | null
          id?: string
          notes?: string | null
          tin_number?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_number?: string | null
          contact_person?: string
          created_at?: string
          customer_code?: string
          customer_name?: string
          email?: string | null
          id?: string
          notes?: string | null
          tin_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      invoice_line_items: {
        Row: {
          computed_sqft: number | null
          created_at: string
          description: string
          height: number | null
          id: string
          invoice_id: string
          job_order_line_item_id: string | null
          line_total: number
          pricing_mode: Database["public"]["Enums"]["pricing_mode"]
          quantity: number
          rate_per_sqft: number | null
          sort_order: number | null
          unit_of_measure: Database["public"]["Enums"]["unit_of_measure"] | null
          unit_price: number
          width: number | null
        }
        Insert: {
          computed_sqft?: number | null
          created_at?: string
          description: string
          height?: number | null
          id?: string
          invoice_id: string
          job_order_line_item_id?: string | null
          line_total: number
          pricing_mode: Database["public"]["Enums"]["pricing_mode"]
          quantity: number
          rate_per_sqft?: number | null
          sort_order?: number | null
          unit_of_measure?:
            | Database["public"]["Enums"]["unit_of_measure"]
            | null
          unit_price: number
          width?: number | null
        }
        Update: {
          computed_sqft?: number | null
          created_at?: string
          description?: string
          height?: number | null
          id?: string
          invoice_id?: string
          job_order_line_item_id?: string | null
          line_total?: number
          pricing_mode?: Database["public"]["Enums"]["pricing_mode"]
          quantity?: number
          rate_per_sqft?: number | null
          sort_order?: number | null
          unit_of_measure?:
            | Database["public"]["Enums"]["unit_of_measure"]
            | null
          unit_price?: number
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_line_items_job_order_line_item_id_fkey"
            columns: ["job_order_line_item_id"]
            isOneToOne: false
            referencedRelation: "job_order_line_items"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          payment_date: string
          proof_file_name: string | null
          proof_file_size: number | null
          proof_file_type: string | null
          proof_storage_path: string | null
          remarks: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          payment_date: string
          proof_file_name?: string | null
          proof_file_size?: number | null
          proof_file_type?: string | null
          proof_storage_path?: string | null
          remarks?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          payment_date?: string
          proof_file_name?: string | null
          proof_file_size?: number | null
          proof_file_type?: string | null
          proof_storage_path?: string | null
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_due_snapshot: number
          contact_department_snapshot: string | null
          contact_email_snapshot: string | null
          contact_name_snapshot: string | null
          contact_phone_snapshot: string | null
          created_at: string
          customer_contact_id: string | null
          customer_id: string
          due_date: string | null
          ewt_amount_snapshot: number
          ewt_enabled: boolean
          ewt_rate: number
          ewt_treatment_snapshot: string
          gross_total_snapshot: number
          id: string
          invoice_amount: number
          invoice_date: string
          invoice_number: string
          job_order_id: string | null
          official_receipt_number: string | null
          paid_at: string | null
          payment_date: string | null
          payment_remarks: string | null
          quotation_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          tax_type: Database["public"]["Enums"]["tax_type"]
          updated_at: string
          vat_amount_snapshot: number
          vat_rate_snapshot: number
          vatable_sales_snapshot: number
        }
        Insert: {
          amount_due_snapshot?: number
          contact_department_snapshot?: string | null
          contact_email_snapshot?: string | null
          contact_name_snapshot?: string | null
          contact_phone_snapshot?: string | null
          created_at?: string
          customer_contact_id?: string | null
          customer_id: string
          due_date?: string | null
          ewt_amount_snapshot?: number
          ewt_enabled?: boolean
          ewt_rate?: number
          ewt_treatment_snapshot?: string
          gross_total_snapshot?: number
          id?: string
          invoice_amount: number
          invoice_date?: string
          invoice_number?: string
          job_order_id?: string | null
          official_receipt_number?: string | null
          paid_at?: string | null
          payment_date?: string | null
          payment_remarks?: string | null
          quotation_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          tax_type?: Database["public"]["Enums"]["tax_type"]
          updated_at?: string
          vat_amount_snapshot?: number
          vat_rate_snapshot?: number
          vatable_sales_snapshot?: number
        }
        Update: {
          amount_due_snapshot?: number
          contact_department_snapshot?: string | null
          contact_email_snapshot?: string | null
          contact_name_snapshot?: string | null
          contact_phone_snapshot?: string | null
          created_at?: string
          customer_contact_id?: string | null
          customer_id?: string
          due_date?: string | null
          ewt_amount_snapshot?: number
          ewt_enabled?: boolean
          ewt_rate?: number
          ewt_treatment_snapshot?: string
          gross_total_snapshot?: number
          id?: string
          invoice_amount?: number
          invoice_date?: string
          invoice_number?: string
          job_order_id?: string | null
          official_receipt_number?: string | null
          paid_at?: string | null
          payment_date?: string | null
          payment_remarks?: string | null
          quotation_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          tax_type?: Database["public"]["Enums"]["tax_type"]
          updated_at?: string
          vat_amount_snapshot?: number
          vat_rate_snapshot?: number
          vatable_sales_snapshot?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_contact_id_fkey"
            columns: ["customer_contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_operational_summaries"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "customer_active_job_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      item_template_materials: {
        Row: {
          active: boolean
          basis: Database["public"]["Enums"]["material_component_basis"]
          created_at: string
          id: string
          item_template_id: string
          material_id: string
          quantity: number
          save_idempotency_key: string | null
          version: number
        }
        Insert: {
          active?: boolean
          basis?: Database["public"]["Enums"]["material_component_basis"]
          created_at?: string
          id?: string
          item_template_id: string
          material_id: string
          quantity: number
          save_idempotency_key?: string | null
          version?: number
        }
        Update: {
          active?: boolean
          basis?: Database["public"]["Enums"]["material_component_basis"]
          created_at?: string
          id?: string
          item_template_id?: string
          material_id?: string
          quantity?: number
          save_idempotency_key?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "item_template_materials_item_template_id_fkey"
            columns: ["item_template_id"]
            isOneToOne: false
            referencedRelation: "item_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_template_materials_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
        ]
      }
      item_templates: {
        Row: {
          created_at: string
          default_height: number | null
          default_rate_per_sqft: number | null
          default_unit: Database["public"]["Enums"]["unit_of_measure"] | null
          default_unit_price: number | null
          default_width: number | null
          description: string
          id: string
          is_active: boolean
          name: string
          pricing_mode: Database["public"]["Enums"]["pricing_mode"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_height?: number | null
          default_rate_per_sqft?: number | null
          default_unit?: Database["public"]["Enums"]["unit_of_measure"] | null
          default_unit_price?: number | null
          default_width?: number | null
          description: string
          id?: string
          is_active?: boolean
          name: string
          pricing_mode: Database["public"]["Enums"]["pricing_mode"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_height?: number | null
          default_rate_per_sqft?: number | null
          default_unit?: Database["public"]["Enums"]["unit_of_measure"] | null
          default_unit_price?: number | null
          default_width?: number | null
          description?: string
          id?: string
          is_active?: boolean
          name?: string
          pricing_mode?: Database["public"]["Enums"]["pricing_mode"]
          updated_at?: string
        }
        Relationships: []
      }
      job_expense_allocations: {
        Row: {
          allocated_amount: number
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          job_expense_id: string
          job_order_id: string
          updated_at: string
        }
        Insert: {
          allocated_amount: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          job_expense_id: string
          job_order_id: string
          updated_at?: string
        }
        Update: {
          allocated_amount?: number
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          job_expense_id?: string
          job_order_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_expense_allocations_job_expense_id_fkey"
            columns: ["job_expense_id"]
            isOneToOne: false
            referencedRelation: "job_expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_expense_allocations_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "customer_active_job_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_expense_allocations_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      job_expenses: {
        Row: {
          amount: number
          check_date: string | null
          check_number: string | null
          created_at: string
          created_by: string | null
          description: string
          disbursement_category:
            | Database["public"]["Enums"]["disbursement_category"]
            | null
          disbursement_subcategory:
            | Database["public"]["Enums"]["disbursement_subcategory"]
            | null
          due_date: string | null
          expense_date: string
          expense_type: Database["public"]["Enums"]["expense_type"]
          general_expense_number: string
          id: string
          job_order_id: string | null
          paid_at: string | null
          payment_method:
            | Database["public"]["Enums"]["disbursement_payment_method"]
            | null
          payment_proof_file_name: string | null
          payment_proof_file_size: number | null
          payment_proof_file_type: string | null
          payment_proof_storage_path: string | null
          payment_released_at: string | null
          payment_source: string | null
          payment_source_reference: string | null
          payment_state: Database["public"]["Enums"]["disbursement_payment_state"]
          payment_status: Database["public"]["Enums"]["expense_payment_status"]
          petty_cash_batch_id: string | null
          prepared_by_name_snapshot: string | null
          prepared_by_signature_url_snapshot: string | null
          project_cost_confirmed_at: string | null
          project_cost_confirmed_by: string | null
          quantity: number | null
          receipt_missing_reason: string | null
          reference_no: string | null
          remarks: string | null
          supplier_address: string | null
          supplier_document_no: string | null
          supplier_id: string | null
          supplier_name: string | null
          supplier_tin: string | null
          tax_amount: number
          tax_type: Database["public"]["Enums"]["tax_type"]
          unit_cost: number | null
          unit_of_measure: string | null
          updated_at: string
          voucher_print_count: number
          voucher_printed_at: string | null
        }
        Insert: {
          amount: number
          check_date?: string | null
          check_number?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          disbursement_category?:
            | Database["public"]["Enums"]["disbursement_category"]
            | null
          disbursement_subcategory?:
            | Database["public"]["Enums"]["disbursement_subcategory"]
            | null
          due_date?: string | null
          expense_date?: string
          expense_type: Database["public"]["Enums"]["expense_type"]
          general_expense_number?: string
          id?: string
          job_order_id?: string | null
          paid_at?: string | null
          payment_method?:
            | Database["public"]["Enums"]["disbursement_payment_method"]
            | null
          payment_proof_file_name?: string | null
          payment_proof_file_size?: number | null
          payment_proof_file_type?: string | null
          payment_proof_storage_path?: string | null
          payment_released_at?: string | null
          payment_source?: string | null
          payment_source_reference?: string | null
          payment_state?: Database["public"]["Enums"]["disbursement_payment_state"]
          payment_status?: Database["public"]["Enums"]["expense_payment_status"]
          petty_cash_batch_id?: string | null
          prepared_by_name_snapshot?: string | null
          prepared_by_signature_url_snapshot?: string | null
          project_cost_confirmed_at?: string | null
          project_cost_confirmed_by?: string | null
          quantity?: number | null
          receipt_missing_reason?: string | null
          reference_no?: string | null
          remarks?: string | null
          supplier_address?: string | null
          supplier_document_no?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          supplier_tin?: string | null
          tax_amount?: number
          tax_type?: Database["public"]["Enums"]["tax_type"]
          unit_cost?: number | null
          unit_of_measure?: string | null
          updated_at?: string
          voucher_print_count?: number
          voucher_printed_at?: string | null
        }
        Update: {
          amount?: number
          check_date?: string | null
          check_number?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          disbursement_category?:
            | Database["public"]["Enums"]["disbursement_category"]
            | null
          disbursement_subcategory?:
            | Database["public"]["Enums"]["disbursement_subcategory"]
            | null
          due_date?: string | null
          expense_date?: string
          expense_type?: Database["public"]["Enums"]["expense_type"]
          general_expense_number?: string
          id?: string
          job_order_id?: string | null
          paid_at?: string | null
          payment_method?:
            | Database["public"]["Enums"]["disbursement_payment_method"]
            | null
          payment_proof_file_name?: string | null
          payment_proof_file_size?: number | null
          payment_proof_file_type?: string | null
          payment_proof_storage_path?: string | null
          payment_released_at?: string | null
          payment_source?: string | null
          payment_source_reference?: string | null
          payment_state?: Database["public"]["Enums"]["disbursement_payment_state"]
          payment_status?: Database["public"]["Enums"]["expense_payment_status"]
          petty_cash_batch_id?: string | null
          prepared_by_name_snapshot?: string | null
          prepared_by_signature_url_snapshot?: string | null
          project_cost_confirmed_at?: string | null
          project_cost_confirmed_by?: string | null
          quantity?: number | null
          receipt_missing_reason?: string | null
          reference_no?: string | null
          remarks?: string | null
          supplier_address?: string | null
          supplier_document_no?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          supplier_tin?: string | null
          tax_amount?: number
          tax_type?: Database["public"]["Enums"]["tax_type"]
          unit_cost?: number | null
          unit_of_measure?: string | null
          updated_at?: string
          voucher_print_count?: number
          voucher_printed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_expenses_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "customer_active_job_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_expenses_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_expenses_petty_cash_batch_id_fkey"
            columns: ["petty_cash_batch_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_expenses_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      job_order_line_items: {
        Row: {
          computed_sqft: number | null
          created_at: string
          description: string
          height: number | null
          id: string
          job_order_id: string
          line_total: number
          pricing_mode: Database["public"]["Enums"]["pricing_mode"]
          quantity: number
          quote_line_item_id: string | null
          rate_per_sqft: number | null
          sort_order: number | null
          unit_of_measure: Database["public"]["Enums"]["unit_of_measure"] | null
          unit_price: number
          width: number | null
        }
        Insert: {
          computed_sqft?: number | null
          created_at?: string
          description: string
          height?: number | null
          id?: string
          job_order_id: string
          line_total: number
          pricing_mode: Database["public"]["Enums"]["pricing_mode"]
          quantity: number
          quote_line_item_id?: string | null
          rate_per_sqft?: number | null
          sort_order?: number | null
          unit_of_measure?:
            | Database["public"]["Enums"]["unit_of_measure"]
            | null
          unit_price: number
          width?: number | null
        }
        Update: {
          computed_sqft?: number | null
          created_at?: string
          description?: string
          height?: number | null
          id?: string
          job_order_id?: string
          line_total?: number
          pricing_mode?: Database["public"]["Enums"]["pricing_mode"]
          quantity?: number
          quote_line_item_id?: string | null
          rate_per_sqft?: number | null
          sort_order?: number | null
          unit_of_measure?:
            | Database["public"]["Enums"]["unit_of_measure"]
            | null
          unit_price?: number
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "job_order_line_items_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "customer_active_job_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_order_line_items_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_order_line_items_quote_line_item_id_fkey"
            columns: ["quote_line_item_id"]
            isOneToOne: false
            referencedRelation: "quote_line_items"
            referencedColumns: ["id"]
          },
        ]
      }
      job_orders: {
        Row: {
          approved_by_name: string | null
          approved_by_signature_url_snapshot: string | null
          approved_by_user_id: string | null
          client_po_number: string | null
          completed_at: string | null
          contact_department_snapshot: string | null
          contact_email_snapshot: string | null
          contact_name_snapshot: string | null
          contact_phone_snapshot: string | null
          created_at: string
          customer_contact_id: string | null
          customer_id: string
          delivered_at: string | null
          dr_number: string | null
          id: string
          installation_date: string | null
          internal_notes: string | null
          job_number: string
          prepared_by_name_snapshot: string | null
          prepared_by_signature_url_snapshot: string | null
          prepared_by_user_id: string | null
          production_started_at: string | null
          project_manager: string | null
          project_name: string
          quotation_id: string
          quoted_amount: number
          ready_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          target_completion_date: string | null
          tax_type: Database["public"]["Enums"]["tax_type"]
          updated_at: string
        }
        Insert: {
          approved_by_name?: string | null
          approved_by_signature_url_snapshot?: string | null
          approved_by_user_id?: string | null
          client_po_number?: string | null
          completed_at?: string | null
          contact_department_snapshot?: string | null
          contact_email_snapshot?: string | null
          contact_name_snapshot?: string | null
          contact_phone_snapshot?: string | null
          created_at?: string
          customer_contact_id?: string | null
          customer_id: string
          delivered_at?: string | null
          dr_number?: string | null
          id?: string
          installation_date?: string | null
          internal_notes?: string | null
          job_number?: string
          prepared_by_name_snapshot?: string | null
          prepared_by_signature_url_snapshot?: string | null
          prepared_by_user_id?: string | null
          production_started_at?: string | null
          project_manager?: string | null
          project_name: string
          quotation_id: string
          quoted_amount: number
          ready_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          target_completion_date?: string | null
          tax_type?: Database["public"]["Enums"]["tax_type"]
          updated_at?: string
        }
        Update: {
          approved_by_name?: string | null
          approved_by_signature_url_snapshot?: string | null
          approved_by_user_id?: string | null
          client_po_number?: string | null
          completed_at?: string | null
          contact_department_snapshot?: string | null
          contact_email_snapshot?: string | null
          contact_name_snapshot?: string | null
          contact_phone_snapshot?: string | null
          created_at?: string
          customer_contact_id?: string | null
          customer_id?: string
          delivered_at?: string | null
          dr_number?: string | null
          id?: string
          installation_date?: string | null
          internal_notes?: string | null
          job_number?: string
          prepared_by_name_snapshot?: string | null
          prepared_by_signature_url_snapshot?: string | null
          prepared_by_user_id?: string | null
          production_started_at?: string | null
          project_manager?: string | null
          project_name?: string
          quotation_id?: string
          quoted_amount?: number
          ready_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          target_completion_date?: string | null
          tax_type?: Database["public"]["Enums"]["tax_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_orders_customer_contact_id_fkey"
            columns: ["customer_contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_operational_summaries"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "job_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_prepared_by_user_id_fkey"
            columns: ["prepared_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_accounting_entries: {
        Row: {
          address: string | null
          counterparty_name: string
          created_at: string
          created_by: string | null
          description: string | null
          document_no: string | null
          entry_date: string | null
          entry_type: string
          ewt_amount: number
          expense_type: Database["public"]["Enums"]["expense_type"] | null
          gross_amount: number
          id: string
          import_batch: string
          notes: string | null
          reference_no: string | null
          source_row: number
          source_sheet: string
          source_workbook: string
          tin: string | null
          vat_amount: number
        }
        Insert: {
          address?: string | null
          counterparty_name: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          document_no?: string | null
          entry_date?: string | null
          entry_type: string
          ewt_amount?: number
          expense_type?: Database["public"]["Enums"]["expense_type"] | null
          gross_amount: number
          id?: string
          import_batch: string
          notes?: string | null
          reference_no?: string | null
          source_row: number
          source_sheet: string
          source_workbook: string
          tin?: string | null
          vat_amount?: number
        }
        Update: {
          address?: string | null
          counterparty_name?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          document_no?: string | null
          entry_date?: string | null
          entry_type?: string
          ewt_amount?: number
          expense_type?: Database["public"]["Enums"]["expense_type"] | null
          gross_amount?: number
          id?: string
          import_batch?: string
          notes?: string | null
          reference_no?: string | null
          source_row?: number
          source_sheet?: string
          source_workbook?: string
          tin?: string | null
          vat_amount?: number
        }
        Relationships: []
      }
      legacy_profit_loss_lines: {
        Row: {
          amount: number
          category: string
          created_at: string
          detail: string | null
          id: string
          import_batch: string
          period_start: string
          source_row: number
          source_sheet: string
          source_workbook: string
        }
        Insert: {
          amount?: number
          category: string
          created_at?: string
          detail?: string | null
          id?: string
          import_batch: string
          period_start: string
          source_row: number
          source_sheet: string
          source_workbook: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          detail?: string | null
          id?: string
          import_batch?: string
          period_start?: string
          source_row?: number
          source_sheet?: string
          source_workbook?: string
        }
        Relationships: []
      }
      legacy_profit_loss_monthly: {
        Row: {
          created_at: string
          direct_materials: number
          gross_revenue: number
          id: string
          import_batch: string
          net_profit: number
          operating_expenses: number
          period_start: string
          service_revenue: number
          source_sheet: string
          source_workbook: string
        }
        Insert: {
          created_at?: string
          direct_materials?: number
          gross_revenue: number
          id?: string
          import_batch: string
          net_profit: number
          operating_expenses?: number
          period_start: string
          service_revenue?: number
          source_sheet: string
          source_workbook: string
        }
        Update: {
          created_at?: string
          direct_materials?: number
          gross_revenue?: number
          id?: string
          import_batch?: string
          net_profit?: number
          operating_expenses?: number
          period_start?: string
          service_revenue?: number
          source_sheet?: string
          source_workbook?: string
        }
        Relationships: []
      }
      materials: {
        Row: {
          category: string
          created_at: string
          id: string
          inventory_unit: string | null
          is_active: boolean
          name: string
          pack_size: number | null
          roll_length_ft: number | null
          roll_width_ft: number | null
          unit: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          inventory_unit?: string | null
          is_active?: boolean
          name: string
          pack_size?: number | null
          roll_length_ft?: number | null
          roll_width_ft?: number | null
          unit: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          inventory_unit?: string | null
          is_active?: boolean
          name?: string
          pack_size?: number | null
          roll_length_ft?: number | null
          roll_width_ft?: number | null
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      petty_cash_batch_attachments: {
        Row: {
          created_at: string
          created_by: string | null
          file_name: string
          file_size: number
          file_type: string
          id: string
          petty_cash_batch_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          file_name: string
          file_size: number
          file_type: string
          id?: string
          petty_cash_batch_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          file_name?: string
          file_size?: number
          file_type?: string
          id?: string
          petty_cash_batch_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_batch_attachments_petty_cash_batch_id_fkey"
            columns: ["petty_cash_batch_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_batches: {
        Row: {
          cash_received: number
          cash_returned_amount: number | null
          cash_returned_reference: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          custodian_name: string
          cv_created_at: string | null
          cv_reference_no: string | null
          funding_date: string
          funding_reference: string
          funding_source: string
          id: string
          job_order_id: string | null
          petty_cash_number: string
          status: string
          updated_at: string
        }
        Insert: {
          cash_received: number
          cash_returned_amount?: number | null
          cash_returned_reference?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          custodian_name: string
          cv_created_at?: string | null
          cv_reference_no?: string | null
          funding_date?: string
          funding_reference: string
          funding_source: string
          id?: string
          job_order_id?: string | null
          petty_cash_number?: string
          status?: string
          updated_at?: string
        }
        Update: {
          cash_received?: number
          cash_returned_amount?: number | null
          cash_returned_reference?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          custodian_name?: string
          cv_created_at?: string | null
          cv_reference_no?: string | null
          funding_date?: string
          funding_reference?: string
          funding_source?: string
          id?: string
          job_order_id?: string | null
          petty_cash_number?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_batches_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "customer_active_job_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "petty_cash_batches_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: false
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      petty_cash_funding_events: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          funding_date: string
          funding_reference: string
          funding_source: string
          id: string
          petty_cash_batch_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          funding_date?: string
          funding_reference: string
          funding_source: string
          id?: string
          petty_cash_batch_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          funding_date?: string
          funding_reference?: string
          funding_source?: string
          id?: string
          petty_cash_batch_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_funding_events_petty_cash_batch_id_fkey"
            columns: ["petty_cash_batch_id"]
            isOneToOne: false
            referencedRelation: "petty_cash_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      print_calibrations: {
        Row: {
          created_at: string
          document_type: string
          field_offsets: Json
          id: string
          page_offset_x_mm: number
          page_offset_y_mm: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_type: string
          field_offsets?: Json
          id?: string
          page_offset_x_mm?: number
          page_offset_y_mm?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          document_type?: string
          field_offsets?: Json
          id?: string
          page_offset_x_mm?: number
          page_offset_y_mm?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      production_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          job_order_id: string
          job_type: string
          notes: string | null
          remarks: string | null
          responsible_user_id: string | null
          sla_due_at: string | null
          sla_set_at: string | null
          sla_set_by: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["production_status"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          job_order_id: string
          job_type?: string
          notes?: string | null
          remarks?: string | null
          responsible_user_id?: string | null
          sla_due_at?: string | null
          sla_set_at?: string | null
          sla_set_by?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["production_status"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          job_order_id?: string
          job_type?: string
          notes?: string | null
          remarks?: string | null
          responsible_user_id?: string | null
          sla_due_at?: string | null
          sla_set_at?: string | null
          sla_set_by?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["production_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_jobs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: true
            referencedRelation: "customer_active_job_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_jobs_job_order_id_fkey"
            columns: ["job_order_id"]
            isOneToOne: true
            referencedRelation: "job_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_jobs_sla_set_by_fkey"
            columns: ["sla_set_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          signature_url: string | null
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          signature_url?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          signature_url?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: []
      }
      quotations: {
        Row: {
          adjustment_amount: number
          adjustment_label: string
          approved_at: string | null
          contact_department_snapshot: string | null
          contact_email_snapshot: string | null
          contact_name_snapshot: string | null
          contact_phone_snapshot: string | null
          created_at: string
          created_by: string | null
          customer_contact_id: string | null
          customer_decided_at: string | null
          customer_id: string
          id: string
          is_no_charge: boolean
          manager_approved_at: string | null
          manager_approved_by_user_id: string | null
          no_charge_reason: string | null
          project_name: string
          quote_date: string
          quote_number: string
          rejected_at: string | null
          remarks: string | null
          sales_agent: string | null
          sales_agent_signature_url_snapshot: string | null
          sales_agent_user_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["quote_status"]
          submitted_for_manager_at: string | null
          subtotal: number
          tax_type: Database["public"]["Enums"]["tax_type"]
          terms: string | null
          total_amount: number
          updated_at: string
        }
        Insert: {
          adjustment_amount?: number
          adjustment_label?: string
          approved_at?: string | null
          contact_department_snapshot?: string | null
          contact_email_snapshot?: string | null
          contact_name_snapshot?: string | null
          contact_phone_snapshot?: string | null
          created_at?: string
          created_by?: string | null
          customer_contact_id?: string | null
          customer_decided_at?: string | null
          customer_id: string
          id?: string
          is_no_charge?: boolean
          manager_approved_at?: string | null
          manager_approved_by_user_id?: string | null
          no_charge_reason?: string | null
          project_name: string
          quote_date?: string
          quote_number?: string
          rejected_at?: string | null
          remarks?: string | null
          sales_agent?: string | null
          sales_agent_signature_url_snapshot?: string | null
          sales_agent_user_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          submitted_for_manager_at?: string | null
          subtotal?: number
          tax_type?: Database["public"]["Enums"]["tax_type"]
          terms?: string | null
          total_amount?: number
          updated_at?: string
        }
        Update: {
          adjustment_amount?: number
          adjustment_label?: string
          approved_at?: string | null
          contact_department_snapshot?: string | null
          contact_email_snapshot?: string | null
          contact_name_snapshot?: string | null
          contact_phone_snapshot?: string | null
          created_at?: string
          created_by?: string | null
          customer_contact_id?: string | null
          customer_decided_at?: string | null
          customer_id?: string
          id?: string
          is_no_charge?: boolean
          manager_approved_at?: string | null
          manager_approved_by_user_id?: string | null
          no_charge_reason?: string | null
          project_name?: string
          quote_date?: string
          quote_number?: string
          rejected_at?: string | null
          remarks?: string | null
          sales_agent?: string | null
          sales_agent_signature_url_snapshot?: string | null
          sales_agent_user_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          submitted_for_manager_at?: string | null
          subtotal?: number
          tax_type?: Database["public"]["Enums"]["tax_type"]
          terms?: string | null
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotations_customer_contact_id_fkey"
            columns: ["customer_contact_id"]
            isOneToOne: false
            referencedRelation: "customer_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_operational_summaries"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "quotations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_manager_approved_by_user_id_fkey"
            columns: ["manager_approved_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_attachments: {
        Row: {
          created_at: string
          deleted_at: string | null
          file_name: string
          file_size: number
          file_type: string
          id: string
          quotation_id: string
          quote_line_item_id: string | null
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          file_name: string
          file_size: number
          file_type: string
          id?: string
          quotation_id: string
          quote_line_item_id?: string | null
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          file_name?: string
          file_size?: number
          file_type?: string
          id?: string
          quotation_id?: string
          quote_line_item_id?: string | null
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_attachments_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_attachments_quote_line_item_id_fkey"
            columns: ["quote_line_item_id"]
            isOneToOne: false
            referencedRelation: "quote_line_items"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_line_items: {
        Row: {
          adjustment_amount: number
          adjustment_label: string
          computed_sqft: number | null
          created_at: string
          description: string
          height: number | null
          id: string
          is_no_charge: boolean
          item_template_id: string | null
          item_template_version: number | null
          line_total: number
          no_charge: boolean
          pricing_mode: Database["public"]["Enums"]["pricing_mode"]
          quantity: number
          quotation_id: string
          rate_per_sqft: number | null
          sort_order: number | null
          unit_of_measure: Database["public"]["Enums"]["unit_of_measure"] | null
          unit_price: number
          updated_at: string
          width: number | null
        }
        Insert: {
          adjustment_amount?: number
          adjustment_label?: string
          computed_sqft?: number | null
          created_at?: string
          description: string
          height?: number | null
          id?: string
          is_no_charge?: boolean
          item_template_id?: string | null
          item_template_version?: number | null
          line_total?: number
          no_charge?: boolean
          pricing_mode: Database["public"]["Enums"]["pricing_mode"]
          quantity?: number
          quotation_id: string
          rate_per_sqft?: number | null
          sort_order?: number | null
          unit_of_measure?:
            | Database["public"]["Enums"]["unit_of_measure"]
            | null
          unit_price?: number
          updated_at?: string
          width?: number | null
        }
        Update: {
          adjustment_amount?: number
          adjustment_label?: string
          computed_sqft?: number | null
          created_at?: string
          description?: string
          height?: number | null
          id?: string
          is_no_charge?: boolean
          item_template_id?: string | null
          item_template_version?: number | null
          line_total?: number
          no_charge?: boolean
          pricing_mode?: Database["public"]["Enums"]["pricing_mode"]
          quantity?: number
          quotation_id?: string
          rate_per_sqft?: number | null
          sort_order?: number | null
          unit_of_measure?:
            | Database["public"]["Enums"]["unit_of_measure"]
            | null
          unit_price?: number
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_line_items_item_template_id_fkey"
            columns: ["item_template_id"]
            isOneToOne: false
            referencedRelation: "item_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_line_items_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_material_estimates: {
        Row: {
          basis: Database["public"]["Enums"]["material_component_basis"]
          component_quantity: number
          created_at: string
          estimated_quantity: number
          id: string
          item_template_id: string | null
          item_template_version: number
          material_id: string
          material_name: string
          quotation_id: string
          quote_line_item_id: string
          unit: string
        }
        Insert: {
          basis: Database["public"]["Enums"]["material_component_basis"]
          component_quantity: number
          created_at?: string
          estimated_quantity: number
          id?: string
          item_template_id?: string | null
          item_template_version?: number
          material_id: string
          material_name: string
          quotation_id: string
          quote_line_item_id: string
          unit: string
        }
        Update: {
          basis?: Database["public"]["Enums"]["material_component_basis"]
          component_quantity?: number
          created_at?: string
          estimated_quantity?: number
          id?: string
          item_template_id?: string | null
          item_template_version?: number
          material_id?: string
          material_name?: string
          quotation_id?: string
          quote_line_item_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_material_estimates_item_template_id_fkey"
            columns: ["item_template_id"]
            isOneToOne: false
            referencedRelation: "item_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_material_estimates_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_material_estimates_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_material_estimates_quote_line_item_id_fkey"
            columns: ["quote_line_item_id"]
            isOneToOne: false
            referencedRelation: "quote_line_items"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean
          address: string | null
          contact_number: string | null
          contact_person: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          payment_terms: string | null
          phone: string | null
          supplier_name: string
          tin: string | null
          tin_number: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          contact_number?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          supplier_name: string
          tin?: string | null
          tin_number?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          contact_number?: string | null
          contact_person?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          supplier_name?: string
          tin?: string | null
          tin_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      workflow_drafts: {
        Row: {
          committed_record_id: string | null
          created_at: string
          customer_id: string | null
          deleted_at: string | null
          id: string
          payload: Json
          project_name: string | null
          source_record_id: string | null
          updated_at: string
          user_id: string
          version: number
          workflow: string
        }
        Insert: {
          committed_record_id?: string | null
          created_at?: string
          customer_id?: string | null
          deleted_at?: string | null
          id?: string
          payload?: Json
          project_name?: string | null
          source_record_id?: string | null
          updated_at?: string
          user_id: string
          version?: number
          workflow: string
        }
        Update: {
          committed_record_id?: string | null
          created_at?: string
          customer_id?: string | null
          deleted_at?: string | null
          id?: string
          payload?: Json
          project_name?: string | null
          source_record_id?: string | null
          updated_at?: string
          user_id?: string
          version?: number
          workflow?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_drafts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_operational_summaries"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "workflow_drafts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      customer_active_job_summaries: {
        Row: {
          created_at: string | null
          customer_id: string | null
          expenses: number | null
          id: string | null
          job_number: string | null
          profit: number | null
          project_name: string | null
          quoted_amount: number | null
          status: Database["public"]["Enums"]["job_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "job_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer_operational_summaries"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "job_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_operational_summaries: {
        Row: {
          active_jobs: number | null
          customer_id: string | null
          lifetime_revenue: number | null
          outstanding_balance: number | null
          total_quotes: number | null
        }
        Relationships: []
      }
      job_bom_items: {
        Row: {
          created_at: string | null
          id: string | null
          job_bom_id: string | null
          material_id: string | null
          planned_quantity: number | null
          unit: string | null
          materials: {
            category: string
            created_at: string
            id: string
            inventory_unit: string | null
            is_active: boolean
            name: string
            pack_size: number | null
            roll_length_ft: number | null
            roll_width_ft: number | null
            unit: string
            updated_at: string
          } | null
        }
        Relationships: []
      }
      job_boms: {
        Row: {
          bom_template_id: string | null
          created_at: string | null
          id: string | null
          job_order_id: string | null
          released_at: string | null
          released_by: string | null
          template_version: number | null
          job_bom_items: {
            created_at: string | null
            id: string | null
            job_bom_id: string | null
            material_id: string | null
            planned_quantity: number | null
            unit: string | null
          } | null
        }
        Relationships: []
      }
      viewer_job_status_summary: {
        Row: {
          job_count: number | null
          status: Database["public"]["Enums"]["job_status"] | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_custom_job_order_material: {
        Args: {
          p_job_order_id: string
          p_job_order_line_item_id: string
          p_material_id: string
          p_quantity: number
          p_unit: string
        }
        Returns: string
      }
      can_write_operations: { Args: { _user_id: string }; Returns: boolean }
      cancel_production: {
        Args: { p_job_order_id: string; p_reason: string }
        Returns: undefined
      }
      confirm_custom_item_materials: {
        Args: {
          p_idempotency_key: string
          p_job_order_id: string
          p_job_order_line_item_id: string
          p_materials: Json
        }
        Returns: string
      }
      confirm_expense_project_cost: {
        Args: { p_expense_id: string }
        Returns: undefined
      }
      convert_material_quantity: {
        Args: {
          p_input_unit: string
          p_material_id: string
          p_quantity: number
        }
        Returns: {
          capacity_description: string
          conversion_factor: number
          entered_quantity: number
          entered_unit: string
          inventory_quantity: number
          inventory_unit: string
        }[]
      }
      correct_job_order_before_completion: {
        Args: { p_job_order_id: string; p_payload: Json; p_reason: string }
        Returns: {
          approved_by_name: string | null
          approved_by_signature_url_snapshot: string | null
          approved_by_user_id: string | null
          client_po_number: string | null
          completed_at: string | null
          contact_department_snapshot: string | null
          contact_email_snapshot: string | null
          contact_name_snapshot: string | null
          contact_phone_snapshot: string | null
          created_at: string
          customer_contact_id: string | null
          customer_id: string
          delivered_at: string | null
          dr_number: string | null
          id: string
          installation_date: string | null
          internal_notes: string | null
          job_number: string
          prepared_by_name_snapshot: string | null
          prepared_by_signature_url_snapshot: string | null
          prepared_by_user_id: string | null
          production_started_at: string | null
          project_manager: string | null
          project_name: string
          quotation_id: string
          quoted_amount: number
          ready_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          target_completion_date: string | null
          tax_type: Database["public"]["Enums"]["tax_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "job_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      correct_production_material_plan: {
        Args: {
          p_job_order_id: string
          p_job_order_line_item_id: string
          p_material_id: string
          p_planned_quantity: number
          p_reason: string
        }
        Returns: undefined
      }
      create_customer_with_contacts: {
        Args: { contacts?: Json; customer_data: Json }
        Returns: Json
      }
      create_invoice_from_approved_quote: {
        Args: { p_quotation_id: string }
        Returns: {
          id: string
          invoice_number: string
        }[]
      }
      create_job_expense_with_allocations: {
        Args: { p_allocations?: Json; p_expense: Json }
        Returns: string
      }
      create_job_invoice: {
        Args: { invoice_data: Json; lines: Json }
        Returns: {
          id: string
          invoice_number: string
        }[]
      }
      create_job_order_from_approved_quote: {
        Args: {
          p_approved_by_user_id: string
          p_client_po_number?: string
          p_dr_number?: string
          p_installation_date?: string
          p_internal_notes?: string
          p_quotation_id: string
          p_target_completion_date: string
        }
        Returns: {
          id: string
          job_number: string
        }[]
      }
      create_replenishment_request: {
        Args: { p_material_id: string; p_quantity: number }
        Returns: string
      }
      create_shortage_request: {
        Args: {
          p_idempotency_key: string
          p_job_order_id: string
          p_material_id: string
        }
        Returns: string
      }
      create_standalone_invoice: {
        Args: { invoice_data: Json; lines: Json }
        Returns: {
          id: string
          invoice_number: string
        }[]
      }
      create_standalone_purchase_request: {
        Args: {
          p_material_id: string
          p_quantity: number
          p_supplier_id: string
        }
        Returns: string
      }
      create_supplier: {
        Args: {
          p_address?: string
          p_contact_person?: string
          p_name: string
          p_phone?: string
          p_tin_number?: string
        }
        Returns: string
      }
      get_current_user_profile: {
        Args: never
        Returns: {
          display_name: string
          role: string
          signature_url: string
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_materials_with_opening_stock: {
        Args: { p_import_key: string; p_rows: Json }
        Returns: number
      }
      is_active_user: { Args: { _user_id: string }; Returns: boolean }
      issue_draft_invoice: {
        Args: { p_invoice_id: string }
        Returns: undefined
      }
      job_bom_items: {
        Args: { "": Database["public"]["Views"]["job_boms"]["Row"] }
        Returns: {
          created_at: string | null
          id: string | null
          job_bom_id: string | null
          material_id: string | null
          planned_quantity: number | null
          unit: string | null
        }[]
        SetofOptions: {
          from: "job_boms"
          to: "job_bom_items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      materials: {
        Args: { "": Database["public"]["Views"]["job_bom_items"]["Row"] }
        Returns: {
          category: string
          created_at: string
          id: string
          inventory_unit: string | null
          is_active: boolean
          name: string
          pack_size: number | null
          roll_length_ft: number | null
          roll_width_ft: number | null
          unit: string
          updated_at: string
        }
        SetofOptions: {
          from: "job_bom_items"
          to: "materials"
          isOneToOne: true
          isSetofReturn: true
        }
      }
      recompute_quote_totals: { Args: { _quote: string }; Returns: undefined }
      release_production: {
        Args: {
          p_idempotency_key: string
          p_job_order_id: string
          p_template_id: string
        }
        Returns: string
      }
      release_production_from_quote: {
        Args: { p_idempotency_key: string; p_job_order_id: string }
        Returns: string
      }
      reopen_quotation_for_correction: {
        Args: { quotation_id: string; reason: string }
        Returns: undefined
      }
      replace_job_expense_allocations: {
        Args: { p_allocations?: Json; p_expense_id: string }
        Returns: undefined
      }
      replace_quote_lines_and_snapshot: {
        Args: { p_lines: Json; p_quotation_id: string }
        Returns: {
          id: string
          sort_order: number
        }[]
      }
      request_missing_production_materials: {
        Args: {
          p_idempotency_key: string
          p_job_order_id: string
          p_material_ids: string[]
        }
        Returns: {
          material_id: string
          purchase_request_id: string
          requested_quantity: number
        }[]
      }
      reserve_inventory: {
        Args: {
          p_idempotency_key: string
          p_job_order_id: string
          p_material_id: string
          p_quantity: number
        }
        Returns: string
      }
      reserve_production_item_inventory: {
        Args: {
          p_idempotency_key: string
          p_job_order_id: string
          p_job_order_line_item_id: string
          p_material_id: string
          p_quantity: number
        }
        Returns: string
      }
      save_item_template_material_version: {
        Args: {
          p_components: Json
          p_idempotency_key: string
          p_item_template_id: string
        }
        Returns: number
      }
      set_purchase_request_supplier: {
        Args: {
          p_new_supplier_name?: string
          p_request_id: string
          p_supplier_id?: string
        }
        Returns: string
      }
      set_user_signature: {
        Args: { p_object_path: string; p_target_user_id: string }
        Returns: undefined
      }
      settle_and_close_petty_cash_batch: {
        Args: {
          p_batch_id: string
          p_cash_returned_amount: number
          p_cash_returned_reference: string
        }
        Returns: {
          cash_received: number
          cash_returned_amount: number | null
          cash_returned_reference: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          custodian_name: string
          cv_created_at: string | null
          cv_reference_no: string | null
          funding_date: string
          funding_reference: string
          funding_source: string
          id: string
          job_order_id: string | null
          petty_cash_number: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "petty_cash_batches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      settle_petty_cash_batch: {
        Args: {
          p_batch_id: string
          p_cash_returned_amount: number
          p_cash_returned_reference: string
        }
        Returns: {
          cash_received: number
          cash_returned_amount: number | null
          cash_returned_reference: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          custodian_name: string
          cv_created_at: string | null
          cv_reference_no: string | null
          funding_date: string
          funding_reference: string
          funding_source: string
          id: string
          job_order_id: string | null
          petty_cash_number: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "petty_cash_batches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      snapshot_quote_materials: {
        Args: { p_quotation_id: string }
        Returns: undefined
      }
      uncancel_production: {
        Args: { p_job_order_id: string; p_reason: string }
        Returns: undefined
      }
      update_own_display_name: {
        Args: { p_display_name: string }
        Returns: undefined
      }
      validate_print_calibration_fields: {
        Args: { _document_type: string; _fields: Json }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "staff"
        | "viewer"
        | "owner"
        | "sales"
        | "accounting"
        | "production"
      disbursement_category:
        | "direct_materials"
        | "petty_cash"
        | "communication"
        | "representation"
        | "commission"
        | "utilities"
        | "salary_and_wages"
        | "security_expenses"
        | "efps"
        | "egov"
        | "other"
      disbursement_payment_method:
        | "check"
        | "bank_transfer"
        | "gcash"
        | "petty_cash"
      disbursement_payment_state:
        | "pending"
        | "scheduled"
        | "released"
        | "cleared"
        | "held"
        | "cancelled"
      disbursement_subcategory:
        | "direct_materials"
        | "transportation"
        | "gas"
        | "meals"
        | "load"
        | "garbage_collection"
        | "extra_salary"
        | "parking"
        | "globe"
        | "smart"
        | "meralco"
        | "manila_water"
        | "apeiros"
        | "1601c"
        | "2550q"
        | "sss"
        | "phic"
        | "hdmf"
        | "other"
      expense_payment_status: "pending" | "paid"
      expense_type:
        | "materials"
        | "labor"
        | "delivery"
        | "outsourcing"
        | "miscellaneous"
        | "installation"
      invoice_status: "draft" | "issued" | "paid"
      job_status:
        | "pending"
        | "in_production"
        | "ready"
        | "delivered"
        | "completed"
        | "cancelled"
      material_component_basis: "per_item" | "per_sqft" | "fixed_per_line"
      pricing_mode: "sqft" | "fixed"
      production_status:
        | "not_started"
        | "preparing"
        | "partially_reserved"
        | "ready_to_start"
        | "in_progress"
        | "for_reconciliation"
        | "awaiting_approval"
        | "completed"
        | "cancelled"
      quote_status:
        | "draft"
        | "sent"
        | "approved"
        | "rejected"
        | "pending_manager_approval"
        | "pending_customer_approval"
      tax_type: "vatable" | "non_vat"
      unit_of_measure:
        | "inches"
        | "feet"
        | "millimeters"
        | "centimeters"
        | "meters"
      user_status: "active" | "inactive"
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
    Enums: {
      app_role: [
        "admin",
        "staff",
        "viewer",
        "owner",
        "sales",
        "accounting",
        "production",
      ],
      disbursement_category: [
        "direct_materials",
        "petty_cash",
        "communication",
        "representation",
        "commission",
        "utilities",
        "salary_and_wages",
        "security_expenses",
        "efps",
        "egov",
        "other",
      ],
      disbursement_payment_method: [
        "check",
        "bank_transfer",
        "gcash",
        "petty_cash",
      ],
      disbursement_payment_state: [
        "pending",
        "scheduled",
        "released",
        "cleared",
        "held",
        "cancelled",
      ],
      disbursement_subcategory: [
        "direct_materials",
        "transportation",
        "gas",
        "meals",
        "load",
        "garbage_collection",
        "extra_salary",
        "parking",
        "globe",
        "smart",
        "meralco",
        "manila_water",
        "apeiros",
        "1601c",
        "2550q",
        "sss",
        "phic",
        "hdmf",
        "other",
      ],
      expense_payment_status: ["pending", "paid"],
      expense_type: [
        "materials",
        "labor",
        "delivery",
        "outsourcing",
        "miscellaneous",
        "installation",
      ],
      invoice_status: ["draft", "issued", "paid"],
      job_status: [
        "pending",
        "in_production",
        "ready",
        "delivered",
        "completed",
        "cancelled",
      ],
      material_component_basis: ["per_item", "per_sqft", "fixed_per_line"],
      pricing_mode: ["sqft", "fixed"],
      production_status: [
        "not_started",
        "preparing",
        "partially_reserved",
        "ready_to_start",
        "in_progress",
        "for_reconciliation",
        "awaiting_approval",
        "completed",
        "cancelled",
      ],
      quote_status: [
        "draft",
        "sent",
        "approved",
        "rejected",
        "pending_manager_approval",
        "pending_customer_approval",
      ],
      tax_type: ["vatable", "non_vat"],
      unit_of_measure: [
        "inches",
        "feet",
        "millimeters",
        "centimeters",
        "meters",
      ],
      user_status: ["active", "inactive"],
    },
  },
} as const
