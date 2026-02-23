---
name: PDF Tools
description: Extract text, search, and analyze PDF files
triggers: pdf,extract pdf,read pdf,pdf text,pdf search,pdf tables
command-dispatch: tool
command-tool: pdf_extract_text
---

# PDF Tools (nano-pdf)

Extract text, metadata, and tables from PDF files.

## Requirements

```bash
pip install pdfplumber
```

## Available Tools

### pdf_extract_text
Extract text from a PDF file.

```json
pdf_extract_text {"path": "C:/path/to/document.pdf"}
```

Parameters:
- `path`: Path to PDF file (required)
- `pages`: Optional list of page numbers to extract (1-indexed)
- `max_chars`: Maximum characters to return (default: 100000)

Extract specific pages:
```json
pdf_extract_text {"path": "document.pdf", "pages": [1, 2, 3]}
```

### pdf_get_info
Get PDF metadata including page count, author, title.

```json
pdf_get_info {"path": "C:/path/to/document.pdf"}
```

Returns:
- `total_pages`: Number of pages
- `page_size`: Width and height
- `metadata`: Title, author, subject, creator, creation date

### pdf_search
Search for text within a PDF.

```json
pdf_search {"path": "document.pdf", "query": "important term"}
```

Parameters:
- `path`: Path to PDF file (required)
- `query`: Text to search for (required)
- `case_sensitive`: Case-sensitive search (default: false)

Returns page numbers and context around matches.

### pdf_extract_tables
Extract tables from a PDF file.

```json
pdf_extract_tables {"path": "document.pdf"}
```

Parameters:
- `path`: Path to PDF file (required)
- `pages`: Optional list of page numbers (1-indexed)

Returns table data as arrays.

## Example Uses

### Read a PDF
```json
pdf_extract_text {"path": "C:/Users/Bl0ck/Documents/report.pdf"}
```

### Get PDF Info
```json
pdf_get_info {"path": "C:/Downloads/manual.pdf"}
```

### Search in PDF
```json
pdf_search {"path": "contract.pdf", "query": "payment terms"}
```

### Extract Tables
```json
pdf_extract_tables {"path": "financial_report.pdf", "pages": [5, 6, 7]}
```

## Tips

- Large PDFs may take a moment to process
- Use `pages` parameter to extract only what you need
- Table extraction works best on well-formatted tables
- Scanned PDFs (images) won't extract text without OCR
