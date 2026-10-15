export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};

/**
 * Variables the server cannot do its job without. Everything else degrades to a
 * disabled feature and is reported by the health endpoint instead.
 */
const REQUIRED_IN_PRODUCTION = [
  ["JWT_SECRET", ENV.cookieSecret, "sessions cannot be signed or verified"],
  [
    "DATABASE_URL",
    ENV.databaseUrl,
    "no job, user or notification can be read or written",
  ],
] as const;

export class EnvValidationError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Set them (see .env.example) and restart.`
    );
    this.name = "EnvValidationError";
  }
}

/**
 * Validate configuration at startup rather than on first use.
 *
 * In production a missing secret is fatal: booting without it produces a server
 * that accepts requests and fails every one of them, which reads as an
 * application bug rather than a deploy that was never configured. In
 * development the same state is normal, so it warns and carries on.
 */
export function validateEnv(): void {
  const missing = REQUIRED_IN_PRODUCTION.filter(([, value]) => !value);

  if (missing.length === 0) return;

  if (ENV.isProduction) {
    throw new EnvValidationError(missing.map(([name]) => name));
  }

  for (const [name, , consequence] of missing) {
    console.warn(`[env] ${name} is not set - ${consequence}.`);
  }
}
