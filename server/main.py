from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import os
from google import genai

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
    embedding: list[float]


# -------- Routes --------

@app.get("/")
def health():
    return {"status": "ok"}


@app.post("/process-page", response_model=PageDataResponse)
def process_page(req: PageDataRequest):

    # ---- 1. Build prompt dynamically ----
    prompt = f"""
        You are an AI assistant and your job is to summarise the following web page as best as possible.
        When summarising, IGNORE ads, menus, cookie notices, and navigation. The page structure is the following:

        Title: {req.name}
        Description: {req.description}
        URL: {req.url}
        ID: {req.id}
        Fav Icon: {req.favIcon}
        Body: {req.body}

        You should use the data as MEANINGFULLY as possible and should extract ALL the meaning, context, and the intent of 
        the page by looking at the page data. When extracting meaning and context, IGNORE the Fav Icon and ID
        of the page, and make the title, description, and the body of the page a PRIORITY. You should still consider
        the URL of the page, but when it comes to documentation pages, or technical pages, make it a priority along 
        others as well. 

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
