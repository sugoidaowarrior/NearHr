"use client";

// Renders a default profile picture as a data URL: two monogram styles the
// user can choose from (A = blue gradient initials, B = solid amber initials).
const S = 96;

export type PfpStyle = "A" | "B";

export function monogramDataUrl(initials: string, style: PfpStyle = "A"): string {
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  const grad = ctx.createLinearGradient(0, 0, S, S);
  if (style === "B") {
    grad.addColorStop(0, "#f59e0b");
    grad.addColorStop(1, "#d97706");
  } else {
    grad.addColorStop(0, "#4d65ff");
    grad.addColorStop(1, "#0082f3");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "800 40px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initials.slice(0, 2), S / 2, S / 2 + 2);
  return c.toDataURL("image/png");
}

// Only data URLs rendered as <img> src (never remote Google photo URLs, which
// expire and show as broken image icons).
export function displayAvatar(avatar: string | null | undefined, initials: string, style: PfpStyle = "A"): string {
  if (avatar && avatar.startsWith("data:image/")) return avatar;
  return monogramDataUrl(initials, style);
}
