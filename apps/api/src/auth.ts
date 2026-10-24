import { oauthProvider } from "@better-auth/oauth-provider";
import type { Database } from "@talvra/db";
import { schema } from "@talvra/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { allowedDomains, appOrigins, type Bindings, isAllowedEmail, mcpResource } from "./env.js";
import { actionEmail, type SendEmail } from "./lib/email.js";

const DAY = 60 * 60 * 24;

export function createAuth(env: Bindings, db: Database, sendEmail: SendEmail) {
  const domains = allowedDomains(env);
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            // Hint Google to show only school accounts; the hook below enforces it.
            hd: domains[0],
            prompt: "select_account" as const,
          },
        }
      : {};

  return betterAuth({
    appName: "Talvra",
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: appOrigins(env),
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        jwks: schema.jwks,
        oauthClient: schema.oauthClients,
        oauthResource: schema.oauthResources,
        oauthClientResource: schema.oauthClientResources,
        oauthRefreshToken: schema.oauthRefreshTokens,
        oauthAccessToken: schema.oauthAccessTokens,
        oauthConsent: schema.oauthConsents,
        oauthClientAssertion: schema.oauthClientAssertions,
      },
    }),
    // The jwt plugin's own /token endpoint isn't used (OAuth uses /oauth2/token).
    disabledPaths: ["/token"],
    plugins: [
      jwt(),
      // OAuth 2.1 for the MCP server: ChatGPT and claude.ai connectors register themselves
      // (dynamic client registration), the student signs in and approves on our consent page, and
      // the connector gets a short-lived JWT for /api/mcp (PKCE required, refresh tokens rotate).
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/oauth/consent",
        scopes: ["openid", "profile", "email", "offline_access"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // Claude Code registers loopback redirects without an application type.
        clientRegistrationDefaultApplicationType: "infer",
        // Access tokens are JWTs (can't be revoked), so keep them short; refresh tokens can.
        resources: [{ identifier: mcpResource(env), name: "Talvra MCP", accessTokenTtl: 15 * 60 }],
        clientRegistrationDefaultResources: [mcpResource(env)],
        clientRegistrationAllowedResources: [mcpResource(env)],
        // Lets the consent page show the app's name before it asks.
        allowPublicClientPrelogin: true,
      }),
    ],
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: env.APP_ENV !== "development",
      cookiePrefix: "talvra",
    },
    session: {
      // Sessions live in Postgres, expire after 14 days without use, and the
      // expiry is pushed forward at most once a day while the user is active.
      expiresIn: 14 * DAY,
      updateAge: DAY,
      // Signed cookie cache saves a DB read per request; revocation takes
      // effect within this window.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(
          actionEmail({
            to: user.email,
            subject: "Reset your Talvra password",
            intro: "Someone asked to reset the password for your Talvra account.",
            action: "Choose a new password",
            url,
          }),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: DAY,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(
          actionEmail({
            to: user.email,
            subject: "Confirm your email for Talvra",
            intro: `Hi ${user.name}, confirm your Morgan email to finish creating your Talvra account.`,
            action: "Confirm email",
            url,
          }),
        );
      },
    },
    socialProviders: google,
    databaseHooks: {
      user: {
        create: {
          // The single place the school-email rule is enforced, for every sign-up path.
          before: async (user) => {
            if (!isAllowedEmail(user.email, domains)) {
              throw new APIError("FORBIDDEN", {
                message: `Use your ${domains.map((d) => `@${d}`).join(" or ")} email to sign up.`,
              });
            }
          },
        },
        update: {
          before: async (user) => {
            if (user.email && !isAllowedEmail(user.email, domains)) {
              throw new APIError("FORBIDDEN", { message: "Email must stay on a school domain." });
            }
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
