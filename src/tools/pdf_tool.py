"""
PDF Tool (nano-pdf) - PDF Text Extraction
==========================================
Extract text and metadata from PDF files.

Features:
- Extract all text from PDF
- Extract specific pages
- Get PDF metadata (pages, author, title)
- Search within PDF content
"""

import os
import logging
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

# Try to import pdfplumber
try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False
    logger.warning("pdfplumber not installed. Run: pip install pdfplumber")


def extract_text(
    path: str,
    pages: Optional[List[int]] = None,
    max_chars: int = 100000
) -> Dict[str, Any]:
    """
    Extract text from a PDF file.
    
    Args:
        path: Path to PDF file
        pages: Optional list of page numbers to extract (1-indexed). If None, extracts all.
        max_chars: Maximum characters to return (to avoid memory issues)
        
    Returns:
        Dict with extracted text
    """
    if not HAS_PDFPLUMBER:
        return {
            "status": "error",
            "error": "pdfplumber not installed. Run: pip install pdfplumber"
        }
    
    if not os.path.exists(path):
        return {
            "status": "error",
            "error": f"File not found: {path}"
        }
    
    try:
        with pdfplumber.open(path) as pdf:
            total_pages = len(pdf.pages)
            
            # Determine which pages to extract
            if pages:
                # Convert to 0-indexed and validate
                page_indices = [p - 1 for p in pages if 0 < p <= total_pages]
            else:
                page_indices = range(total_pages)
            
            extracted_pages = []
            total_text = ""
            
            for i in page_indices:
                page = pdf.pages[i]
                text = page.extract_text() or ""
                
                extracted_pages.append({
                    "page": i + 1,
                    "text": text,
                    "char_count": len(text)
                })
                
                total_text += f"\n--- Page {i + 1} ---\n{text}"
                
                # Check if we've exceeded max chars
                if len(total_text) > max_chars:
                    total_text = total_text[:max_chars] + f"\n... (truncated at {max_chars} chars)"
                    break
            
            return {
                "status": "success",
                "path": path,
                "total_pages": total_pages,
                "extracted_pages": len(extracted_pages),
                "text": total_text.strip(),
                "char_count": len(total_text)
            }
            
    except Exception as e:
        logger.error(f"PDF extraction error: {e}")
        return {
            "status": "error",
            "error": str(e)
        }


def get_info(path: str) -> Dict[str, Any]:
    """
    Get PDF metadata and info.
    
    Args:
        path: Path to PDF file
        
    Returns:
        Dict with PDF metadata
    """
    if not HAS_PDFPLUMBER:
        return {
            "status": "error",
            "error": "pdfplumber not installed. Run: pip install pdfplumber"
        }
    
    if not os.path.exists(path):
        return {
            "status": "error",
            "error": f"File not found: {path}"
        }
    
    try:
        with pdfplumber.open(path) as pdf:
            metadata = pdf.metadata or {}
            
            # Get page dimensions from first page
            first_page = pdf.pages[0] if pdf.pages else None
            page_size = None
            if first_page:
                page_size = {
                    "width": first_page.width,
                    "height": first_page.height
                }
            
            return {
                "status": "success",
                "path": path,
                "filename": os.path.basename(path),
                "file_size": os.path.getsize(path),
                "total_pages": len(pdf.pages),
                "page_size": page_size,
                "metadata": {
                    "title": metadata.get("Title"),
                    "author": metadata.get("Author"),
                    "subject": metadata.get("Subject"),
                    "creator": metadata.get("Creator"),
                    "producer": metadata.get("Producer"),
                    "creation_date": metadata.get("CreationDate"),
                    "mod_date": metadata.get("ModDate"),
                }
            }
            
    except Exception as e:
        logger.error(f"PDF info error: {e}")
        return {
            "status": "error",
            "error": str(e)
        }


