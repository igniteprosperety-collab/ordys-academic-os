import { cn } from "@/lib/utils";
import officialLogo from "../../../mobile/branding/ordys-launcher.webp";
import symbolLogo from "../../../mobile/branding/ordys-symbol.svg";

type OrdysBrandLockupProps = {
  compact?: boolean;
  className?: string;
};

export function OrdysBrandLockup({ compact = false, className }: OrdysBrandLockupProps) {
  return (
    <div
      className={cn(
        "flex select-none items-center justify-center",
        compact ? "size-9" : "mx-auto h-[104px] w-[250px]",
        className,
      )}
    >
      <img
        src={compact ? symbolLogo : officialLogo}
        alt={compact ? "ORDYS" : "ORDYS ACADEMY"}
        className={compact ? "size-full object-contain" : "h-full w-full object-contain"}
        draggable={false}
      />
    </div>
  );
}
