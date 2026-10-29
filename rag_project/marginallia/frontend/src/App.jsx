import { useEffect, useRef, useState } from "react";

const SUGGESTIONS = [
  "Summarize the main points",
  "What are the key takeaways?",
  "List any dates or numbers mentioned",
];

export default function App() {
  const [docs, setDocs] = useState([]); // { name, chunks, status }
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, asking]);

  async function ingest(files) {
    for (const file of files) {
      setDocs((d) => [{ name: file.name, status: "reading" }, ...d]);
      const body = new FormData();
      body.append("file", file);
      try {
        const res = await fetch("/api/ingest", { method: "POST", body });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Upload failed");
        setDocs((d) =>
          d.map((x) =>
            x.name === file.name && x.status === "reading"
              ? { ...x, status: "ready", chunks: data.chunks }
              : x
          )
        );
      } catch (err) {
        setDocs((d) =>
          d.map((x) =>
            x.name === file.name && x.status === "reading"
              ? { ...x, status: "error", error: err.message }
              : x
          )
        );
      }
    }
  }

  async function ask(text) {
    const q = (text ?? question).trim();
    if (!q || asking) return;
    setQuestion("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setAsking(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Something went wrong");
      setMessages((m) => [...m, { role: "ai", text: data.answer, sources: data.sources }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "ai", text: err.message, error: true }]);
    } finally {
      setAsking(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    ingest([...e.dataTransfer.files]);
  }

  return (
    <div className="app">
      <aside className="library">
        <h1 className="brand">Marginalia</h1>
        <p className="tagline">Ask questions. Get answers with the sources in the margin.</p>

        <div
          className={`drop ${dragging ? "over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <button className="drop-btn" onClick={() => fileInput.current.click()}>
            Add documents
          </button>
          <span className="hint">or drop PDF, TXT, MD files here</span>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept=".pdf,.txt,.md"
            onChange={(e) => { ingest([...e.target.files]); e.target.value = ""; }}
          />
        </div>

        <ul className="docs">
          {docs.map((d, i) => (
            <li key={i} className={`doc ${d.status}`}>
              <span className="doc-name" title={d.name}>{d.name}</span>
              <span className="doc-meta">
                {d.status === "reading" && "Indexing…"}
                {d.status === "ready" && `${d.chunks} passages`}
                {d.status === "error" && d.error}
              </span>
            </li>
          ))}
        </ul>
      </aside>

      <main className="desk">
        <div className="thread">
          {messages.length === 0 && (
            <div className="empty">
              <h2>What do you want to know?</h2>
              <p>Add a document on the left, then ask anything about it.</p>
              <div className="chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => ask(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="msg user">{m.text}</div>
            ) : (
              <div key={i} className={`msg ai ${m.error ? "error" : ""}`}>
                <div className="answer">{m.text}</div>
                {m.sources?.length > 0 && (
                  <div className="margin">
                    {m.sources.map((s, n) => (
                      <details key={n} className="note">
                        <summary>
                          <span className="note-n">{n + 1}</span>
                          <span className="note-src">{s.source}</span>
                          <span className="bar" style={{ "--w": `${Math.max(s.score, 0) * 100}%` }} />
                        </summary>
                        <p>{s.text}</p>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            )
          )}

          {asking && (
            <div className="msg ai">
              <div className="dots"><i /><i /><i /></div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about your documents"
            aria-label="Your question"
          />
          <button type="submit" disabled={asking || !question.trim()}>Ask</button>
        </form>
      </main>
    </div>
  );
}
