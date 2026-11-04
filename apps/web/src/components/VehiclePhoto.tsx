import type { CarModel } from "@autovoyage/shared";

export const VEHICLE_ART_SOURCE = "https://github.com/gexiaobin/mem-car-information-system/blob/main/docs/image-attribution.md";
export const VEHICLE_ART_CREDIT = "Car Concept — Eric Chadwick / Darmstadt Graphics Group GmbH, CC BY 4.0；银白材质、灯光与构图改编";

/** A locally rendered concept car; it does not identify the owner's actual vehicle. */
export function VehiclePhoto({ className = "", priority = false, caption = true }: {
  model?: Pick<CarModel, "id" | "brand" | "name">;
  className?: string;
  priority?: boolean;
  caption?: boolean;
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
      {caption && <figcaption>
        <span>3D 概念车 · 外观示意</span>
        <a href={VEHICLE_ART_SOURCE} target="_blank" rel="noreferrer" title={VEHICLE_ART_CREDIT}>素材来源</a>
      </figcaption>}
    </figure>
  );
}
