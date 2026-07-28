import ipaddress
import socket
from urllib.parse import urlparse
 
import requests
from bs4 import BeautifulSoup
 
# Text below this is a login wall, an SPA shell, or an error stub — not content.
MIN_USABLE_CHARS = 600
 
# Everything past this is diminishing returns for a 4-5 sentence summary, and
# uncapped input is how one arXiv PDF costs as much as fifty blog posts.
MAX_FETCH_CHARS = 12_000
 
FETCH_TIMEOUT_S = 10
 
# Some sites 403 anything that doesn't look like a browser.
BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
 
# Tags that are never page content. Dropping them before get_text keeps the
# 12k budget spent on prose rather than nav chrome.
BOILERPLATE_TAGS = ("script", "style", "nav", "footer", "header", "noscript", "aside", "form")
 
 
def is_safe_url(url: str) -> bool:
    """
    Blocks SSRF. This endpoint fetches URLs supplied by a client, so without
    this check anyone holding the API secret could use the server to reach
    localhost, cloud metadata endpoints, or anything else on the private
    network the server sits in.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        if not parsed.hostname:
            return False
 
        # Resolve first: a public-looking hostname can still point at 127.0.0.1.
        for info in socket.getaddrinfo(parsed.hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return False
        return True
    except Exception:
        return False
 
 
def extract_text(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(BOILERPLATE_TAGS):
        tag.decompose()
    return " ".join(soup.get_text(" ").split())
 
 
def fetch_page_text(url: str) -> tuple[str, str]:
    """
    Returns (text, status). status is one of: ok | unsafe | http_error |
    not_html | too_short | fetch_error. Anything other than 'ok' means the
    caller should cache the URL as unfetchable and never retry it.
    """
    if not is_safe_url(url):
        return "", "unsafe"
 
    try:
        res = requests.get(
            url,
            headers={"User-Agent": BROWSER_UA},
            timeout=FETCH_TIMEOUT_S,
            allow_redirects=True,
        )
    except Exception:
        return "", "fetch_error"
 
    if res.status_code != 200:
        return "", "http_error"
 
    # PDFs and binaries need different extraction; BeautifulSoup returns noise.
    content_type = res.headers.get("content-type", "")
    if "html" not in content_type.lower():
        return "", "not_html"
 
    text = extract_text(res.text)
    if len(text) < MIN_USABLE_CHARS:
        return "", "too_short"
 
    return text[:MAX_FETCH_CHARS], "ok"