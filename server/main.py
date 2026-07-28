import json
import os
import threading
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Header, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from google import genai
from google.genai import types
from typing import List, Optional, Union
from utils.helpers import extract_url, list_chunker
from utils.backfill_helpers import fetch_page_text
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from utils.models import (
    PageDataRequest,
    PageDataResponse,
    PageItem,
    PageReasoningRequest,
    PageReasoningResponse,
    RankedPage,
    EmbedItemsRequest,
    PromptRequest,
    ExpandedPromptResponse,
    BackfillItem,
    BackfillRequest,
    BackfillResponse,
)
import logging

load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Gemini call counter, read via /stats. Counts only — no URLs, no content, no
# user identity — so it doesn't touch the "we store nothing" claim.
#
# Embeddings are counted per ITEM, not per call: Gemini bills per input, so one
# batched call with 100 titles costs ~100x a single-title call. Generation is
# counted per call.
#
# In-memory, so it resets on every deploy and whenever Render spins the
# instance down.
call_counts = Counter()

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

MAX_BACKFILL_URLS = 10
FETCH_WORKERS = 10

logger = logging.getLogger("uvicorn.error")


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


@app.get("/stats", dependencies=[Depends(require_secret)])
def stats():
    """
    Gemini call counts since the last restart. To get cost-per-search: read
    this, run one search, read it again, and diff. Multiply the delta by any
    candidate-count increase you're considering before making it.
    """
    return dict(call_counts)


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
        call_counts["process_page.generate"] += 1
        summary_resp = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=NO_THINKING,
        )
        summary = summary_resp.text.strip()
    except Exception:
        logger.exception("summary failed")
        raise HTTPException(status_code=500, detail="Summary failed")

    # ---- 3. Generate embedding ----
    try:
        call_counts["process_page.embed"] += 1
        embed_resp = client.models.embed_content(
            model="gemini-embedding-001",
            contents=f"{req.name}\n{req.description}\n{summary}",
            config={"task_type": "RETRIEVAL_DOCUMENT"}
        )
        embedding = embed_resp.embeddings[0].values
    except Exception:
        logger.exception("embedding failed")
        raise HTTPException(status_code=500, detail="Embedding failed")

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
            ],
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
        call_counts["page_reasoning.generate"] += 1
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=NO_THINKING,
        )
        text = response.text.strip().removeprefix("```json").removesuffix("```").strip()
        reasoning = json.loads(text)
    except Exception:
        logger.exception("reasoning failed")
        raise HTTPException(status_code=500, detail="Reasoning failed")

    return reasoning


@app.post("/embed-uncached", response_model=List[List[float]], dependencies=[Depends(require_secret)])
@limiter.limit("30/minute")
def embed_uncached(request: Request, req: EmbedItemsRequest):
    # Create embeddings for uncached item
    # Chunks the list of uncached embeddings since Gemini can only accept a maximum of 100 items
    # for each call.

    chunked_list = list_chunker(req.uncached_items, 100)
    accumulated_chunks = []

    try:
        for chunked_items in chunked_list:
            # Per item, not per call: this is the endpoint that scales with
            # maxResults, so it's the one to watch before raising the cap.
            call_counts["embed_uncached.embed"] += len(chunked_items)
            embed_response = client.models.embed_content(
                model="gemini-embedding-001",
                contents=[item.title.strip() or item.url or "untitled" for item in chunked_items],
                config={"task_type": "RETRIEVAL_DOCUMENT"},
            )
            accumulated_chunks.extend([e.values for e in embed_response.embeddings])
    except Exception as e:
        logger.error("embed_uncached failed: %s", type(e).__name__)
        raise HTTPException(status_code=500, detail="embed_failed")

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
        call_counts["expand_prompt.generate"] += 1
        prompt_res = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=NO_THINKING,
        )
        expanded_query = prompt_res.text.strip()

        # generate embeddings for the expanded prompt

        call_counts["expand_prompt.embed"] += 1
        embed_resp = client.models.embed_content(
            model="gemini-embedding-001",
            contents=f"{expanded_query}",
            config={"task_type": "RETRIEVAL_QUERY"}
        )
        embeddings = embed_resp.embeddings[0].values
    except Exception:
        logger.exception("expansion failed")
        raise HTTPException(status_code=500, detail="Expansion failed")

    return {
        "expanded_query": expanded_query,
        "embeddings": embeddings,
    }


