import type { Email } from "./email.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const shell = (
  body: string,
  unsubscribeUrl: string,
) => `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111;line-height:1.5">
<p style="font-size:18px;font-weight:600;margin:0 0 16px">Talvra</p>
${body}
<p style="color:#666;font-size:12px;margin-top:32px">You get this because reminders are on in Talvra. <a href="${esc(unsubscribeUrl)}" style="color:#666">Turn off emails</a> · change times in Reminders.</p>
</div>`;

const button = (label: string, url: string) =>
  `<p><a href="${esc(url)}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${esc(label)}</a></p>`;

export type DueLine = { name: string; course: string; due: string; url: string };

function when(dueAt: Date, timeZone: string) {
  return dueAt.toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relative(dueAt: Date, now: Date) {
  const mins = Math.round((dueAt.getTime() - now.getTime()) / 60_000);
  if (mins < 90) return `in ${Math.max(mins, 1)} minutes`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `in ${hours} hours`;
  return `in ${Math.round(hours / 24)} days`;
}

export function reminderEmail(o: {
  to: string;
  name: string;
  course: string;
  dueAt: Date;
  timeZone: string;
  url: string;
  unsubscribeUrl: string;
  now?: Date;
}): Email {
  const now = o.now ?? new Date();
  const subject = `Due ${relative(o.dueAt, now)}: ${o.name}`;
  const due = when(o.dueAt, o.timeZone);
  return {
    to: o.to,
    subject,
    text: `${o.name} (${o.course}) is due ${due}.\n\nOpen your plan: ${o.url}\n\nTurn off emails: ${o.unsubscribeUrl}`,
    html: shell(
      `<p><strong>${esc(o.name)}</strong><br><span style="color:#555">${esc(o.course)}</span></p>
<p>Due <strong>${esc(due)}</strong> (${esc(relative(o.dueAt, now))}).</p>
${button("Open your plan", o.url)}`,
      o.unsubscribeUrl,
    ),
    headers: listUnsubscribe(o.unsubscribeUrl),
  };
}

export function digestEmail(o: {
  to: string;
  firstName: string;
  overdue: DueLine[];
  dueSoon: DueLine[];
  cardsDue: number;
  appUrl: string;
  unsubscribeUrl: string;
}): Email {
  const count = o.overdue.length + o.dueSoon.length;
  const subject =
    count === 0
      ? `${o.cardsDue} flashcards to review today`
      : `Today: ${count} ${count === 1 ? "thing" : "things"} due soon${o.overdue.length ? ` (${o.overdue.length} overdue)` : ""}`;
  const list = (title: string, items: DueLine[]) =>
    items.length
      ? `<p style="margin:16px 0 4px;font-weight:600">${esc(title)}</p><ul style="padding-left:20px;margin:0">${items
          .map(
            (i) =>
              `<li><a href="${esc(i.url)}">${esc(i.name)}</a> · ${esc(i.course)} · ${esc(i.due)}</li>`,
          )
          .join("")}</ul>`
      : "";
  const textList = (title: string, items: DueLine[]) =>
    items.length
      ? `${title}\n${items.map((i) => `- ${i.name} (${i.course}), ${i.due}: ${i.url}`).join("\n")}\n\n`
      : "";
  return {
    to: o.to,
    subject,
    text: `Good morning ${o.firstName},\n\n${textList("Overdue", o.overdue)}${textList("Due in the next 2 days", o.dueSoon)}${
      o.cardsDue ? `${o.cardsDue} flashcards are due for review.\n\n` : ""
    }Open Talvra: ${o.appUrl}\n\nTurn off emails: ${o.unsubscribeUrl}`,
    html: shell(
      `<p>Good morning ${esc(o.firstName)},</p>
${list("Overdue", o.overdue)}
${list("Due in the next 2 days", o.dueSoon)}
${o.cardsDue ? `<p style="margin-top:16px">${o.cardsDue} flashcards are due for review.</p>` : ""}
${button("Open Talvra", o.appUrl)}`,
      o.unsubscribeUrl,
    ),
    headers: listUnsubscribe(o.unsubscribeUrl),
  };
}

export function testEmail(o: { to: string; appUrl: string; unsubscribeUrl: string }): Email {
  return {
    to: o.to,
    subject: "Talvra reminders are working",
    text: `This is a test. Reminders will look like this and link to your plan.\n\n${o.appUrl}\n\nTurn off emails: ${o.unsubscribeUrl}`,
    html: shell(
      `<p>This is a test. Your reminders will arrive like this and link straight to your plan.</p>${button("Open Talvra", o.appUrl)}`,
      o.unsubscribeUrl,
    ),
    headers: listUnsubscribe(o.unsubscribeUrl),
  };
}

/** RFC 8058 one-click unsubscribe (Gmail/Yahoo bulk-sender requirement). */
function listUnsubscribe(url: string) {
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}
