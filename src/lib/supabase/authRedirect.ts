// Only known application destinations can receive authentication callbacks.
export function authRedirect(next: string | null, type: string | null) {
  if (type === "recovery" || type === "invite") return "/reset-password";
  return next === "/reset-password" ? next : "/ferramentas";
}
