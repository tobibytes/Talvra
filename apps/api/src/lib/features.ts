import type { Bindings } from "../env.js";

/** "Do my homework" is switched on per email by the owner (DO_HOMEWORK_EMAILS); off otherwise. */
export function doHomeworkEnabled(env: Pick<Bindings, "DO_HOMEWORK_EMAILS">, email: string) {
  const allowed = (env.DO_HOMEWORK_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
