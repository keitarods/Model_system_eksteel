import Image from "next/image";

/** Decorative background: mirror only the photograph, keeping the interface readable. */
export function AppBackground() {
  return <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#111b22]">
    <Image src="/images/fundo.png" alt="" fill priority sizes="100vw"
      className="object-cover object-center" style={{ transform: "scaleX(-1)" }} />
    <div className="absolute inset-0 bg-black/35" />
    <div className="absolute inset-0 bg-gradient-to-r from-[#101b24]/55 via-[#101b24]/15 to-[#101b24]/65" />
  </div>;
}
