import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  CheckCheck,
  ChevronRight,
  CalendarDays,
  Wrench,
  Info,
} from "lucide-react";
import type { Bootstrap, Notice } from "@autovoyage/shared";
import { post } from "../lib/api";
import { Empty, ErrorBox, dateText, messageOf } from "../components/UI";
export default function MessagesPage({
  data,
  onRefresh,
}: {
  data: Bootstrap;
  onRefresh: () => Promise<void>;
}) {
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const messages = data.messages.filter(
    (m) => filter !== "unread" || !m.readAt,
  );
  const read = async (message: Notice) => {
    try {
      if (!message.readAt) {
        await post(`/messages/${message.id}/read`);
        await onRefresh();
      }
      const link = message.link;
      if (link && link.startsWith("/") && !link.startsWith("//")) {
        const destination =
          link.startsWith("/appointments") ||
          link.startsWith("/vehicles") ||
          link === "/my"
            ? "/account"
            : link.startsWith("/faults") || link === "/repair"
              ? "/repairs"
              : link;
        navigate(destination);
      }
    } catch (e) {
      setError(messageOf(e));
    }
  };
  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">STAY IN THE KNOW</p>
          <h1>
            每一条消息，都有回音<span className="title-dot">。</span>
          </h1>
          <p>保养提醒、专家回复与服务进度，都在这里。</p>
        </div>
        <button
          className="btn btn-secondary"
          disabled={busy || data.messages.every((m) => m.readAt)}
          onClick={async () => {
            setBusy(true);
            try {
              await post("/messages/read-all");
              await onRefresh();
            } catch (e) {
              setError(messageOf(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <CheckCheck size={18} />
          {busy ? "正在更新…" : "全部标记已读"}
        </button>
      </div>
      <ErrorBox message={error} />
      <div className="tabs">
        <button
          className={filter === "all" ? "active" : ""}
          onClick={() => setFilter("all")}
        >
          全部消息 <span>{data.messages.length}</span>
        </button>
        <button
          className={filter === "unread" ? "active" : ""}
          onClick={() => setFilter("unread")}
        >
          未读 <span>{data.messages.filter((m) => !m.readAt).length}</span>
        </button>
      </div>
      <section className="card message-list">
        {messages.length ? (
          messages.map((message) => {
            const Icon = /appoint|booking|预约/.test(message.type)
              ? CalendarDays
              : /maintenance|保养/.test(message.type)
                ? Wrench
                : Bell;
            return (
              <button
                key={message.id}
                className={`message-row ${!message.readAt ? "unread" : ""}`}
                onClick={() => read(message)}
              >
                <span className="message-icon">
                  <Icon size={22} />
                </span>
                <span className="message-content">
                  <span>
                    <strong>{message.title}</strong>
                    {!message.readAt && <i aria-label="未读" />}
                    <time>{dateText(message.createdAt, true)}</time>
                  </span>
                  <span>{message.body}</span>
                </span>
                <ChevronRight size={19} />
              </button>
            );
          })
        ) : (
          <Empty
            title={filter === "unread" ? "未读消息都看完了" : "暂时没有新消息"}
            text="新的提醒和服务进度会在这里与你见面。"
          />
        )}
      </section>
    </>
  );
}
