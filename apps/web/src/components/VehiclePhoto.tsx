import type { CarModel } from "@autovoyage/shared";

/** A locally rendered concept car; it does not identify the owner's actual vehicle. */
export function VehiclePhoto({ className = "", priority = false }: {
  model?: Pick<CarModel, "id" | "brand" | "name">;
  className?: string;
  priority?: boolean;
}) {
  return (
    <figure className={`vehicle-photo vehicle-illustration vehicle-studio-render ${className}`}>
      <img
        src="/images/vehicles/studio-silver.webp"
        srcSet="/images/vehicles/studio-silver-small.webp 720w, /images/vehicles/studio-silver.webp 1440w"
        sizes="(max-width: 767px) 90vw, (max-width: 1199px) 50vw, 720px"
        width={1440}
        height={504}
        alt="银白概念跑车的三维渲染，外观仅为示意"
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
      />
    </figure>
  );
}
