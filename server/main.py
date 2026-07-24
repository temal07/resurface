import json
import os
import threading
import time
import urllib.request
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from google import genai
from google.genai import types
from typing import List, Optional, Union
from utils.helpers import cosine_similarity, extract_url, list_chunker
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from utils.models import (
    PageDataRequest,
    PageDataResponse,
    BookmarkItem,
    SearchHistoryItem,
    PageItem,
    PageReasoningRequest,
    PageReasoningResponse,
    RankedPage,
    CompareRequest,
    ScoredPage,
    CompareResponse,
    EmbedItemsRequest,
    PromptRequest,
    ExpandedPromptResponse,
)

load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# gemini-2.5-flash runs an internal "thinking" pass before answering, adding
# several seconds per call. Extraction/ranking/expansion don't need reasoning
# tokens, so disable it (budget=0) to cut latency on the hot path.
NO_THINKING = types.GenerateContentConfig(
    thinking_config=types.ThinkingConfig(thinking_budget=0)
)

# Shared secret the extension must send on every data request. Without it the
# API is open to anyone who reads the backend URL out of the shipped extension.
API_SECRET = os.getenv("API_SECRET")

# Cap the page text fed to Gemini so a single request can't run up a huge call.
MAX_BODY_CHARS = 20_000


def require_secret(x_api_key: str = Header(default="")):
    # CORS does not protect this API (it's a browser read-permission mechanism,
    # ignored by curl/scripts/bots). This header check is the actual gate.
    if not API_SECRET or x_api_key != API_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")


def client_ip(request: Request) -> str:
    # Render sits behind a proxy, so the real caller is in X-Forwarded-For;
    # without this every user would share one rate-limit bucket (the proxy IP).
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else get_remote_address(request)


limiter = Limiter(key_func=client_ip, default_limits=["60/minute"])

# Render sets RENDER_EXTERNAL_URL to the service's public URL. On the free tier
# the instance spins down after ~15 min with no inbound traffic, so the next
# request eats a ~30-50s cold start. Pinging our own health endpoint below that
# window keeps the instance warm. No-op locally (env var unset).
SELF_URL = os.getenv("RENDER_EXTERNAL_URL")
KEEPALIVE_INTERVAL_S = 600  # 10 min, comfortably under Render's 15-min idle timeout


def _keepalive_loop() -> None:
    while True:
        time.sleep(KEEPALIVE_INTERVAL_S)
        try:
            urllib.request.urlopen(f"{SELF_URL}/", timeout=10).close()
        except Exception:
            pass  # transient failure; just try again next tick


@asynccontextmanager
async def lifespan(app: FastAPI):
    if SELF_URL:
        threading.Thread(target=_keepalive_loop, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS is not the security boundary (the secret is), but fix the dead wildcard
# so it at least expresses intent: Starlette matches origins exactly and has no
# support for "chrome-extension://*", so the old value matched nothing.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------- Routes --------

@app.get("/")
def health():
    return {"status": "ok"}


@app.post("/process-page", response_model=PageDataResponse, dependencies=[Depends(require_secret)])
@limiter.limit("20/minute")
def process_page(request: Request, req: PageDataRequest):

    safe_body = req.body[:MAX_BODY_CHARS]

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
        Body: {safe_body}

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
            config=NO_THINKING,
        )
        summary = summary_resp.text.strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Summary failed: {e}")

    # ---- 3. Generate embedding ----
    try:
        embed_resp = client.models.embed_content(
            model="gemini-embedding-001",
            contents=f"{req.name}\n{req.description}\n{summary}",
            config={"task_type": "RETRIEVAL_DOCUMENT"}
        )
        embedding = embed_resp.embeddings[0].values
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {e}")

    return {
        "summary": summary,
        "embedding": embedding,
    }


