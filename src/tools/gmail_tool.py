"""
Gmail Tool — Read, send, and search email via Gmail API (OAuth2)
================================================================
Uses the Gmail API with OAuth2 for full-featured email access.

Setup:
  1. Create a Google Cloud project and enable the Gmail API
  2. Create OAuth2 Desktop credentials and download the JSON file
  3. Place the client secret JSON in Substrate/config/
  4. On first run, a browser window opens for one-time authorization

Falls back to IMAP/SMTP with App Passwords if no OAuth2 credentials found.
"""

import os
import re
import email
import imaplib
import smtplib
import logging
import base64
import threading
import time
import json
import glob
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import parsedate_to_datetime, formataddr
from typing import Dict, Any, Optional, List, Callable
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_SOMA = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_CONFIG_DIR = os.path.join(_SOMA, 'config')
_TOKEN_PATH = os.path.join(_CONFIG_DIR, 'gmail_token.json')

_SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
]

# ---------------------------------------------------------------------------
# OAuth2 credential helpers
# ---------------------------------------------------------------------------

def _find_client_secret_file() -> Optional[str]:
    """Find the OAuth2 client secret JSON in config/."""
    patterns = [
        os.path.join(_CONFIG_DIR, 'client_secret*.json'),
        os.path.join(_CONFIG_DIR, 'credentials.json'),
    ]
    for pat in patterns:
        matches = glob.glob(pat)
        if matches:
            return matches[0]
    return None


def _get_gmail_service():
    """Build and return an authenticated Gmail API service, or None.
    
    On first call, opens a browser for OAuth consent.
    Subsequent calls use the cached token.
    """
    try:
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
    except ImportError as e:
        logger.error(f"[GMAIL] Missing Google API dependencies: {e}. "
                     "Run: pip install google-auth-oauthlib google-api-python-client")
        return None

    creds = None
    # Load existing token
    if os.path.exists(_TOKEN_PATH):
        try:
            creds = Credentials.from_authorized_user_file(_TOKEN_PATH, _SCOPES)
        except Exception as e:
            logger.warning(f"[GMAIL] Failed to load token: {e}")

    # Refresh or re-authorize
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                logger.info("[GMAIL] Token refreshed successfully")
            except Exception as e:
                logger.warning(f"[GMAIL] Token refresh failed: {e}")
                creds = None

        if not creds:
            client_secret = _find_client_secret_file()
            if not client_secret:
                logger.error("[GMAIL] No client_secret*.json found in config/")
                return None
            try:
                flow = InstalledAppFlow.from_client_secrets_file(client_secret, _SCOPES)
                creds = flow.run_local_server(port=0, open_browser=True)
                logger.info("[GMAIL] OAuth2 authorization completed")
            except Exception as e:
                logger.error(f"[GMAIL] OAuth2 flow failed: {e}")
                return None

        # Save token for next time
        try:
            os.makedirs(_CONFIG_DIR, exist_ok=True)
            with open(_TOKEN_PATH, 'w') as f:
                f.write(creds.to_json())
            logger.info(f"[GMAIL] Token saved to {_TOKEN_PATH}")
        except Exception as e:
            logger.warning(f"[GMAIL] Failed to save token: {e}")

    try:
        service = build('gmail', 'v1', credentials=creds, cache_discovery=False)
        return service
    except Exception as e:
        logger.error(f"[GMAIL] Failed to build Gmail service: {e}")
        return None


def _has_oauth2() -> bool:
    """Check if OAuth2 credentials are available (token or client secret)."""
    if os.path.exists(_TOKEN_PATH):
        return True
    return _find_client_secret_file() is not None


# ---------------------------------------------------------------------------
# IMAP/SMTP fallback helpers (App Password)
# ---------------------------------------------------------------------------

def _get_app_password_credentials() -> tuple:
    """Return (email_address, app_password) from env vars or None."""
    addr = os.environ.get('GMAIL_ADDRESS', '').strip()
    pw = os.environ.get('GMAIL_APP_PASSWORD', '').strip().replace(' ', '')
    if addr and pw:
        return addr, pw
    return None, None


