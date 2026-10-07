import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai import errors as genai_errors
from pypdf import PdfReader

# Tried in order. On any API-level failure (rate limit, overload, server
# error, or a bad/empty response) for one model, the next is tried
# automatically — each free-tier model has its own independent RPM/RPD
# quota, so cascading through them maximizes how many requests you get
# before hitting a hard stop for the day.
GEMINI_MODEL_CHAIN = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemma-4-31b-it",
    "gemma-4-26b-a4b-it",
]

ENV_PATH = Path("C:/Users/santo/Documents/GoLangProjects/autoclicker/.env")
load_dotenv(dotenv_path=ENV_PATH)


class ProcessingError(Exception):
    """Raised when there is a processing error with market data."""


def extract_pdf_text(pdf_path: Path) -> str:
    """Extracts text from a PDF file using pypdf.

    Args:
        pdf_path (Path): The path to the PDF file.

    Returns:
        str: The extracted text.
    """
    if not pdf_path.is_file():
        raise ProcessingError(f"PDF file not found: {pdf_path}")

    try:
        reader = PdfReader(pdf_path)
    except Exception as exc:
        raise ProcessingError(f"Error reading PDF file: {exc}") from exc

    pages: list[str] = []

    for page_number, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text()
        except Exception as exc:
            raise ProcessingError(
                f"Error extracting text from page {page_number}: {exc}"
            ) from exc
        if text:
            pages.append(text)

    result = "\n\n".join(pages).strip()

    if not result:
        raise ProcessingError("No text found in PDF file")

    return result


def build_gemini_client() -> genai.Client:
    """Creates a GenAI client."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ProcessingError("GEMINI_API_KEY environment variable not set")
    return genai.Client(api_key=api_key)


COMPANIES_PROMPT_TEMPLATE = """
You are analysing a financial market research document.

Extract companies that are explicitly mentioned in the document.

For each company:

- identify the company name
- identify its stock ticker when it can be determined
- determine whether the document contains bullish information about it
- determine whether the document contains bearish information about it

Do not invent companies, tickers, prices, or claims.

A company may be both bullish and bearish if the document contains
evidence supporting both perspectives.

Return only the requested structured JSON.

DOCUMENT TEXT:

{text}
""".strip()

COMPANIES_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "companies": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "company_name": {"type": "string"},
                    "symbol": {"type": "string"},
                    "bullish": {"type": "boolean"},
                    "bearish": {"type": "boolean"},
                },
                "required": ["company_name", "symbol", "bullish", "bearish"],
            },
        },
    },
    "required": ["companies"],
}

SUMMARY_PROMPT_TEMPLATE = """
Summarise the following financial market research document.

Requirements:

- concise
- factual
- do not invent information
- mention the major market themes
- mention important companies when relevant
- do not provide personalised investment advice
- return only the summary text

DOCUMENT TEXT:

{text}
""".strip()


def _run_with_model_fallback(step_name: str, attempt):
    """
    Try `attempt(model_name)` against each model in GEMINI_MODEL_CHAIN in
    order, moving to the next model on any failure. Raises ProcessingError
    (with a clean message, no traceback) only if every model fails.
    """
    last_error: Exception | None = None
    for model_name in GEMINI_MODEL_CHAIN:
        try:
            return attempt(model_name)
        except (genai_errors.APIError, ProcessingError, json.JSONDecodeError) as exc:
            print(
                f"[info] {step_name}: {model_name} unavailable ({exc}); "
                "trying next model.",
                file=sys.stderr,
            )
            last_error = exc
            continue
    raise ProcessingError(
        f"{step_name}: every model in the fallback chain failed. "
        f"Last error: {last_error}"
    )


def analyse_market_text(client: genai.Client, text: str) -> dict[str, Any]:
    """Send extracted PDF text to Gemini and return structured JSON."""

    def attempt(model_name: str) -> dict[str, Any]:
        response = client.models.generate_content(
            model=model_name,
            contents=COMPANIES_PROMPT_TEMPLATE.format(text=text),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=COMPANIES_JSON_SCHEMA,
            ),
        )
        if not response.text:
            raise ProcessingError(f"{model_name} returned an empty response.")
        return json.loads(response.text)

    return _run_with_model_fallback("company extraction", attempt)


def generate_summary(client: genai.Client, text: str) -> str:
    """Generate the one-time human-readable summary."""

    def attempt(model_name: str) -> str:
        response = client.models.generate_content(
            model=model_name,
            contents=SUMMARY_PROMPT_TEMPLATE.format(text=text),
        )
        if not response.text:
            raise ProcessingError(f"{model_name} returned an empty summary.")
        return response.text.strip()

    return _run_with_model_fallback("summary generation", attempt)


def process_pdf(pdf_path: Path) -> dict[str, Any]:
    """Process one PDF from extraction through Gemini analysis."""
    text = extract_pdf_text(pdf_path)
    client = build_gemini_client()

    companies = analyse_market_text(client=client, text=text)
    summary = generate_summary(client=client, text=text)

    return {
        "source_file": pdf_path.name,
        "companies": companies.get("companies", []),
        "ai_summary": summary,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract market information from a PDF using Gemini."
    )
    parser.add_argument("pdf", type=Path, help="Path to the PDF to process.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        result = process_pdf(args.pdf)
    except ProcessingError as exc:
        print(
            json.dumps({"error": str(exc)}, ensure_ascii=False),
            file=sys.stderr,
        )
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())