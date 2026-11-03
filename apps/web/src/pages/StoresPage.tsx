import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  MapPin,
  LocateFixed,
  Search,
  SlidersHorizontal,
  ArrowRight,
  Navigation,
  Clock3,
  Check,
  ShieldCheck,
  X,
  CalendarDays,
  ChevronRight,
} from "lucide-react";
import type {
  Appointment,
  Bootstrap,
  Offer,
  Slot,
  Store,
  Vehicle,
} from "@autovoyage/shared";
import { cents } from "@autovoyage/shared";
import { api, post } from "../lib/api";
import { StoreIllustration } from "../components/StoreIllustration";
import StoreMap, {
  distanceKm,
  storeWgs,
  type Point,
} from "../components/StoreMap";
import {
  Modal,
  ErrorBox,
  Empty,
  DemoTag,
  dateInput,
  dateText,
  messageOf,
  Loading,
} from "../components/UI";

const referenceCenter = { lat: 36.0671, lng: 120.3826 };
function createRequestId() {
  if (typeof globalThis.crypto.randomUUID === "function")
    return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
const storeType = (store: Store) =>
  store.type === "4s"
    ? "已审核4S店"
    : store.type === "chain"
      ? "连锁服务"
      : "综合维修";
const scopeOf = (offer: Offer) =>
  JSON.stringify([
    offer.materialSpec,
    offer.includes,
    offer.excludes,
    offer.taxIncluded,
  ]);
const validOn = (offer: Offer, day: string) =>
  offer.active &&
  offer.validFrom.slice(0, 10) <= day &&
  offer.validTo.slice(0, 10) >= day;
export default function StoresPage({
  data,
  vehicle: selectedVehicle,
  onSelectVehicle,
  onRefresh,
  onSuccess,
}: {
  data: Bootstrap;
  vehicle?: Vehicle;
  onSelectVehicle: (id: string) => void;
  onRefresh: () => Promise<void>;
  onSuccess: (text: string) => void;
}) {
  const [params] = useSearchParams();
  const [projectIds, setProjectIds] = useState<string[]>(() =>
    [
      params.get("fault")
        ? data.projects.find((p) => p.category === "diagnosis")?.id ||
          "project-diagnosis"
        : params.get("project") ||
          data.projects.find((p) => p.active && p.category !== "diagnosis")
            ?.id ||
          "",
    ].filter(Boolean),
  );
  const [day, setDay] = useState(() => {
    const upcoming = data.slots
      .filter(
        (slot) => slot.active && new Date(slot.startsAt).getTime() > Date.now(),
      )
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
    return upcoming ? dateInput(new Date(upcoming.startsAt)) : dateInput();
  });
  const [selectedScopes, setSelectedScopes] = useState<Record<string, string>>(
    {},
  );
  const [sort, setSort] = useState("distance");
  const [type, setType] = useState("all");
  const [range, setRange] = useState("all");
  const [search, setSearch] = useState("");
  const [center, setCenter] = useState<Point>(referenceCenter);
  const [centerLabel, setCenterLabel] = useState("青岛市中心 · 搜索参考位置");
  const [selectedId, setSelectedId] = useState(params.get("store") || "");
  const [showMap, setShowMap] = useState(true);
  const [positionModal, setPositionModal] = useState(false);
  const [booking, setBooking] = useState<{
    store: Store;
    offers: Offer[];
    missing: string[];
    complete: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);
  const [dateOffers, setDateOffers] = useState<Offer[]>([]);
  const [offersDate, setOffersDate] = useState("");
  const [offersLoading, setOffersLoading] = useState(true);
  const [offersError, setOffersError] = useState("");
  const [offersAttempt, setOffersAttempt] = useState(0);
  const fault = data.faults.find((f) => f.id === params.get("fault"));
  const vehicle = fault
    ? data.vehicles.find((v) => v.id === fault.vehicleId)
    : selectedVehicle;
  useEffect(() => {
    if (fault) {
      setProjectIds([
        data.projects.find((p) => p.category === "diagnosis")?.id ||
          "project-diagnosis",
      ]);
      setSelectedScopes({});
      setSort("distance");
    }
  }, [fault?.id]);
  useEffect(() => {
    if (fault) return;
    const activeProjects = data.projects.filter((project) => project.active);
    const activeIds = new Set(activeProjects.map((project) => project.id));
    const nextIds = projectIds.filter((id) => activeIds.has(id));
    if (!nextIds.length) {
      const fallback =
        activeProjects.find((project) => project.category !== "diagnosis") ||
        activeProjects[0];
      if (fallback) nextIds.push(fallback.id);
    }
    if (
      nextIds.length === projectIds.length &&
      nextIds.every((id, index) => id === projectIds[index])
    )
      return;
    setProjectIds(nextIds);
    setSelectedScopes((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([id]) => nextIds.includes(id)),
      ),
    );
    setSort("distance");
    setBooking(null);
  }, [data.projects, fault?.id, projectIds]);
  useEffect(() => {
    const controller = new AbortController();
    setOffersLoading(true);
    setOffersError("");
    api<Offer[]>(`/offers?date=${encodeURIComponent(day)}`, {
      signal: controller.signal,
    })
      .then((offers) => {
        setDateOffers(offers);
        setOffersDate(day);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setDateOffers([]);
          setOffersError(messageOf(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setOffersLoading(false);
      });
    return () => controller.abort();
  }, [day, data.offers, offersAttempt]);
  const priceReady = !offersLoading && offersDate === day && !offersError;
  const matchingOffers = (priceReady ? dateOffers : []).filter(
    (offer) =>
      offer.modelId === vehicle?.modelId &&
      projectIds.includes(offer.projectId) &&
      validOn(offer, day),
  );
  const comparisonReady =
    projectIds.length > 0 &&
    projectIds.every((projectId) => !!selectedScopes[projectId]);
  const schemes = projectIds.map((projectId) => ({
    projectId,
    name:
      data.projects.find((project) => project.id === projectId)?.name ||
      "服务项目",
    options: [
      ...new Map(
        matchingOffers
          .filter(
            (offer) =>
              offer.projectId === projectId && offer.priceType === "fixed",
          )
          .map((offer) => [scopeOf(offer), offer]),
      ).entries(),
    ],
  }));
  const results = useMemo(
    () =>
      !priceReady
        ? []
        : data.stores
            .filter(
              (store) =>
                store.approved &&
                (!fault || store.id === fault.storeId) &&
                (type === "all" || store.type === type) &&
                `${store.name}${store.address}`.includes(search),
            )
            .map((store) => {
              const offers: Offer[] = [];
              const missing: string[] = [];
              for (const projectId of projectIds) {
                const options = matchingOffers
                  .filter(
                    (offer) =>
                      offer.storeId === store.id &&
                      offer.projectId === projectId &&
                      (!selectedScopes[projectId] ||
                        scopeOf(offer) === selectedScopes[projectId]),
                  )
                  .sort(
                    (a, b) =>
                      (a.priceType === "fixed" ? 0 : 1) -
                        (b.priceType === "fixed" ? 0 : 1) ||
                      (a.totalCents ?? Infinity) - (b.totalCents ?? Infinity),
                  );
                if (options[0]) offers.push(options[0]);
                else missing.push(projectId);
              }
              const complete =
                projectIds.length > 0 &&
                offers.length === projectIds.length &&
                offers.every(
                  (offer) =>
                    offer.priceType === "fixed" && offer.totalCents !== null,
                );
              return {
                store,
                offers,
                missing,
                complete,
                totalCents: complete
                  ? offers.reduce((sum, offer) => sum + offer.totalCents!, 0)
                  : null,
                distance: distanceKm(center, storeWgs(store)),
              };
            })
            .filter((item) => range === "all" || item.distance <= Number(range))
            .sort(
              (a, b) =>
                Number(b.complete) - Number(a.complete) ||
                (sort === "price" && comparisonReady && a.complete && b.complete
                  ? a.totalCents! - b.totalCents!
                  : 0) ||
                a.distance - b.distance ||
                a.store.id.localeCompare(b.store.id),
            ),
    [
      data.stores,
      dateOffers,
      priceReady,
      vehicle?.modelId,
      projectIds,
      day,
      selectedScopes,
      sort,
      type,
      range,
      search,
      center,
      fault?.id,
      comparisonReady,
    ],
  );
  const locate = () => {
    setLocating(true);
    setError("");
    if (!navigator.geolocation) {
      setError("当前浏览器不支持定位，请手动选择搜索位置。");
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCenter({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setCenterLabel("当前位置 · 本次查询使用");
        setLocating(false);
      },
      () => {
        setError("未能获取位置，你仍可点击地图或手动选择搜索位置。");
        setLocating(false);
      },
      { timeout: 12000, maximumAge: 60000, enableHighAccuracy: false },
    );
  };
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">GOOD CARE, CLOSE TO YOU</p>
          <h1>
            好服务，就在身边<span className="title-dot">。</span>
          </h1>
          <p>同一项目，同一方案。把价格看清楚，再作选择。</p>
        </div>
        <div className="store-map-actions">
          {vehicle && <button className="btn btn-secondary" onClick={() => {
            setShowMap(true);
            requestAnimationFrame(() => document.getElementById("store-map")?.scrollIntoView({
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
              block: "start",
            }));
          }}>
            <MapPin size={17} />查看门店地图
          </button>}
          <button
            className="btn btn-secondary"
            onClick={locate}
            disabled={locating}
          >
            <LocateFixed size={17} />
            {locating ? "正在定位…" : "使用我的位置"}
          </button>
        </div>
      </div>
      <ErrorBox message={error} />
      {offersError && (
        <div className="feedback feedback-error" role="alert">
          <span>{offersError}</span>
          <button
            className="text-btn"
            onClick={() => setOffersAttempt((value) => value + 1)}
          >
            重试价格查询
          </button>
        </div>
      )}
      {fault && (
        <div className="feedback feedback-info">
          <ShieldCheck size={19} />
          <span>
            已关联故障咨询：{fault.title}
            。仅可预约原车辆在该店的到店诊断服务；固定诊断费用不包含后续维修总价。
          </span>
        </div>
      )}
      {!vehicle ? (
        <section className="card">
          <Empty
            title="请先建立车辆档案"
            text="我们需要知道你的车型，才能展示适配的服务与价格。"
          />
        </section>
      ) : (
        <>
          <section className="card search-panel">
            <div className="search-panel-top">
              <button
                className="search-location"
                onClick={() => setPositionModal(true)}
              >
                <MapPin size={19} />
                <span>
                  {centerLabel}
                  <small>直线距离参考点，支持点击地图调整</small>
                </span>
                <ChevronRight size={16} />
              </button>
              <label className="store-search">
                <Search size={18} />
                <span className="sr-only">搜索门店或地址</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索门店名称、地址"
                />
              </label>
            </div>
            <div className="store-filters">
              <label>
                我的爱车
                <select
                  disabled={!!fault}
                  value={vehicle.id}
                  onChange={(e) => {
                    onSelectVehicle(e.target.value);
                    setSelectedScopes({});
                    setSort("distance");
                  }}
                >
                  {data.vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.plate}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                服务日期
                <input
                  type="date"
                  value={day}
                  min={dateInput()}
                  onChange={(e) => setDay(e.target.value)}
                />
              </label>
              <fieldset className="project-group-filter">
                <legend>本次服务项目（可多选）</legend>
                <div className="project-choice-chips">
                  {data.projects
                    .filter(
                      (project) =>
                        project.active &&
                        (!fault || project.category === "diagnosis"),
                    )
                    .map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        aria-pressed={projectIds.includes(project.id)}
                        className={
                          projectIds.includes(project.id) ? "selected" : ""
                        }
                        disabled={!!fault}
                        onClick={() => {
                          setProjectIds((ids) =>
                            ids.includes(project.id)
                              ? ids.length > 1
                                ? ids.filter((id) => id !== project.id)
                                : ids
                              : [...ids, project.id],
                          );
                          setSort("distance");
                        }}
                      >
                        {projectIds.includes(project.id) && <Check size={14} />}{" "}
                        {project.name}
                      </button>
                    ))}
                </div>
              </fieldset>
              {schemes.map((scheme) => (
                <label
                  className="scheme-filter bundle-scheme"
                  key={scheme.projectId}
                >
                  {scheme.name} · 材料与范围
                  <select
                    value={selectedScopes[scheme.projectId] || ""}
                    onChange={(event) => {
                      setSelectedScopes((previous) => ({
                        ...previous,
                        [scheme.projectId]: event.target.value,
                      }));
                      if (!event.target.value) setSort("distance");
                    }}
                  >
                    <option value="">各店方案分别查看（未锁定比价口径）</option>
                    {scheme.options.map(([key, offer]) => (
                      <option value={key} key={key}>
                        {offer.materialSpec} ·{" "}
                        {offer.taxIncluded ? "含税" : "未含税"} ·{" "}
                        {offer.includes} · 不含：{offer.excludes || "无"}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="store-subfilters">
              <div className="segmented">
                {[
                  { value: "all", label: "全部门店" },
                  { value: "chain", label: "连锁服务" },
                  { value: "independent", label: "综合维修" },
                  { value: "4s", label: "4S店" },
                ].map((item) => (
                  <button
                    key={item.value}
                    aria-pressed={type === item.value}
                    className={type === item.value ? "active" : ""}
                    onClick={() => setType(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <label className="compact-filter">
                <span className="sr-only">距离范围</span>
                <select
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                >
                  <option value="all">不限距离</option>
                  <option value="3">3 km内</option>
                  <option value="5">5 km内</option>
                  <option value="10">10 km内</option>
                  <option value="30">30 km内</option>
                </select>
              </label>
            </div>
          </section>
          <div className="results-toolbar">
            <p>
              <strong>
                {results.filter((result) => result.complete).length}
              </strong>{" "}
              家完整报价门店{" "}
              {results.some((result) => !result.complete) && (
                <span>
                  {" "}
                  · 另有 {
                    results.filter((result) => !result.complete).length
                  }{" "}
                  家部分支持 / 需询价
                </span>
              )}
              <span>
                ·{" "}
                {comparisonReady
                  ? `已锁定${projectIds.length}项完整比价口径`
                  : "请为每个项目锁定材料、范围与税费口径"}
              </span>
            </p>
            <div>
              <label className="compact-filter">
                <span className="sr-only">排序方式</span>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="distance">直线距离优先</option>
                  <option value="price" disabled={!comparisonReady}>
                    同口径固定总价优先
                    {!comparisonReady ? "（先锁定各项方案）" : ""}
                  </option>
                </select>
              </label>
              <button
                className="btn btn-secondary map-toggle"
                aria-label={showMap ? "隐藏地图，查看列表" : "显示门店地图"}
                aria-pressed={showMap}
                onClick={() => setShowMap(!showMap)}
              >
                <MapPin size={19} />
                {showMap ? "隐藏地图" : "显示地图"}
              </button>
            </div>
          </div>
          <div className={`store-results ${!showMap ? "list-only" : ""}`}>
            <div className="store-result-list">
              {!priceReady && !offersError ? (
                <section className="card">
                  <Loading label="正在查询所选服务日的有效价格…" />
                </section>
              ) : results.length ? (
                results.map(
                  (
                    { store, offers, missing, complete, totalCents, distance },
                    index,
                  ) => (
                    <Fragment key={store.id}>
                      {!complete &&
                        (index === 0 || results[index - 1].complete) && (
                          <div className="partial-results-heading">
                            部分支持 / 需询价 · 不参与完整总价比较
                          </div>
                        )}
                      <article
                        className={`card store-card ${selectedId === store.id ? "selected" : ""}`}
                        id={`store-${store.id}`}
                        key={store.id}
                      >
                        <div className="store-card-top">
                          <button
                            className="store-image store-art-tile"
                            aria-label={`在地图查看${store.name}`}
                            onClick={() => setSelectedId(store.id)}
                          >
                            <span className="store-marker-number">
                              {index + 1}
                            </span>
                            <StoreIllustration type={store.type} />
                          </button>
                          <div className="store-card-info">
                            <button
                              className="store-name-button"
                              onClick={() => setSelectedId(store.id)}
                            >
                              <h2>{store.name}</h2>
                            </button>
                            <div className="store-tags">
                              <span className="badge badge-neutral">
                                {storeType(store)}
                              </span>
                              {store.isDemo && <DemoTag />}
                            </div>
                            <p>
                              <MapPin size={14} />
                              {store.address}
                            </p>
                            <p>
                              <Clock3 size={14} />
                              {store.hours}{" "}
                              <span>· 直线 {distance.toFixed(1)} km</span>
                            </p>
                          </div>
                        </div>
                        <div className="bundle-quote-items">
                          {offers.map((offer) => (
                            <div key={offer.id}>
                              <span>
                                <strong>{offer.title}</strong>
                                <small>{offer.materialSpec}</small>
                                <small>
                                  {offer.taxIncluded ? "含税" : "未含税"} ·{" "}
                                  {offer.includes}
                                </small>
                              </span>
                              <span className="bundle-line-price">
                                {offer.priceType === "fixed"
                                  ? cents(offer.totalCents)
                                  : offer.priceType === "estimate"
                                    ? `${cents(offer.lowCents)}–${cents(offer.highCents)}`
                                    : "需询价"}
                                {offer.priceType !== "fixed" && (
                                  <small>
                                    {offer.priceType === "estimate"
                                      ? "预估区间"
                                      : "非确定总价"}
                                  </small>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                        {missing.length > 0 && (
                          <div className="bundle-missing">
                            未支持所选项目或材料方案：
                            {missing
                              .map(
                                (id) =>
                                  data.projects.find(
                                    (project) => project.id === id,
                                  )?.name || id,
                              )
                              .join("、")}
                          </div>
                        )}
                        <div className="bundle-total">
                          <span
                            className={`badge ${complete ? "badge-success" : "badge-warning"}`}
                          >
                            {complete
                              ? `完整 ${projectIds.length} 项固定报价`
                              : "报价不完整"}
                          </span>
                          <span>
                            <strong>
                              {complete ? cents(totalCents) : "需补充报价"}
                            </strong>
                            <small>
                              {complete
                                ? comparisonReady
                                  ? "所选完整项目组总价"
                                  : "以上所示方案总额，口径尚未锁定"
                                : "缺项与询价不计作零元"}
                            </small>
                          </span>
                        </div>
                        <div className="store-card-bottom">
                          <span>
                            <ShieldCheck size={14} />
                            预约保留价格快照
                          </span>
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={!!fault && !fault.confirmed}
                            onClick={() => {
                              setSelectedId(store.id);
                              setBooking({ store, offers, missing, complete });
                            }}
                          >
                            查看项目明细{complete && "与预约"}
                            <ArrowRight size={15} />
                          </button>
                        </div>
                      </article>
                    </Fragment>
                  ),
                )
              ) : (
                <section className="card">
                  <Empty
                    title="暂未找到匹配门店"
                    text="试试放宽距离、日期或材料方案，也可以选择其他保养项目。"
                  >
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setRange("all");
                        setSelectedScopes({});
                        setType("all");
                        setSearch("");
                      }}
                    >
                      重置筛选条件
                    </button>
                  </Empty>
                </section>
              )}
            </div>
            {showMap && (
              <div className="store-map-column" id="store-map">
                <StoreMap
                  config={data.config}
                  stores={results.map((item) => item.store)}
                  center={center}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    setSelectedId(id);
                    document.getElementById(`store-${id}`)?.scrollIntoView({
                      behavior: window.matchMedia(
                        "(prefers-reduced-motion: reduce)",
                      ).matches
                        ? "auto"
                        : "smooth",
                      block: "nearest",
                    });
                  }}
                  onMoveCenter={(point) => {
                    setCenter(point);
                    setCenterLabel("地图选点 · 搜索参考位置");
                  }}
                />
                <p className="map-privacy">
                  <LocateFixed size={14} />
                  位置仅用于本次找店查询，不持续追踪。
                </p>
              </div>
            )}
          </div>
          {booking && (
            <BookingModal
              data={data}
              vehicle={vehicle}
              store={booking.store}
              offers={booking.offers.map(
                (old) => dateOffers.find((offer) => offer.id === old.id) || old,
              )}
              missingNames={booking.missing.map(
                (id) =>
                  data.projects.find((project) => project.id === id)?.name ||
                  id,
              )}
              complete={booking.complete}
              priceReady={
                priceReady &&
                booking.offers.length === projectIds.length &&
                booking.offers.every((old) =>
                  dateOffers.some((offer) => offer.id === old.id),
                )
              }
              day={day}
              faultId={fault?.id}
              onClose={() => setBooking(null)}
              onRefresh={onRefresh}
              onBooked={async () => {
                setBooking(null);
                await onRefresh();
                onSuccess("预约已提交，等待门店确认");
              }}
            />
          )}
        </>
      )}
      {positionModal && (
        <Modal
          title="设置搜索参考位置"
          subtitle="输入 WGS84 经纬度，或回到地图点击选择。"
          onClose={() => setPositionModal(false)}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setCenter({
                lat: Number(form.get("lat")),
                lng: Number(form.get("lng")),
              });
              setCenterLabel(
                String(form.get("label") || "手选位置") + " · 搜索参考位置",
              );
              setPositionModal(false);
            }}
          >
            <label>
              位置名称
              <input name="label" defaultValue="青岛市中心" maxLength={40} />
            </label>
            <div className="form-grid">
              <label>
                纬度
                <input
                  type="number"
                  name="lat"
                  min="-85"
                  max="85"
                  step="any"
                  required
                  defaultValue={center.lat}
                />
              </label>
              <label>
                经度
                <input
                  type="number"
                  name="lng"
                  min="-180"
                  max="180"
                  step="any"
                  required
                  defaultValue={center.lng}
                />
              </label>
            </div>
            <button className="btn btn-primary">使用这个参考位置</button>
            <button
              className="text-btn"
              type="button"
              onClick={() => {
                setCenter(referenceCenter);
                setCenterLabel("青岛市中心 · 搜索参考位置");
                setPositionModal(false);
              }}
            >
              使用青岛市中心
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}

function BookingModal({
  data,
  vehicle,
  store,
  offers,
  missingNames,
  complete,
  day,
  faultId,
  priceReady,
  onClose,
  onRefresh,
  onBooked,
}: {
  data: Bootstrap;
  vehicle: Vehicle;
  store: Store;
  offers: Offer[];
  missingNames: string[];
  complete: boolean;
  day: string;
  faultId?: string;
  priceReady: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onBooked: () => Promise<void>;
}) {
  const [slotId, setSlotId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(createRequestId);
  const [confirmed, setConfirmed] = useState(false);
  const signature = offers
    .map(
      (offer) =>
        `${offer.id}:${offer.version}:${offer.priceType}:${offer.totalCents}`,
    )
    .join("|");
  useEffect(() => {
    setConfirmed(false);
    setRequestId(createRequestId());
  }, [signature, day]);
  const availableSlots = data.slots
    .filter(
      (slot) =>
        slot.storeId === store.id &&
        slot.active &&
        new Date(slot.startsAt).getTime() > Date.now() &&
        dateInput(new Date(slot.startsAt)) === day,
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const model = data.models.find((model) => model.id === vehicle.modelId);
  const canBook =
    complete &&
    offers.length > 0 &&
    offers.every(
      (offer) => offer.priceType === "fixed" && offer.totalCents !== null,
    );
  const totalCents = offers.reduce(
    (sum, offer) => sum + (offer.totalCents || 0),
    0,
  );
  const submit = async () => {
    if (!priceReady || !canBook) {
      setError("项目组报价不完整或尚未核验，请重新确认。");
      return;
    }
    if (!slotId) {
      setError("请选择一个可预约时段。");
      return;
    }
    if (!confirmed) {
      setError("请核对全部项目、材料规格和完整总价。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await post<Appointment>("/appointments", {
        vehicleId: vehicle.id,
        offerIds: offers.map((offer) => offer.id),
        slotId,
        expectedVersions: Object.fromEntries(
          offers.map((offer) => [offer.id, offer.version]),
        ),
        requestId,
        ...(faultId ? { faultId } : {}),
      });
      await onBooked();
    } catch (error) {
      setError(messageOf(error));
      await onRefresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="确认这一程的服务"
      subtitle={`${store.name}${store.isDemo ? " · 演示门店与报价" : ""}`}
      onClose={onClose}
      wide
    >
      <div className="booking-layout">
        <div>
          <div className="booking-service">
            <span className="eyebrow">COMPLETE SERVICE PLAN</span>
            <h3>{offers.length} 项服务 · 逐项核对</h3>
            <span className="badge badge-blue">
              {model?.brand} {model?.name} · {model?.year}款
            </span>
            <p>
              {vehicle.plate} · 服务日 {day}
            </p>
          </div>
          {offers.map((offer) => (
            <section className="booking-bundle-item" key={offer.id}>
              <div>
                <h3>{offer.title}</h3>
                <span className="badge badge-neutral">
                  价格版本 {offer.version}
                </span>
              </div>
              <p>{offer.materialSpec}</p>
              <dl className="detail-list">
                <div>
                  <dt>包含范围</dt>
                  <dd>{offer.includes}</dd>
                </div>
                <div>
                  <dt>不包含</dt>
                  <dd>{offer.excludes || "无额外说明"}</dd>
                </div>
                <div>
                  <dt>税费口径</dt>
                  <dd>{offer.taxIncluded ? "含税" : "未含税，请核对税费"}</dd>
                </div>
                <div>
                  <dt>有效期</dt>
                  <dd>
                    {dateText(offer.validFrom)} — {dateText(offer.validTo)}
                  </dd>
                </div>
              </dl>
              <div className="bundle-item-prices">
                <span>材料 {cents(offer.materialCents)}</span>
                <span>工时 {cents(offer.laborCents)}</span>
                <span>其他 {cents(offer.otherCents)}</span>
              </div>
              <div className="bundle-item-total">
                <span>
                  {offer.priceType === "fixed"
                    ? "项目固定总价"
                    : offer.priceType === "estimate"
                      ? "预估区间"
                      : "报价状态"}
                </span>
                <strong>
                  {offer.priceType === "fixed"
                    ? cents(offer.totalCents)
                    : offer.priceType === "estimate"
                      ? `${cents(offer.lowCents)}–${cents(offer.highCents)}`
                      : "需询价"}
                </strong>
              </div>
            </section>
          ))}
          {missingNames.length > 0 && (
            <div className="feedback feedback-warning">
              尚未支持所选项目或材料方案：{missingNames.join("、")}
              。缺项不能作为零元参与总价。
            </div>
          )}
          <div className="price-breakdown">
            <div>
              <span>门店电话</span>
              <a href={`tel:${store.phone}`}>{store.phone}</a>
            </div>
            <div className="price-total">
              <span>所选完整项目组总价</span>
              <strong>{canBook ? cents(totalCents) : "报价不完整"}</strong>
            </div>
          </div>
        </div>
        <div className="booking-choice">
          {!priceReady && canBook && (
            <div className="feedback feedback-warning">
              正在核验所选服务日的有效报价。核验完成前不能提交。
            </div>
          )}
          <h3>
            <CalendarDays size={19} />
            选择服务时段
          </h3>
          <p className="muted">{day} · 北京时间</p>
          {!canBook ? (
            <div className="feedback feedback-warning">
              当前项目组包含缺项、预估或需询价项目，不能作为确定总价预约。请更换门店或调整项目，并核对完整固定报价。
            </div>
          ) : (
            <>
              {availableSlots.length ? (
                <div className="slot-grid">
                  {availableSlots.map((slot) => (
                    <button
                      className={
                        slotId === slot.id
                          ? "slot-option selected"
                          : "slot-option"
                      }
                      key={slot.id}
                      disabled={slot.reserved >= slot.capacity}
                      onClick={() => {
                        setSlotId(slot.id);
                        setRequestId(createRequestId());
                        setError("");
                      }}
                    >
                      <strong>
                        {new Intl.DateTimeFormat("zh-CN", {
                          timeZone: "Asia/Shanghai",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(slot.startsAt))}{" "}
                        —{" "}
                        {new Intl.DateTimeFormat("zh-CN", {
                          timeZone: "Asia/Shanghai",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(slot.endsAt))}
                      </strong>
                      <span>
                        {slot.reserved >= slot.capacity
                          ? "时段已满"
                          : `余 ${slot.capacity - slot.reserved} 个名额`}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="feedback">
                  所选日期暂时没有可预约时段，请返回选择其他日期。
                </div>
              )}
              <p className="form-hint">
                {faultId
                  ? "本次固定总价仅为到店诊断费，不包含后续维修。实际维修项目、材料与费用需另行确认。"
                  : "所有所选项目将安排在同一次预约中。查看报价不预留名额，提交时会重新校验每项价格版本与名额。"}
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  我已核对以上全部 {offers.length}{" "}
                  项服务的车型、材料、包含与排除范围、税费口径及总价{" "}
                  {cents(totalCents)}。后续增项需另行确认；待门店接单前可取消。
                </span>
              </label>
              <ErrorBox message={error} />
              <button
                className="btn btn-primary btn-full"
                disabled={busy || !priceReady || !availableSlots.length}
                onClick={submit}
              >
                {busy ? "正在提交预约…" : "确认全部项目并提交预约"}
                <ArrowRight size={17} />
              </button>
              <p className="form-hint">
                提交成功后为“待门店确认”，请留意站内消息。
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
