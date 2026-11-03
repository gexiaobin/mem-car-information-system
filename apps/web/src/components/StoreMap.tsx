import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin, RotateCcw } from "lucide-react";
import type { PublicConfig, Store } from "@autovoyage/shared";

export interface Point {
  lat: number;
  lng: number;
}
const PI = Math.PI;
const A = 6378245;
const EE = 0.006693421622965943;
function delta(point: Point) {
  const x = point.lng - 105;
  const y = point.lat - 35;
  let lat =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  lat += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  lat += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  lat +=
    ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  let lng =
    300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  lng += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  lng += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  lng +=
    ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  const rad = (point.lat / 180) * PI;
  const magic = 1 - EE * Math.sin(rad) ** 2;
  const root = Math.sqrt(magic);
  return {
    lat: (lat * 180) / (((A * (1 - EE)) / (magic * root)) * PI),
    lng: (lng * 180) / ((A / root) * Math.cos(rad) * PI),
  };
}
const outside = (p: Point) =>
  p.lng < 72.004 || p.lng > 137.8347 || p.lat < 0.8293 || p.lat > 55.8271;
export function toGcj(p: Point): Point {
  if (outside(p)) return p;
  const d = delta(p);
  return { lat: p.lat + d.lat, lng: p.lng + d.lng };
}
export function toWgs(p: Point): Point {
  if (outside(p)) return p;
  let result = p;
  for (let i = 0; i < 4; i++) {
    const forward = toGcj(result);
    result = {
      lat: result.lat - (forward.lat - p.lat),
      lng: result.lng - (forward.lng - p.lng),
    };
  }
  return result;
}
export const storeWgs = (s: Store): Point =>
  s.coordinateSystem === "GCJ02" ? toWgs(s) : { lat: s.lat, lng: s.lng };