def _connect_imap():
    """Connect and authenticate to Gmail IMAP. Returns (imap, error_dict)."""
    addr, pw = _get_app_password_credentials()
    if not addr or not pw:
        return None, {"status": "error", "error": "Gmail credentials not configured."}
    try:
        imap = imaplib.IMAP4_SSL('imap.gmail.com', 993)
        imap.login(addr, pw)
        return imap, None
    except Exception as e:
        return None, {"status": "error", "error": f"IMAP login failed: {e}"}


# ---------------------------------------------------------------------------
# Gmail API — Read / Search / Send
# ---------------------------------------------------------------------------

def _parse_gmail_message(msg: dict) -> Dict[str, Any]:
    """Parse a Gmail API message resource into a clean dict."""
    headers = {h['name'].lower(): h['value'] for h in msg.get('payload', {}).get('headers', [])}
    
    # Extract body
    body = ''
    payload = msg.get('payload', {})
    
    def _get_body_text(part):
        """Recursively extract text from message parts."""
        mime = part.get('mimeType', '')
        data = part.get('body', {}).get('data', '')
        if data and mime == 'text/plain':
            return base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')
        if data and mime == 'text/html':
            html = base64.urlsafe_b64decode(data).decode('utf-8', errors='replace')
            return re.sub(r'<[^>]+>', '', html).strip()
        for sub in part.get('parts', []):
            result = _get_body_text(sub)
            if result:
                return result
        return ''
    
    body = _get_body_text(payload)
    
    # Parse date
    date_str = headers.get('date', '')
    try:
        date_obj = parsedate_to_datetime(date_str)
        date_str = date_obj.strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
        pass
    
    return {
        'from': headers.get('from', ''),
        'to': headers.get('to', ''),
        'subject': headers.get('subject', ''),
        'date': date_str,
        'body': body[:5000],
        'message_id': headers.get('message-id', ''),
        'gmail_id': msg.get('id', ''),
        'thread_id': msg.get('threadId', ''),
        'labels': msg.get('labelIds', []),
    }


def check_status() -> Dict[str, Any]:
    """Check if Gmail is configured and connectable."""
    # Try OAuth2 first
    if _has_oauth2():
        try:
            service = _get_gmail_service()
            if service:
                profile = service.users().getProfile(userId='me').execute()
                return {
                    "status": "success",
                    "configured": True,
                    "email": profile.get('emailAddress', ''),
                    "auth_method": "oauth2",
                }
        except Exception as e:
            return {"status": "error", "configured": True, "error": f"OAuth2 failed: {e}", "auth_method": "oauth2"}
    
    # Fall back to App Password
    addr, pw = _get_app_password_credentials()
    if not addr or not pw:
        return {
            "status": "error",
            "configured": False,
            "error": "Gmail not configured. Add OAuth2 credentials.json to config/ or set GMAIL_ADDRESS + GMAIL_APP_PASSWORD."
        }
    try:
        imap = imaplib.IMAP4_SSL('imap.gmail.com', 993)
        imap.login(addr, pw)
        imap.logout()
        return {"status": "success", "configured": True, "email": addr, "auth_method": "app_password"}
    except Exception as e:
        return {"status": "error", "configured": True, "error": f"Login failed: {e}", "auth_method": "app_password"}


def read_inbox(
    max_results: int = 10,
    unread_only: bool = False,
    folder: str = 'INBOX'
) -> Dict[str, Any]:
    """Read recent emails from the inbox."""
    # Try OAuth2
    if _has_oauth2():
        service = _get_gmail_service()
        if service:
            try:
                q = 'is:unread' if unread_only else ''
                if folder and folder.upper() != 'INBOX':
                    q = f'in:{folder} {q}'.strip()
                results = service.users().messages().list(
                    userId='me', q=q or None, maxResults=max_results,
                    labelIds=['INBOX'] if folder.upper() == 'INBOX' else None,
                ).execute()
                
                messages = results.get('messages', [])
                if not messages:
                    return {"status": "success", "emails": [], "count": 0, "message": "No emails found."}
                
                emails = []
                for m in messages:
                    msg = service.users().messages().get(userId='me', id=m['id'], format='full').execute()
                    emails.append(_parse_gmail_message(msg))
                
                return {"status": "success", "emails": emails, "count": len(emails)}
            except Exception as e:
                logger.error(f"[GMAIL] API read_inbox failed: {e}")
                return {"status": "error", "error": str(e)}
    
    # Fallback to IMAP
    return _imap_read_inbox(max_results, unread_only, folder)


