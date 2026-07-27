# Store all the models here
from pydantic import BaseModel
from typing import List, Optional

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


class PageItem(BaseModel):
    title: str
    url: str


class PageReasoningRequest(BaseModel):
    summary: str
    top_items: List[PageItem]


class RankedPage(BaseModel):
    url: str
    title: str
    reason: str = ""


class PageReasoningResponse(BaseModel):
    pages: List[RankedPage]
    reason: Optional[str] = None


class EmbedItemsRequest(BaseModel):
    uncached_items: List[PageItem]


class PromptRequest(BaseModel):
    prompt: str


class ExpandedPromptResponse(BaseModel):
    expanded_query: str
    embeddings: List[float]

