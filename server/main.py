import json
import math
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import os
from google import genai
from typing import List, Optional, Union


load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["chrome-extension://*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------- Models --------

class PageDataRequest(BaseModel):
    id: int
    name: str
    url: str
    favIcon: str
    description: str
    body: str


class PageDataResponse(BaseModel):
    summary: str
    embedding: List[float]


class BookmarkItem(BaseModel):
    url: str
    title: str
    summary: str
    favIcon: Optional[str] = ""
    tags: Optional[List[str]] = None


class SearchHistoryItem(BaseModel):
    url: str
    title: str
    summary: str
    timestamp: Optional[str] = None
    query: Optional[str] = None


class PageReasoningRequest(BaseModel):
    summary: str
    bookmarks: List[BookmarkItem]
    history: List[SearchHistoryItem]

class RankedPage(BaseModel):
    url: str
    title: str
    reason: str

class PageReasoningResponse(BaseModel):
    pages: List[RankedPage]


class CompareRequest(BaseModel):
    embedding: List[float]
    bookmarks: List[BookmarkItem]
    history: List[SearchHistoryItem]

class ScoredPage(BaseModel):
    url: str
    title: str
    score: float

class CompareResponse(BaseModel):
    pages: List[ScoredPage]

# -------- Routes --------

@app.get("/")
def health():
    return {"status": "ok"}


@app.post("/process-page", response_model=PageDataResponse)
def process_page(req: PageDataRequest):

    # ---- 1. Build prompt dynamically ----
    prompt = f"""
        You are an information extraction system.

        Your task is to infer the PRIMARY INTENT of the user based ONLY on the content provided on the page.
        You are NOT allowed to invent context or rely on prior knowledge of the website.

        You must follow the rules below STRICTLY.

        DISALLOWED CONTENT:
        - IGNORE navigation menus, sidebars, headers, footers, buttons, UI labels, account controls, and repeated interface text.
        - IGNORE generic platform disclaimers, legal text, onboarding hints, or boilerplate.
        - DO NOT describe the website or app itself unless the main content explicitly discusses it.

        FOCUS RULES:
        - Summaries MUST begin by stating the subject matter directly.
        - Focus ONLY on the main semantic content and the current interaction or discussion.
        - Identify ONE dominant topic or problem. Do NOT blend multiple unrelated topics.
        - DO NOT describe the structure, flow, or progression of the conversation or interaction.
        - DO NOT mention that the content is part of a discussion, framework, or guided process.
        - Extract ONLY the subject matter being discussed, not how it is being discussed.
        - DO NOT describe conversations, discussions, explorations, or thought processes.
        - Rewrite the content as if it were a neutral encyclopedia entry about the subject matter.

        INTENT QUESTION:
        "What is the user likely reading, working on, or thinking about on this page right now?"

        INPUT FORMAT:
        Title: {req.name}
        Description: {req.description}
        URL: {req.url}
        Body: {req.body}

        DATA PRIORITY:
        - Prioritise Body > Title > Description.
        - Use the URL ONLY if it clearly encodes semantic meaning (e.g. technical documentation paths).

        OUTPUT FORMAT (STRICT):
        Return a single paragraph (4 to 5 sentences) describing:
        1. The primary topic or problem
        2. The user's likely intent
        3. Key technical, conceptual, or contextual details

        FAILURE CONDITION:
        If the provided content does not contain enough meaningful signal to confidently infer user intent,
        respond EXACTLY with:
        INSUFFICIENT_CONTEXT
    """

    # ---- 2. Generate summary ----
    try:
        summary_resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        summary = summary_resp.text.strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Summary failed: {e}")

    # ---- 3. Generate embedding ----
    try:
        embed_resp = client.models.embed_content(
            model="gemini-embedding-001",
            contents=f"{req.name}\n{req.description}\n{summary}",
        )
        embedding = embed_resp.embeddings[0].values
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {e}")

    return {
        "summary": summary,
        "embedding": embedding,
    }


@app.post("/page-reasoning", response_model=PageReasoningResponse)
def page_reasoning(req: PageReasoningRequest):

    bookmarks_text = "\n".join(
        [f"- [{b.title}]({b.url})" for b in req.bookmarks]
    ) or "None"

    history_text = "\n".join(
        [f"- [{h.title}]({h.url})" for h in req.history]
    ) or "None"

    prompt = f"""
        You are a relevance ranking system for a browser extension.

        The user is currently on a page with this intent:
        {req.summary}

        Below are the user's bookmarks and recent history. Return the top 3 most relevant pages.

        BOOKMARKS:
        {bookmarks_text}

        RECENT HISTORY:
        {history_text}

        OUTPUT FORMAT (strict JSON, no markdown fences):
        {{
            "pages": [
                {{"url": "...", "title": "...", "reason": "one sentence why it's relevant"}},
                ...
            ]
        }}

        Rules:
        - Only return pages from the lists above. Do NOT invent URLs.
        - Do NOT return the current page. The current page is seen by the user and is not relevant to the user's intent.
        - Return at most 5 pages. Do NOT pad with weak results just to reach 5. 
        - If nothing is relevant, return an empty list.
        """

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        text = response.text.strip().removeprefix("```json").removesuffix("```").strip()
        reasoning = json.loads(text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reasoning failed: {e}")

    return reasoning


# helper func
def cosine_similarity(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)

@app.post("/compare-pages", response_model=CompareResponse)
def compare_pages(req: CompareRequest):
     # Cap candidates to avoid slow embedding calls
    candidates = [
        {"url": b.url, "title": b.title} for b in req.bookmarks[:30]
    ] + [
        {"url": h.url, "title": h.title} for h in req.history[:20]
    ]

    # Embed all candidates in one batch call
    texts = [f"{c['title']}\n{c['url']}" for c in candidates]

    try:
        embed_resp = client.models.embed_content(
            model="gemini-embedding-001",
            contents=texts,
        )
        embeddings = [e.values for e in embed_resp.embeddings]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {e}")

    # Score each candidate
    scored = []
    for candidate, embedding in zip(candidates, embeddings):
        score = cosine_similarity(req.embedding, embedding)
        scored.append({
            "url": candidate["url"],
            "title": candidate["title"],
            "score": score,
        })

    # Sort and return top 5
    top = sorted(scored, key=lambda x: x["score"], reverse=True)[:5]

    return {"pages": top}