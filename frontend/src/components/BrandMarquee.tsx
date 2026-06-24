import { SUNRACK_PARTNER_LOGOS } from "@/constants/sunrack-partners";
import { cn } from "@/lib/utils";

function PartnerLogo({ src, name }: { src: string; name: string }) {
  return (
    <img
      src={src}
      alt={name}
      height={44}
      className="h-9 w-auto max-w-[140px] object-contain opacity-50 grayscale transition-all duration-300 hover:opacity-100 hover:grayscale-0 sm:h-11"
      loading="lazy"
    />
  );
}

export function BrandMarquee({
  title = "Trusted By Leading Brands",
  className,
}: {
  title?: string;
  className?: string;
}) {
  return (
    <div className={cn("w-full", className)}>
      <div className="mb-5 text-center text-[11px] font-medium uppercase tracking-wider text-zinc-500 sm:text-xs">
        {title}
      </div>
      <div className="relative w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
        <div className="flex w-max animate-marquee gap-12 py-2 sm:gap-16">
          <div className="flex items-center gap-12 sm:gap-16">
            {SUNRACK_PARTNER_LOGOS.map((logo) => (
              <PartnerLogo key={logo.src} {...logo} />
            ))}
          </div>
          <div className="flex items-center gap-12 sm:gap-16" aria-hidden="true">
            {SUNRACK_PARTNER_LOGOS.map((logo) => (
              <PartnerLogo key={`dup-${logo.src}`} {...logo} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
