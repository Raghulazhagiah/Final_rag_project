# Marginalia: a minimal RAG app

React (Vite) + FastAPI + Pinecone + Gemini. Two endpoints:

- `POST /api/ingest`: upload a PDF/TXT/MD file, chunk it, embed it, store it in Pinecone
- `POST /api/ask`: embed a question, retrieve the top 5 chunks, answer with Gemini

## Run it

Backend (Python 3.10+):

    cd backend
    python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
    pip install -r requirements.txt
    cp .env.example .env        # then fill in your two API keys
    uvicorn main:app --reload --port 8000

Frontend (Node 18+), in a second terminal:

    cd frontend
    npm install
    npm run dev

Open http://localhost:5173. The Pinecone index is created automatically on first start
(768 dimensions, cosine, serverless).
