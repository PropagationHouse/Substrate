import os
import json
import uuid
from datetime import datetime, timezone, timedelta
from flask import Flask, render_template, request, jsonify, session, Response
import queue
import threading
from dotenv import load_dotenv
import google.generativeai as genai
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_socketio import SocketIO, emit
from sqlalchemy.pool import QueuePool
from models import db, User, Workspace, MediaPlan, MediaItem, NewsSource, Article, ResearchCache, BrandProfile, MediaAsset

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

# Database
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///media_planning.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = None  # No file size limit
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    "poolclass": QueuePool,
    "pool_size": 5,
    "max_overflow": 10,
    "pool_pre_ping": True,
    "connect_args": {"check_same_thread": False, "timeout": 30}
}

db.init_app(app)

# Set WAL mode and busy_timeout on every new SQLite connection
from sqlalchemy import event as sa_event

with app.app_context():
    @sa_event.listens_for(db.engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=10000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

# Ensure DB sessions are properly cleaned up after each request
@app.teardown_appcontext
def shutdown_session(exception=None):
    db.session.remove()


# Rate limiting
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["5000 per day", "500 per hour"],
    storage_uri="memory://"
)

# Gemini AI client
AVAILABLE_MODELS = {}
client = None

try:
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    client = genai  # Set client for use in routes
    
    # Fetch available models from API
    print("Fetching available models from Gemini API...")
    for m in genai.list_models():
        if 'generateContent' in m.supported_generation_methods:
            model_id = m.name.replace('models/', '')
            AVAILABLE_MODELS[model_id] = {
                'name': m.display_name,
                'description': m.description if hasattr(m, 'description') else '',
                'supported_methods': m.supported_generation_methods
            }
    
    print(f"✓ Found {len(AVAILABLE_MODELS)} available models")
    
    # Use first available model or specified one
    default_model = os.getenv("GEMINI_MODEL")
    if not default_model or default_model not in AVAILABLE_MODELS:
        default_model = list(AVAILABLE_MODELS.keys())[0] if AVAILABLE_MODELS else None
    
    if default_model:
        model = genai.GenerativeModel(default_model)
        print(f"✓ Gemini AI initialized successfully ({default_model})")
    else:
        model = None
        print("Warning: No compatible models found")
        
except Exception as e:
    model = None
    client = None
    print(f"Warning: Gemini API error. AI features will be disabled. Error: {e}")

with app.app_context():
    # Step 0: Enable WAL mode for concurrent read/write access
    import sqlite3
    db_path = os.path.join(app.instance_path, 'media_planning.db')
    if os.path.exists(db_path):
        wal_conn = sqlite3.connect(db_path)
        wal_conn.execute("PRAGMA journal_mode=WAL")
        wal_conn.execute("PRAGMA busy_timeout=10000")
        wal_conn.close()
    
    # Step 1: Migrate schema — add workspace_id columns BEFORE create_all
    if os.path.exists(db_path):
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        for table in ['media_items', 'articles', 'media_assets']:
            try:
                cursor.execute(f"SELECT workspace_id FROM {table} LIMIT 1")
            except sqlite3.OperationalError:
                try:
                    cursor.execute(f"ALTER TABLE {table} ADD COLUMN workspace_id VARCHAR(36)")
                    print(f"✓ Added workspace_id column to {table}")
                except:
                    pass
        conn.commit()
        conn.close()
    
    # Step 2: Create any new tables (e.g. workspaces)
    db.create_all()
    
    # Step 3: Clean slate — no default news sources seeded. Users add their own.
    
    # Step 4: Auto-create Main workspace if none exist
    if Workspace.query.count() == 0:
        main_ws = Workspace(name='Main Studio', icon='🎬', color='#4ade80', is_main=True)
        db.session.add(main_ws)
        db.session.commit()
        print(f"✓ Created default workspace: {main_ws.name} ({main_ws.id})")
        
        # Link to existing brand profile
        existing_bp = BrandProfile.query.first()
        if existing_bp:
            main_ws.brand_profile_id = existing_bp.id
            db.session.commit()
        
        # Scope existing unscoped items to main workspace using raw SQL
        # (avoids SQLAlchemy ORM issues with freshly added columns)
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("UPDATE media_items SET workspace_id = ? WHERE workspace_id IS NULL", (main_ws.id,))
        cursor.execute("UPDATE articles SET workspace_id = ? WHERE workspace_id IS NULL", (main_ws.id,))
        cursor.execute("UPDATE media_assets SET workspace_id = ? WHERE workspace_id IS NULL", (main_ws.id,))
        conn.commit()
        conn.close()
        print("✓ Migrated existing data to Main workspace")

# ==================== ROUTES ====================

@app.route('/')
def index():
    return render_template('index_new.html')

# ========== WORKSPACE API ==========

@app.route('/api/workspaces', methods=['GET', 'POST'])
def workspaces_api():
    """List or create workspaces"""
    if request.method == 'POST':
        data = request.json
        ws = Workspace(
            name=data.get('name', 'New Workspace'),
            color=data.get('color', '#818cf8'),
            icon=data.get('icon', '📂'),
            is_main=False
        )
        # Optionally create a dedicated brand profile for this workspace
        if data.get('create_brand_profile'):
            bp = BrandProfile(
                name=data.get('brand_name', data.get('name', 'New Workspace')),
                industry=data.get('industry', ''),
                description=data.get('description', ''),
                target_audience=data.get('target_audience', '')
            )
            db.session.add(bp)
            db.session.flush()  # get bp.id
            ws.brand_profile_id = bp.id
        
        db.session.add(ws)
        db.session.commit()
        return jsonify(ws.to_dict())
    
    all_ws = Workspace.query.order_by(Workspace.is_main.desc(), Workspace.created_at).all()
    return jsonify([w.to_dict() for w in all_ws])

@app.route('/api/workspaces/<ws_id>', methods=['PUT', 'DELETE'])
def workspace_detail(ws_id):
    """Update or delete a workspace"""
    ws = Workspace.query.get_or_404(ws_id)
    
    if request.method == 'DELETE':
        if ws.is_main:
            return jsonify({"error": "Cannot delete the main workspace"}), 400
        # Delete all workspace-scoped data
        MediaItem.query.filter_by(workspace_id=ws_id).delete()
        Article.query.filter_by(workspace_id=ws_id).delete()
        MediaAsset.query.filter_by(workspace_id=ws_id).delete()
        # Delete workspace's brand profile if it's not shared
        if ws.brand_profile_id:
            other_ws = Workspace.query.filter(Workspace.id != ws_id, Workspace.brand_profile_id == ws.brand_profile_id).first()
            if not other_ws:
                bp = BrandProfile.query.get(ws.brand_profile_id)
                if bp:
                    db.session.delete(bp)
        db.session.delete(ws)
        db.session.commit()
        return jsonify({"success": True})
    
    # PUT
    data = request.json
    if 'name' in data:
        ws.name = data['name']
    if 'color' in data:
        ws.color = data['color']
    if 'icon' in data:
        ws.icon = data['icon']
    if 'brand_profile_id' in data:
        ws.brand_profile_id = data['brand_profile_id']
    if 'settings' in data:
        ws.set_settings(data['settings'])
    
    db.session.commit()
    return jsonify(ws.to_dict())

@app.route('/api/workspaces/<ws_id>/aggregate', methods=['GET'])
def workspace_aggregate(ws_id):
    """Get aggregate task/content summary from all sub-workspaces (for main workspace overview)"""
    ws = Workspace.query.get_or_404(ws_id)
    if not ws.is_main:
        return jsonify({"error": "Aggregate only available from main workspace"}), 400
    
    sub_workspaces = Workspace.query.filter(Workspace.is_main == False).all()
    summary = []
    for sub in sub_workspaces:
        items = MediaItem.query.filter_by(workspace_id=sub.id).all()
        total = len(items)
        done = len([i for i in items if i.status in ('done', 'published', 'posted')])
        in_progress = len([i for i in items if i.status == 'in_progress'])
        summary.append({
            'workspace': sub.to_dict(),
            'total_items': total,
            'done': done,
            'in_progress': in_progress,
            'pending': total - done - in_progress
        })
    
    return jsonify(summary)

