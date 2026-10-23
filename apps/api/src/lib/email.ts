import type { Bindings } from "../env.js";

export type Email = { to: string; subject: string; text: string; html: string };
export type SendEmail = (email: Email) => Promise<void>;

/**
 * Sends through Resend when RESEND_API_KEY is set. In development without a
 * key, the email is logged so links (verification, reset) can be clicked
 * from the terminal. Production without a key is a configuration error.
 */
export function emailSender(env: Bindings): SendEmail {
  return async (email) => {
    if (!env.RESEND_API_KEY) {
      if (env.APP_ENV === "production") throw new Error("RESEND_API_KEY is not set");
      console.log(`[email] to=${email.to} subject="${email.subject}"\n${email.text}`);
      return;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, ...email, to: [email.to] }),
    });
    if (!res.ok) throw new Error(`Resend failed (${res.status}): ${await res.text()}`);
  };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Minimal, accessible transactional email: one message, one button, plain-text fallback. */
export function actionEmail(opts: {
  to: string;
  subject: string;
  intro: string;
  action: string;
  url: string;
}): Email {
  const { to, subject, intro, action, url } = opts;
  return {
    to,
    subject,
    text: `${intro}\n\n${action}: ${url}\n\nIf you didn't ask for this, you can ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111">
<h1 style="font-size:20px">Talvra</h1>
<p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${escapeHtml(action)}</a></p>
<p style="color:#555;font-size:13px">If you didn't ask for this, you can ignore this email.</p>
</div>`,
  };
}