def _imap_read_inbox(max_results, unread_only, folder):
    """IMAP fallback for read_inbox."""
    imap, err = _connect_imap()
    if err:
        return err
    try:
        imap.select(folder, readonly=True)
        criteria = 'UNSEEN' if unread_only else 'ALL'
        status, data = imap.search(None, criteria)
        if status != 'OK':
            return {"status": "error", "error": "IMAP search failed"}
        msg_ids = data[0].split()
        if not msg_ids:
            return {"status": "success", "emails": [], "count": 0, "message": "No emails found."}
        recent_ids = msg_ids[-max_results:]
        recent_ids.reverse()
        emails = []
        for mid in recent_ids:
            status, msg_data = imap.fetch(mid, '(RFC822)')
            if status == 'OK':
                parsed = _imap_parse_message(msg_data)
                parsed['uid'] = mid.decode()
                emails.append(parsed)
        imap.logout()
        return {"status": "success", "emails": emails, "count": len(emails)}
    except Exception as e:
        try: imap.logout()
        except Exception: pass
        return {"status": "error", "error": str(e)}


def _imap_parse_message(msg_data) -> Dict[str, Any]:
    """Parse a raw IMAP email message into a clean dict."""
    raw = msg_data[0][1]
    msg = email.message_from_bytes(raw)
    subject = ''
    if msg['Subject']:
        parts = email.header.decode_header(msg['Subject'])
        subject = ''.join(
            part.decode(enc or 'utf-8') if isinstance(part, bytes) else part
            for part, enc in parts
        )
    body = ''
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == 'text/plain':
                payload = part.get_payload(decode=True)
                if payload:
                    body = payload.decode(part.get_content_charset() or 'utf-8', errors='replace')
                    break
            elif ct == 'text/html' and not body:
                payload = part.get_payload(decode=True)
                if payload:
                    body = re.sub(r'<[^>]+>', '', payload.decode(part.get_content_charset() or 'utf-8', errors='replace')).strip()
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            body = payload.decode(msg.get_content_charset() or 'utf-8', errors='replace')
    date_str = msg.get('Date', '')
    try:
        date_str = parsedate_to_datetime(date_str).strftime('%Y-%m-%d %H:%M:%S')
    except Exception: pass
    return {
        'from': msg.get('From', ''), 'to': msg.get('To', ''),
        'subject': subject, 'date': date_str,
        'body': body[:5000], 'message_id': msg.get('Message-ID', ''),
    }


def search_emails(
    query: str,
    max_results: int = 10,
    folder: str = 'INBOX'
) -> Dict[str, Any]:
    """Search emails. Uses Gmail API query syntax (same as the Gmail search bar)."""
    # Try OAuth2
    if _has_oauth2():
        service = _get_gmail_service()
        if service:
            try:
                results = service.users().messages().list(
                    userId='me', q=query, maxResults=max_results,
                ).execute()
                messages = results.get('messages', [])
                if not messages:
                    return {"status": "success", "emails": [], "count": 0,
                            "message": f"No emails matching '{query}'."}
                emails = []
                for m in messages:
                    msg = service.users().messages().get(userId='me', id=m['id'], format='full').execute()
                    emails.append(_parse_gmail_message(msg))
                return {"status": "success", "emails": emails, "count": len(emails), "query": query}
            except Exception as e:
                logger.error(f"[GMAIL] API search failed: {e}")
                return {"status": "error", "error": str(e)}
    
    # Fallback to IMAP
    return _imap_search_emails(query, max_results, folder)


