import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  Camera,
  CarFront,
  ChevronRight,
  Clock3,
  FileClock,
  LogOut,
  Plus,
  ShieldCheck,
  UserRound,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  ScanLine,
} from "lucide-react";
import type {
  Appointment,
  Bootstrap,
  RegistrationImport,
  Vehicle,
} from "@autovoyage/shared";
import { APPOINTMENT_NAMES, cents } from "@autovoyage/shared";
import { api, patch, post } from "../lib/api";
import {
  Modal,
  Empty,
  ErrorBox,
  DemoTag,
  dateText,
  messageOf,
} from "../components/UI";
import RegistrationCertificate, {
  RegistrationDetails,
  registrationStatusLabel,
} from "../components/RegistrationCertificate";
import { VehiclePhoto } from "../components/VehiclePhoto";
const inactive = ["completed", "cancelled", "expired", "rejected"];
export default function AccountPage({
  data,
  vehicle,
  onRefresh,
  onLogout,
  onAddVehicle,
  onImport,
  onSuccess,
}: {
  data: Bootstrap;
  vehicle?: Vehicle;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
  onAddVehicle: () => void;
  onImport: (vehicleId?: string, jobId?: string) => void;
  onSuccess: (text: string) => void;
}) {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(
    params.get("tab") === "vehicles" ? "vehicles" : "appointments",
  );
  useEffect(() => {
    const target = params.get("tab");
    if (target && ["appointments", "history", "vehicles"].includes(target))
      setTab(target);
  }, [params]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("active");
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [registrations, setRegistrations] = useState<RegistrationImport[]>([]);
  const [registrationTarget, setRegistrationTarget] = useState<{
    vehicleId?: string;
    job?: RegistrationImport;
  } | null>(null);
  const [registrationError, setRegistrationError] = useState("");
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const refreshRegistrations = useCallback(async () => {
    const results = await api<RegistrationImport[]>("/registration-imports");
    setRegistrations(results);
    setRegistrationError("");
  }, []);
  useEffect(() => {
    if (tab !== "vehicles") return;
    let alive = true;
    setRegistrationLoading(true);
    api<RegistrationImport[]>("/registration-imports")
      .then((results) => {
        if (alive) {
          setRegistrations(results);
          setRegistrationError("");
        }
      })
      .catch((e) => {
        if (alive) setRegistrationError(messageOf(e));
      })
      .finally(() => {
        if (alive) setRegistrationLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tab]);
  const navigate = useNavigate();
  const appointment = data.appointments.find((a) => a.id === selected);
  const appointments = data.appointments.filter(
    (a) => filter === "all" || !inactive.includes(a.status),
  );
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">YOUR CAR, YOUR JOURNEY</p>
          <h1>
            每次用心，都有记录<span className="title-dot">。</span>
          </h1>
          <p>服务进度、车辆档案与养护历史，一目了然。</p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => onLogout().catch((e) => setError(messageOf(e)))}
        >
          <LogOut size={17} />
          退出登录
        </button>
      </div>
      <ErrorBox message={error} />
      <section className="profile-card">
        <span className="profile-avatar">{data.user.name.slice(0, 1)}</span>
        <div>
          <h2>{data.user.name}</h2>
          <p>{data.user.email}</p>
        </div>
        <span className="profile-identity">
          <ShieldCheck size={16} />
          云程车主
        </span>
        <div className="profile-stat">
          <strong>{data.vehicles.length}</strong>
          <span>我的爱车</span>
        </div>
        <div className="profile-stat">
          <strong>
            {data.appointments.filter((a) => a.status === "completed").length}
          </strong>
          <span>已完成服务</span>
        </div>
      </section>
      <div className="tabs account-tabs">
        {[
          { id: "appointments", label: "我的预约", Icon: CalendarDays },
          { id: "history", label: "养护档案", Icon: FileClock },
          { id: "vehicles", label: "车辆档案", Icon: CarFront },
        ].map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
          >
            <item.Icon size={18} />
            {item.label}
          </button>
        ))}
      </div>
      {tab === "appointments" && (
        <>
          <div className="list-heading">
            <h2>我的服务预约</h2>
            <div className="segmented">
              <button
                className={filter === "active" ? "active" : ""}
                onClick={() => setFilter("active")}
              >
                进行中
              </button>
              <button
                className={filter === "all" ? "active" : ""}
                onClick={() => setFilter("all")}
              >
                全部记录
              </button>
            </div>
          </div>
          {appointments.length ? (
            <div className="appointment-grid">
              {appointments.map((apt) => {
                const store = data.stores.find((s) => s.id === apt.storeId);
                const car = data.vehicles.find((v) => v.id === apt.vehicleId);
                const slot = data.slots.find((s) => s.id === apt.slotId);
                const changes = data.changes.filter(
                  (c) => c.appointmentId === apt.id && c.status === "pending",
                );
                return (
                  <button
                    className="card appointment-card"
                    key={apt.id}
                    onClick={() => setSelected(apt.id)}
                  >
                    <div>
                      <span
                        className={`badge ${apt.status === "completed" ? "badge-success" : inactive.includes(apt.status) ? "badge-neutral" : "badge-blue"}`}
                      >
                        {APPOINTMENT_NAMES[apt.status]}
                      </span>
                      <span className="appointment-amount">
                        {cents(apt.finalCents)}
                      </span>
                    </div>
                    <h3>{store?.name || "服务门店"}</h3>
                    <p>{apt.snapshot.map((s) => s.title).join("、")}</p>
                    <div className="appointment-date">
                      <Clock3 size={16} />
                      {dateText(slot?.startsAt, true)}
                    </div>
                    <footer>
                      <span>
                        {car?.name} · {car?.plate}
                      </span>
                      <span>
                        {changes.length ? (
                          <strong className="warning-text">
                            有费用变更待确认
                          </strong>
                        ) : (
                          "查看详情"
                        )}
                        <ChevronRight size={17} />
                      </span>
                    </footer>
                  </button>
                );
              })}
            </div>
          ) : (
            <section className="card">
              <Empty
                title={
                  filter === "active" ? "暂无进行中的预约" : "还没有服务预约"
                }
                text="选一家合适的门店，把下一次保养安排好。"
              >
                <button
                  className="btn btn-primary"
                  onClick={() => navigate("/stores")}
                >
                  看看附近门店
                  <ArrowRight size={17} />
                </button>
              </Empty>
            </section>
          )}
        </>
      )}
      {tab === "history" && (
        <section className="card history-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CARE, WELL DOCUMENTED</p>
              <h2>已完成的保养项目</h2>
            </div>
          </div>
          {data.serviceRecords.length ? (
            <div className="history-list">
              {data.serviceRecords.map((record) => (
                <div className="history-row" key={record.id}>
                  <span className="history-dot">
                    <CheckCircle2 size={17} />
                  </span>
                  <div>
                    <time>{dateText(record.completedAt)}</time>
                    <h3>
                      {data.projects.find((p) => p.id === record.projectId)
                        ?.name || "保养项目"}
                    </h3>
                    <p>
                      {
                        data.vehicles.find((v) => v.id === record.vehicleId)
                          ?.plate
                      }{" "}
                      · {record.totalKm.toLocaleString()} km · {record.source}
                    </p>
                    <small className="history-price-note">
                      项目报价快照 {cents(record.totalCents)}
                      {data.appointments.some(
                        (a) => a.id === record.appointmentId,
                      )
                        ? " · 最终总额见服务详情"
                        : " · 合成历史导入记录"}
                    </small>
                  </div>
                  {data.appointments.some(
                    (a) => a.id === record.appointmentId,
                  ) ? (
                    <button
                      className="text-btn"
                      onClick={() => {
                        setTab("appointments");
                        setFilter("all");
                        setSelected(record.appointmentId);
                      }}
                    >
                      服务详情
                      <ChevronRight size={16} />
                    </button>
                  ) : (
                    <span className="badge badge-neutral">历史导入</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title="养护记录会从下一次服务开始"
              text="门店完成实际项目，经你核对确认后，会逐项记录到这里。"
            />
          )}
          <div className="section-note">
            完工确认后只更新实际完成的保养项目，其他项目保留原有周期。
          </div>
        </section>
      )}
      {tab === "vehicles" && (
        <>
          <div className="list-heading">
            <h2>我的车辆档案</h2>
            <button className="btn btn-secondary" onClick={onAddVehicle}>
              <Plus size={17} />
              添加车辆
            </button>
          </div>
          {registrationError && (
            <div className="registration-inline-error">
              <ErrorBox message={`行驶证档案加载失败：${registrationError}`} />
              <button
                className="text-btn"
                onClick={() =>
                  refreshRegistrations().catch((e) =>
                    setRegistrationError(messageOf(e)),
                  )
                }
              >
                重新加载档案
              </button>
            </div>
          )}
          {registrations.some((item) => item.status !== "confirmed") && (
            <section className="registration-task-list">
              <h3>行驶证识别记录</h3>
              <p>
                已上传的照片可在这里继续核对。完成确认前不会创建或修改车辆。
              </p>
              {registrations
                .filter((item) => item.status !== "confirmed")
                .map((item) => (
                  <div className="registration-task-row" key={item.id}>
                    <div>
                      <strong>
                        {item.vehicleId
                          ? data.vehicles.find(
                              (car) => car.id === item.vehicleId,
                            )?.plate || "爱车行驶证"
                          : "新车建档"}{" "}
                        · {registrationStatusLabel(item.status)}
                      </strong>
                      <small>{dateText(item.createdAt, true)}</small>
                    </div>
                    <button
                      className="text-btn"
                      onClick={() =>
                        setRegistrationTarget({
                          vehicleId: item.vehicleId || undefined,
                          job: item,
                        })
                      }
                    >
                      查看任务
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </div>
                ))}
            </section>
          )}
          <div className="vehicle-account-grid">
            {data.vehicles.map((car) => {
              const model = data.models.find((m) => m.id === car.modelId);
              const registration = registrations.find(
                (item) =>
                  item.vehicleId === car.id && item.status === "confirmed",
              );
              const registrationTask = registrations.find(
                (item) =>
                  item.vehicleId === car.id && item.status !== "confirmed",
              );
              return (
                <section className="card vehicle-account-card" key={car.id}>
                  <VehiclePhoto
                    model={model}
                    className="archive-vehicle-photo"
                  />
                  <div className="vehicle-account-top">
                    <span className="icon-tile icon-tile-blue">
                      <CarFront size={25} />
                    </span>
                    <div>
                      <h3>{car.name}</h3>
                      <p>
                        {model?.brand} {model?.name} · {model?.year}款
                      </p>
                    </div>
                    {car.isDemo && <DemoTag />}
                  </div>
                  <dl className="detail-list">
                    <div>
                      <dt>车牌号码</dt>
                      <dd>{car.plate}</dd>
                    </div>
                    <div>
                      <dt>车辆启用</dt>
                      <dd>{dateText(car.startDate)}</dd>
                    </div>
                    <div>
                      <dt>已确认总里程</dt>
                      <dd>
                        {car.totalKm == null
                          ? "待更新"
                          : `${car.totalKm.toLocaleString()} km`}
                      </dd>
                    </div>
                    <div>
                      <dt>数据日期</dt>
                      <dd>{dateText(car.observedAt, true)}</dd>
                    </div>
                  </dl>
                  {registration ? (
                    <div className="registration-card-panel">
                      <div className="registration-card-heading">
                        <FileCheck2 size={18} aria-hidden="true" />
                        <strong>行驶证档案</strong>
                        <span className="badge badge-success">本人已核对</span>
                      </div>
                      <RegistrationDetails
                        fields={
                          registration.confirmedFields || registration.candidate
                        }
                      />
                      <button
                        className="text-btn"
                        onClick={() =>
                          setRegistrationTarget({
                            vehicleId: car.id,
                            job: registration,
                          })
                        }
                      >
                        查看完整行驶证档案
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <div className="registration-empty">
                      <FileCheck2 size={22} aria-hidden="true" />
                      <div>
                        <p>
                          {registrationLoading
                            ? "正在读取行驶证档案…"
                            : "补全行驶证，让档案更完整"}
                        </p>
                        <small>
                          可识别号牌、VIN、车辆类型与注册日期，核对后保存。证件资料仅本人可查看。
                        </small>
                      </div>
                    </div>
                  )}
                  <details className="vehicle-rules-info">
                    <summary>查看此车型的保养依据</summary>
                    {data.rules.some(
                      (rule) => rule.modelId === car.modelId && rule.verified,
                    ) ? (
                      <ul>
                        {data.rules
                          .filter(
                            (rule) =>
                              rule.modelId === car.modelId && rule.verified,
                          )
                          .map((rule) => (
                            <li key={rule.id}>
                              <strong>
                                {
                                  data.projects.find(
                                    (project) => project.id === rule.projectId,
                                  )?.name
                                }
                              </strong>
                              <p>
                                {rule.sourceTitle} · 版本 {rule.version}
                              </p>
                              {rule.sourceUrl && (
                                <a
                                  href={rule.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  查看手册来源
                                </a>
                              )}
                            </li>
                          ))}
                      </ul>
                    ) : (
                      <p>
                        本车型尚无经过核验的适用保养规则，请联系平台管理员补充手册来源与规则。上传里程不能替代保养依据。
                      </p>
                    )}
                  </details>
                  <button
                    className="btn btn-primary btn-full"
                    onClick={() =>
                      setRegistrationTarget({
                        vehicleId: car.id,
                        job: registrationTask || undefined,
                      })
                    }
                  >
                    <ScanLine size={17} aria-hidden="true" />
                    {registrationTask
                      ? "继续行驶证识别任务"
                      : registration
                        ? "上传新的行驶证"
                        : "上传行驶证并识别"}
                  </button>
                  <button
                    className="btn btn-secondary btn-full"
                    onClick={() => setEditing(car)}
                  >
                    修改车辆昵称与车牌
                  </button>
                </section>
              );
            })}
          </div>
          <section className="card mileage-history">
            <div className="section-heading">
              <div>
                <p className="eyebrow">MILEAGE HISTORY</p>
                <h2>里程更新记录</h2>
              </div>
              <button
                className="text-btn"
                disabled={!vehicle}
                onClick={() => onImport()}
              >
                <Camera size={17} />
                更新当前爱车里程
              </button>
            </div>
            {data.observations.length ? (
              <div className="observation-list">
                {data.observations.map((observation) => (
                  <div key={observation.id}>
                    <span>
                      <strong>
                        {observation.totalKm.toLocaleString()} <small>km</small>
                      </strong>
                      <p>
                        {
                          data.vehicles.find(
                            (v) => v.id === observation.vehicleId,
                          )?.plate
                        }{" "}
                        · {observation.source}
                      </p>
                    </span>
                    <span>
                      <time>{dateText(observation.observedAt, true)}</time>
                      <small>
                        确认于 {dateText(observation.confirmedAt, true)}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">暂无图片核对后入库的里程记录。</p>
            )}
            {data.imports.length > 0 && (
              <details className="import-history-details">
                <summary>查看图片识别任务（{data.imports.length}）</summary>
                {data.imports.map((job) => (
                  <div className="import-history-row" key={job.id}>
                    <span>
                      <a href={job.imageUrl} target="_blank" rel="noreferrer">
                        查看原图
                      </a>
                      {job.status !== "confirmed" && (
                        <button
                          className="text-btn"
                          onClick={() => onImport(job.vehicleId, job.id)}
                        >
                          查看任务
                        </button>
                      )}
                    </span>
                    <span>
                      {
                        {
                          uploaded: "已上传",
                          processing: "识别中",
                          awaiting_confirmation: "待核对",
                          confirmed: "已入库",
                          failed: "识别未完成",
                          review: "待复核",
                        }[job.status]
                      }
                    </span>
                    <span>{job.reason || dateText(job.createdAt, true)}</span>
                  </div>
                ))}
              </details>
            )}
          </section>
        </>
      )}
      <div className="account-privacy">
        <ShieldCheck size={20} />
        <p>你的车辆与服务信息按账号隔离。退出登录会清理本页私人状态。</p>
        <button className="text-btn muted" onClick={() => setClosing(true)}>
          账号注销
        </button>
      </div>
      {appointment && (
        <AppointmentDetail
          appointment={appointment}
          data={data}
          onClose={() => setSelected(null)}
          onRefresh={onRefresh}
          onSuccess={onSuccess}
        />
      )}{" "}
      {editing && (
        <EditVehicle
          vehicle={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onRefresh();
            onSuccess("车辆信息已保存");
          }}
        />
      )}{" "}
      {registrationTarget && (
        <RegistrationCertificate
          key={
            registrationTarget.job?.id ||
            registrationTarget.vehicleId ||
            "registration-new"
          }
          models={data.models}
          vehicle={data.vehicles.find(
            (car) =>
              car.id ===
              (registrationTarget.vehicleId ||
                registrationTarget.job?.vehicleId),
          )}
          initialJob={registrationTarget.job}
          aiConfigured={data.config.aiConfigured}
          onClose={() => {
            setRegistrationTarget(null);
            refreshRegistrations().catch((e) =>
              setRegistrationError(messageOf(e)),
            );
          }}
          onSaved={async () => {
            await onRefresh();
            await refreshRegistrations();
            onSuccess("行驶证信息已核对保存，爱车档案已更新");
          }}
        />
      )}
      {closing && (
        <CloseAccount
          email={data.user.email}
          onClose={() => setClosing(false)}
        />
      )}
    </>
  );
}
function AppointmentDetail({
  appointment: apt,
  data,
  onClose,
  onRefresh,
  onSuccess,
}: {
  appointment: Appointment;
  data: Bootstrap;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSuccess: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [action, setAction] = useState<
    "cancel" | "complete" | "dispute" | null
  >(null);
  const [reason, setReason] = useState("");
  const store = data.stores.find((s) => s.id === apt.storeId);
  const slot = data.slots.find((s) => s.id === apt.slotId);
  const vehicle = data.vehicles.find((v) => v.id === apt.vehicleId);
  const changes = data.changes.filter((c) => c.appointmentId === apt.id);
  const mutate = async (path: string, body: unknown, message: string) => {
    setBusy(true);
    setError("");
    try {
      await post(path, body);
      await onRefresh();
      setAction(null);
      onSuccess(message);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const approvedScope = apt.approvedSnapshot || apt.snapshot;
  const progress = [
    "pending",
    "confirmed",
    "in_service",
    "awaiting_owner",
    "completed",
  ];
  const index = progress.indexOf(apt.status);
  return (
    <Modal
      title="服务预约详情"
      subtitle={`预约号 ${apt.id.slice(0, 12)} · ${dateText(apt.createdAt, true)}`}
      onClose={onClose}
      wide
    >
      <div className="appointment-detail">
        <div className="appointment-detail-top">
          <div>
            <span
              className={`badge ${apt.status === "completed" ? "badge-success" : "badge-blue"}`}
            >
              {APPOINTMENT_NAMES[apt.status]}
            </span>
            <h3>{store?.name || "服务门店"}</h3>
            <p>
              {vehicle?.name} · {vehicle?.plate}
            </p>
          </div>
          <strong className="detail-total">
            {cents(apt.finalCents)}
            <small>
              {apt.status === "completed" ? "确认后最终总额" : "当前确认总额"}
            </small>
          </strong>
        </div>
        {index >= 0 && (
          <ol className="service-progress">
            {progress.map((state, i) => (
              <li className={i <= index ? "reached" : ""} key={state}>
                <span>{i < index ? <CheckCircle2 size={16} /> : i + 1}</span>
                <small>
                  {
                    {
                      pending: "已提交",
                      confirmed: "已接单",
                      in_service: "服务中",
                      awaiting_owner: "待核对",
                      completed: "已归档",
                    }[state as "pending"]
                  }
                </small>
              </li>
            ))}
          </ol>
        )}
        <dl className="detail-list">
          <div>
            <dt>预约时段</dt>
            <dd>
              {dateText(slot?.startsAt, true)} —{" "}
              {slot
                ? new Intl.DateTimeFormat("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(slot.endsAt))
                : ""}
            </dd>
          </div>
          <div>
            <dt>门店地址</dt>
            <dd>{store?.address}</dd>
          </div>
          <div>
            <dt>门店电话</dt>
            <dd>
              <a href={`tel:${store?.phone}`}>{store?.phone}</a>
            </dd>
          </div>
          {apt.reason && (
            <div>
              <dt>处理说明</dt>
              <dd>{apt.reason}</dd>
            </div>
          )}
        </dl>
        <h3 className="detail-section-title">提交时的报价明细</h3>
        {apt.snapshot.map((item) => (
          <div className="snapshot-item" key={item.offerId}>
            <div>
              <h4>{item.title}</h4>
              <strong>{cents(item.totalCents)}</strong>
            </div>
            <p>{item.materialSpec}</p>
            <small>
              材料 {cents(item.materialCents)} + 工时 {cents(item.laborCents)} +
              其他 {cents(item.otherCents)} ·{" "}
              {item.taxIncluded ? "含税" : "未含税"} · 版本 {item.version}
            </small>
            <p className="snapshot-scope">
              包含：{item.includes}
              <br />
              不含：{item.excludes || "无额外说明"}
            </p>
          </div>
        ))}
        <div className="snapshot-summary">
          <span>预约时固定总价</span>
          <strong>{cents(apt.totalCents)}</strong>
        </div>
        {changes.length > 0 && (
          <>
            <h3 className="detail-section-title">服务与费用变更</h3>
            {changes.map((change) => (
              <section className="service-change" key={change.id}>
                <div>
                  <strong>{change.reason}</strong>
                  <span
                    className={`badge ${change.status === "approved" ? "badge-success" : change.status === "pending" ? "badge-warning" : "badge-neutral"}`}
                  >
                    {
                      {
                        pending: "待你确认",
                        approved: "已同意",
                        rejected: "已拒绝",
                      }[change.status]
                    }
                  </span>
                </div>
                <p>{change.description}</p>
                {change.proposedSnapshot && (
                  <div className="change-scope">
                    <h4>拟定服务范围与材料</h4>
                    {change.proposedSnapshot.map((item) => (
                      <div key={item.offerId}>
                        <strong>{item.title}</strong>
                        <span>{item.materialSpec}</span>
                        <small>
                          包含：{item.includes} · 不含：
                          {item.excludes || "无额外说明"}
                        </small>
                        <span>{cents(item.totalCents)}</span>
                      </div>
                    ))}
                    <p>
                      相较原预约新增：
                      {change.proposedProjectIds
                        ?.filter(
                          (id) =>
                            !apt.snapshot.some((item) => item.projectId === id),
                        )
                        .map(
                          (id) =>
                            data.projects.find((p) => p.id === id)?.name || id,
                        )
                        .join("、") || "无"}
                    </p>
                    <p>
                      相较原预约移除：
                      {apt.snapshot
                        .filter(
                          (item) =>
                            !change.proposedProjectIds?.includes(
                              item.projectId,
                            ),
                        )
                        .map((item) => item.title)
                        .join("、") || "无"}
                    </p>
                  </div>
                )}
                <div className="change-amounts">
                  <span>
                    原总额<strong>{cents(change.previousCents)}</strong>
                  </span>
                  <span>
                    差额
                    <strong>
                      {change.proposedCents - change.previousCents >= 0
                        ? "+"
                        : ""}
                      {cents(change.proposedCents - change.previousCents)}
                    </strong>
                  </span>
                  <span>
                    变更后总额<strong>{cents(change.proposedCents)}</strong>
                  </span>
                </div>
                {change.status === "pending" && (
                  <div className="modal-actions">
                    <button
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() =>
                        mutate(
                          `/changes/${change.id}/decision`,
                          { approved: false },
                          "已拒绝本次变更",
                        )
                      }
                    >
                      拒绝变更
                    </button>
                    <button
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() =>
                        mutate(
                          `/changes/${change.id}/decision`,
                          { approved: true },
                          "变更已确认",
                        )
                      }
                    >
                      确认变更及新总额
                    </button>
                  </div>
                )}
              </section>
            ))}
          </>
        )}
        {["awaiting_owner", "completed"].includes(apt.status) && (
          <section className="completion-summary">
            <h3>门店提交的实际完成项目</h3>
            <p>
              已确认服务范围：
              {approvedScope.map((item) => item.title).join("、")}
            </p>
            <ul>
              {apt.completedProjectIds.map((id) => (
                <li key={id}>
                  <CheckCircle2 size={17} />
                  {data.projects.find((p) => p.id === id)?.name || id}
                </li>
              ))}
            </ul>
            <p>服务里程：{apt.serviceKm?.toLocaleString() ?? "待补充"} km</p>
            <p className="form-hint">
              确认后仅对以上实际完成的项目更新保养周期。
            </p>
          </section>
        )}
        <ErrorBox message={error} />
        {action ? (
          <section className="action-confirm">
            <h3>
              {action === "cancel"
                ? "确定取消这个预约？"
                : action === "complete"
                  ? "核对完成，确认归档？"
                  : "请描述需要核对的问题"}
            </h3>
            <p>
              {action === "complete"
                ? "请确认实际完成项目、服务里程与最终费用均正确。有异议可返回并联系门店核对。"
                : action === "cancel"
                  ? "取消后将释放本次预约名额，需要时可重新预约。"
                  : "提交后保持待完工确认状态，待门店核对处理。"}
            </p>
            {action !== "complete" && (
              <label>
                说明
                <textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  placeholder={
                    action === "cancel"
                      ? "请填写取消原因"
                      : "例如：项目未完成、费用需核对"
                  }
                />
              </label>
            )}
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setAction(null)}
              >
                返回
              </button>
              <button
                className={`btn ${action === "cancel" ? "btn-danger" : "btn-primary"}`}
                disabled={busy || (action !== "complete" && !reason.trim())}
                onClick={() =>
                  mutate(
                    `/appointments/${apt.id}/action`,
                    { action, reason },
                    action === "complete"
                      ? "完工已确认，养护档案已更新"
                      : action === "cancel"
                        ? "预约已取消"
                        : "异议已提交，请等待门店核对",
                  )
                }
              >
                {busy
                  ? "正在处理…"
                  : action === "complete"
                    ? "确认完工并归档"
                    : action === "cancel"
                      ? "确认取消预约"
                      : "提交核对问题"}
              </button>
            </div>
          </section>
        ) : (
          <div className="modal-actions">
            {["pending", "confirmed"].includes(apt.status) && (
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setAction("cancel");
                  setReason("");
                }}
              >
                取消预约
              </button>
            )}
            {apt.status === "awaiting_owner" && (
              <>
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setAction("dispute");
                    setReason("");
                  }}
                >
                  信息有异议
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => setAction("complete")}
                >
                  核对并确认完工
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
function CloseAccount({
  email,
  onClose,
}: {
  email: string;
  onClose: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="申请注销账号"
      subtitle="请先确认没有未完成的服务与待处理事项。"
      onClose={onClose}
    >
      <div className="form-stack">
        <div className="feedback feedback-warning">
          <AlertTriangle size={20} />
          <span>
            注销会撤销当前登录并停用账号。相关服务记录按系统的必要留存规则处理。
          </span>
        </div>
        <label>
          输入账号邮箱确认
          <input
            type="email"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder={email}
          />
        </label>
        <ErrorBox message={error} />
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            保留账号
          </button>
          <button
            className="btn btn-danger"
            disabled={busy || confirmation !== email}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/auth/account", {
                  method: "DELETE",
                  body: JSON.stringify({ confirmation: email }),
                });
                sessionStorage.removeItem("autovoyage-vehicle");
                window.location.assign("/");
              } catch (e) {
                setError(messageOf(e));
                setBusy(false);
              }
            }}
          >
            {busy ? "正在处理…" : "确认注销"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditVehicle({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="修改车辆信息"
      subtitle="里程仍需通过图片上传、核对确认更新。"
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const values = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await patch(`/vehicles/${vehicle.id}`, {
              name: values.get("name"),
              plate: values.get("plate"),
            });
            await onSaved();
          } catch (e) {
            setError(messageOf(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          车辆昵称
          <input
            name="name"
            defaultValue={vehicle.name}
            required
            maxLength={40}
          />
        </label>
        <label>
          车牌号码
          <input
            name="plate"
            defaultValue={vehicle.plate}
            required
            maxLength={12}
          />
        </label>
        <ErrorBox message={error} />
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "正在保存…" : "保存车辆信息"}
        </button>
      </form>
    </Modal>
  );
}