def search_text(
    path: str,
    query: str,
    case_sensitive: bool = False
) -> Dict[str, Any]:
    """
    Search for text within a PDF.
    
    Args:
        path: Path to PDF file
        query: Text to search for
        case_sensitive: Whether search is case-sensitive
        
    Returns:
        Dict with search results
    """
    if not HAS_PDFPLUMBER:
        return {
            "status": "error",
            "error": "pdfplumber not installed. Run: pip install pdfplumber"
        }
    
    if not os.path.exists(path):
        return {
            "status": "error",
            "error": f"File not found: {path}"
        }
    
    try:
        with pdfplumber.open(path) as pdf:
            results = []
            search_query = query if case_sensitive else query.lower()
            
            for i, page in enumerate(pdf.pages):
                text = page.extract_text() or ""
                search_text = text if case_sensitive else text.lower()
                
                if search_query in search_text:
                    # Find all occurrences and get context
                    occurrences = []
                    start = 0
                    while True:
                        pos = search_text.find(search_query, start)
                        if pos == -1:
                            break
                        
                        # Get context around match (50 chars before and after)
                        context_start = max(0, pos - 50)
                        context_end = min(len(text), pos + len(query) + 50)
                        context = text[context_start:context_end]
                        
                        occurrences.append({
                            "position": pos,
                            "context": f"...{context}..."
                        })
                        start = pos + 1
                    
                    results.append({
                        "page": i + 1,
                        "occurrences": len(occurrences),
                        "matches": occurrences[:5]  # Limit to first 5 matches per page
                    })
            
            return {
                "status": "success",
                "path": path,
                "query": query,
                "total_pages_with_matches": len(results),
                "results": results
            }
            
    except Exception as e:
        logger.error(f"PDF search error: {e}")
        return {
            "status": "error",
            "error": str(e)
        }


def extract_tables(
    path: str,
    pages: Optional[List[int]] = None
) -> Dict[str, Any]:
    """
    Extract tables from a PDF.
    
    Args:
        path: Path to PDF file
        pages: Optional list of page numbers (1-indexed)
        
    Returns:
        Dict with extracted tables
    """
    if not HAS_PDFPLUMBER:
        return {
            "status": "error",
            "error": "pdfplumber not installed. Run: pip install pdfplumber"
        }
    
    if not os.path.exists(path):
        return {
            "status": "error",
            "error": f"File not found: {path}"
        }
    
    try:
        with pdfplumber.open(path) as pdf:
            total_pages = len(pdf.pages)
            
            if pages:
                page_indices = [p - 1 for p in pages if 0 < p <= total_pages]
            else:
                page_indices = range(total_pages)
            
            all_tables = []
            
            for i in page_indices:
                page = pdf.pages[i]
                tables = page.extract_tables()
                
                for j, table in enumerate(tables):
                    if table:
                        all_tables.append({
                            "page": i + 1,
                            "table_index": j,
                            "rows": len(table),
                            "columns": len(table[0]) if table else 0,
                            "data": table
                        })
            
            return {
                "status": "success",
                "path": path,
                "total_tables": len(all_tables),
                "tables": all_tables
            }
            
    except Exception as e:
        logger.error(f"PDF table extraction error: {e}")
        return {
            "status": "error",
            "error": str(e)
        }


# Tool definitions for registry
PDF_TOOLS = {
    "pdf_extract_text": {
        "function": extract_text,
        "description": "Extract text from a PDF file. Can extract all pages or specific pages.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path to PDF file"},
                "pages": {"type": "array", "items": {"type": "integer"}, "description": "Optional list of page numbers to extract (1-indexed)"},
                "max_chars": {"type": "integer", "description": "Maximum characters to return", "default": 100000}
            },
            "required": ["path"]
        }
    },
    "pdf_get_info": {
        "function": get_info,
        "description": "Get PDF metadata including page count, author, title, creation date",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path to PDF file"}
            },
            "required": ["path"]
        }
    },
    "pdf_search": {
        "function": search_text,
        "description": "Search for text within a PDF and get page numbers and context",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path to PDF file"},
                "query": {"type": "string", "description": "Text to search for"},
                "case_sensitive": {"type": "boolean", "description": "Case-sensitive search", "default": False}
            },
            "required": ["path", "query"]
        }
    },
    "pdf_extract_tables": {
        "function": extract_tables,
        "description": "Extract tables from a PDF file",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path to PDF file"},
                "pages": {"type": "array", "items": {"type": "integer"}, "description": "Optional list of page numbers (1-indexed)"}
            },
            "required": ["path"]
        }
    }
}