@app.post("/page-reasoning", response_model=PageReasoningResponse, dependencies=[Depends(require_secret)])
@limiter.limit("30/minute")
def page_reasoning(request: Request, req: PageReasoningRequest):

    page_items_text = "\n".join(
        [f"- [{item.title}]({item.url})" for item in req.top_items]
    )

    prompt = f"""
        You are a relevance ranking system for a browser extension.

        The user is currently on a page with this intent:
        {req.summary}

        Below are the relevant_pages:
        {page_items_text}

        OUTPUT FORMAT (strict JSON, no markdown fences):
        {{
            "pages": [
                {{"url": "...", "title": "...", "reason": "one sentence why it's relevant"}},
                ...
            ]
            "reason": "brief phrase (5-8 words) explaining why nothing matched, or null if pages is not empty"
        }}

        Rules:
        - Only return pages from the lists above. Do NOT invent URLs.
        - Do NOT return the current page. The current page is seen by the user and is not relevant to the user's intent.
        - Return at most 5 pages. Do NOT pad with weak results just to reach 5. 
        - If nothing is relevant, return an empty pages list and fill the reason field with a specific brief phrase explanation — NOT generic. Reference the user's actual intent and why the available pages don't match it.
        - NEVER return an empty pages list without a "reason" field. If pages is empty, "reason" is REQUIRED (Example: when nothing matches: {{"pages": [], "reason": "No ML resources in your history"}})
        """

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=NO_THINKING,
        )
        text = response.text.strip().removeprefix("```json").removesuffix("```").strip()
        reasoning = json.loads(text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reasoning failed: {e}")

    return reasoning


@app.post("/compare-pages", response_model=CompareResponse, dependencies=[Depends(require_secret)])
@limiter.limit("30/minute")
def compare_pages(request: Request, req: CompareRequest):
     # Cap candidates to avoid slow embedding calls
    candidates = [
        {"url": b.url, "title": b.title} for b in req.bookmarks[:30]
    ] + [
        {"url": h.url, "title": h.title} for h in req.history[:50]
    ]

    # Embed all candidates in one batch call
    texts = [f"{c['title']}" for c in candidates]

    try:
        embed_resp = client.models.embed_content(
            model="gemini-embedding-001",
            contents=texts,
            config={"task_type": "RETRIEVAL_DOCUMENT"}
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


@app.post("/embed-uncached", response_model=List[List[float]], dependencies=[Depends(require_secret)])
@limiter.limit("30/minute")
def embed_uncached(request: Request, req: EmbedItemsRequest):
    # Create embeddings for uncached item
    # Chunks the list of uncached embeddings since Gemini can only accept a maximum of 100 items
    # for each call.

   chunked_list = list_chunker(req.uncached_items, 100)
    accumulated_chunks = []

    for chunked_items in chunked_list:
        embed_response = client.models.embed_content(
            model="gemini-embedding-001",
            contents=[item.title for item in chunked_items],
            config={"task_type": "RETRIEVAL_DOCUMENT"},
        )
        accumulated_chunks.extend([e.values for e in embed_response.embeddings])

    return accumulated_chunks


@app.post("/expand-prompt", response_model=ExpandedPromptResponse, dependencies=[Depends(require_secret)])
@limiter.limit("30/minute")
def expand_prompt(request: Request, req: PromptRequest):
    # If the user types in something vague like 'recipes', 'anthropic docs', 'ts docs', etc. 
    # this endpoint will expand that query into a richer query that contains user intent based on the words
    # written

    prompt = f"""
        You are a a search query expander. Given a short user query, 
        write 2-3 sentences describing what the user likely wants to 
        find, including related topics, synonyms, and context. Be 
        specific and semantic-rich.

        The query is: {req.prompt}      
    """

    try:
        prompt_res = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=NO_THINKING,
        )
        expanded_query = prompt_res.text.strip()

        # generate embeddings for the expanded prompt

        embed_resp = client.models.embed_content(
            model="gemini-embedding-001",
            contents=f"{expanded_query}",
            config={"task_type": "RETRIEVAL_QUERY"}
        )
        embeddings = embed_resp.embeddings[0].values
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Expansion failed: {e}")

    return {
        "expanded_query": expanded_query,
        "embeddings": embeddings,
    }
