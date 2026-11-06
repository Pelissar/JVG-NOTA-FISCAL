import "server-only";

/**
 * Focus credentials must be resolved by the server at request time.
 * A dynamic key prevents build-time substitution of private values into
 * Turbopack artifacts that Netlify then correctly flags as exposed secrets.
 */
export function focusRuntimeEnv(name: string): string {
  const runtimeEnvironment: NodeJS.ProcessEnv = process.env;
  return runtimeEnvironment[name]?.trim() ?? "";
}
