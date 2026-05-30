# Store all the models here
from pydantic import BaseModel

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


class PageItem(BaseModel):
    title: str
    url: str


class PageReasoningRequest(BaseModel):
    summary: str
    top_items: List[PageItem]


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


class EmbedItemsRequest(BaseModel):
    uncached_items: List[PageItem]


class PromptRequest(BaseModel):
    prompt: str


class ExpandedPromptResponse(BaseModel):
    expanded_query: str
    embeddings: List[float]

