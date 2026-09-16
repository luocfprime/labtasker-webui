import { useState, type ReactNode } from "react";

import { messages as m } from "./messages";

export function copyJson(value: unknown) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return navigator.clipboard.writeText(text);
}

export function JsonNode({
  label,
  value,
  depth = 0,
  copyable = true,
}: {
  label?: string;
  value: unknown;
  depth?: number;
  copyable?: boolean;
}) {
  const prefix =
    label === undefined ? null : <span className="json-key">{label}</span>;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const kind = Array.isArray(value) ? m.json.array : m.json.object;
    return (
      <details className="json-node" open={depth < 2}>
        <summary>
          {prefix}{" "}
          <span className="json-kind">
            {kind} · {entries.length}
          </span>
        </summary>
        {copyable && (
          <button
            className="json-copy"
            aria-label={m.json.copyValue(label)}
            onClick={() => void copyJson(value)}
          >
            {m.common.copy}
          </button>
        )}
        <div className="json-children">
          {entries.length ? (
            entries.map(([key, child]) => (
              <JsonNode
                key={key}
                label={key}
                value={child}
                depth={depth + 1}
                copyable={copyable}
              />
            ))
          ) : (
            <span className="json-empty">{m.common.empty}</span>
          )}
        </div>
      </details>
    );
  }
  let rendered: ReactNode;
  if (typeof value === "string" && /^https?:\/\/[^\s]+$/i.test(value)) {
    rendered = (
      <a href={value} target="_blank" rel="noopener noreferrer">
        {value}
      </a>
    );
  } else if (typeof value === "string") {
    rendered = <span className="json-string">{JSON.stringify(value)}</span>;
  } else if (value === null) {
    rendered = <span className="json-null">null</span>;
  } else {
    rendered = <span className="json-scalar">{String(value)}</span>;
  }
  return (
    <div className="json-leaf">
      {prefix} {rendered}
      {copyable && (
        <button
          aria-label={m.json.copyValue(label)}
          onClick={() => void copyJson(value)}
        >
          {m.common.copy}
        </button>
      )}
    </div>
  );
}

export function JsonBlock({
  title,
  value,
  meta,
}: {
  title: string;
  value: unknown;
  meta?: ReactNode;
}) {
  const [raw, setRaw] = useState(false);
  return (
    <section className="detail-section">
      <div className="section-title">
        <div className="section-heading">
          <h3>{title}</h3>
          {meta && <span className="section-meta">{meta}</span>}
        </div>
        <button className="link" onClick={() => setRaw(!raw)}>
          {raw ? m.json.tree : m.json.raw}
        </button>
        <button className="link" onClick={() => void copyJson(value)}>
          {m.common.copy}
        </button>
      </div>
      {raw ? (
        <pre>{JSON.stringify(value, null, 2)}</pre>
      ) : (
        <div className="json-tree">
          <JsonNode value={value} />
        </div>
      )}
    </section>
  );
}