@app.route('/api/brand-profiles', methods=['GET', 'POST'])
def brand_profiles():
    if request.method == 'POST':
        data = request.json
        profile = BrandProfile(
            name=data['name'],
            industry=data.get('industry', ''),
            description=data.get('description', ''),
            target_audience=data.get('target_audience', ''),
            brand_colors=data.get('brand_colors', ''),
            brand_fonts=data.get('brand_fonts', ''),
            interests=data.get('interests', ''),
            keywords=data.get('keywords', '')
        )
        db.session.add(profile)
        db.session.commit()
        return jsonify(profile.to_dict())
    
    profiles = BrandProfile.query.all()
    return jsonify([p.to_dict() for p in profiles])

@app.route('/api/brand-profiles/<profile_id>', methods=['PUT'])
def update_brand_profile(profile_id):
    profile = BrandProfile.query.get_or_404(profile_id)
    data = request.json
    
    profile.name = data.get('name', profile.name)
    profile.industry = data.get('industry', profile.industry)
    profile.description = data.get('description', profile.description)
    profile.target_audience = data.get('target_audience', profile.target_audience)
    profile.brand_colors = data.get('brand_colors', profile.brand_colors)
    profile.brand_fonts = data.get('brand_fonts', profile.brand_fonts)
    profile.interests = data.get('interests', profile.interests)
    profile.keywords = data.get('keywords', profile.keywords)
    
    db.session.commit()
    return jsonify(profile.to_dict())

@app.route('/api/media-plans', methods=['GET', 'POST'])
def media_plans():
    if request.method == 'POST':
        data = request.json
        plan = MediaPlan(
            brand_profile_id=data['brand_profile_id'],
            title=data['title'],
            description=data.get('description', ''),
            status=data.get('status', 'planning'),
            start_date=datetime.fromisoformat(data['start_date']) if data.get('start_date') else None,
            end_date=datetime.fromisoformat(data['end_date']) if data.get('end_date') else None
        )
        db.session.add(plan)
        db.session.commit()
        return jsonify(plan.to_dict())
    
    brand_id = request.args.get('brand_profile_id')
    if brand_id:
        plans = MediaPlan.query.filter_by(brand_profile_id=brand_id).all()
    else:
        plans = MediaPlan.query.all()
    return jsonify([p.to_dict() for p in plans])

@app.route('/api/media-items', methods=['GET', 'POST'])
def media_items():
    if request.method == 'POST':
        data = request.json
        
        # Parse scheduled_date if it's a string
        scheduled_date = None
        if data.get('scheduled_date'):
            try:
                if isinstance(data['scheduled_date'], str):
                    # Handle ISO format with Z or timezone
                    date_str = data['scheduled_date'].replace('Z', '+00:00')
                    scheduled_date = datetime.fromisoformat(date_str)
                else:
                    scheduled_date = data['scheduled_date']
            except Exception as e:
                print(f"Error parsing date: {e}")
        
        item = MediaItem(
            media_plan_id=data.get('media_plan_id'),
            workspace_id=data.get('workspace_id'),
            title=data['title'],
            content_type=data.get('content_type', 'post'),
            status=data.get('status', 'idea'),
            description=data.get('description', ''),
            channel=data.get('channel', ''),
            scheduled_date=scheduled_date,
            shot_list=data.get('shot_list', ''),
            storyboard=data.get('storyboard', ''),
            caption=data.get('caption', ''),
            tags=data.get('tags', '')
        )
        db.session.add(item)
        db.session.commit()
        return jsonify(item.to_dict())
    
    # GET request - filter by workspace_id, brand_profile_id, or media_plan_id
    workspace_id = request.args.get('workspace_id')
    brand_id = request.args.get('brand_profile_id')
    plan_id = request.args.get('media_plan_id')
    
    query = MediaItem.query
    if workspace_id:
        query = query.filter_by(workspace_id=workspace_id)
    if brand_id:
        query = query.filter_by(media_plan_id=brand_id)
    elif plan_id:
        query = query.filter_by(media_plan_id=plan_id)
    
    items = query.all()
    return jsonify([i.to_dict() for i in items])

@app.route('/api/media-items/<item_id>', methods=['PUT', 'DELETE'])
def media_item_detail(item_id):
    item = MediaItem.query.get_or_404(item_id)
    
    if request.method == 'DELETE':
        db.session.delete(item)
        db.session.commit()
        return jsonify({"success": True})
    
    if request.method == 'PUT':
        data = request.json
        for key, value in data.items():
            if hasattr(item, key):
                if key in ['scheduled_date'] and value:
                    value = datetime.fromisoformat(value)
                setattr(item, key, value)
        db.session.commit()
        return jsonify(item.to_dict())

@app.route('/api/news/fetch', methods=['POST'])
@limiter.limit("10 per hour")
def fetch_news():
    """Fetch latest news from user's configured sources (not hardcoded defaults)"""
    from news_fetcher import fetch_feed
    
    brand_id = request.json.get('brand_profile_id')
    profile = BrandProfile.query.get(brand_id) if brand_id else None
    
    # Get keywords from profile
    keywords = profile.keywords if profile else ""
    
    # Fetch from user's DB sources, NOT the hardcoded DEFAULT_FEEDS
    active_sources = NewsSource.query.filter_by(is_active=True).all()
    
    if not active_sources:
        return jsonify({"count": 0, "articles": [], "message": "No active sources configured. Add sources in Research Settings."})
    
    articles = []
    for source in active_sources:
        feed_articles = fetch_feed(source.url, source.name, source.keywords or keywords)
        articles.extend(feed_articles)
    
    workspace_id = request.json.get('workspace_id')
    
    # Save to database
    for art_data in articles:
        existing = Article.query.filter_by(url=art_data['url']).first()
        if not existing:
            article = Article(
                title=art_data['title'],
                url=art_data['url'],
                source=art_data['source'],
                content=art_data.get('content', ''),
                summary=art_data.get('summary', ''),
                published_at=art_data.get('published_at'),
                image_url=art_data.get('image_url', ''),
                brand_profile_id=brand_id,
                workspace_id=workspace_id
            )
            db.session.add(article)
    
    db.session.commit()
    return jsonify({"count": len(articles), "articles": articles[:10]})

