import type { Database } from "@talvra/db";
import { schema } from "@talvra/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { allowedDomains, type Bindings, isAllowedEmail } from "./env.js";
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
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
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
