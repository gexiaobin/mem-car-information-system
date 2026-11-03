import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { LoaderCircle, MapPin, RotateCcw } from "lucide-react";
import type { PublicConfig, Store } from "@autovoyage/shared";
import "./StoreMap.css";

// MapLibre's relative default worker URL does not survive Vite's bundling.
// Let Vite emit a versioned worker asset and serve it from the app's own origin.
maplibregl.setWorkerUrl(mapWorkerUrl);

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
      const fail = (message: string) => {
        clearTimeout(timer);
        script.remove();
        delete window.__autovoyageMapReady;
        reject(new Error(message));
      };
      const timer = setTimeout(() => fail("地图加载超时，请检查网络后重试。"), 18000);
      window.__autovoyageMapReady = () => {
        clearTimeout(timer);
        delete window.__autovoyageMapReady;
        resolve(window.AMap);
      };
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.amapKey)}&callback=__autovoyageMapReady`;
      script.onerror = () => fail("地图服务连接失败，请使用门店列表。");
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
  const map = useRef<maplibregl.Map | any>(null);
  const markers = useRef<any[]>([]);
  const centerMarker = useRef<any>(null);
  const [ready, setReady] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const actions = useRef({ onSelect, onMoveCenter });
  actions.current = { onSelect, onMoveCenter };
  const visibleStoresKey = stores.map((store) => store.id).join("|");
  useEffect(() => {
    if (!container.current) return;
    let cancelled = false;
    let loadTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (message: string) => {
      if (cancelled) return;
      clearTimeout(loadTimer);
      setError(message);
      setPhase("error");
    };
    const beginLoading = () => {
      clearTimeout(loadTimer);
      if (!cancelled) {
        setError("");
        setPhase("loading");
      }
      loadTimer = setTimeout(() => fail("底图加载超时，请重试；门店列表仍可使用。"), 25000);
    };
    const loaded = () => {
      clearTimeout(loadTimer);
      if (!cancelled) {
        setError("");
        setPhase("ready");
      }
    };
    setError("");
    beginLoading();
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
          map.current.on("complete", loaded);
          setReady((n) => n + 1);
        })
        .catch((e) => {
          clearTimeout(loadTimer);
          fail(e.message);
        });
    } else {
      try {
        const instance = new maplibregl.Map({
          container: container.current,
          style: "https://tiles.openfreemap.org/styles/liberty",
          center: [center.lng, center.lat],
          zoom: 13,
          maxZoom: 19,
          attributionControl: false,
          scrollZoom: false,
          dragRotate: false,
          pitchWithRotate: false,
          locale: {
            "NavigationControl.ZoomIn": "放大地图",
            "NavigationControl.ZoomOut": "缩小地图",
            "AttributionControl.ToggleAttribution": "地图数据来源",
          },
        });
        map.current = instance;
        markers.current = [];
        instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
        instance.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");
        instance.getCanvas().setAttribute("aria-label", "门店地图，可拖动或使用缩放按钮浏览");
        let hasMapData = false;
        let hadErrors = false;
        const reportResourceError = () => fail(hasMapData
          ? "部分地图未加载完整，请重试；门店列表仍可使用。"
          : "地图底图暂时无法加载，请检查网络后重试；门店列表仍可使用。");
        instance.on("sourcedata", (event) => {
          if (event.tile) {
            hasMapData = true;
            if (hadErrors) reportResourceError();
          }
        });
        instance.on("error", () => {
          hadErrors = true;
          reportResourceError();
        });
        instance.on("idle", () => {
          if (!hadErrors && hasMapData) loaded();
        });
        instance.on("movestart", () => {
          // A new viewport starts a new resource batch.
          hadErrors = false;
          beginLoading();
        });
        instance.on("webglcontextlost", () => {
          hadErrors = true;
          fail("地图绘制已中断，请重试；也可继续使用门店列表。");
        });
        instance.on("click", (event) =>
          actions.current.onMoveCenter({ lat: event.lngLat.lat, lng: event.lngLat.lng }),
        );
        setReady((n) => n + 1);
      } catch {
        fail("当前浏览器无法绘制地图，请启用硬件加速或更换浏览器后重试；门店列表仍可使用。");
      }
    }
    const observer = new ResizeObserver(() => {
      if (map.current && config.mapProvider === "osm")
        map.current.resize();
    });
    observer.observe(container.current);
    return () => {
      cancelled = true;
      clearTimeout(loadTimer);
      observer.disconnect();
      if (map.current) {
        if (config.mapProvider === "amap") {
          map.current.destroy();
        } else {
          markers.current.forEach((marker) => marker.remove());
          if (centerMarker.current) centerMarker.current.remove();
          map.current.remove();
        }
        markers.current = [];
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
        element.type = "button";
        element.className = `map-number ${store.id === selectedId ? "active" : ""}`;
        element.textContent = String(i + 1);
        element.setAttribute("aria-label", `选择${store.name}`);
        element.setAttribute("aria-pressed", String(store.id === selectedId));
        element.title = store.name;
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          actions.current.onSelect(store.id);
        });
        const marker = new AMap.Marker({
          position: [p.lng, p.lat],
          content: element,
          anchor: "center",
        });
        map.current.add(marker);
        return marker;
      });
    } else {
      markers.current.forEach((marker) => marker.remove());
      markers.current = stores.map((store, i) => {
        const p = storeWgs(store);
        const element = document.createElement("button");
        element.type = "button";
        element.className = `map-number ${store.id === selectedId ? "active" : ""}`;
        element.textContent = String(i + 1);
        element.setAttribute("aria-label", `选择${store.name}`);
        element.setAttribute("aria-pressed", String(store.id === selectedId));
        element.title = store.name;
        element.style.zIndex = store.id === selectedId ? "2" : "1";
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          actions.current.onSelect(store.id);
        });
        return new maplibregl.Marker({ element })
          .setLngLat([p.lng, p.lat])
          .addTo(map.current);
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
      const element = document.createElement("span");
      element.className = "map-center-dot";
      element.setAttribute("aria-hidden", "true");
      centerMarker.current = new maplibregl.Marker({ element })
        .setLngLat([center.lng, center.lat])
        .addTo(map.current);
      map.current.panTo([center.lng, center.lat], { duration: 0 });
      if (stores.length && !stores.some((store) => store.id === selectedId)) {
        const bounds = new maplibregl.LngLatBounds(
          [center.lng, center.lat],
          [center.lng, center.lat],
        );
        stores.forEach((store) => {
          const point = storeWgs(store);
          bounds.extend([point.lng, point.lat]);
        });
        map.current.fitBounds(bounds, {
          padding: { top: 60, right: 35, bottom: 90, left: 35 },
          maxZoom: 13,
          duration: 0,
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
      map.current.panTo([p.lng, p.lat], {
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 350,
      });
    }
  }, [selectedId, ready]);
  return (
    <div className="map-frame" data-map-state={phase}>
      <div
        ref={container}
        className="map-canvas"
        aria-label="服务门店地图，点击地图选择搜索位置"
        aria-busy={phase === "loading"}
      />
      {phase === "loading" && (
        <div className="map-loading" role="status">
          <LoaderCircle size={17} aria-hidden="true" />
          <span>正在加载地图…</span>
        </div>
      )}
      {error && (
        <div className="map-error" role="status">
          <MapPin size={18} aria-hidden="true" />
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
