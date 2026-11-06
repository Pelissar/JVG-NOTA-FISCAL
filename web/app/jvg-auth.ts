import { createSupabaseServerClient } from "../lib/supabase/server";

export type JvgAuthUser = {
  userId: string;
  email: string;
  displayName: string;
};

/** Valida a identidade com Supabase Auth em cada requisicao protegida. */
export async function getJvgUser(): Promise<JvgAuthUser | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !data.user.email) return null;
  return {
    userId: data.user.id,
    email: data.user.email,
    displayName: data.user.email.split("@")[0] || "Usuário",
  };
}
