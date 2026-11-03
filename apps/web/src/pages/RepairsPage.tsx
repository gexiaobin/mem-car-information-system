import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Camera,
  ChevronRight,
  CircleHelp,
  FileText,
  ImagePlus,
  MessageCircle,
  Plus,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import type { Bootstrap, Fault, Vehicle } from "@autovoyage/shared";
import { cents } from "@autovoyage/shared";
import { api, post } from "../lib/api";
import {
  Modal,
  Empty,
  ErrorBox,
  dateText,
  localTimeInput,
  asDateTime,
  messageOf,
} from "../components/UI";
const statusNames: Record<Fault["status"], string> = {
  pending: "等待专家回复",
  need_info: "需要补充资料",
  replied: "专家已回复",
  booked: "已关联预约",
  closed: "咨询已关闭",
};
export default function RepairsPage({
  data,
  vehicle,
  onRefresh,
  onSuccess,
}: {
  data: Bootstrap;
  vehicle?: Vehicle;
  onRefresh: () => Promise<void>;
  onSuccess: (text: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Fault | null>(null);
  const current = data.faults.find((f) => f.id === selected?.id) || selected;
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">ASK AN EXPERT, FEEL ASSURED</p>
          <h1>
            有疑问，问一问<span className="title-dot">。</span>
          </h1>
          <p>把爱车的异常说清楚，让专业建议先到一步。</p>
        </div>
        <button
          className="btn btn-primary"
          disabled={!vehicle}
          onClick={() => setCreating(true)}
        >
          <Plus size={18} />
          发起故障咨询
        </button>
      </div>
      <section className="repair-guide">
        <div className="repair-guide-intro">
          <span className="icon-tile icon-tile-blue">
            <Wrench size={24} />
          </span>
          <h2>从描述问题，到安心进店</h2>
          <p>
            照片与文字帮助专家初步判断，
            <br />
            具体维修方案以必要的现场检查为准。
          </p>
        </div>
        <div className="repair-guide-steps">
          {[
            {
              icon: Camera,
              title: "记录异常",
              text: "描述表现、发生条件，上传照片",
            },
            {
              icon: MessageCircle,
              title: "获取建议",
              text: "专家回复，说明估价与不确定性",
            },
            {
              icon: FileText,
              title: "确认范围",
              text: "核对诊断或维修方案后再预约",
            },
          ].map((item, i) => (
            <div key={item.title}>
              <span className="step-number">0{i + 1}</span>
              <item.icon size={23} />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      </section>
      <div className="safety-notice">
        <ShieldAlert size={23} />
        <div>
          <strong>安全先于一切</strong>
          <p>
            如出现制动失灵、冒烟、起火等危险症状，请停止驾驶并联系救援，不要等待在线建议。
          </p>
        </div>
      </div>
      <div className="section-heading">
        <div>
          <p className="eyebrow">MY CONSULTATIONS</p>
          <h2>我的故障咨询</h2>
        </div>
        <span className="muted">{data.faults.length} 条记录</span>
      </div>
      {data.faults.length ? (
        <div className="fault-grid">
          {data.faults.map((fault) => (
            <button
              className="card fault-card"
              key={fault.id}
              onClick={() => setSelected(fault)}
            >
              <div>
                <span
                  className={`badge ${fault.status === "replied" ? "badge-success" : fault.status === "need_info" ? "badge-warning" : "badge-blue"}`}
                >
                  {statusNames[fault.status]}
                </span>
                <small>{dateText(fault.createdAt)}</small>
              </div>
              <h3>{fault.title}</h3>
              <p>{fault.description}</p>
              <footer>
                <span>
                  {data.vehicles.find((v) => v.id === fault.vehicleId)?.plate} ·{" "}
                  {data.stores.find((s) => s.id === fault.storeId)?.name}
                </span>
                <ChevronRight size={18} />
              </footer>
            </button>
          ))}
        </div>
      ) : (
        <section className="card">
          <Empty
            title="暂时没有故障咨询"
            text="遇到异响、警示灯或其他异常，可以先把情况告诉专家。"
          >
            <button
              className="btn btn-secondary"
              disabled={!vehicle}
              onClick={() => setCreating(true)}
            >
              发起第一条咨询
            </button>
          </Empty>
        </section>
      )}
      {creating && vehicle && (
        <CreateFault
          data={data}
          vehicle={vehicle}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await onRefresh();
            onSuccess("故障咨询已提交，请留意专家回复");
          }}
        />
      )}{" "}
      {current && (
        <FaultDetail
          fault={current}
          data={data}
          onClose={() => setSelected(null)}
          onRefresh={onRefresh}
          onSuccess={onSuccess}
        />
      )}
    </>
  );
}
function CreateFault({
  data,
  vehicle,
  onClose,
  onCreated,
}: {
  data: Bootstrap;
  vehicle: Vehicle;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  const danger = /制动|刹车失灵|冒烟|起火|转向失灵/.test(description);
  return (
    <Modal
      title="描述爱车的异常"
      subtitle="照片和具体条件越清楚，专家越容易理解问题。"
      onClose={onClose}
      wide
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const values = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            const imageUrls: string[] = [];
            for (const file of files) {
              const form = new FormData();
              form.set("file", file);
              const uploaded = await api<{ url: string; id: string }>(
                "/files",
                { method: "POST", body: form },
              );
              imageUrls.push(uploaded.url);
            }
            await post("/faults", {
              vehicleId: values.get("vehicleId"),
              storeId: values.get("storeId"),
              title: values.get("title"),
              description,
              conditions: values.get("conditions"),
              occurredAt: asDateTime(String(values.get("occurredAt"))),
              imageUrls,
            });
            await onCreated();
          } catch (e) {
            setError(messageOf(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            咨询车辆
            <select name="vehicleId" defaultValue={vehicle.id}>
              {data.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.plate}
                </option>
              ))}
            </select>
          </label>
          <label>
            选择服务门店
            <select name="storeId" required>
              <option value="">请选择一家门店</option>
              {data.stores
                .filter((s) => s.approved)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.isDemo ? "（演示门店）" : ""}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <label>
          问题标题
          <input
            name="title"
            required
            maxLength={100}
            placeholder="例如：低速行驶时，左前轮有异响"
          />
        </label>
        <label>
          异常描述
          <textarea
            required
            rows={4}
            maxLength={3000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="出现了什么现象？警示灯、声音、频率，以及已经做过的处理…"
          />
        </label>
        {danger && (
          <div className="feedback feedback-error">
            <ShieldAlert size={20} />
            <span>
              描述可能涉及驾驶安全。请停稳车辆并联系救援，在线咨询不能替代现场检查。
            </span>
          </div>
        )}
        <div className="form-grid">
          <label>
            发生条件
            <input
              name="conditions"
              required
              maxLength={300}
              placeholder="例如：冷车启动、低速转弯时"
            />
          </label>
          <label>
            发现时间（北京时间）
            <input
              type="datetime-local"
              name="occurredAt"
              required
              max={localTimeInput()}
              defaultValue={localTimeInput()}
            />
          </label>
        </div>
        <label className="file-picker">
          <ImagePlus size={24} />
          <span>
            {files.length
              ? `已选择 ${files.length} 张照片`
              : "添加故障照片（可选，最多4张）"}
          </span>
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const next = Array.from(e.target.files || []);
              if (
                next.length > 4 ||
                next.some((f) => f.size > 8 * 1024 * 1024)
              ) {
                setError("最多选择4张图片，每张不超过8MB。");
                return;
              }
              setFiles(next);
              setError("");
            }}
          />
        </label>
        {files.length > 0 && (
          <p className="form-hint">{files.map((f) => f.name).join("、")}</p>
        )}
        <ErrorBox message={error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            暂不提交
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? "正在提交…" : "提交给门店专家"}
            <ArrowRight size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function FaultDetail({
  fault,
  data,
  onClose,
  onRefresh,
  onSuccess,
}: {
  fault: Fault;
  data: Bootstrap;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSuccess: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [supplement, setSupplement] = useState("");
  const [agree, setAgree] = useState(false);
  const navigate = useNavigate();
  const mutate = async (path: string, body: unknown, message: string) => {
    setBusy(true);
    setError("");
    try {
      await post(path, body);
      await onRefresh();
      onSuccess(message);
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={fault.title}
      subtitle={`${data.stores.find((s) => s.id === fault.storeId)?.name || "服务门店"} · ${dateText(fault.createdAt, true)}`}
      onClose={onClose}
      wide
    >
      <div className="fault-detail">
        <span className="badge badge-blue">{statusNames[fault.status]}</span>
        <h3>你描述的情况</h3>
        <p className="preserve-lines">{fault.description}</p>
        <dl className="detail-list">
          <div>
            <dt>发生条件</dt>
            <dd>{fault.conditions}</dd>
          </div>
          <div>
            <dt>发现时间</dt>
            <dd>{dateText(fault.occurredAt, true)}</dd>
          </div>
        </dl>
        {fault.imageUrls.length > 0 && (
          <div className="fault-images">
            {fault.imageUrls.map((url) => (
              <a href={url} key={url} target="_blank" rel="noreferrer">
                <img src={url} alt="车主上传的故障照片" />
              </a>
            ))}
          </div>
        )}{" "}
        {fault.reply ? (
          <section className="expert-reply">
            <div className="expert-reply-heading">
              <span className="icon-tile icon-tile-blue">
                <MessageCircle size={21} />
              </span>
              <div>
                <h3>门店专家的建议</h3>
                <small>基于现有资料的初步判断</small>
              </div>
            </div>
            <p className="preserve-lines">{fault.reply}</p>
            <dl className="detail-list">
              <div>
                <dt>维修预估</dt>
                <dd>
                  {fault.estimateLowCents == null
                    ? "需进一步检查后报价"
                    : `${cents(fault.estimateLowCents)} — ${cents(fault.estimateHighCents)}`}
                </dd>
              </div>
              <div>
                <dt>诊断费用</dt>
                <dd>
                  {fault.diagnosisCents == null
                    ? "需到店确认"
                    : cents(fault.diagnosisCents)}
                </dd>
              </div>
              <div>
                <dt>不确定因素</dt>
                <dd>{fault.uncertainty || "需现场检查确认具体方案。"}</dd>
              </div>
            </dl>
            <div className="notice-note">
              <CircleHelp size={18} />
              <span>
                预估区间不等于确定总价。预约时请另行核对实际服务项目、范围和报价。
              </span>
            </div>
            {fault.status === "replied" &&
              (!fault.confirmed ? (
                <>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={agree}
                      onChange={(e) => setAgree(e.target.checked)}
                    />
                    <span>
                      我已理解专家建议、诊断费和估价不确定性，同意按以上范围继续沟通服务。
                    </span>
                  </label>
                  <button
                    className="btn btn-primary"
                    disabled={busy || !agree}
                    onClick={() =>
                      mutate(
                        `/faults/${fault.id}/confirm`,
                        {},
                        "服务范围已确认，可以查看该店服务与时段",
                      )
                    }
                  >
                    {busy ? "正在确认…" : "确认已理解服务范围"}
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    onClose();
                    navigate(
                      `/stores?fault=${fault.id}&store=${fault.storeId}`,
                    );
                  }}
                >
                  选择该店服务与预约
                  <ArrowRight size={17} />
                </button>
              ))}
          </section>
        ) : (
          <div className="feedback feedback-info">
            咨询已送达门店，专家回复后会通过站内消息通知你。
          </div>
        )}
        {!["closed", "booked"].includes(fault.status) && (
          <form
            className="form-stack supplemental-form"
            onSubmit={(e) => {
              e.preventDefault();
              mutate(
                `/faults/${fault.id}/supplement`,
                { description: supplement },
                "补充资料已发送",
              ).then((saved) => {
                if (saved) setSupplement("");
              });
            }}
          >
            <label>
              补充问题信息
              <textarea
                rows={3}
                required
                maxLength={2000}
                placeholder="补充新的现象、发生条件或检查结果"
                value={supplement}
                onChange={(e) => setSupplement(e.target.value)}
              />
            </label>
            <button
              className="btn btn-secondary"
              disabled={busy || !supplement.trim()}
            >
              发送补充信息
            </button>
          </form>
        )}
        <ErrorBox message={error} />
      </div>
    </Modal>
  );
}
