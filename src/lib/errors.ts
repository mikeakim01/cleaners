/** Map low-level Supabase/Postgres errors to human-readable messages. */
export function humanizeDbError(error: unknown, fallback: string): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";

  if (code === "23505" || /duplicate key|already exists/i.test(message)) {
    if (/slug/i.test(message)) return "This URL handle is already taken. Try another one.";
    if (/phone/i.test(message)) return "This phone number is already registered.";
    if (/name/i.test(message)) return "This business name is already taken.";
    return "This record already exists.";
  }
  if (code === "23503" || /foreign key/i.test(message)) {
    return "A related record could not be found. Please refresh and try again.";
  }
  if (code === "42501" || /row-level security|not authorized|permission/i.test(message)) {
    return "You do not have permission to do that.";
  }
  if (/JWT|expired|session/i.test(message)) {
    return "Your session has expired. Please sign in again.";
  }
  if (/network|fetch failed|Failed to fetch/i.test(message)) {
    return "Could not reach the server. Check your connection and try again.";
  }
  return message ? `${fallback}: ${message}` : fallback;
}

export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}
