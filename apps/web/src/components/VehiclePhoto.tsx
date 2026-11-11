import type { CarModel } from "@autovoyage/shared";

export const VEHICLE_ART_SOURCE = "https://github.com/gexiaobin/mem-car-information-system/blob/main/docs/image-attribution.md";
export const VEHICLE_ART_CREDIT = "Car Concept — Eric Chadwick / Darmstadt Graphics Group GmbH, CC BY 4.0；银白材质、灯光与构图改编";

/** Keeps the license accessible without overlaying the vehicle illustration. */
export function VehicleArtCredit() {
  return <a className="vehicle-art-credit" href={VEHICLE_ART_SOURCE} target="_blank" rel="noreferrer" title={VEHICLE_ART_CREDIT}>车辆素材与许可</a>;
}

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