def _imap_search_emails(query, max_results, folder):
    """IMAP fallback for search_emails."""
    imap, err = _connect_imap()
    if err:
        return err
    try:
        imap.select(folder, readonly=True)
        imap_keywords = ('FROM', 'TO', 'SUBJECT', 'BODY', 'SINCE', 'BEFORE', 'ON', 'SEEN', 'UNSEEN', 'FLAGGED', 'ALL')
        if any(query.upper().startswith(kw) for kw in imap_keywords):
            criteria = query
        else:
            q = query.replace('"', '\\"')
            criteria = f'(OR OR (FROM "{q}") (SUBJECT "{q}") (BODY "{q}"))'
        status, data = imap.search(None, criteria)
        if status != 'OK':
            return {"status": "error", "error": f"Search failed for: {criteria}"}
        msg_ids = data[0].split()
        if not msg_ids:
            return {"status": "success", "emails": [], "count": 0, "message": f"No emails matching '{query}'."}
        recent_ids = msg_ids[-max_results:]
        recent_ids.reverse()
        emails = []
        for mid in recent_ids:
            status, msg_data = imap.fetch(mid, '(RFC822)')
            if status == 'OK':
                parsed = _imap_parse_message(msg_data)
                parsed['uid'] = mid.decode()
                emails.append(parsed)
        imap.logout()
        return {"status": "success", "emails": emails, "count": len(emails), "query": query}
    except Exception as e:
        try: imap.logout()
        except Exception: pass
        return {"status": "error", "error": str(e)}


def send_email(
    to: str,
    subject: str,
    body: str,
    reply_to_message_id: Optional[str] = None,
    thread_id: Optional[str] = None,
    html: bool = False
) -> Dict[str, Any]:
    """Send an email via Gmail.
    
    Args:
        to: Recipient email address
        subject: Email subject
        body: Email body (plain text or HTML)
        reply_to_message_id: Optional Message-ID to reply to (threading)
        thread_id: Optional Gmail thread ID to reply in
        html: If True, send as HTML email
    """
    # Try OAuth2
    if _has_oauth2():
        service = _get_gmail_service()
        if service:
            try:
                if html:
                    msg = MIMEMultipart('alternative')
                    msg.attach(MIMEText(body, 'html'))
                else:
                    msg = MIMEText(body, 'plain')
                
                # Get sender address from profile
                profile = service.users().getProfile(userId='me').execute()
                msg['From'] = profile.get('emailAddress', '')
                msg['To'] = to
                msg['Subject'] = subject
                
                if reply_to_message_id:
                    msg['In-Reply-To'] = reply_to_message_id
                    msg['References'] = reply_to_message_id
                
                raw = base64.urlsafe_b64encode(msg.as_bytes()).decode('utf-8')
                send_body = {'raw': raw}
                if thread_id:
                    send_body['threadId'] = thread_id
                
                result = service.users().messages().send(userId='me', body=send_body).execute()
                logger.info(f"[GMAIL] Sent email to {to}: {subject} (id: {result.get('id')})")
                return {"status": "success", "message": f"Email sent to {to}", "subject": subject,
                        "gmail_id": result.get('id'), "thread_id": result.get('threadId')}
            except Exception as e:
                logger.error(f"[GMAIL] API send failed: {e}")
                return {"status": "error", "error": f"Send failed: {e}"}
    
    # Fallback to SMTP
    return _smtp_send_email(to, subject, body, reply_to_message_id, html)


def _smtp_send_email(to, subject, body, reply_to_message_id, html):
    """SMTP fallback for send_email."""
    addr, pw = _get_app_password_credentials()
    if not addr or not pw:
        return {"status": "error", "error": "Gmail credentials not configured."}
    try:
        if html:
            msg = MIMEMultipart('alternative')
            msg.attach(MIMEText(body, 'html'))
        else:
            msg = MIMEText(body, 'plain')
        msg['From'] = addr
        msg['To'] = to
        msg['Subject'] = subject
        if reply_to_message_id:
            msg['In-Reply-To'] = reply_to_message_id
            msg['References'] = reply_to_message_id
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
            smtp.login(addr, pw)
            smtp.send_message(msg)
        logger.info(f"[GMAIL] Sent email to {to}: {subject}")
        return {"status": "success", "message": f"Email sent to {to}", "subject": subject}
    except Exception as e:
        return {"status": "error", "error": f"Send failed: {e}"}


