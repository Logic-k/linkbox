import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// env 미설정 시 null — 앱은 로컬 전용 모드로 동작하고 동기화 UI를 숨긴다
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;
