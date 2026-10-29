"""Marginalia: a minimal RAG backend with exactly two endpoints.

POST /api/ingest  -> upload a .pdf/.txt/.md file; it is chunked, embedded and stored in Pinecone
POST /api/ask     -> ask a question; relevant chunks are retrieved and Gemini answers from them
"""
import io
import os
import uuid

from google import genai

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sentence_transformers import SentenceTransformer
from google.genai import types
from pinecone import Pinecone, ServerlessSpec
from pydantic import BaseModel
from pypdf import PdfReader

load_dotenv()

EMBED_MODEL = os.getenv("EMBED_MODEL", "gemini-embedding-001")
EMBED_DIM = int(os.getenv("EMBED_DIM", "768"))
CHAT_MODEL = os.getenv("CHAT_MODEL", "gemini-2.5-flash")
INDEX_NAME = os.getenv("PINECONE_INDEX", "marginalia")

gemini = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
embedder = SentenceTransformer(EMBED_MODEL)
pc = Pinecone(api_key=os.environ["PINECONE_API_KEY"])

if not pc.has_index(INDEX_NAME):
    pc.create_index(
        name=INDEX_NAME,
        dimension=EMBED_DIM,
        metric="cosine",
        spec=ServerlessSpec(
            cloud=os.getenv("PINECONE_CLOUD", "aws"),
            region=os.getenv("PINECONE_REGION", "us-east-1"),
        ),
    )
index = pc.Index(INDEX_NAME)

app = FastAPI(title="Marginalia")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- helpers ----------
def extract_text(filename: str, data: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        reader = PdfReader(io.BytesIO(data))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    if name.endswith((".txt", ".md")):
        return data.decode("utf-8", errors="ignore")
    raise HTTPException(400, "Unsupported file type. Use .pdf, .txt or .md")


def chunk_text(text: str, size: int = 1000, overlap: int = 150) -> list[str]:
    text = " ".join(text.split())
    chunks, start = [], 0
    while start < len(text):
        chunks.append(text[start : start + size])
        start += size - overlap
    return [c for c in chunks if c.strip()]


QUERY_PREFIX = "Represent this sentence for searching relevant passages: "

def embed(texts: list[str], task_type: str) -> list[list[float]]:
    # BGE models expect a prefix on queries, but not on documents
    if task_type == "RETRIEVAL_QUERY":
        texts = [QUERY_PREFIX + t for t in texts]
    return embedder.encode(texts, normalize_embeddings=True).tolist()


# ---------- API 1: ingest ----------
@app.post("/api/ingest")
async def ingest(file: UploadFile = File(...)):
    text = extract_text(file.filename or "", await file.read())
    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(400, "No readable text found in this file.")

    vectors = embed(chunks, "RETRIEVAL_DOCUMENT")
    doc_id = uuid.uuid4().hex[:8]
    records = [
        {
            "id": f"{doc_id}-{i}",
            "values": vec,
            "metadata": {"text": chunk, "source": file.filename, "chunk": i},
        }
        for i, (chunk, vec) in enumerate(zip(chunks, vectors))
    ]
    for i in range(0, len(records), 100):
        index.upsert(vectors=records[i : i + 100])

    return {"filename": file.filename, "chunks": len(chunks)}


# ---------- API 2: ask ----------
class AskRequest(BaseModel):
    question: str


@app.post("/api/ask")
async def ask(req: AskRequest):
    question = req.question.strip()
    if not question:
        raise HTTPException(400, "Question is empty.")

    query_vec = embed([question], "RETRIEVAL_QUERY")[0]
    result = index.query(vector=query_vec, top_k=5, include_metadata=True)
    matches = result.matches

    if not matches:
        return {"answer": "Your library is empty. Add a document first.", "sources": []}

    context = "\n\n".join(
        f"[{i + 1}] ({m.metadata['source']})\n{m.metadata['text']}"
        for i, m in enumerate(matches)
    )
    prompt = (
        "Answer the question using only the context below. "
        "Cite sources inline like [1] or [2]. "
        "If the context does not contain the answer, say you could not find it.\n\n"
        f"Context:\n{context}\n\nQuestion: {question}"
    )
    response = gemini.models.generate_content(model=CHAT_MODEL, contents=prompt)

    return {
        "answer": response.text,
        "sources": [
            {
                "source": m.metadata["source"],
                "text": m.metadata["text"],
                "score": round(m.score, 3),
            }
            for m in matches
        ],
    }