export const distanceKm = (a: Point, b: Point) => {
  const rad = PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
};
declare global {
  interface Window {
    AMap?: any;
    _AMapSecurityConfig?: { securityJsCode: string };
    __autovoyageMapReady?: () => void;
  }
}
let amapLoading: Promise<any> | undefined;
function loadAMap(config: PublicConfig) {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (!config.amapKey)
    return Promise.reject(new Error("高德地图暂未配置，请使用列表查看门店。"));
  if (!amapLoading)
    amapLoading = new Promise((resolve, reject) => {
      window._AMapSecurityConfig = { securityJsCode: config.amapSecurityCode };
      const script = document.createElement("script");
      const timer = setTimeout(
        () => reject(new Error("地图加载超时，请检查网络后重试。")),
        18000,
      );
      window.__autovoyageMapReady = () => {
        clearTimeout(timer);
        resolve(window.AMap);
      };
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.amapKey)}&callback=__autovoyageMapReady`;
      script.onerror = () => {
        clearTimeout(timer);
        reject(new Error("地图服务连接失败，请使用门店列表。"));
      };
      document.head.appendChild(script);
    }).catch((e) => {
      amapLoading = undefined;
      throw e;
    });
  return amapLoading;
}
export default function StoreMap({
  config,
  stores,
  center,
  selectedId,
  onSelect,
  onMoveCenter,
}: {
  config: PublicConfig;
  stores: Store[];
  center: Point;
  selectedId: string;
  onSelect: (id: string) => void;
  onMoveCenter: (point: Point) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | any>(null);
  const markers = useRef<L.LayerGroup | any[]>([]);
  const centerMarker = useRef<any>(null);
  const [ready, setReady] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const actions = useRef({ onSelect, onMoveCenter });
  actions.current = { onSelect, onMoveCenter };
  const visibleStoresKey = stores.map((store) => store.id).join("|");
  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    setError("");
    if (config.mapProvider === "amap") {
      markers.current = [];
      loadAMap(config)
        .then((AMap) => {
          if (cancelled || !container.current) return;
          const gcj = toGcj(center);
          map.current = new AMap.Map(container.current, {
            zoom: 13,
            center: [gcj.lng, gcj.lat],
            viewMode: "2D",
          });
          map.current.on("click", (e: any) =>
            actions.current.onMoveCenter(
              toWgs({ lat: e.lnglat.lat, lng: e.lnglat.lng }),
            ),
          );
          setReady((n) => n + 1);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    } else {
      const instance = L.map(container.current, {
        zoomControl: true,
        scrollWheelZoom: false,
      }).setView([center.lat, center.lng], 13);
      map.current = instance;
      let failures = 0;
      const layer = L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
        },
      );
      layer.on("tileerror", () => {
        failures++;
        if (!cancelled && failures >= 3)
          setError("地图底图暂时无法加载，门店列表仍可使用。");
      });
      layer.on("tileload", () => {
        if (!cancelled) {
          failures = 0;
          setError("");
        }
      });
      layer.addTo(instance);
      instance.on("click", (e: L.LeafletMouseEvent) =>
        actions.current.onMoveCenter(e.latlng),
      );
      markers.current = L.layerGroup().addTo(instance);
      setReady((n) => n + 1);
    }
    const observer = new ResizeObserver(() => {
      if (map.current && config.mapProvider === "osm")
        map.current.invalidateSize();
    });
    observer.observe(container.current);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (map.current) {
        config.mapProvider === "amap"
          ? map.current.destroy()
          : map.current.remove();
        map.current = null;
      }
      centerMarker.current = null;
    };
  }, [config.mapProvider, config.amapKey, config.amapSecurityCode, attempt]);
  useEffect(() => {
    if (!map.current || !ready) return;
    if (config.mapProvider === "amap") {
      const AMap = window.AMap;
      const old = markers.current as any[];
      old.forEach((m) => map.current.remove(m));
      markers.current = stores.map((store, i) => {
        const p = toGcj(storeWgs(store));
        const element = document.createElement("button");
        element.className = `map-number ${store.id === selectedId ? "active" : ""}`;
        element.textContent = String(i + 1);
        element.setAttribute("aria-label", `选择${store.name}`);
        const marker = new AMap.Marker({
          position: [p.lng, p.lat],
          content: element,
          anchor: "center",
        });
        marker.on("click", () => actions.current.onSelect(store.id));
        map.current.add(marker);
        return marker;
      });
    } else {
      const group = markers.current as L.LayerGroup;
      group.clearLayers();
      stores.forEach((store, i) => {
        const p = storeWgs(store);
        const marker = L.marker([p.lat, p.lng], {
          bubblingMouseEvents: false,
          icon: L.divIcon({
            className: "map-marker-wrapper",
            html: `<span class="map-number ${store.id === selectedId ? "active" : ""}">${i + 1}</span>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
          }),
          keyboard: true,
          title: store.name,
        });
        const tooltip = document.createElement("span");
        tooltip.textContent = store.name;
        marker.bindTooltip(tooltip);
        marker.on("click", () => actions.current.onSelect(store.id));
        marker.addTo(group);
      });
    }
  }, [stores, selectedId, ready, config.mapProvider]);
  useEffect(() => {
    if (!map.current || !ready) return;
    if (centerMarker.current) {
      config.mapProvider === "amap"
        ? map.current.remove(centerMarker.current)
        : centerMarker.current.remove();
    }
    if (config.mapProvider === "amap") {
      const p = toGcj(center);
      centerMarker.current = new window.AMap.CircleMarker({
        center: [p.lng, p.lat],
        radius: 8,
        fillColor: "#003288",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 3,
      });
      map.current.add(centerMarker.current);
      map.current.setCenter([p.lng, p.lat]);
      if (stores.length && !stores.some((store) => store.id === selectedId)) {
        map.current.setFitView(
          [...(markers.current as any[]), centerMarker.current],
          false,
          [45, 40, 55, 40],
          13,
        );
      }
    } else {
      centerMarker.current = L.circleMarker([center.lat, center.lng], {
        radius: 7,
        color: "white",
        weight: 3,
        fillColor: "#003288",
        fillOpacity: 1,
      }).addTo(map.current);
      map.current.panTo([center.lat, center.lng]);
      if (stores.length && !stores.some((store) => store.id === selectedId)) {
        const bounds = L.latLngBounds(
          [center.lat, center.lng],
          [center.lat, center.lng],
        );
        stores.forEach((store) => {
          const point = storeWgs(store);
          bounds.extend([point.lat, point.lng]);
        });
        map.current.fitBounds(bounds, {
          padding: [35, 50],
          maxZoom: 13,
          animate: false,
        });
      }
    }
  }, [center.lat, center.lng, ready, config.mapProvider, visibleStoresKey]);
  useEffect(() => {
    const store = stores.find((s) => s.id === selectedId);
    if (!store || !map.current || !ready) return;
    if (config.mapProvider === "amap") {
      const p = toGcj(storeWgs(store));
      map.current.panTo([p.lng, p.lat]);
    } else {
      const p = storeWgs(store);
      map.current.panTo([p.lat, p.lng]);
    }
  }, [selectedId, ready]);
  return (
    <div className="map-frame">
      <div
        ref={container}
        className="map-canvas"
        aria-label="服务门店地图，点击地图选择搜索位置"
      />
      {error && (
        <div className="map-error" role="status">
          <MapPin size={18} />
          <span>{error}</span>
          <button className="text-btn" onClick={() => setAttempt((n) => n + 1)}>
            <RotateCcw size={15} />
            重试
          </button>
        </div>
      )}
      <div className="map-caption">
        蓝点为搜索中心 · {stores.length} 家门店 · 点击地图可换位置
      </div>
    </div>
  );
}
