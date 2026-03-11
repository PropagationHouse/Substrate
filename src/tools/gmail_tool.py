"""
Gmail Tool — Read, send, and search email via Gmail
====================================================
Uses IMAP/SMTP with App Passwords for zero-config authentication.
No Google Cloud Console project or OAuth consent screen required.

Setup:
  1. Enable 2-Step Verification on the Gmail account
  2. Generate an App Password: https://myaccount.google.com/apppasswords
  3. Store email + app_password in Substrate config (remote_api_keys)

The agent can also use Gmail API (OAuth2) if credentials.json is present
in the config/ directory, but App Password is the default path.
"""

import os
import re
import email
import imaplib
import smtplib
import logging
import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import parsedate_to_datetime, formataddr
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Credential helpers
# ---------------------------------------------------------------------------

def _get_credentials() -> tuple:
    """Return (email_address, app_password) from env vars or None."""
    addr = os.environ.get('GMAIL_ADDRESS', '').strip()
    pw = os.environ.get('GMAIL_APP_PASSWORD', '').strip()
    if addr and pw:
        return addr, pw
    return None, None


def check_status() -> Dict[str, Any]:
    """Check if Gmail credentials are configured and connectable."""
    addr, pw = _get_credentials()
    if not addr or not pw:
        return {
            "status": "error",
            "configured": False,
            "error": "Gmail credentials not configured. Set GMAIL_ADDRESS and GMAIL_APP_PASSWORD in config."
        }
    try:
        imap = imaplib.IMAP4_SSL('imap.gmail.com', 993)
        imap.login(addr, pw)
        imap.logout()
        return {"status": "success", "configured": True, "email": addr}
    except Exception as e:
        return {"status": "error", "configured": True, "error": f"Login failed: {e}"}


# ---------------------------------------------------------------------------
# IMAP — Read / Search
# ---------------------------------------------------------------------------

def _connect_imap():
    """Connect and authenticate to Gmail IMAP. Returns (imap, error_dict)."""
    addr, pw = _get_credentials()
    if not addr or not pw:
        return None, {"status": "error", "error": "Gmail credentials not configured."}
    try:
        imap = imaplib.IMAP4_SSL('imap.gmail.com', 993)
        imap.login(addr, pw)
        return imap, None
    except Exception as e:
        return None, {"status": "error", "error": f"IMAP login failed: {e}"}


def _parse_message(msg_data) -> Dict[str, Any]:
    """Parse a raw email message into a clean dict."""
    raw = msg_data[0][1]
    msg = email.message_from_bytes(raw)
    
    # Decode subject
    subject = ''
    if msg['Subject']:
        parts = email.header.decode_header(msg['Subject'])
        subject = ''.join(
            part.decode(enc or 'utf-8') if isinstance(part, bytes) else part
            for part, enc in parts
        )
    
    # Extract body
    body = ''
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == 'text/plain':
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or 'utf-8'
                    body = payload.decode(charset, errors='replace')
                    break
            elif ct == 'text/html' and not body:
                payload = part.get_payload(decode=True)
                if payload:
                    charset = part.get_content_charset() or 'utf-8'
                    html = payload.decode(charset, errors='replace')
                    # Strip HTML tags for plain text
                    body = re.sub(r'<[^>]+>', '', html).strip()
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            charset = msg.get_content_charset() or 'utf-8'
            body = payload.decode(charset, errors='replace')
    
    # Parse date
    date_str = msg.get('Date', '')
    try:
        date_obj = parsedate_to_datetime(date_str)
        date_str = date_obj.strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
        pass
    
    return {
        'from': msg.get('From', ''),
        'to': msg.get('To', ''),
        'subject': subject,
        'date': date_str,
        'body': body[:5000],  # Cap body length
        'message_id': msg.get('Message-ID', ''),
    }