def _mark_as_read_api(gmail_id: str):
    """Mark a message as read via Gmail API."""
    if _has_oauth2():
        service = _get_gmail_service()
        if service:
            try:
                service.users().messages().modify(
                    userId='me', id=gmail_id,
                    body={'removeLabelIds': ['UNREAD']}
                ).execute()
                return
            except Exception as e:
                logger.error(f"[GMAIL] API mark_as_read failed: {e}")


# ---------------------------------------------------------------------------
# Google Voice SMS helpers
# ---------------------------------------------------------------------------

def read_sms(max_results: int = 10) -> Dict[str, Any]:
    """Read recent SMS messages forwarded from Google Voice to Gmail."""
    return search_emails(
        query='from:txt.voice.google.com',
        max_results=max_results
    )


# ---------------------------------------------------------------------------
# Dispatcher (called from tool_registry)
# ---------------------------------------------------------------------------

def gmail_dispatch(action: str, **kwargs) -> Dict[str, Any]:
    """Dispatch Gmail tool actions."""
    actions = {
        "status": lambda: check_status(),
        "inbox": lambda: read_inbox(
            max_results=kwargs.get("max_results", 10),
            unread_only=kwargs.get("unread_only", False),
            folder=kwargs.get("folder", "INBOX"),
        ),
        "search": lambda: search_emails(
            query=kwargs.get("query", ""),
            max_results=kwargs.get("max_results", 10),
            folder=kwargs.get("folder", "INBOX"),
        ),
        "send": lambda: send_email(
            to=kwargs.get("to", ""),
            subject=kwargs.get("subject", ""),
            body=kwargs.get("body", ""),
            reply_to_message_id=kwargs.get("reply_to_message_id"),
            thread_id=kwargs.get("thread_id"),
            html=kwargs.get("html", False),
        ),
        "read_sms": lambda: read_sms(
            max_results=kwargs.get("max_results", 10),
        ),
    }
    fn = actions.get(action)
    if not fn:
        return {"status": "error",
                "error": f"Unknown gmail action: {action}. Available: {', '.join(actions.keys())}"}
    return fn()


# ---------------------------------------------------------------------------
# Background SMS Listener Service
# ---------------------------------------------------------------------------

_sms_listener_thread = None
_sms_listener_stop = threading.Event()
_POLL_INTERVAL = 5  # seconds between Gmail checks