@app.route('/api/news/digest', methods=['POST'])
@limiter.limit("15 per hour")
def news_digest():
    """Generate an AI digest of what's actually worth paying attention to from recent articles"""
    if not client:
        return jsonify({"error": "AI features are disabled"}), 503
    
    data = request.json
    brand_id = data.get('brand_profile_id')
    workspace_id = data.get('workspace_id')
    
    profile = BrandProfile.query.get(brand_id) if brand_id else None
    
    # Get recent articles
    query = Article.query
    if workspace_id:
        query = query.filter_by(workspace_id=workspace_id)
    elif brand_id:
        query = query.filter_by(brand_profile_id=brand_id)
    recent = query.order_by(Article.published_at.desc()).limit(25).all()
    
    if not recent:
        return jsonify({"digest": "No articles to digest yet. Fetch news from your sources first."})
    
    articles_text = "\n".join([
        f"- [{a.source}] \"{a.title}\": {(a.summary or a.content or '')[:200]}"
        for a in recent
    ])
    
    brand_ctx = ""
    if profile:
        brand_ctx = f"Brand: {profile.name} | Industry: {profile.industry or 'General'} | Audience: {profile.target_audience or 'General'} | Keywords: {profile.keywords or 'N/A'}"
    
    try:
        selected_model = session.get('ai_model', list(AVAILABLE_MODELS.keys())[0] if AVAILABLE_MODELS else 'gemini-2.5-flash')
        ai_model = genai.GenerativeModel(selected_model)
        
        prompt = f"""You scan the wire for a creative team and distill it into something they'll actually read. You have personality. You have taste. You don't waste their time.

{brand_ctx}

Fresh off the wire:
{articles_text}

Write a compact wire digest in clean HTML. This goes at the top of their feed — it should feel like a smart friend texting them the highlights.

Output format: raw HTML (no markdown, no code fences). Use this structure:

<div class="digest-summary">
  <p class="digest-lead"><strong>[One sentence: the vibe of the wire today. What's the throughline?]</strong></p>
  [For each noteworthy story (3-5 max), output:]
  <div class="digest-item">
    <span class="digest-source">[Source Name]</span>
    <p><strong>[Why this matters to the brand]</strong> — [The angle or opportunity in one sentence]</p>
  </div>
  [If nothing is noteworthy:]
  <p class="digest-quiet">Quiet cycle. Nothing on the wire worth pulling you away from execution. Keep building.</p>
</div>

Rules:
- Direct, opinionated, no corporate speak. Write like you talk.
- Skip anything generic. Only surface what THIS brand should care about.
- Clean HTML only. No inline styles. Use the class names provided.
- Do NOT wrap in code fences or markdown."""

        response = ai_model.generate_content(prompt)
        return jsonify({"digest": response.text if response.text else "Nothing stood out this cycle. Check back after your next fetch."})
    except Exception as e:
        print(f"Digest error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/news', methods=['GET'])
def get_news():
    """Get saved news articles"""
    brand_id = request.args.get('brand_profile_id')
    workspace_id = request.args.get('workspace_id')
    limit = int(request.args.get('limit', 20))
    pinned = request.args.get('pinned')
    
    query = Article.query
    if workspace_id:
        query = query.filter_by(workspace_id=workspace_id)
    if brand_id:
        query = query.filter_by(brand_profile_id=brand_id)
    if pinned == 'true':
        query = query.filter_by(is_pinned=True)
    
    articles = query.order_by(Article.published_at.desc()).limit(limit).all()
    return jsonify([a.to_dict() for a in articles])

@app.route('/api/news/<article_id>/pin', methods=['POST'])
def toggle_pin_article(article_id):
    """Toggle pin status of an article"""
    article = Article.query.get_or_404(article_id)
    article.is_pinned = not article.is_pinned
    db.session.commit()
    return jsonify(article.to_dict())

@app.route('/api/news/<article_id>', methods=['DELETE'])
def delete_article(article_id):
    """Delete an article"""
    article = Article.query.get_or_404(article_id)
    db.session.delete(article)
    db.session.commit()
    return jsonify({"success": True})

@app.route('/api/research/convert', methods=['POST'])
@limiter.limit("20 per hour")
def convert_research_to_media():
    """Convert research article into media plan item(s)"""
    if not client:
        return jsonify({"error": "AI features disabled. Please set GEMINI_API_KEY."}), 503
    
    data = request.json
    article_id = data.get('article_id')
    brand_profile_id = data.get('brand_profile_id')
    content_type = data.get('content_type', 'Instagram Reel')
    count = min(data.get('count', 3), 10)
    
    article = Article.query.get_or_404(article_id)
    
    # Get brand context
    brand_context = ""
    if brand_profile_id:
        profile = BrandProfile.query.get(brand_profile_id)
        if profile:
            brand_context = f"\nBrand: {profile.name} ({profile.industry or 'general'})\nTarget audience: {profile.target_audience or 'general'}\n"
    
    prompt = f"""Based on this research finding, generate exactly {count} content idea(s) for the format: {content_type}.
{brand_context}
Research: {article.title}
Details: {article.summary or article.content or ''}

For each idea return JSON with these fields:
- "title": catchy title under 60 chars
- "description": what to create and key talking points (2-3 sentences)
- "caption": ready-to-post caption with relevant hashtags

Return ONLY a JSON array, no markdown. Example: [{{"title":"...","description":"...","caption":"..."}}]"""

    try:
        selected_model = session.get('ai_model', list(AVAILABLE_MODELS.keys())[0] if AVAILABLE_MODELS else 'gemini-2.5-flash')
        ai_model = genai.GenerativeModel(selected_model)
        response = ai_model.generate_content(prompt)
        
        import re
        json_match = re.search(r'\[[\s\S]*\]', response.text)
        if not json_match:
            return jsonify({"error": "Could not parse AI response"}), 500
        
        ideas = json.loads(json_match.group())
        
        created_items = []
        for idea in ideas[:count]:
            item = MediaItem(
                media_plan_id=brand_profile_id,
                title=idea.get('title', 'Untitled'),
                content_type=content_type,
                description=idea.get('description', ''),
                caption=idea.get('caption', ''),
                status='not_started'
            )
            db.session.add(item)
            created_items.append(item)
        
        db.session.commit()
        return jsonify([i.to_dict() for i in created_items])
    
    except Exception as e:
        print(f"Convert error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/settings', methods=['GET', 'POST'])
def settings():
    """Get or update user settings (theme, preferences)"""
    if request.method == 'POST':
        data = request.json
        session['theme'] = data.get('theme', 'forest')
        session['accent_color'] = data.get('accent_color', '#4ade80')
        session['ai_model'] = data.get('ai_model', 'gemini-2.5-flash')
        return jsonify({"success": True})
    
    return jsonify({
        "theme": session.get('theme', 'forest'),
        "accent_color": session.get('accent_color', '#4ade80'),
        "ai_model": session.get('ai_model', 'gemini-2.5-flash'),
        "available_models": AVAILABLE_MODELS
    })

@app.route('/api/models', methods=['GET'])
def get_models():
    """Get available AI models"""
    return jsonify(AVAILABLE_MODELS)

@app.route('/api/news-sources', methods=['GET', 'POST'])
def news_sources():
    """Manage news sources"""
    if request.method == 'POST':
        data = request.json
        try:
            # Check if source with this URL already exists
            existing = NewsSource.query.filter_by(url=data['url']).first()
            if existing:
                # Reactivate and update name if it already exists
                existing.is_active = True
                existing.name = data.get('name', existing.name)
                db.session.commit()
                return jsonify(existing.to_dict()), 200
            
            source = NewsSource(
                url=data['url'],
                name=data['name'],
                feed_type=data.get('feed_type', 'rss'),
                keywords=data.get('keywords', ''),
                is_active=True
            )
            db.session.add(source)
            db.session.commit()
            return jsonify(source.to_dict()), 201
        except Exception as e:
            db.session.rollback()
            return jsonify({"error": f"Could not add source: {str(e)}"}), 400
    
    sources = NewsSource.query.all()
    return jsonify([s.to_dict() for s in sources])

@app.route('/api/news-sources/<int:source_id>', methods=['PUT', 'DELETE'])
def manage_news_source(source_id):
    """Update or delete a news source"""
    source = NewsSource.query.get_or_404(source_id)
    
    if request.method == 'DELETE':
        db.session.delete(source)
        db.session.commit()
        return jsonify({"success": True})
    
    data = request.json
    if 'is_active' in data:
        source.is_active = data['is_active']
    if 'name' in data:
        source.name = data['name']
    if 'url' in data:
        source.url = data['url']
    if 'keywords' in data:
        source.keywords = data['keywords']
    
    db.session.commit()
    return jsonify(source.to_dict())

@app.route('/api/research/search', methods=['POST'])
@limiter.limit("20 per hour")
def research_search():
    """Research a topic using Gemini AI with Google Search grounding for real-time web results"""
    if not client:
        return jsonify({"error": "AI features are disabled"}), 503
    
    data = request.json
    query = data.get('query', '').strip()
    brand_id = data.get('brand_profile_id')
    workspace_id = data.get('workspace_id')
    
    if not query:
        return jsonify({"results": [], "ai_summary": "", "sources": []})
    
    # Brand context for more relevant results
    brand_context = ""
    if brand_id:
        profile = BrandProfile.query.get(brand_id)
        if profile:
            brand_context = f" for a {profile.industry or 'general'} brand called {profile.name}"
    
    try:
        selected_model = session.get('ai_model', list(AVAILABLE_MODELS.keys())[0] if AVAILABLE_MODELS else 'gemini-2.5-flash')
        
        # Use Google Search grounding for real-time web results
        # Build the tool at the proto level (the SDK's GenerativeModel constructor
        # can't handle google_search — it only knows FunctionDeclaration tools)
        from google.ai.generativelanguage_v1beta.types import Tool as ProtoTool
        
        google_search_tool = None
        try:
            google_search_tool = ProtoTool(google_search={})
        except (AttributeError, TypeError):
            try:
                google_search_tool = ProtoTool(google_search_retrieval={})
            except (AttributeError, TypeError):
                google_search_tool = None
        
        # Create model WITHOUT tools (pass them in generate_content instead)
        ai_model = genai.GenerativeModel(selected_model)
        
        research_prompt = f"""Research the following topic thoroughly{brand_context}: "{query}"

Search the web for the most current, real information. Provide:
1. A comprehensive 2-3 paragraph summary of key findings and current state
2. List each distinct source/article you found with its title, URL, source name, and a brief summary of what it covers

Format your response as JSON:
{{
  "summary": "Comprehensive research summary with current findings...",
  "sources": [
    {{
      "title": "Article or page title",
      "url": "https://actual-url.com/article",
      "source": "Publication or site name",
      "summary": "What this source covers and why it's relevant",
      "published": "Date if available, otherwise empty string"
    }}
  ]
}}

IMPORTANT: Include REAL URLs from actual web sources. Include 5-10 sources. Return ONLY valid JSON, no markdown fences."""

        # Pass tool in generate_content (not constructor) to avoid FunctionLibrary parsing
        gen_kwargs = {}
        if google_search_tool:
            gen_kwargs["tools"] = [google_search_tool]
        response = ai_model.generate_content(research_prompt, **gen_kwargs)
        
        ai_summary = ""
        sources = []
        
        # Also try to extract grounding metadata (citations from Google Search)
        grounding_sources = []
        try:
            if hasattr(response, 'candidates') and response.candidates:
                candidate = response.candidates[0]
                # Check for grounding metadata
                if hasattr(candidate, 'grounding_metadata') and candidate.grounding_metadata:
                    gm = candidate.grounding_metadata
                    if hasattr(gm, 'grounding_chunks'):
                        for chunk in gm.grounding_chunks:
                            if hasattr(chunk, 'web') and chunk.web:
                                grounding_sources.append({
                                    "title": chunk.web.title or "Untitled",
                                    "url": chunk.web.uri or "",
                                    "source": _extract_domain(chunk.web.uri) if chunk.web.uri else "Web",
                                    "summary": "",
                                    "published": ""
                                })
                    elif hasattr(gm, 'web_search_queries'):
                        pass  # Queries used but no direct chunks
        except Exception as grounding_err:
            print(f"Grounding metadata extraction: {grounding_err}")
        
        # Extract text from response — handle different structures
        response_text = ""
        try:
            response_text = response.text or ""
        except (ValueError, AttributeError):
            # response.text can raise if there are multiple parts or no text part
            try:
                if hasattr(response, 'candidates') and response.candidates:
                    parts = response.candidates[0].content.parts
                    response_text = ''.join(p.text for p in parts if hasattr(p, 'text') and p.text)
            except Exception:
                pass
        
        if response_text:
            import re
            raw_text = response_text.strip()
            # Strip markdown code fences (```json ... ``` or ``` ... ```)
            raw_text = re.sub(r'^```(?:json)?\s*\n?', '', raw_text)
            raw_text = re.sub(r'\n?```\s*$', '', raw_text)
            raw_text = raw_text.strip()
            
            parsed = None
            # Attempt 1: direct JSON parse
            try:
                parsed = json.loads(raw_text)
            except (json.JSONDecodeError, ValueError):
                pass
            
            # Attempt 2: extract JSON object from mixed text
            if not parsed:
                try:
                    json_match = re.search(r'\{[^{}]*"summary"[^{}]*"sources"\s*:\s*\[[\s\S]*\]\s*\}', raw_text)
                    if json_match:
                        parsed = json.loads(json_match.group())
                except (json.JSONDecodeError, ValueError):
                    pass
            
            # Attempt 3: greedy object match
            if not parsed:
                try:
                    json_match = re.search(r'\{[\s\S]*\}', raw_text)
                    if json_match:
                        parsed = json.loads(json_match.group())
                except (json.JSONDecodeError, ValueError):
                    pass
            
            if parsed and isinstance(parsed, dict):
                ai_summary = parsed.get('summary', '')
                sources = parsed.get('sources', [])
                if not ai_summary:
                    ai_summary = raw_text
            else:
                # Could not parse — use raw text but clean up JSON artifacts
                print(f"[research/search] Could not parse JSON from response, using raw text")
                ai_summary = raw_text
        
        # Merge grounding sources with parsed sources (deduplicate by URL)
        seen_urls = {s.get('url', '') for s in sources if s.get('url')}
        for gs in grounding_sources:
            if gs['url'] and gs['url'] not in seen_urls:
                sources.append(gs)
                seen_urls.add(gs['url'])
        
        # Save sources as articles in local DB for persistence
        saved_articles = []
        for src in sources:
            url = src.get('url', '')
            if not url or url.startswith('ai-research://'):
                continue
            # Skip if already exists in DB
            existing = Article.query.filter_by(url=url).first()
            if not existing:
                article = Article(
                    title=src.get('title', 'Untitled'),
                    url=url,
                    source=src.get('source', 'Web'),
                    summary=src.get('summary', ''),
                    content=src.get('summary', ''),
                    brand_profile_id=brand_id,
                    workspace_id=workspace_id,
                    published_at=datetime.now(timezone.utc)
                )
                db.session.add(article)
                saved_articles.append(article)
        
        if saved_articles:
            db.session.commit()
        
        # Build results list (article dicts with real URLs)
        all_results = [a.to_dict() for a in saved_articles]
        
        return jsonify({
            "results": all_results,
            "ai_summary": ai_summary,
            "sources": sources,
            "query": query
        })
        
    except Exception as e:
        print(f"Research search error: {e}")
        import traceback
        traceback.print_exc()
        # Fall back to local DB results
        search_term = f"%{query}%"
        article_query = Article.query.filter(
            db.or_(
                Article.title.ilike(search_term),
                Article.summary.ilike(search_term),
                Article.source.ilike(search_term)
            )
        )
        if workspace_id:
            article_query = article_query.filter_by(workspace_id=workspace_id)
        db_articles = article_query.order_by(Article.published_at.desc()).limit(10).all()
        local_results = [a.to_dict() for a in db_articles]
        
        return jsonify({
            "results": local_results,
            "ai_summary": f"Live search unavailable ({str(e)}). Showing cached results.",
            "sources": [],
            "query": query
        })


def _extract_domain(url):
    """Extract domain name from URL for display"""
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        domain = parsed.netloc.replace('www.', '')
        return domain
    except:
        return "Web"

@app.route('/api/research/brief', methods=['POST'])
@limiter.limit("10 per hour")
def research_brief():
    """Generate an AI-powered research brief based on interests and recent news"""
    if not client:
        return jsonify({"error": "AI features are disabled"}), 503
    
    data = request.json
    brand_id = data.get('brand_profile_id')
    
    # Gather context
    profile = BrandProfile.query.get(brand_id) if brand_id else None
    
    # Get recent articles
    recent_query = Article.query
    if brand_id:
        recent_query = recent_query.filter_by(brand_profile_id=brand_id)
    recent_articles = recent_query.order_by(Article.published_at.desc()).limit(15).all()
    
    # Get pinned articles
    pinned = Article.query.filter_by(is_pinned=True).limit(10).all()
    
    articles_context = "\n".join([
        f"- [{a.source}] {a.title}: {(a.summary or '')[:150]}"
        for a in (recent_articles + pinned)
    ]) or "No articles fetched yet."
    
    brand_context = ""
    if profile:
        brand_context = f"""
Brand: {profile.name}
Industry: {profile.industry or 'General'}
Target Audience: {profile.target_audience or 'General'}
Keywords/Interests: {profile.keywords or 'None specified'}
"""
    
    try:
        selected_model = session.get('ai_model', list(AVAILABLE_MODELS.keys())[0] if AVAILABLE_MODELS else 'gemini-2.5-flash')
        ai_model = genai.GenerativeModel(selected_model)
        
        prompt = f"""You are the trusted strategist embedded in a creative team. You write internal intelligence briefs that the team actually reads because they're sharp, specific, and feel like they were written by someone who genuinely understands the operation.

{brand_context}

What's on the wire:
{articles_context}

Write a rich, immersive intelligence brief in clean HTML. This is NOT a generic report — it's a personalized strategic document for this specific brand and team. 

Output format: raw HTML (no markdown, no code fences). Use this structure:

<div class="brief-hero">
  <h2>[A compelling, specific headline that captures today's strategic picture — NOT "Daily Brief" or "Industry Update"]</h2>
  <p class="brief-subtitle">[One sentence setting the scene. What's the energy today? What shifted?]</p>
</div>

<div class="brief-section brief-signal">
  <h3>🔥 The Signal</h3>
  <p>[2-3 sentences on THE story that matters most. Why it matters for THIS brand specifically. Be opinionated and direct. Name the opportunity or threat.]</p>
</div>

<div class="brief-section brief-radar">
  <h3>📡 On Your Radar</h3>
  [2-3 items, each as a <div class="brief-radar-item"><strong>[Source/Topic]</strong> — [One punchy sentence on why it matters. Content angle if there is one.]</div>]
</div>

<div class="brief-section brief-plays">
  <h3>🎯 Plays to Run</h3>
  [2-3 concrete content concepts. NOT "consider posting about X". Actual hooks, formats, angles. Each as a <div class="brief-play"><strong>[Format: Hook]</strong><p>[1-2 sentences: the concept, why it works, what makes it timely]</p></div>]
</div>

<div class="brief-section brief-skip">
  <h3>💀 Noise</h3>
  <p>[One sentence on what to ignore this cycle and why.]</p>
</div>

<div class="brief-footer">
  <p>[A closing line — motivational, strategic, or a provocative question to chew on. Make it memorable.]</p>
</div>

Rules:
- Write like a sharp colleague, not a corporate bot. Short sentences. Personality.
- Every point ties back to THIS brand, THIS audience, THIS operation.
- If the news is dry, say so honestly. Don't manufacture excitement.
- The HTML must be clean and semantic. No inline styles. Use only the class names provided.
- Do NOT wrap output in code fences or markdown. Output raw HTML only."""

        response = ai_model.generate_content(prompt)
        
        if response.text:
            return jsonify({"brief": response.text})
        else:
            return jsonify({"error": "AI could not generate a brief. Try again."}), 400
            
    except Exception as e:
        print(f"AI brief error: {e}")
        return jsonify({"error": f"Error generating brief: {str(e)}"}), 500

@app.route('/api/chat', methods=['POST'])
@limiter.limit("30 per hour")
def chat():
    """Chat with AI assistant"""
    if not client:
        return jsonify({"error": "AI features are disabled"}), 503
    
    data = request.json
    message = data.get('message', '')
    action_mode = data.get('action_mode', False)
    brand_profile_id = data.get('brand_profile_id')
    
    if not message:
        return jsonify({"error": "Message is required"}), 400
    
    try:
        # Use selected model from session
        selected_model = session.get('ai_model', list(AVAILABLE_MODELS.keys())[0] if AVAILABLE_MODELS else 'gemini-2.5-flash')
        model = genai.GenerativeModel(selected_model)
        
        # Fetch brand profile from DB if provided
        brand_context = ""
        if brand_profile_id:
            profile = BrandProfile.query.get(brand_profile_id)
            if profile:
                brand_context = f"""
**CURRENT BRAND PROFILE (already set up):**
- Name: {profile.name}
- Industry: {profile.industry or 'Not specified'}
- Description: {profile.description or 'Not specified'}
- Target Audience: {profile.target_audience or 'Not specified'}
- Keywords: {profile.keywords or 'Not specified'}
"""
        
        # If action mode, add instructions for creating/updating content
        if action_mode:
            system_prompt = f"""You are a media planning assistant with FULL control of the user's content board and research system. The brand profile IS set up. Use it for all content.
{brand_context}
You can perform these actions. Return them as ACTION_JSON after your message text.

**1. CREATE CONTENT** - create new content items:
ACTION_JSON:
{{"actions": [{{"type": "create_content", "items": [{{"title": "...", "content_type": "Instagram Reel", "description": "...", "caption": "...", "scheduled_date": "2026-05-15T12:00:00Z"}}]}}]}}

**2. UPDATE PLANNING** - add shotlists, storyboards, scripts, captions to existing items:
ACTION_JSON:
{{"actions": [{{"type": "update_planning", "item_title": "exact title", "planning_type": "shotlist|storyboard|script|caption", "content": {{"shots": [...]}}}}]}}

**3. DELETE CONTENT** - delete items by title:
ACTION_JSON:
{{"actions": [{{"type": "delete_content", "item_titles": ["Title 1", "Title 2"]}}]}}

**4. MOVE CONTENT** - change status of items:
ACTION_JSON:
{{"actions": [{{"type": "move_content", "item_titles": ["Title"], "new_status": "not_started|in_progress|done"}}]}}

**5. RESEARCH** - trigger an AI research search:
ACTION_JSON:
{{"actions": [{{"type": "research", "query": "search query"}}]}}

**6. RESEARCH BRIEF** - generate an AI industry brief:
ACTION_JSON:
{{"actions": [{{"type": "research_brief"}}]}}

You can combine multiple actions. For example: research a topic, then create content based on findings.

IMPORTANT RULES:
1. The brand profile IS set up. Never tell the user to set it up.
2. Generate content directly. Do NOT ask clarifying questions.
3. When asked to delete or move items, match by title from the current items list in context.
4. Use today's date ({datetime.now().strftime('%Y-%m-%d')}) as reference for scheduling.
5. For research queries, pick specific, focused search terms.

Planning data formats:
- Shotlists: {{"shots": [{{"type": "Wide", "angle": "Eye level", "description": "...", "duration": "5s", "image": null}}]}}
- Storyboards: {{"frames": [{{"frame_number": 1, "description": "...", "notes": "...", "image": null}}]}}
- Scripts: {{"script": "Full script text..."}}
- Captions: {{"caption": "Caption text with hashtags"}}

Content types: Instagram Reel, TikTok, Instagram Post, YouTube Short, Blog Post, etc.
"""
            full_message = system_prompt + "\n\nUser request: " + message
        else:
            full_message = message
        
        response = model.generate_content(full_message)
        
        # Handle safety blocks
        if not response.text:
            return jsonify({"error": "Response blocked by safety filters. Please rephrase your question."}), 400
        
        # Parse actions if in action mode
        actions = []
        response_text = response.text
        
        if action_mode and "ACTION_JSON:" in response_text:
            parts = response_text.split("ACTION_JSON:")
            response_text = parts[0].strip()
            
            try:
                import re
                json_match = re.search(r'\{[\s\S]*\}', parts[1])
                if json_match:
                    action_data = json.loads(json_match.group())
                    actions = action_data.get('actions', [])
            except Exception as e:
                print(f"Error parsing actions: {e}")
        
        return jsonify({
            "response": response_text,
            "actions": actions
        })
    except Exception as e:
        print(f"Chat error: {e}")
        return jsonify({"error": f"AI error: {str(e)}"}), 500

@app.route('/api/generate-image', methods=['POST'])
@app.route('/api/ai/generate-image', methods=['POST'])
@limiter.limit("10 per hour")
def generate_image():
    """Generate images using Gemini's native image generation, optionally with reference image"""
    if not client:
        return jsonify({"error": "AI features are disabled"}), 503
        
    data = request.json
    prompt = data.get('prompt', '')
    brand_profile_id = data.get('brand_profile_id')
    reference_image_data = data.get('reference_image_data')  # base64 data URL
    variation_strength = data.get('variation_strength', 'strong')  # strong, light, manual
    
    if not prompt:
        return jsonify({"error": "Prompt is required"}), 400
    
    try:
        import base64
        import requests as _req
        
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return jsonify({"error": "GEMINI_API_KEY not configured"}), 503
        
        # Fallback chain: gemini-2.5-flash-image → gemini-2.5-flash
        MODEL_CHAIN = ["gemini-2.5-flash-image", "gemini-2.5-flash"]
        
        # Build content parts for the REST API
        parts = []
        
        if reference_image_data:
            # Extract base64 image data from data URL
            if reference_image_data.startswith('data:'):
                header, b64_data = reference_image_data.split(',', 1)
                mime_type = header.split(':')[1].split(';')[0]
            else:
                b64_data = reference_image_data
                mime_type = 'image/png'
            
            parts.append({"inlineData": {"mimeType": mime_type, "data": b64_data}})
            
            # Adjust prompt based on variation strength
            if variation_strength == 'light':
                parts.append({"text": f"Generate a very subtle variation of the attached image. Keep the composition, colors, and overall look nearly identical but with minimal creative differences. Instructions: {prompt}"})
            elif variation_strength == 'strong':
                parts.append({"text": f"Generate a bold creative variation of the attached image. Keep the general subject/theme but significantly vary the composition, style, colors, or perspective. Instructions: {prompt}"})
            else:
                parts.append({"text": f"Using the attached image as reference: {prompt}"})
        else:
            parts.append({"text": f"Generate an image: {prompt}"})
        
        # Try models in order until one succeeds (REST API with responseModalities)
        last_error = None
        for model_name in MODEL_CHAIN:
            try:
                print(f"[ImageGen] Trying model: {model_name}")
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
                payload = {
                    "contents": [{"parts": parts}],
                    "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}
                }
                resp = _req.post(url, json=payload, timeout=60)
                result = resp.json()
                
                if resp.status_code != 200:
                    err_msg = result.get('error', {}).get('message', resp.text[:200])
                    last_error = f"{model_name}: {err_msg}"
                    print(f"[ImageGen] API error: {last_error}")
                    continue
                
                # Extract image from response
                candidates = result.get('candidates', [])
                if candidates:
                    for part in candidates[0].get('content', {}).get('parts', []):
                        if 'inlineData' in part:
                            mime = part['inlineData'].get('mimeType', 'image/png')
                            b64 = part['inlineData']['data']
                            data_url = f'data:{mime};base64,{b64}'
                            print(f"[ImageGen] Success with {model_name}")
                            return jsonify({"success": True, "image_url": data_url, "prompt": prompt, "model": model_name})
                
                last_error = f"{model_name}: No image in response"
                print(f"[ImageGen] {last_error}")
                continue
                
            except Exception as model_err:
                last_error = f"{model_name}: {str(model_err)}"
                print(f"[ImageGen] Model failed: {last_error}")
                continue
        
        return jsonify({
            "error": last_error or "No image generation model available. Try a more descriptive prompt.",
        }), 400
        
    except Exception as e:
        print(f"Image generation error: {e}")
        return jsonify({"error": f"Image generation failed: {str(e)}"}), 500

# ========== MOOD BOARD API ==========

@app.route('/api/mood-board', methods=['GET'])
def get_mood_board():
    """Get mood board images for a brand profile.
    If ?metadata_only=1, returns lightweight metadata without base64 image data.
    """
    brand_profile_id = request.args.get('brand_profile_id')
    metadata_only = request.args.get('metadata_only', '0') == '1'
    
    if not brand_profile_id:
        return jsonify([])
    
    # Get from database for persistence
    assets = MediaAsset.query.filter_by(
        brand_profile_id=brand_profile_id,
        asset_type='mood_board'
    ).all()
    
    if metadata_only:
        # Return only positioning/layout metadata — no heavy base64 data
        results = []
        for asset in assets:
            meta = asset.get_meta()
            results.append({
                'id': asset.id,
                'name': asset.name,
                'description': asset.description or '',
                'x': meta.get('x') if meta else None,
                'y': meta.get('y') if meta else None,
                'rotation': meta.get('rotation', 0) if meta else 0,
                'scale': meta.get('scale', 1) if meta else 1,
                'opacity': meta.get('opacity', 1) if meta else 1,
                'zIndex': meta.get('zIndex', 1) if meta else 1,
                'width': meta.get('width') if meta else None,
                'height': meta.get('height') if meta else None,
                'uploaded_at': asset.uploaded_at.isoformat() if asset.uploaded_at else None,
            })
        return jsonify(results)
    
    return jsonify([asset.to_dict() for asset in assets])

@app.route('/api/mood-board/image/<image_id>', methods=['GET'])
def get_mood_board_image(image_id):
    """Get a single mood board image's data URL by ID — for lazy loading."""
    asset = MediaAsset.query.get(image_id)
    if not asset or asset.asset_type != 'mood_board':
        return jsonify({"error": "Image not found"}), 404
    return jsonify({"id": asset.id, "url": asset.file_url})

@app.route('/api/mood-board/upload', methods=['POST'])
def upload_mood_image():
    """Upload image to mood board - no file size limit, preserves transparency"""
    import base64
    from PIL import Image
    from io import BytesIO
    
    brand_profile_id = request.form.get('brand_profile_id')
    workspace_id = request.form.get('workspace_id')
    
    if not brand_profile_id or brand_profile_id in ('undefined', 'null', ''):
        return jsonify({"error": "Brand profile required. Please save your brand profile in Settings first."}), 400
    
    if 'image' not in request.files:
        return jsonify({"error": "No image file provided"}), 400
    
    file = request.files['image']
    
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    try:
        # Read image bytes
        image_bytes = file.read()
        
        # Open with PIL to get dimensions and ensure proper format
        img = Image.open(BytesIO(image_bytes))
        width, height = img.size
        
        # Convert to base64 data URL, preserving original format
        base64_image = base64.b64encode(image_bytes).decode('utf-8')
        
        # Determine mime type - preserve transparency for PNG
        mime_type = file.content_type or 'image/png'
        data_url = f'data:{mime_type};base64,{base64_image}'
        
        # Save to database for persistence
        asset = MediaAsset(
            brand_profile_id=brand_profile_id,
            workspace_id=workspace_id,
            asset_type='mood_board',
            name=file.filename or 'Untitled',
            file_url=data_url,
            file_name=file.filename,
            file_size=len(image_bytes),
            mime_type=mime_type,
            description=request.form.get('description', '')
        )
        asset.set_meta({'width': width, 'height': height, 'x': None, 'y': None, 'rotation': 0, 'scale': 1})
        db.session.add(asset)
        db.session.commit()
        
        return jsonify(asset.to_dict())
    except Exception as e:
        db.session.rollback()
        print(f"Error uploading mood board image: {e}")
        return jsonify({"error": f"Error processing image: {str(e)}"}), 400

@app.route('/api/mood-board/<image_id>', methods=['DELETE'])
def delete_mood_image(image_id):
    """Delete image from mood board"""
    try:
        asset = MediaAsset.query.get(image_id)
        if asset:
            db.session.delete(asset)
            db.session.commit()
        return jsonify({"success": True})
    except Exception as e:
        print(f"Error deleting mood board image: {e}")
        return jsonify({"error": str(e)}), 500

# ========== PLANNING TOOLS API ==========

@app.route('/api/mood-board/<image_id>/update', methods=['POST'])
def update_mood_image_position(image_id):
    """Update mood board image position/rotation/scale"""
    try:
        asset = MediaAsset.query.get(image_id)
        if asset:
            data = request.json
            meta = asset.get_meta() or {}
            meta.update({
                'x': data.get('x'),
                'y': data.get('y'),
                'rotation': data.get('rotation', 0),
                'scale': data.get('scale', 1)
            })
            asset.set_meta(meta)
            db.session.commit()
        return jsonify({"success": True})
    except Exception as e:
        print(f"Error updating mood board image: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/mood-board/batch-update', methods=['POST'])
def batch_update_mood_positions():
    """Batch update positions for multiple mood board images in one transaction"""
    try:
        updates = request.json.get('updates', [])
        for item in updates:
            asset = MediaAsset.query.get(item.get('id'))
            if asset:
                meta = asset.get_meta() or {}
                meta.update({
                    'x': item.get('x'),
                    'y': item.get('y'),
                    'rotation': item.get('rotation', 0),
                    'scale': item.get('scale', 1),
                    'opacity': item.get('opacity', 1),
                    'zIndex': item.get('zIndex', 1)
                })
                asset.set_meta(meta)
        db.session.commit()
        return jsonify({"success": True})
    except Exception as e:
        db.session.rollback()
        print(f"Error batch updating mood board: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/media-items/<item_id>/planning', methods=['POST'])
def save_planning_data(item_id):
    """Save planning data for a media item"""
    data = request.json
    tool = data.get('tool')
    planning_data = data.get('data')
    
    print(f"Saving planning data for item {item_id}: tool={tool}, data_keys={planning_data.keys() if planning_data else None}")
    
    item = MediaItem.query.get(item_id)
    if not item:
        return jsonify({"error": "Media item not found"}), 404
    
    try:
        # Store in the correct column based on tool type
        if tool == 'shotlist':
            item.shot_list = json.dumps(planning_data)
        elif tool == 'storyboard':
            item.storyboard = json.dumps(planning_data)
        elif tool == 'script':
            # Script content stored in caption column for now (or could add script column)
            item.caption = planning_data.get('content', '')
        elif tool == 'caption':
            item.caption = planning_data.get('content', '')
        
        db.session.commit()
        print(f"Planning data saved successfully for item {item_id}")
        return jsonify({"success": True})
    except Exception as e:
        db.session.rollback()
        print(f"Error saving planning data: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/ai/clarify', methods=['POST'])
@limiter.limit("20 per hour")
def ai_clarify():
    """Generate clarifying questions before content generation"""
    if not client:
        return jsonify({"error": "AI features are disabled"}), 503
    
    data = request.json
    tool_type = data.get('tool_type')
    content_title = data.get('content_title', '')
    content_type = data.get('content_type', '')
    
    # Define questions based on tool type
    questions_map = {
        'shotlist': [
            {'key': 'location', 'question': 'Where will this be filmed?', 'type': 'text', 'placeholder': 'e.g., Studio, outdoor park, office'},
            {'key': 'duration', 'question': 'What is the target video length?', 'type': 'select', 'options': ['15 seconds', '30 seconds', '60 seconds', '2-3 minutes']},
            {'key': 'mood', 'question': 'What mood or tone should this convey?', 'type': 'text', 'placeholder': 'e.g., energetic, calm, professional'}
        ],
        'storyboard': [
            {'key': 'scenes', 'question': 'How many key scenes do you envision?', 'type': 'select', 'options': ['3-4', '5-6', '7-8', '9+']},
            {'key': 'style', 'question': 'What visual style are you going for?', 'type': 'text', 'placeholder': 'e.g., minimalist, vibrant, cinematic'},
            {'key': 'transitions', 'question': 'Any specific transition preferences?', 'type': 'text', 'placeholder': 'e.g., cuts, fades, wipes'}
        ],
        'script': [
            {'key': 'tone', 'question': 'What tone should the script have?', 'type': 'select', 'options': ['Professional', 'Casual', 'Humorous', 'Inspirational', 'Educational']},
            {'key': 'target_audience', 'question': 'Who is the target audience?', 'type': 'text', 'placeholder': 'e.g., young professionals, parents, tech enthusiasts'},
            {'key': 'key_message', 'question': 'What is the one key message to convey?', 'type': 'textarea', 'placeholder': 'The main takeaway for viewers'}
        ],
        'caption': [
            {'key': 'platform', 'question': 'Which platform is this for?', 'type': 'select', 'options': ['Instagram', 'TikTok', 'LinkedIn', 'Twitter/X', 'Facebook']},
            {'key': 'cta_type', 'question': 'What action do you want viewers to take?', 'type': 'select', 'options': ['Visit link', 'Comment', 'Share', 'Follow', 'Purchase']},
            {'key': 'hashtag_count', 'question': 'How many hashtags?', 'type': 'select', 'options': ['None', '3-5', '5-10', '10+']}
        ]
    }
    
    questions = questions_map.get(tool_type, [])
    
    return jsonify({"questions": questions})

@app.route('/api/ai/generate-planning', methods=['POST'])
@limiter.limit("20 per hour")
def ai_generate_planning():
    """Generate planning content with AI based on user instructions"""
    if not client:
        return jsonify({"error": "AI features are disabled"}), 503
    
    data = request.json
    tool_type = data.get('tool_type')
    user_instructions = data.get('user_instructions', '')
    content_title = data.get('content_title', '')
    content_type = data.get('content_type', '')
    description = data.get('description', '')
    brand = data.get('brand', '')
    industry = data.get('industry', '')
    mood_context = data.get('mood_board_context', '')
    
    # Build context-aware prompt
    selected_model = session.get('ai_model', list(AVAILABLE_MODELS.keys())[0] if AVAILABLE_MODELS else 'gemini-2.5-flash')
    model = genai.GenerativeModel(selected_model)
    
    prompts = {
        'shotlist': f"""Generate a detailed shot list for: {content_title} ({content_type})
Description: {description}
Brand: {brand} in {industry} industry
Visual inspiration: {mood_context}

User Instructions: {user_instructions}

Based on the user's instructions, determine the optimal number of shots needed and create them. For each shot, provide:
- type: (Wide, Medium, Close-up, Extreme Close-up, etc.)
- angle: (Eye level, Low angle, High angle, Dutch angle, etc.)
- description: Detailed description of what's in the shot
- duration: Estimated duration (e.g., "3s", "5-7s")

Return ONLY a JSON object: {{"shots": [{{"type": "...", "angle": "...", "description": "...", "duration": "..."}}]}}""",

        'storyboard': f"""Create a storyboard for: {content_title} ({content_type})
Description: {description}
Brand: {brand} in {industry} industry
Visual inspiration: {mood_context}

User Instructions: {user_instructions}

Based on the user's instructions, determine the optimal number of frames needed and create them. For each frame, provide:
- frame_number: Sequential number
- description: Visual description of the frame
- notes: Camera movement, transitions, or special notes

Return ONLY a JSON object: {{"frames": [{{"frame_number": 1, "description": "...", "notes": "..."}}]}}""",

        'script': f"""Write a script for: {content_title} ({content_type})
Description: {description}
Brand: {brand} in {industry} industry

User Instructions: {user_instructions}

Write a complete, production-ready script based on the user's instructions.

Return ONLY a JSON object: {{"script": "full script text here"}}""",

        'caption': f"""Write a caption for: {content_title} ({content_type})
Description: {description}
Brand: {brand} in {industry} industry

User Instructions: {user_instructions}

Write an engaging social media caption with relevant hashtags based on the user's instructions.

Return ONLY a JSON object: {{"caption": "caption text with hashtags"}}"""
    }
    
    prompt = prompts.get(tool_type, '')
    
    try:
        response = model.generate_content(prompt)
        
        if not response.text:
            return jsonify({"error": "Response blocked by safety filters"}), 400
        
        # Parse JSON from response
        import re
        json_match = re.search(r'\{[\s\S]*\}', response.text)
        if json_match:
            content = json.loads(json_match.group())
            return jsonify({"content": content})
        else:
            return jsonify({"error": "Could not parse AI response"}), 500
        
    except Exception as e:
        print(f"AI generation error: {e}")
        return jsonify({"error": f"Generation failed: {str(e)}"}), 500

@app.route('/api/ai/improve-prompt', methods=['POST'])
@limiter.limit("30 per hour")
def ai_improve_prompt():
    """Improve image generation prompt with AI"""
    if not client:
        return jsonify({"error": "AI features are disabled"}), 503
    
    data = request.json
    original_prompt = data.get('prompt', '')
    brand = data.get('brand', {})
    mood_context = data.get('mood_context', '')
    
    selected_model = session.get('ai_model', list(AVAILABLE_MODELS.keys())[0] if AVAILABLE_MODELS else 'gemini-2.5-flash')
    model = genai.GenerativeModel(selected_model)
    
    prompt = f"""Improve this image generation prompt to be more detailed and effective:

Original prompt: "{original_prompt}"

Brand context: {brand.get('name', '')} in {brand.get('industry', '')} industry
Visual inspiration: {mood_context}

Enhance the prompt with specific details about composition, lighting, style, and mood. Keep it concise but descriptive. Return only the improved prompt, no explanation."""
    
    try:
        response = model.generate_content(prompt)
        
        if not response.text:
            return jsonify({"error": "Response blocked by safety filters"}), 400
        
        return jsonify({"improved_prompt": response.text.strip()})
        
    except Exception as e:
        print(f"Prompt improvement error: {e}")
        return jsonify({"error": f"Improvement failed: {str(e)}"}), 500

@app.route('/api/upload-temp', methods=['POST'])
def upload_temp():
    """Temporary file upload endpoint"""
    # Placeholder for file upload
    return jsonify({"url": "/static/placeholder-image.jpg"})

# ============================================================
# STROKE PERSISTENCE API
# ============================================================

import json as _json
import time as _time
_STROKES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'strokes')
os.makedirs(_STROKES_DIR, exist_ok=True)

# SSE subscribers for real-time stroke sync
_sse_subscribers = []  # list of queue.Queue
_sse_lock = threading.Lock()

def _notify_sse_subscribers(ws_id, stroke_count):
    """Push a notification to all SSE listeners."""
    msg = _json.dumps({'workspace_id': ws_id, 'stroke_count': stroke_count, 't': _time.time()})
    with _sse_lock:
        dead = []
        for q in _sse_subscribers:
            try:
                q.put_nowait(msg)
            except Exception:
                dead.append(q)
        for q in dead:
            _sse_subscribers.remove(q)

@app.route('/api/mood-board/strokes/stream')
def stroke_stream():
    """SSE endpoint — clients connect here to get instant push when strokes change."""
    def generate():
        q = queue.Queue(maxsize=50)
        with _sse_lock:
            _sse_subscribers.append(q)
        try:
            yield 'data: {"connected":true}\n\n'
            while True:
                try:
                    msg = q.get(timeout=30)
                    yield f'data: {msg}\n\n'
                except queue.Empty:
                    yield ': keepalive\n\n'
        except GeneratorExit:
            pass
        finally:
            with _sse_lock:
                if q in _sse_subscribers:
                    _sse_subscribers.remove(q)
    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', 'Connection': 'keep-alive'})

@app.route('/api/mood-board/strokes', methods=['GET'])
def get_strokes():
    """Load persisted strokes for a workspace"""
    ws_id = request.args.get('workspace_id', 'default')
    safe_id = ws_id.replace('/', '_').replace('\\', '_') or 'default'
    filepath = os.path.join(_STROKES_DIR, f'{safe_id}.json')
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r') as f:
                return jsonify(_json.load(f))
        except Exception:
            pass
    return jsonify({'layers': [], 'layerCounter': 1, 'activeLayerId': 'layer0'})

@app.route('/api/mood-board/strokes', methods=['POST'])
def save_strokes():
    """Persist strokes for a workspace"""
    data = request.get_json(force=True)
    ws_id = data.get('workspace_id', 'default')
    safe_id = ws_id.replace('/', '_').replace('\\', '_') or 'default'
    filepath = os.path.join(_STROKES_DIR, f'{safe_id}.json')
    payload = {
        'layers': data.get('layers', []),
        'layerCounter': data.get('layerCounter', 1),
        'activeLayerId': data.get('activeLayerId', 'layer0')
    }
    try:
        with open(filepath, 'w') as f:
            _json.dump(payload, f)
        # Keep in-memory state in sync so new WS clients get latest
        _draw_state['layers'] = payload['layers']
        _draw_state['layerCounter'] = payload.get('layerCounter', 1)
        _draw_state['activeLayerId'] = payload.get('activeLayerId', 'layer0')
        # Notify all SSE listeners instantly
        sc = sum(len(l.get('strokes', [])) for l in payload['layers'])
        _notify_sse_subscribers(safe_id, sc)
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ============================================================
# REAL-TIME DRAW SYNC (Socket.IO)
# ============================================================

socketio = SocketIO(app, cors_allowed_origins='*', path='/ws/draw', async_mode='threading')

# In-memory store for current draw state (persists across reconnections within server lifetime)
# Bootstrap from persisted file so new devices get real strokes on connect
def _load_draw_state():
    default_path = os.path.join(_STROKES_DIR, 'default.json')
    if os.path.exists(default_path):
        try:
            with open(default_path, 'r') as f:
                data = _json.load(f)
                if data.get('layers') and any(len(l.get('strokes', [])) > 0 for l in data['layers']):
                    return data
        except Exception:
            pass
    return {
        'layers': [{'id': 'layer0', 'name': 'Layer 1', 'visible': True, 'strokes': []}],
        'layerCounter': 1,
        'activeLayerId': 'layer0'
    }

_draw_state = _load_draw_state()

@socketio.on('draw:request_state')
def handle_request_state():
    """Send current draw state to newly connected client"""
    emit('draw:state', _draw_state)

@socketio.on('draw:stroke_add')
def handle_stroke_add(data):
    """A client added a stroke — broadcast to others and persist"""
    if not data or 'layerId' not in data or 'stroke' not in data:
        return
    # Persist in server memory
    for layer in _draw_state['layers']:
        if layer['id'] == data['layerId']:
            layer['strokes'].append(data['stroke'])
            break
    # Broadcast to all OTHER clients
    emit('draw:stroke_add', data, broadcast=True, include_self=False)

@socketio.on('draw:layer_update')
def handle_layer_update(data):
    """A client updated layers — broadcast and persist"""
    if not data or 'layers' not in data:
        return
    _draw_state['layers'] = data['layers']
    _draw_state['layerCounter'] = data.get('layerCounter', len(data['layers']))
    _draw_state['activeLayerId'] = data.get('activeLayerId', data['layers'][0]['id'] if data['layers'] else 'layer0')
    emit('draw:layer_update', data, broadcast=True, include_self=False)

@socketio.on('draw:stroke_progress')
def handle_stroke_progress(data):
    """Live stroke streaming — broadcast partial stroke to others for smooth rendering"""
    if not data:
        return
    emit('draw:stroke_progress', data, broadcast=True, include_self=False)

@socketio.on('draw:image_move')
def handle_image_move(data):
    """A client moved/resized an image — broadcast to others"""
    if not data or 'imageId' not in data:
        return
    emit('draw:image_move', data, broadcast=True, include_self=False)

@socketio.on('draw:clear')
def handle_draw_clear():
    """A client cleared all strokes — broadcast and persist"""
    for layer in _draw_state['layers']:
        layer['strokes'] = []
    emit('draw:clear', broadcast=True, include_self=False)

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)
