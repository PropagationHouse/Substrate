# YouTube Transcript Integration - Developer Guide

This document provides technical details for developers working with the YouTube transcript retrieval system in Tiny Pirate.

## Architecture Overview

The YouTube transcript functionality is implemented through several components:

```
src/
├── youtube/
│   ├── transcript_handler.py     # Core transcript retrieval logic
│   └── utils.py                  # Helper functions
├── commands/
│   └── command_executor.py       # Integration with command system
└── notes/
    └── note_methods.py           # Note creation from transcripts
```

## Key Classes and Methods

### TranscriptHandler

The `TranscriptHandler` class in `transcript_handler.py` is responsible for all transcript retrieval operations.

#### Key Methods:

- `get_transcript(url)`: Main entry point for transcript retrieval
  - Returns: `Tuple[bool, str]` - Success flag and transcript/error message
  - Parameters:
    - `url`: YouTube video URL

- `process_video(url)`: Comprehensive video processing
  - Returns: Dictionary with transcript, title, and other metadata
  - Used for creating notes and LLM analysis

- `format_transcript(transcript_list)`: Formats raw transcript data
  - Adds timestamps and proper formatting

- `check_transcript_cache(video_id)` / `save_transcript_to_cache(video_id, transcript)`:
  - Manages transcript caching for performance

### Command Integration

In `command_executor.py`, the `handle_web_command` method integrates transcript retrieval with the command system:

1. Identifies YouTube URLs
2. Calls `TranscriptHandler.get_transcript()`
3. Processes the result based on success/failure
4. Creates notes when successful
5. Falls back to browser opening when necessary

## YouTube Transcript API Usage

As of August 2025, we use YouTube Transcript API v1.2.1 which requires an instance-based approach:

```python
# Import the API
from youtube_transcript_api import YouTubeTranscriptApi

# Create API instance
ytt_api = YouTubeTranscriptApi()

# Fetch transcript with language preference
fetched_transcript = ytt_api.fetch(video_id, languages=['en'])

# Convert to raw data format if needed
transcript_list = fetched_transcript.to_raw_data()
```

### API Changes (v1.1.0 → v1.2.1)

The YouTube Transcript API underwent significant changes in v1.2.1:

1. **Static methods removed**:
   - `get_transcript()` → Now requires instance creation
   - `list_transcripts()` → Replaced with instance methods

2. **New object types**:
   - `FetchedTranscript` - Returned by `fetch()`, implements list interface
   - `FetchedTranscriptSnippet` - Individual transcript entries

3. **Data conversion**:
   - Use `.to_raw_data()` to convert to the previous dictionary format

## Error Handling and Retry Logic

The system implements robust error handling:

1. **Rate limiting (429)**:
   - Exponential backoff: 5, 10, 20, 40, 80 seconds
   - Maximum 5 retry attempts

2. **Fallback chain**:
   - YouTube Transcript API → PyTube → HTML Scraping
   - Each method has its own error handling

3. **Error reporting**:
   - Structured error messages
   - Debug logging for troubleshooting

## Caching Implementation

Transcripts are cached to improve performance and reliability:

1. **Cache location**: `cache/transcripts/`
2. **Cache key**: Video ID (extracted from URL)
3. **Cache format**: Plain text files with formatted transcripts
4. **Cache validation**: Simple existence check

## Testing

Test scripts are available to verify transcript retrieval:

- `test_transcript_handler.py`: Basic functionality tests
- `wait_test.py`: Tests with extended waiting periods
- `new_api_test.py`: Tests specific to the new API version

## Common Issues and Solutions

1. **Rate limiting**:
   - Symptom: 429 errors
   - Solution: Implement exponential backoff (already in place)

2. **Empty XML responses**:
   - Symptom: "no element found: line 1, column 0"
   - Solution: Retry or fall back to alternative methods

3. **Missing transcripts**:
   - Symptom: No transcript available in any language
   - Solution: Inform user that the video doesn't have captions

4. **API version compatibility**:
   - Symptom: AttributeError for missing methods
   - Solution: Update code to use instance-based approach