def _extract_gv_sms(parsed_email: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """Extract sender number and message text from a Google Voice forwarded email."""
    body = parsed_email.get('body', '')
    subject = parsed_email.get('subject', '')
    
    sender_number = None
    message_text = body.strip()
    
    # Try to extract phone number from subject
    phone_match = re.search(r'[\+]?1?\s*\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}', subject)
    if phone_match:
        sender_number = phone_match.group().strip()
    
    # Also check body for phone number if not found in subject
    if not sender_number:
        phone_match = re.search(r'[\+]?1?\s*\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}', body)
        if phone_match:
            sender_number = phone_match.group().strip()
    
    # Clean up message body — remove Google Voice boilerplate
    # Remove leading URL lines like <https://voice.google.com>
    message_text = re.sub(r'<https?://[^>]+>\s*', '', message_text)
    # Split off footer boilerplate
    message_text = re.split(r'(?:YOUR ACCOUNT|To respond to this text message|HELP CENTER|HELP FORUM|This email was sent)', message_text, flags=re.IGNORECASE)[0].strip()
    # Remove any leading "Message from..." header
    message_text = re.sub(r'^(?:New )?(?:text )?message from[^\n]*\n?', '', message_text, flags=re.IGNORECASE).strip()
    
    if not message_text:
        return None
    
    return {
        'sender': sender_number or 'unknown',
        'text': message_text,
        'subject': subject,
        'message_id': parsed_email.get('message_id', ''),
        'gmail_id': parsed_email.get('gmail_id', ''),
        'thread_id': parsed_email.get('thread_id', ''),
        'date': parsed_email.get('date', ''),
    }


def _sms_listener_loop(llm_fn: Callable, send_frontend_fn: Callable):
    """Background loop that polls Gmail for new Google Voice texts."""
    logger.info("[SMS_LISTENER] Starting Gmail SMS listener...")
    
    # Wait for auth to be available
    retries = 0
    while not _sms_listener_stop.is_set() and retries < 10:
        if _has_oauth2():
            break
        addr, pw = _get_app_password_credentials()
        if addr and pw:
            break
        retries += 1
        logger.info(f"[SMS_LISTENER] Waiting for Gmail credentials... ({retries}/10)")
        _sms_listener_stop.wait(10)
    
    if _sms_listener_stop.is_set():
        return
    
    use_api = _has_oauth2()
    method = "Gmail API (OAuth2)" if use_api else "IMAP (App Password)"
    logger.info(f"[SMS_LISTENER] Listening for SMS via {method} (polling every {_POLL_INTERVAL}s)")
    
    _poll_count = 0
    while not _sms_listener_stop.is_set():
        _poll_count += 1
        try:
            if use_api:
                _poll_api(llm_fn, send_frontend_fn, _poll_count)
            else:
                _poll_imap(llm_fn, send_frontend_fn, _poll_count)
        except Exception as e:
            logger.error(f"[SMS_LISTENER] Poll error: {e}")
        
        _sms_listener_stop.wait(_POLL_INTERVAL)
    
    logger.info("[SMS_LISTENER] Listener stopped.")


def _clean_reply_for_sms(text: str) -> str:
    """Strip thinking tags, tool calls, and other non-conversational content."""
    if not text:
        return ''
    # Remove <think>...</think> blocks
    cleaned = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
    # Remove ```tool_call``` or ```python``` blocks that are tool invocations
    cleaned = re.sub(r'```(?:tool_call|tool_result)[^`]*```', '', cleaned, flags=re.DOTALL)
    # Remove lines that look like tool calls (e.g. "Action: ...", "Tool: ...")
    cleaned = re.sub(r'^(?:Action|Tool|Observation|Thought):.*$', '', cleaned, flags=re.MULTILINE)
    # Collapse whitespace
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
    return cleaned


def _handle_sms_reply(llm_fn, send_frontend_fn, sms, parsed):
    """Handle SMS reply using a direct LLM call (no agent tool pipeline).
    
    Flow:
    1. Show the incoming SMS in the desktop UI as a user message
    2. Call LLM directly for a clean conversational reply (no tools)
    3. Show the reply in the desktop UI as assistant message
    4. Send exactly ONE email back as SMS
    """
    import traceback
    try:
        sender = sms['sender']
        text = sms['text']
        
        # 1) Show inbound SMS as a real user-side message in the desktop UI
        try:
            send_frontend_fn({
                'type': 'user_message',
                'text': f"\U0001F4F1 {text}",
                'speak': False,
            })
        except Exception as e:
            logger.error(f"[SMS_LISTENER] Failed to push inbound SMS to UI: {e}")
        
        # 2) Call LLM directly — no tool calling, just a conversational reply
        llm_messages = [
            {'role': 'system', 'content': (
                'You received a text message (SMS). Reply naturally and conversationally. '
                'Keep it concise — this will be sent as a text message. '
                'Do NOT use tools, do NOT write code, do NOT use markdown formatting.'
            )},
            {'role': 'user', 'content': text}
        ]
        logger.info(f"[SMS_LISTENER] Calling LLM for reply to: {text[:80]}")
        llm_result = llm_fn(llm_messages)
        
        reply_text = ''
        if isinstance(llm_result, dict):
            reply_text = llm_result.get('content', '')
        elif isinstance(llm_result, str):
            reply_text = llm_result
        
        # Clean the reply
        clean_reply = _clean_reply_for_sms(reply_text)
        if not clean_reply:
            logger.warning("[SMS_LISTENER] LLM returned empty reply")
            return
        
        logger.info(f"[SMS_LISTENER] LLM reply: {clean_reply[:80]}")
        
        # 3) Show agent reply as a normal assistant bubble in the desktop UI
        try:
            send_frontend_fn({
                'status': 'done',
                'result': clean_reply,
                'messages': [
                    {'role': 'assistant', 'content': clean_reply}
                ],
                'new_message': True,
                'clear_thinking': True,
                'source': 'sms',
            })
        except Exception as e:
            logger.error(f"[SMS_LISTENER] Failed to push reply to UI: {e}")
        
        # 4) Send exactly ONE email back as SMS
        reply_to = parsed.get('from', '')
        if not reply_to:
            logger.error("[SMS_LISTENER] No reply-to address found")
            return
        
        logger.info(f"[SMS_LISTENER] Sending SMS reply to {reply_to}")
        reply_result = send_email(
            to=reply_to,
            subject=f"Re: {sms.get('subject', 'SMS')}",
            body=clean_reply,
            reply_to_message_id=sms.get('message_id'),
            thread_id=sms.get('thread_id'),
        )
        if reply_result.get('status') == 'success':
            logger.info(f"[SMS_LISTENER] SMS reply sent to {sender}")
        else:
            logger.error(f"[SMS_LISTENER] SMS reply failed: {reply_result.get('error')}")
        
        # 5) Save to conversation memory so future context includes this exchange
        try:
            from src.memory.unified_memory import UnifiedMemory
            mem = UnifiedMemory()
            mem.add_memory(f"[SMS from {sender}]: {text}", memory_type='CHAT')
            mem.add_memory(f"[SMS reply to {sender}]: {clean_reply}", memory_type='CHAT')
        except Exception as mem_err:
            logger.debug(f"[SMS_LISTENER] Memory save failed (non-critical): {mem_err}")
    except Exception as e:
        logger.error(f"[SMS_LISTENER] Error in reply handler: {e}\n{traceback.format_exc()}")


def _poll_api(llm_fn, send_frontend_fn, poll_count):
    """Poll for new GV texts using Gmail API.
    
    Batches multiple unread texts from the same sender into a single agent
    call so the user doesn't receive duplicate/triplicate replies.
    """
    service = _get_gmail_service()
    if not service:
        logger.warning("[SMS_LISTENER] Gmail API service unavailable")
        return
    
    results = service.users().messages().list(
        userId='me',
        q='from:txt.voice.google.com is:unread',
        maxResults=10,
    ).execute()
    
    messages = results.get('messages', [])
    num_found = len(messages)
    
    if poll_count <= 3 or num_found > 0 or poll_count % 60 == 0:
        logger.info(f"[SMS_LISTENER] Poll #{poll_count}: found={num_found} unread GV messages (API)")
    
    if not messages:
        return
    
    # Fetch and parse all messages, group by sender
    batched = {}  # sender -> list of (sms, parsed)
    for m in messages:
        if _sms_listener_stop.is_set():
            break
        try:
            msg = service.users().messages().get(userId='me', id=m['id'], format='full').execute()
            parsed = _parse_gmail_message(msg)
            sms = _extract_gv_sms(parsed)
            
            # Mark as read immediately to prevent re-processing
            _mark_as_read_api(m['id'])
            
            if not sms:
                logger.debug(f"[SMS_LISTENER] Could not parse GV SMS from message {m['id']}")
                continue
            
            sender = sms['sender']
            if sender not in batched:
                batched[sender] = []
            batched[sender].append((sms, parsed))
        except Exception as e:
            import traceback
            logger.error(f"[SMS_LISTENER] Error fetching message {m['id']}: {e}\n{traceback.format_exc()}")
            try:
                _mark_as_read_api(m['id'])
            except Exception:
                pass
    
    # Process each sender batch as ONE agent call
    for sender, sms_list in batched.items():
        if _sms_listener_stop.is_set():
            break
        
        # Combine multiple texts from same sender into one prompt
        if len(sms_list) == 1:
            combined_text = sms_list[0][0]['text']
        else:
            # Oldest first
            combined_text = '\n'.join(s['text'] for s, _ in reversed(sms_list))
            logger.info(f"[SMS_LISTENER] Batched {len(sms_list)} texts from {sender}")
        
        # Use the most recent message's metadata for the reply
        latest_sms, latest_parsed = sms_list[0]
        latest_sms = dict(latest_sms)  # copy so we can modify
        latest_sms['text'] = combined_text
        
        logger.info(f"[SMS_LISTENER] New text from {sender}: {combined_text[:80]}")
        
        # Route to agent in a separate thread so polling continues
        reply_thread = threading.Thread(
            target=_handle_sms_reply,
            args=(llm_fn, send_frontend_fn, latest_sms, latest_parsed),
            daemon=True,
            name=f"sms-reply-{sender}"
        )
        reply_thread.start()


def _poll_imap(llm_fn, send_frontend_fn, poll_count):
    """Poll for new GV texts using IMAP fallback."""
    imap, err = _connect_imap()
    if err:
        logger.warning(f"[SMS_LISTENER] IMAP connect failed: {err}")
        return
    
    try:
        imap.select('INBOX', readonly=True)
        status, data = imap.search(None, '(UNSEEN FROM "txt.voice.google.com")')
        
        num_found = len(data[0].split()) if status == 'OK' and data[0] else 0
        if poll_count <= 3 or num_found > 0 or poll_count % 60 == 0:
            logger.info(f"[SMS_LISTENER] Poll #{poll_count}: found={num_found} unread GV messages (IMAP)")
        
        if status == 'OK' and data[0]:
            msg_ids = data[0].split()
            for mid in msg_ids:
                if _sms_listener_stop.is_set():
                    break
                
                status, msg_data = imap.fetch(mid, '(RFC822)')
                if status != 'OK':
                    continue
                
                parsed = _imap_parse_message(msg_data)
                sms = _extract_gv_sms(parsed)
                if not sms:
                    continue
                
                logger.info(f"[SMS_LISTENER] New text from {sms['sender']}: {sms['text'][:80]}")
                
                # Mark as read first to prevent re-processing
                _imap_mark_as_read(mid)
                
                # Route to agent in a separate thread
                reply_thread = threading.Thread(
                    target=_handle_sms_reply,
                    args=(llm_fn, send_frontend_fn, sms, parsed),
                    daemon=True,
                    name=f"sms-reply-imap-{mid[:8] if isinstance(mid, str) else mid}"
                )
                reply_thread.start()
        
        try: imap.logout()
        except Exception: pass
    except Exception as e:
        try: imap.logout()
        except Exception: pass
        raise


def _imap_mark_as_read(uid: str):
    """Mark a message as read via IMAP."""
    imap, err = _connect_imap()
    if err:
        return
    try:
        imap.select('INBOX', readonly=False)
        imap.store(uid, '+FLAGS', '\\Seen')
        imap.logout()
    except Exception as e:
        logger.error(f"[SMS_LISTENER] Failed to mark message {uid} as read: {e}")
        try: imap.logout()
        except Exception: pass


def start_sms_listener(llm_fn: Callable, send_frontend_fn: Callable):
    """Start the background SMS listener thread.
    
    Args:
        llm_fn: Direct LLM call function (e.g. call_llm_sync) that takes
                a list of message dicts and returns {'content': str}.
        send_frontend_fn: Function to push messages to the desktop UI.
    """
    global _sms_listener_thread
    
    if _sms_listener_thread and _sms_listener_thread.is_alive():
        logger.info("[SMS_LISTENER] Already running.")
        return
    
    _sms_listener_stop.clear()
    _sms_listener_thread = threading.Thread(
        target=_sms_listener_loop,
        args=(llm_fn, send_frontend_fn),
        daemon=True,
        name="sms-listener"
    )
    _sms_listener_thread.start()


def stop_sms_listener():
    """Stop the background SMS listener."""
    global _sms_listener_thread
    _sms_listener_stop.set()
    if _sms_listener_thread:
        _sms_listener_thread.join(timeout=5)
        _sms_listener_thread = None
    logger.info("[SMS_LISTENER] Stopped.")
