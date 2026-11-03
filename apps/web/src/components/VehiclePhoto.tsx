import { useState } from "react";
import { CarFront, ImageOff } from "lucide-react";
import type { CarModel } from "@autovoyage/shared";

const photos = {
  magotan: { src: "/images/vehicles/vw-magotan.webp", label: "大众迈腾 B8L 车型实拍参考图", author: "Dinkun Chen", source: "https://commons.wikimedia.org/wiki/File:VOLKSWAGEN_MAGOTAN_B8L_China.jpg" },
  seal: { src: "/images/vehicles/byd-seal.webp", label: "比亚迪海豹车型实拍参考图", author: "Calreyn88", source: "https://commons.wikimedia.org/wiki/File:2024_BYD_Seal_2.jpg" },
};

/** A model reference image is never presented as the owner's actual vehicle. */
export function VehiclePhoto({ model, className = "", priority = false, caption = true }: {
  model?: Pick<CarModel, "id" | "brand" | "name">;
  className?: string;
  priority?: boolean;
  caption?: boolean;
}) {
  const normalizedName = model?.name.replace(/\s*·\s*课程演示车型$/, "").trim();
  const key = model?.brand === "大众" && normalizedName === "迈腾" ? "magotan"
    : model?.brand === "比亚迪" && normalizedName === "海豹" ? "seal" : null;
  const photo = key ? photos[key] : null;
  const [failedSrc, setFailedSrc] = useState("");
  const available = photo && failedSrc !== photo.src;
  return (
    <figure className={`vehicle-photo ${available ? "" : "vehicle-photo-empty"} ${className}`}>
      {available ? <img src={photo.src} alt={photo.label} width="1280" height="720"
        loading={priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : "auto"}
        onError={() => setFailedSrc(photo.src)} />
        : <div className="vehicle-photo-fallback">
          {photo ? <ImageOff size={42} aria-hidden="true" /> : <CarFront size={48} aria-hidden="true" />}
          <span>{photo ? "车型图片暂时无法显示" : "此车型暂无参考图片"}</span>
        </div>}
      {caption && available && <figcaption>
        <span>车型参考图，非本人实车；年款配置以档案为准</span>
        <span className="photo-attribution"><a href={photo.source} target="_blank" rel="noreferrer" aria-label={`查看${photo.author}拍摄的原图`}>{photo.author}</a>
          {" · "}<a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>
          <span> · 已缩放 / WebP 转换</span></span>
      </figcaption>}
    </figure>
  );
}
