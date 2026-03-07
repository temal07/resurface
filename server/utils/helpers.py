# helper func
from typing import List
import re
import math

def cosine_similarity(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def extract_url(url: str) -> str:
    cleaned = re.sub(r'https?://(www\.)?|\.com|\.net|\.edu|\.org|\.io', '', url)
    return re.sub(r'[/\-_]', ' ', cleaned).strip()


def list_chunker(lst, chunk_size) -> list: 
    return [lst[i: i+ chunk_size] for i in range(0, len(lst), chunk_size)]