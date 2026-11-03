import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Camera,
  MapPin,
  CalendarDays,
  Wrench,
  ChevronRight,
  Plus,
  Gauge,
  ShieldCheck,
  Clock3,
  FileClock,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import type { Bootstrap, Vehicle } from "@autovoyage/shared";
import { APPOINTMENT_NAMES, cents } from "@autovoyage/shared";
import {
  CarArt,
  DemoTag,
  Empty,
  SectionHeading,
  dateText,
} from "../components/UI";

export default function HomePage({
  data,
  vehicle,
  onSelectVehicle,
  onAddVehicle,
  onImport,
}: {
  data: Bootstrap;
  vehicle?: Vehicle;
  onSelectVehicle: (id: string) => void;
  onAddVehicle: () => void;
  onImport: () => void;
}) {
  const navigate = useNavigate();
  const model = data.models.find((m) => m.id === vehicle?.modelId);
  const plans = data.maintenance.filter((m) => m.vehicleId === vehicle?.id);
  const attention = plans.filter((m) => m.status !== "ok");
  const next = [...attention, ...plans][0];
  const missingRules =
    next?.scope === "vehicle" ||
    (next?.status === "missing" &&
      (!next.sourceTitle || /手册|规则|适用范围/.test(next.reason)));
  const appointments = data.appointments.filter(
    (a) =>
      a.vehicleId === vehicle?.id &&
      !["cancelled", "expired", "rejected", "completed"].includes(a.status),
  );
  const latest = appointments[0];
  const latestStore = data.stores.find((s) => s.id === latest?.storeId);
  const slot = data.slots.find((s) => s.id === latest?.slotId);
  const suggestedStores = data.stores.filter((s) => s.approved).slice(0, 2);
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">A LITTLE CARE, A LONGER JOURNEY</p>
          <h1>
            {data.user.name}，一路好心情<span className="title-dot">。</span>
          </h1>
          <p>把爱车照顾好，向更远处出发。</p>
        </div>
        <button className="btn btn-secondary add-car" onClick={onAddVehicle}>
          <Plus size={17} />
          添加爱车
        </button>
      </div>
      {!vehicle ? (
        <section className="card">
          <Empty
            title="从认识你的爱车开始"
            text="添加车辆档案，保养提醒、门店服务和每一次旅程记录，都从这里开始。"
          >
            <button className="btn btn-primary" onClick={onAddVehicle}>
              <Plus size={18} />
              添加第一辆车
            </button>
          </Empty>
        </section>
      ) : (
        <>
          <div className="dashboard-hero">
            <section className="vehicle-hero">
              <div className="vehicle-hero-top">
                <span className="overline-light">MY GARAGE / 我的爱车</span>
                <label className="vehicle-switch">
                  <span className="sr-only">切换车辆</span>
                  <select
                    value={vehicle.id}
                    onChange={(e) => onSelectVehicle(e.target.value)}
                  >
                    {data.vehicles.map((v) => (
                      <option value={v.id} key={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="vehicle-title">
                <h2>
                  {model?.brand} {model?.name}
                </h2>
                <p>
                  {model?.year}款 · {model?.power}{" "}
                  <span className="plate">{vehicle.plate}</span>
                </p>
                {vehicle.isDemo && <DemoTag />}
              </div>
              <CarArt />
              <div className="vehicle-data">
                <div>
                  <span>
                    <Gauge size={15} />
                    已确认总里程
                  </span>
                  <strong>
                    {vehicle.totalKm == null
                      ? "待更新"
                      : vehicle.totalKm.toLocaleString()}
                    <small>{vehicle.totalKm != null && "km"}</small>
                  </strong>
                  <p>数据日期 {dateText(vehicle.observedAt)}</p>
                </div>
                <div>
                  <span>
                    <CalendarDays size={15} />
                    车辆启用
                  </span>
                  <strong className="date-value">
                    {dateText(vehicle.startDate)}
                  </strong>
                  <p>{vehicle.name}</p>
                </div>
                <button className="hero-update" onClick={onImport}>
                  <Camera size={18} />
                  更新里程
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </section>
            <section className="care-card">
              <div className="care-card-heading">
                <span className="icon-tile icon-tile-amber">
                  <Wrench size={22} />
                </span>
                <span className="eyebrow">YOUR NEXT CARE</span>
              </div>
              <h2>
                {next?.status === "due"
                  ? "爱车需要一点关照"
                  : next?.status === "missing"
                    ? "补充资料，更懂爱车"
                    : next?.status === "soon"
                      ? "下一次保养，早作安排"
                      : "有序养护，从容出发"}
              </h2>
              <p className="care-summary">
                {attention.length
                  ? next?.scope === "vehicle"
                    ? "车型保养依据需要补充核验"
                    : `${attention.length} 项保养需要关注`
                  : "查看项目周期，为下一程做好准备"}
              </p>
              {next ? (
                <div className="next-care-detail">
                  <strong>{next.name}</strong>
                  <span
                    className={`badge badge-${next.status === "due" ? "warning" : next.status === "ok" ? "success" : "blue"}`}
                  >
                    {
                      {
                        due: "已到期",
                        soon: "临近保养",
                        missing: "资料待补充",
                        ok: "未到期",
                      }[next.status]
                    }
                  </span>
                  <p>{next.reason}</p>
                  {next.scope !== "vehicle" && (
                    <div className="thresholds">
                      <span>
                        时间阈值<strong>{dateText(next.dueAt)}</strong>
                      </span>
                      <span>
                        里程阈值
                        <strong>
                          {next.dueKm?.toLocaleString() ?? "待补充"}{" "}
                          <small>{next.dueKm != null ? "km" : ""}</small>
                        </strong>
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="next-care-detail">
                  <p>车辆保养规则尚待核验，不能据此判断是否无需保养。</p>
                </div>
              )}
              <button
                className="btn btn-primary btn-full"
                onClick={() =>
                  missingRules
                    ? navigate("/account?tab=vehicles")
                    : next?.status === "missing"
                      ? onImport()
                      : navigate(
                          `/stores${next ? `?project=${next.projectId}` : ""}`,
                        )
                }
              >
                {missingRules
                  ? "查看车辆资料与规则"
                  : next?.status === "missing"
                    ? "补充车辆里程"
                    : "查看门店与价格"}
                <ArrowRight size={17} />
              </button>
              <p className="care-footnote">
                <ShieldCheck size={14} />
                按项目计算，时间或里程先到为准
              </p>
            </section>
          </div>
          <div className="quick-actions">
            {[
              {
                Icon: Camera,
                title: "更新车辆里程",
                description: "截图识别 · 核对确认",
                action: onImport,
                color: "blue",
              },
              {
                Icon: MapPin,
                title: "发现附近门店",
                description: "同项比价 · 从容选择",
                action: () => navigate("/stores"),
                color: "teal",
              },
              {
                Icon: Wrench,
                title: "向专家问一问",
                description: "描述问题 · 获取建议",
                action: () => navigate("/repairs"),
                color: "amber",
              },
              {
                Icon: FileClock,
                title: "每次服务都有记录",
                description: "预约进度 · 养护档案",
                action: () => navigate("/account"),
                color: "violet",
              },
            ].map((item) => (
              <button key={item.title} onClick={item.action}>
                <span className={`icon-tile icon-tile-${item.color}`}>
                  <item.Icon size={22} />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <ArrowUpRight size={17} />
              </button>
            ))}
          </div>
          <div className="dashboard-bottom">
            <section className="card maintenance-section">
              <SectionHeading
                eyebrow="MAINTENANCE PLAN"
                title="爱车保养计划"
                action={missingRules ? "查看车辆资料" : "更新里程"}
                onAction={
                  missingRules
                    ? () => navigate("/account?tab=vehicles")
                    : onImport
                }
              />
              {plans.length ? (
                <div className="maintenance-list">
                  {plans.map((plan) => (
                    <div className="maintenance-row" key={plan.projectId}>
                      <span
                        className={`plan-status-icon status-${plan.status}`}
                      >
                        {plan.status === "ok" ? (
                          <CheckCircle2 size={20} />
                        ) : (
                          <AlertCircle size={20} />
                        )}
                      </span>
                      <div className="maintenance-main">
                        <div className="maintenance-row-title">
                          <h3>{plan.name}</h3>
                          {plan.isDemo && <DemoTag />}
                        </div>
                        <p>{plan.reason}</p>
                        <small>
                          {plan.sourceTitle || "保养依据待补充"}
                          {plan.sourceUrl && (
                            <>
                              {" "}
                              ·{" "}
                              <a
                                href={plan.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                查看来源
                              </a>
                            </>
                          )}
                        </small>
                      </div>
                      <div className="maintenance-row-right">
                        <span
                          className={`badge badge-${plan.status === "due" ? "warning" : plan.status === "ok" ? "success" : "neutral"}`}
                        >
                          {
                            {
                              due: "已到期",
                              soon: "临近保养",
                              missing: "待补充",
                              ok: "未到期",
                            }[plan.status]
                          }
                        </span>
                        <button
                          className="icon-btn"
                          aria-label={
                            plan.scope === "vehicle"
                              ? "查看车辆资料与保养规则"
                              : `查看${plan.name}门店`
                          }
                          onClick={() =>
                            navigate(
                              plan.scope === "vehicle"
                                ? "/account?tab=vehicles"
                                : `/stores?project=${plan.projectId}`,
                            )
                          }
                        >
                          <ChevronRight size={19} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty
                  title="保养规则待补充"
                  text="当前车型尚未配置经过核验的手册规则，请联系平台管理员补充。"
                />
              )}
              <div className="section-note">
                只更新实际完成并确认的保养项目，保留每一次服务依据。
              </div>
            </section>
            <div className="dashboard-side">
              <section className="card appointment-glance">
                <SectionHeading
                  eyebrow="UPCOMING SERVICE"
                  title="我的服务待办"
                  action="全部"
                  onAction={() => navigate("/account")}
                />
                {latest ? (
                  <>
                    <span className="badge badge-blue">
                      {APPOINTMENT_NAMES[latest.status]}
                    </span>
                    <h3>{latestStore?.name || "服务门店"}</h3>
                    <p>{latest.snapshot.map((s) => s.title).join("、")}</p>
                    <div className="service-time">
                      <Clock3 size={17} />
                      {dateText(slot?.startsAt, true)}
                    </div>
                    <button
                      className="text-btn"
                      onClick={() => navigate("/account")}
                    >
                      查看服务详情
                      <ArrowRight size={16} />
                    </button>
                  </>
                ) : (
                  <div className="quiet-state">
                    <CalendarDays size={28} />
                    <p>暂时没有待处理预约</p>
                    <small>选一家合适的门店，安排下一次养护。</small>
                    <button
                      className="text-btn"
                      onClick={() => navigate("/stores")}
                    >
                      去看看门店
                      <ArrowRight size={15} />
                    </button>
                  </div>
                )}
              </section>
              <section className="card nearby-glance">
                <SectionHeading
                  eyebrow="EXPLORE NEARBY"
                  title="发现服务门店"
                  action="更多"
                  onAction={() => navigate("/stores")}
                />
                {suggestedStores.map((store) => {
                  const offer = data.offers.find(
                    (o) =>
                      o.storeId === store.id &&
                      o.modelId === vehicle.modelId &&
                      o.active &&
                      o.priceType === "fixed",
                  );
                  return (
                    <button
                      className="small-store"
                      key={store.id}
                      onClick={() => navigate(`/stores?store=${store.id}`)}
                    >
                      <span className="store-avatar">
                        <Wrench size={20} />
                      </span>
                      <span>
                        <strong>{store.name}</strong>
                        <small>
                          {store.isDemo ? "演示门店 · " : ""}
                          {store.type === "chain"
                            ? "连锁服务"
                            : store.type === "4s"
                              ? "已审核4S店"
                              : "综合维修"}
                        </small>
                      </span>
                      <ChevronRight size={17} />
                    </button>
                  );
                })}
              </section>
            </div>
          </div>
        </>
      )}
    </>
  );
}
