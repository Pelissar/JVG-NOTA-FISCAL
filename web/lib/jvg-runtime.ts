import { AsyncLocalStorage } from "node:async_hooks";

type RuntimeConfig = {
  supabaseUrl: string;
  supabaseSecretKey: string | null;
};

const runtime = new AsyncLocalStorage<RuntimeConfig>();

export function withJvgRuntime<T>(env: Cloudflare.Env, execute: () => T): T {
  const bindings = env as unknown as Record<string, unknown>;
  const configuredUrl = bindings.JVG_SUPABASE_URL;
  const configuredKey = bindings.JVG_SUPABASE_SECRET_KEY;
  return runtime.run(
    {
      supabaseUrl: typeof configuredUrl === "string" && configuredUrl.startsWith("https://")
        ? configuredUrl.replace(/\/$/, "")
        : "https://gkhxcuysqyvnkdkzsxxm.supabase.co",
      supabaseSecretKey: typeof configuredKey === "string" && configuredKey.length > 15
        ? configuredKey : null,
    },
    execute,
  );
}

export function jvgRuntime(): RuntimeConfig {
  return runtime.getStore() ?? {
    supabaseUrl: "https://gkhxcuysqyvnkdkzsxxm.supabase.co",
    supabaseSecretKey: null,
  };
}
