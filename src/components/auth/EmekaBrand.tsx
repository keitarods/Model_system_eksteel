"use client";
import Image from "next/image";
import { useState } from "react";

export function EmekaBrand({ compact = false, symbolOnly = false }: { compact?: boolean; symbolOnly?: boolean }) {
  const [missing, setMissing] = useState(false);
  return missing ? (
    <span className={`${compact ? "text-sm" : "text-3xl"} font-bold tracking-tight text-white`}>emeka<span className="font-light text-slate-400">_system</span></span>
  ) : (
    <Image src={symbolOnly ? "/images/emeka_logo.png" : "/images/emeka_engenharia.png"} alt="Emeka Engenharia" width={symbolOnly ? 1254 : 1774} height={symbolOnly ? 1254 : 887}
      priority unoptimized className={`${compact ? "h-7" : "h-20 sm:h-28"} w-auto max-w-full object-contain`} onError={() => setMissing(true)} />
  );
}
