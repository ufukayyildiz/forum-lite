import { useState } from "react";

const PALETTE = ["#b8bb26","#83a598","#fabd2f","#d3869b","#8ec07c","#fe8019","#83a598","#fb4934","#fabd2f","#8ec07c"];

function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return PALETTE[h % PALETTE.length];
}

function initials(name: string) {
  return name.split(/\s+/).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

interface Props {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function DAvatar({ src, name, size = 32, className, style }: Props) {
  const [err, setErr] = useState(false);

  const base: React.CSSProperties = {
    width: size, height: size, borderRadius: "50%",
    fontSize: Math.max(size * 0.36, 10), fontWeight: 700,
    flexShrink: 0, display: "inline-flex", alignItems: "center",
    justifyContent: "center", verticalAlign: "middle",
    objectFit: "cover", ...style,
  };

  if (src && !err) {
    return <img src={src} alt={name} style={base} className={className} onError={() => setErr(true)} />;
  }

  return (
    <div style={{ ...base, background: colorFor(name), color: "#fff" }} className={className}>
      {initials(name)}
    </div>
  );
}
