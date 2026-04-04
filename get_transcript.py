
from youtube_transcript_api import YouTubeTranscriptApi

video_id = '5umJ63d3rzQ'

try:
    transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)

    # Try to find an English transcript, prefer manually created if available
    transcript = None
    for t in transcript_list:
        if t.language_code == 'en':
            transcript = t
            break

    if transcript:
        raw_transcript = transcript.fetch()
        full_text_transcript = ' '.join([entry['text'] for entry in raw_transcript])
        print(full_text_transcript)
    else:
        print("No English transcript found for this video.")
except Exception as e:
    print(f"An error occurred: {e}")
