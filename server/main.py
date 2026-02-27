import json
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
    

class ReasoningResponse(BaseModel):
    url: str
    title: str
    pages: list[Union[BookmarkItem, SearchHistoryItem]]
    reasoning: str

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
        ID: {req.id}
        Fav Icon: {req.favIcon}
        Body: {req.body}

        DATA PRIORITY:
        - Prioritise Body > Title > Description.
        - Use the URL ONLY if it clearly encodes semantic meaning (e.g. technical documentation paths).
        - IGNORE Fav Icon and ID entirely.

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
            model="text-embedding-004",
            contents=f"{req.name}\n{req.description}\n{summary}",
        )
        embedding = embed_resp.embeddings[0].values
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Embedding failed: {e}")

    return {
        "summary": summary,
        "embedding": embedding,
    }

@app.post("/page-reasoning", response_model=ReasoningResponse)
def page_reasoning(req: PageDataResponse):

    ### 1. Build Prompt:

    prompt = f"""
        You are a reasoning system that helps decide HOW to search a user's saved pages.

        You are NOT allowed to recommend specific pages or URLs.

        INPUT:
        Current page summary:
        {req.summary}

        TASK:
        Infer the user's current intent and decide:
        - What topic this page is about
        - What kinds of previously visited or bookmarked pages would be relevant
        - What should be excluded

        OUTPUT FORMAT (STRICT JSON):
        {{
            "url": str
            "title": str
            "pages": list[Union[BookmarkItem, SearchHistoryItem]]
        }}

        Rules:
        - Do NOT invent pages
        - Do NOT mention websites unless implied by the summary
        - Be concise and concrete
    """

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )

        reasoning = json.loads(response.text)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Summary failed: {e}")

    return reasoning