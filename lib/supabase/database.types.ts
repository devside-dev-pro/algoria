export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      candles: {
        Row: { close: number; high: number; id: number; low: number; open: number; symbol: string; time: number; timeframe: string; volume: number | null };
        Insert: { close: number; high: number; id?: never; low: number; open: number; symbol?: string; time: number; timeframe?: string; volume?: number | null };
        Update: { close?: number; high?: number; id?: never; low?: number; open?: number; symbol?: string; time?: number; timeframe?: string; volume?: number | null };
        Relationships: [];
      };
      commands: {
        Row: { consumed: boolean; id: number; payload: Json | null; ts: string; type: string };
        Insert: { consumed?: boolean; id?: never; payload?: Json | null; ts?: string; type: string };
        Update: { consumed?: boolean; id?: never; payload?: Json | null; ts?: string; type?: string };
        Relationships: [];
      };
      events: {
        Row: { data: Json | null; id: number; level: string; msg: string; symbol: string; ts: string };
        Insert: { data?: Json | null; id?: never; level: string; msg: string; symbol?: string; ts?: string };
        Update: { data?: Json | null; id?: never; level?: string; msg?: string; symbol?: string; ts?: string };
        Relationships: [];
      };
      signals: {
        Row: {
          confidence: number;
          confluence: Json | null;
          created_at: string;
          direction: string;
          entry: number;
          id: string;
          lot: number;
          mode: string;
          rationale: Json | null;
          ref: string | null;
          result_code: string | null;
          risk_reward: number | null;
          status: string;
          stop_loss: number;
          symbol: string;
          take_profits: number[];
          ticket: string | null;
        };
        Insert: {
          confidence: number;
          confluence?: Json | null;
          created_at?: string;
          direction: string;
          entry: number;
          id?: string;
          lot: number;
          mode: string;
          rationale?: Json | null;
          ref?: string | null;
          result_code?: string | null;
          risk_reward?: number | null;
          status?: string;
          stop_loss: number;
          symbol?: string;
          take_profits: number[];
          ticket?: string | null;
        };
        Update: {
          confidence?: number;
          confluence?: Json | null;
          created_at?: string;
          direction?: string;
          entry?: number;
          id?: string;
          lot?: number;
          mode?: string;
          rationale?: Json | null;
          ref?: string | null;
          result_code?: string | null;
          risk_reward?: number | null;
          status?: string;
          stop_loss?: number;
          symbol?: string;
          take_profits?: number[];
          ticket?: string | null;
        };
        Relationships: [];
      };
      state_snapshots: {
        Row: {
          adx: number | null;
          atr: number | null;
          atr_percentile: number | null;
          balance: number | null;
          day_pnl: number | null;
          equity: number | null;
          id: number;
          killed: boolean | null;
          mode: string | null;
          open_positions: number | null;
          open_risk_pct: number | null;
          regime: string | null;
          session: string | null;
          spread: number | null;
          symbol: string;
          tradable: boolean | null;
          ts: string;
        };
        Insert: {
          adx?: number | null;
          atr?: number | null;
          atr_percentile?: number | null;
          balance?: number | null;
          day_pnl?: number | null;
          equity?: number | null;
          id?: never;
          killed?: boolean | null;
          mode?: string | null;
          open_positions?: number | null;
          open_risk_pct?: number | null;
          regime?: string | null;
          session?: string | null;
          spread?: number | null;
          symbol?: string;
          tradable?: boolean | null;
          ts?: string;
        };
        Update: {
          adx?: number | null;
          atr?: number | null;
          atr_percentile?: number | null;
          balance?: number | null;
          day_pnl?: number | null;
          equity?: number | null;
          id?: never;
          killed?: boolean | null;
          mode?: string | null;
          open_positions?: number | null;
          open_risk_pct?: number | null;
          regime?: string | null;
          session?: string | null;
          spread?: number | null;
          symbol?: string;
          tradable?: boolean | null;
          ts?: string;
        };
        Relationships: [];
      };
      trades: {
        Row: {
          closed_at: string | null;
          direction: string | null;
          entry: number | null;
          exit: number | null;
          id: string;
          lot: number | null;
          opened_at: string | null;
          pnl: number | null;
          r: number | null;
          reason: string | null;
          signal_ref: string | null;
          symbol: string;
          ticket: string | null;
        };
        Insert: {
          closed_at?: string | null;
          direction?: string | null;
          entry?: number | null;
          exit?: number | null;
          id?: string;
          lot?: number | null;
          opened_at?: string | null;
          pnl?: number | null;
          r?: number | null;
          reason?: string | null;
          signal_ref?: string | null;
          symbol?: string;
          ticket?: string | null;
        };
        Update: {
          closed_at?: string | null;
          direction?: string | null;
          entry?: number | null;
          exit?: number | null;
          id?: string;
          lot?: number | null;
          opened_at?: string | null;
          pnl?: number | null;
          r?: number | null;
          reason?: string | null;
          signal_ref?: string | null;
          symbol?: string;
          ticket?: string | null;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