def read_inbox(
    max_results: int = 10,
    unread_only: bool = False,
    folder: str = 'INBOX'
) -> Dict[str, Any]:
    """Read recent emails from the inbox.
    
    Args:
        max_results: Maximum emails to return (default 10)
        unread_only: If True, only return unread emails
        folder: IMAP folder to read from (default INBOX)
    """
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
        
        # Get most recent N
        recent_ids = msg_ids[-max_results:]
        recent_ids.reverse()  # Newest first
        
        emails = []
        for mid in recent_ids:
            status, msg_data = imap.fetch(mid, '(RFC822)')
            if status == 'OK':
                parsed = _parse_message(msg_data)
                parsed['uid'] = mid.decode()
                emails.append(parsed)
        
        imap.logout()
        return {"status": "success", "emails": emails, "count": len(emails)}
    except Exception as e:
        try:
            imap.logout()
        except Exception:
            pass
        return {"status": "error", "error": str(e)}


def search_emails(
    query: str,
    max_results: int = 10,
    folder: str = 'INBOX'
) -> Dict[str, Any]:
    """Search emails using IMAP search criteria.
    
    Args:
        query: Search query — can be a name, email, subject keyword, or IMAP criteria.
               Simple text is auto-converted to search FROM, TO, SUBJECT, and BODY.
        max_results: Maximum results to return
        folder: IMAP folder to search
    """
    imap, err = _connect_imap()
    if err:
        return err
    
    try:
        imap.select(folder, readonly=True)
        
        # If query looks like raw IMAP criteria, use as-is
        imap_keywords = ('FROM', 'TO', 'SUBJECT', 'BODY', 'SINCE', 'BEFORE',
                         'ON', 'SEEN', 'UNSEEN', 'FLAGGED', 'ALL')
        if any(query.upper().startswith(kw) for kw in imap_keywords):
            criteria = query
        else:
            # Search across multiple fields with OR
            q = query.replace('"', '\\"')
            criteria = f'(OR OR (FROM "{q}") (SUBJECT "{q}") (BODY "{q}"))'
        
        status, data = imap.search(None, criteria)
        if status != 'OK':
            return {"status": "error", "error": f"Search failed for: {criteria}"}
        
        msg_ids = data[0].split()
        if not msg_ids:
            return {"status": "success", "emails": [], "count": 0,
                    "message": f"No emails matching '{query}'."}
        
        recent_ids = msg_ids[-max_results:]
        recent_ids.reverse()
        
        emails = []
        for mid in recent_ids:
            status, msg_data = imap.fetch(mid, '(RFC822)')
            if status == 'OK':
                parsed = _parse_message(msg_data)
                parsed['uid'] = mid.decode()
                emails.append(parsed)
        
        imap.logout()
        return {"status": "success", "emails": emails, "count": len(emails),
                "query": query}
    except Exception as e:
        try:
            imap.logout()
        except Exception:
            pass
        return {"status": "error", "error": str(e)}


# ---------------------------------------------------------------------------
# SMTP — Send
# ---------------------------------------------------------------------------

def send_email(
    to: str,
    subject: str,
    body: str,
    reply_to_message_id: Optional[str] = None,
    html: bool = False
) -> Dict[str, Any]:
    """Send an email via Gmail SMTP.
    
    Args:
        to: Recipient email address
        subject: Email subject
        body: Email body (plain text or HTML)
        reply_to_message_id: Optional Message-ID to reply to (threading)
        html: If True, send as HTML email
    """
    addr, pw = _get_credentials()
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


# ---------------------------------------------------------------------------
# Google Voice SMS helpers
# ---------------------------------------------------------------------------

def read_sms(max_results: int = 10) -> Dict[str, Any]:
    """Read recent SMS messages forwarded from Google Voice to Gmail.
    
    Google Voice forwards texts as emails from specific addresses.
    This searches for those forwarded messages.
    """
    return search_emails(
        query='FROM "voice-noreply@google.com"',
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
