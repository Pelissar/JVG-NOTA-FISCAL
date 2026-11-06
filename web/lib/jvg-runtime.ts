type RuntimeConfig = {
  supabaseUrl: string;
  supabaseSecretKey: string | null;
};

export function jvgRuntime(): RuntimeConfig {
  const secret = process.env.JVG_SUPABASE_SECRET_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://gkhxcuysqyvnkdkzsxxm.supabase.co";
  return {
    supabaseUrl: url.replace(/\/$/, ""),
    supabaseSecretKey: secret && secret.length > 15 ? secret : null,
  };
}