@app.post("/backfill", response_model=BackfillResponse, dependencies=[Depends(require_secret)])
@limiter.limit("10/minute")
def backfill(request: Request, req: BackfillRequest):
    """
        Re-fetches pages the extension only has a title and URL for (history and
        bookmarks predating install), and returns a content-based summary and
        embedding for each. Roughly half of real-world URLs are unrecoverable —
        login walls and client-rendered apps return no text — so every URL carries
        its own status and one failure never fails the batch.
    """
    # Get the first 10 urls to avoid over-requesting
    urls = req.urls[:MAX_BACKFILL_URLS]
    if not urls:
        return {"items": []}

    # ---- 1. Fetch in parallel ----
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as pool:
        fetched = list(pool.map(fetch_page_text, urls))

    results: List[dict] = []
    summarisable: List[tuple[int, str, str]] = []  # (index : int, url : str, text : str)

    for i, (text, status) in enumerate(fetched):
        results.append({"url": urls[i], "summary": "", "embedding": [], "status": status})
        if status == "ok":
            summarisable.append((i, urls[i], text))

    if not summarisable:
        return {"items": results}

    # ---- 2. Summarise each fetched page ----
    # This loop is the expensive half: up to MAX_BACKFILL_URLS generate calls
    # per search, against one batched embed call in step 3.
    for i, url, text in summarisable:
        prompt = f"""
            You are an information extraction system.
 
            Describe the SUBJECT MATTER of the page below, using ONLY the
            content provided. Do not invent context or rely on prior knowledge
            of the website.
 
            DISALLOWED CONTENT:
            - IGNORE navigation, sidebars, headers, footers, buttons, UI labels.
            - IGNORE cookie notices, legal boilerplate, and subscription prompts.
            - DO NOT describe the website or app itself unless the main content
              explicitly discusses it.
 
            FOCUS RULES:
            - Begin by stating the subject matter directly.
            - Identify ONE dominant topic. Do NOT blend unrelated topics.
            - Write as a neutral encyclopedia entry about the subject matter.
 
            INPUT:
            URL: {url}
            Body: {text}
 
            OUTPUT FORMAT (STRICT):
            A single paragraph, 4 to 5 sentences, covering the primary topic,
            what someone reading this page would be trying to learn or do, and
            the key technical or conceptual details.
 
            FAILURE CONDITION:
            If there is not enough meaningful content to describe the subject,
            respond EXACTLY with:
            INSUFFICIENT_CONTEXT
        """

        try:
            call_counts["backfill.generate"] += 1
            resp = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=NO_THINKING
            )
            summary = (resp.text or "").strip()
        except Exception as e:
            logger.error("backfill summary failed: %s", type(e).__name__)
            results[i]["status"] = "summary_error"
            continue

        if not summary or summary == "INSUFFICIENT_CONTEXT":
            results[i]["status"] = "no_signal"
            continue

        results[i]["summary"] = summary

    # ---- 3. Embed the summaries in one batched call ----
    embed_targets = [r for r in results if r["summary"]]
    if embed_targets:
        try:
            call_counts["backfill.embed"] += len(embed_targets)
            embed_resp = client.models.embed_content(
                model="gemini-embedding-001",
                contents=[r["summary"] for r in embed_targets],
                config={"task_type": "RETRIEVAL_DOCUMENT"},
            )
            for r, e in zip(embed_targets, embed_resp.embeddings):
                r["embedding"] = e.values
                r["status"] = "ok"
        except Exception as e:
            logger.error("backfill embed failed: %s", type(e).__name__)
            for r in embed_targets:
                r["status"] = "embed_error"
                r["summary"] = ""
 
    return {"items": results}