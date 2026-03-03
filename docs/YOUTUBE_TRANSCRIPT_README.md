# YouTube Transcript Retrieval

Substrate includes functionality to retrieve and process transcripts from YouTube videos. This document outlines how this feature works and how to use it.

## Overview

The YouTube transcript retrieval system allows you to:
- Extract transcripts from YouTube videos
- Create notes based on video content
- Process and analyze video content with the LLM

## Usage

Simply send a YouTube URL in the chat interface:
```
https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

The system will:
1. Extract the video ID
2. Attempt to retrieve the transcript (prioritizing English)
3. Format the transcript with timestamps
4. Create a note with the transcript and video metadata
5. Return a summary or analysis of the content

## Technical Implementation

### Components

- **TranscriptHandler**: Core class for transcript retrieval and processing
- **Command Executor**: Integrates transcript retrieval with the main app
- **YouTube Transcript API**: External library used for transcript access

### Transcript Retrieval Methods

The system uses multiple methods to retrieve transcripts, in order of preference:
1. **YouTube Transcript API**: Primary method using the official API
2. **PyTube Method**: Fallback using the pytube library
3. **HTML Scraping**: Final fallback using direct HTML parsing

### Caching

Transcripts are cached locally to:
- Improve performance for repeated requests
- Reduce API calls to YouTube
- Ensure reliability during network issues

### Error Handling

The system implements robust error handling:
- Rate limiting detection and backoff
- Multiple retrieval attempts with exponential backoff
- Fallback to alternative retrieval methods
- Clear error reporting when transcripts are unavailable

## API Version Notes

As of August 2025, this feature uses YouTube Transcript API v1.2.1, which requires an instance-based approach:

```python
# Create API instance
ytt_api = YouTubeTranscriptApi()

# Fetch transcript with language preference
fetched_transcript = ytt_api.fetch(video_id, languages=['en'])

# Convert to raw data format if needed
transcript_list = fetched_transcript.to_raw_data()
```

## Troubleshooting

If transcript retrieval fails:
- Ensure the video has captions available
- Check your internet connection
- Verify you're not being rate-limited by YouTube
- Try again after a few minutes if rate limiting occurs
