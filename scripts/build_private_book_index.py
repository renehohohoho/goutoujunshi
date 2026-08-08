#!/usr/bin/env python3
"""Build a local-only private book index for Master Dog.

The generated index may contain excerpts from private books. Keep it out of git.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "mobile-app" / "private-book-index.json"
TEXT_SUFFIXES = {".txt", ".md"}
EPUB_SUFFIXES = {".epub"}
PDF_SUFFIXES = {".pdf"}


@dataclass
class Chunk:
    book: str
    path: str
    chunk_id: int
    text: str


def strip_markup(content: str) -> str:
    content = re.sub(r"(?is)<script.*?</script>|<style.*?</style>", " ", content)
    content = re.sub(r"(?s)<[^>]+>", " ", content)
    content = html.unescape(content)
    return normalize_text(content)


def normalize_text(text: str) -> str:
    text = text.replace("\u3000", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def read_epub(path: Path) -> str:
    parts: list[str] = []
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        candidates = [
            name
            for name in names
            if name.lower().endswith((".xhtml", ".html", ".htm"))
            and not name.lower().startswith("meta-inf/")
        ]
        for name in candidates:
            try:
                raw = archive.read(name)
            except KeyError:
                continue
            text = raw.decode("utf-8", errors="ignore")
            parts.append(strip_markup(text))
    return normalize_text(" ".join(parts))


def read_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader  # type: ignore
    except ImportError:
        try:
            from PyPDF2 import PdfReader  # type: ignore
        except ImportError as exc:
            raise RuntimeError("PDF support requires pypdf or PyPDF2") from exc

    reader = PdfReader(str(path))
    parts = []
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception:
            continue
    return normalize_text(" ".join(parts))


def read_text(path: Path) -> str:
    return normalize_text(path.read_text(encoding="utf-8", errors="ignore"))


def iter_book_files(source: Path) -> list[Path]:
    suffixes = TEXT_SUFFIXES | EPUB_SUFFIXES | PDF_SUFFIXES
    return sorted(
        path
        for path in source.rglob("*")
        if path.is_file() and path.suffix.lower() in suffixes
    )


def chunk_text(book: Path, text: str, chunk_chars: int, overlap: int) -> list[Chunk]:
    chunks: list[Chunk] = []
    if not text:
        return chunks
    step = max(1, chunk_chars - overlap)
    chunk_id = 0
    for start in range(0, len(text), step):
        piece = text[start : start + chunk_chars].strip()
        if len(piece) < 120:
            continue
        chunks.append(
            Chunk(
                book=book.stem,
                path=str(book),
                chunk_id=chunk_id,
                text=piece,
            )
        )
        chunk_id += 1
    return chunks


def read_book(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in EPUB_SUFFIXES:
        return read_epub(path)
    if suffix in PDF_SUFFIXES:
        return read_pdf(path)
    if suffix in TEXT_SUFFIXES:
        return read_text(path)
    return ""


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    env = load_env(ROOT / "mobile-app" / ".env")
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        default=env.get("PRIVATE_BOOK_SOURCE_DIR") or os.getenv("PRIVATE_BOOK_SOURCE_DIR"),
        help="Private book directory. Defaults to PRIVATE_BOOK_SOURCE_DIR from mobile-app/.env.",
    )
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--chunk-chars", type=int, default=1400)
    parser.add_argument("--overlap", type=int, default=180)
    parser.add_argument("--skip-pdf", action="store_true", help="Skip PDF files.")
    parser.add_argument("--only-pdf", action="store_true", help="Index only PDF files.")
    parser.add_argument("--max-files", type=int, default=0, help="Limit number of files for a partial run.")
    parser.add_argument("--merge-existing", action="store_true", help="Merge newly indexed chunks into the existing output.")
    args = parser.parse_args()

    if not args.source:
        print("ERROR: missing --source or PRIVATE_BOOK_SOURCE_DIR", file=sys.stderr)
        return 2

    source = Path(args.source)
    if not source.exists() or not source.is_dir():
        print(f"ERROR: source directory does not exist: {source}", file=sys.stderr)
        return 2

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    existing_chunks: list[dict[str, object]] = []
    existing_skipped: list[dict[str, str]] = []
    if args.merge_existing and output.exists():
        try:
            existing = json.loads(output.read_text(encoding="utf-8"))
            existing_chunks = list(existing.get("chunks") or [])
            existing_skipped = list(existing.get("skipped") or [])
        except Exception:
            existing_chunks = []
            existing_skipped = []

    chunks: list[Chunk] = []
    skipped: list[dict[str, str]] = []
    files = iter_book_files(source)
    if args.skip_pdf:
        files = [path for path in files if path.suffix.lower() not in PDF_SUFFIXES]
    if args.only_pdf:
        files = [path for path in files if path.suffix.lower() in PDF_SUFFIXES]
    if args.max_files > 0:
        files = files[: args.max_files]

    for index, book in enumerate(files, start=1):
        try:
            print(f"[{index}/{len(files)}] reading: {book.name}", flush=True)
            text = read_book(book)
            chunks.extend(chunk_text(book, text, args.chunk_chars, args.overlap))
            print(f"[{index}/{len(files)}] indexed: {book.name}", flush=True)
        except Exception as exc:
            skipped.append({"path": str(book), "reason": str(exc)})
            print(f"[{index}/{len(files)}] skipped: {book.name} ({exc})", flush=True)

    all_chunks = existing_chunks + [chunk.__dict__ for chunk in chunks]
    seen_chunk_keys: set[tuple[str, int]] = set()
    deduped_chunks: list[dict[str, object]] = []
    for chunk in all_chunks:
        key = (str(chunk.get("path", "")), int(chunk.get("chunk_id", 0)))
        if key in seen_chunk_keys:
            continue
        seen_chunk_keys.add(key)
        deduped_chunks.append(chunk)

    all_skipped = existing_skipped + skipped
    payload = {
        "schema": 1,
        "source_dir": str(source),
        "chunk_chars": args.chunk_chars,
        "overlap": args.overlap,
        "chunk_count": len(deduped_chunks),
        "chunks": deduped_chunks,
        "skipped": all_skipped,
    }
    output.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(deduped_chunks)} chunks to {output}")
    if skipped:
        print(f"skipped {len(skipped)} files; install pypdf for PDF support if needed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
