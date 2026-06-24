import * as React from "react";
import { cn } from "../../lib/utils";

interface AvatarProps { src?: string | null; name: string; size?: "sm" | "md" | "lg"; className?: string }

const sizes = { sm: "h-7 w-7 text-xs", md: "h-9 w-9 text-sm", lg: "h-14 w-14 text-lg" };

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function colorFromName(name: string) {
  const colors = ["bg-indigo-600","bg-violet-600","bg-rose-600","bg-amber-600","bg-emerald-600","bg-sky-600","bg-pink-600"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return colors[h % colors.length];
}

export function Avatar({ src, name, size = "md", className }: AvatarProps) {
  const [err, setErr] = React.useState(false);
  const cls = cn("rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0 overflow-hidden", sizes[size], className);
  if (src && !err) {
    return <img src={src} alt={name} className={cls} onError={() => setErr(true)} />;
  }
  return <div className={cn(cls, colorFromName(name))}>{initials(name)}</div>;
}
