import json
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timezone

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    
    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

class Workspace(db.Model):
    __tablename__ = 'workspaces'
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(200), nullable=False)
    color = db.Column(db.String(7), default='#4ade80')  # hex color
    icon = db.Column(db.String(10), default='📋')
    is_main = db.Column(db.Boolean, default=False)
    brand_profile_id = db.Column(db.String(36), db.ForeignKey('brand_profiles.id'), nullable=True)
    settings_json = db.Column(db.Text, default='{}')  # workspace-specific settings
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    def get_settings(self):
        try:
            return json.loads(self.settings_json) if self.settings_json else {}
        except:
            return {}

    def set_settings(self, value):
        self.settings_json = json.dumps(value) if isinstance(value, dict) else value

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'color': self.color,
            'icon': self.icon,
            'is_main': self.is_main,
            'brand_profile_id': self.brand_profile_id,
            'settings': self.get_settings(),
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class BrandProfile(db.Model):
    __tablename__ = 'brand_profiles'
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(200), nullable=False)
    industry = db.Column(db.String(100))
    description = db.Column(db.Text)
    target_audience = db.Column(db.Text)
    brand_colors = db.Column(db.String(500))
    brand_fonts = db.Column(db.String(500))
    logo_url = db.Column(db.String(500))
    interests = db.Column(db.Text)  # Comma-separated interests for news
    keywords = db.Column(db.Text)  # Keywords for news filtering
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    media_plans = db.relationship('MediaPlan', backref='brand_profile', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'industry': self.industry,
            'description': self.description,
            'target_audience': self.target_audience,
            'brand_colors': self.brand_colors,
            'brand_fonts': self.brand_fonts,
            'logo_url': self.logo_url,
            'interests': self.interests,
            'keywords': self.keywords,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

class MediaPlan(db.Model):
    __tablename__ = 'media_plans'
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    brand_profile_id = db.Column(db.String(36), db.ForeignKey('brand_profiles.id'), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    status = db.Column(db.String(50), default='planning')  # planning, active, completed, archived
    start_date = db.Column(db.DateTime)
    end_date = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    media_items = db.relationship('MediaItem', backref='media_plan', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'brand_profile_id': self.brand_profile_id,
            'title': self.title,
            'description': self.description,
            'status': self.status,
            'start_date': self.start_date.isoformat() if self.start_date else None,
            'end_date': self.end_date.isoformat() if self.end_date else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'item_count': len(self.media_items)
        }

class MediaItem(db.Model):
    __tablename__ = 'media_items'
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    media_plan_id = db.Column(db.String(36), db.ForeignKey('media_plans.id'), nullable=False)
    workspace_id = db.Column(db.String(36), db.ForeignKey('workspaces.id'), nullable=True)
    title = db.Column(db.String(200), nullable=False)
    content_type = db.Column(db.String(50))  # post, reel, story, carousel, video, blog
    status = db.Column(db.String(50), default='idea')  # idea, research, scripting, shooting, editing, scheduled, posted
    description = db.Column(db.Text)
    channel = db.Column(db.String(100))  # instagram, tiktok, youtube, linkedin, etc
    scheduled_date = db.Column(db.DateTime)
    posted_date = db.Column(db.DateTime)
    shot_list = db.Column(db.Text)  # JSON array of shots
    storyboard = db.Column(db.Text)  # JSON array of scenes
    caption = db.Column(db.Text)
    tags = db.Column(db.String(500))
    source_article_id = db.Column(db.String(36), db.ForeignKey('articles.id'))
    position = db.Column(db.Integer, default=0)  # For kanban ordering
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    def to_dict(self):
        # Build planning_data from stored columns
        planning_data = {}
        if self.shot_list:
            try:
                planning_data['shotlist'] = json.loads(self.shot_list) if isinstance(self.shot_list, str) else self.shot_list
            except:
                planning_data['shotlist'] = {}
        if self.storyboard:
            try:
                planning_data['storyboard'] = json.loads(self.storyboard) if isinstance(self.storyboard, str) else self.storyboard
            except:
                planning_data['storyboard'] = {}
        if self.caption:
            planning_data['caption'] = {'content': self.caption}
        
        return {
            'id': self.id,
            'media_plan_id': self.media_plan_id,
            'workspace_id': self.workspace_id,
            'title': self.title,
            'content_type': self.content_type,
            'status': self.status,
            'description': self.description,
            'channel': self.channel,
            'scheduled_date': self.scheduled_date.isoformat() if self.scheduled_date else None,
            'posted_date': self.posted_date.isoformat() if self.posted_date else None,
            'shot_list': self.shot_list,
            'storyboard': self.storyboard,
            'caption': self.caption,
            'tags': self.tags,
            'source_article_id': self.source_article_id,
            'position': self.position,
            'planning_data': planning_data,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

class NewsSource(db.Model):
    __tablename__ = 'news_sources'
    id = db.Column(db.Integer, primary_key=True)
    url = db.Column(db.String(1000), nullable=False, unique=True)
    name = db.Column(db.String(200), nullable=False)
    feed_type = db.Column(db.String(50), default='rss')  # rss, atom, json
    keywords = db.Column(db.String(500))
    is_active = db.Column(db.Boolean, default=True)
    last_fetched = db.Column(db.DateTime)
    articles_count = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    
    def to_dict(self):
        return {
            'id': self.id,
            'url': self.url,
            'name': self.name,
            'feed_type': self.feed_type,
            'keywords': self.keywords,
            'is_active': self.is_active,
            'last_fetched': self.last_fetched.isoformat() if self.last_fetched else None,
            'articles_count': self.articles_count
        }

class Article(db.Model):
    __tablename__ = 'articles'
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id = db.Column(db.String(36), db.ForeignKey('workspaces.id'), nullable=True)
    title = db.Column(db.String(500), nullable=False)
    url = db.Column(db.String(1000), nullable=False, unique=True)
    source = db.Column(db.String(200))
    content = db.Column(db.Text)
    summary = db.Column(db.Text)
    published_at = db.Column(db.DateTime)
    image_url = db.Column(db.String(1000))
    brand_profile_id = db.Column(db.String(36), db.ForeignKey('brand_profiles.id'))
    is_pinned = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    
    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'url': self.url,
            'source': self.source,
            'content': self.content,
            'summary': self.summary,
            'published_at': self.published_at.isoformat() if self.published_at else None,
            'image_url': self.image_url,
            'brand_profile_id': self.brand_profile_id,
            'is_pinned': self.is_pinned,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

class ResearchCache(db.Model):
    __tablename__ = 'research_cache'
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    query = db.Column(db.String(500), nullable=False)
    results = db.Column(db.Text)  # JSON
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    
    def to_dict(self):
        return {
            'id': self.id,
            'query': self.query,
            'results': self.results,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

class MediaAsset(db.Model):
    __tablename__ = 'media_assets'
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    brand_profile_id = db.Column(db.String(36), db.ForeignKey('brand_profiles.id'), nullable=False)
    workspace_id = db.Column(db.String(36), db.ForeignKey('workspaces.id'), nullable=True)
    asset_type = db.Column(db.String(50))  # logo, image, video, template, mood_board
    name = db.Column(db.String(200), nullable=False, default='Untitled')
    file_url = db.Column(db.Text)  # Can store base64 data URLs
    file_name = db.Column(db.String(500))
    file_size = db.Column(db.Integer)
    mime_type = db.Column(db.String(100))
    description = db.Column(db.Text)
    tags = db.Column(db.String(500))
    asset_metadata = db.Column(db.Text)  # JSON string
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    uploaded_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    
    def get_meta(self):
        if self.asset_metadata:
            try:
                return json.loads(self.asset_metadata) if isinstance(self.asset_metadata, str) else self.asset_metadata
            except:
                return {}
        return {}
    
    def set_meta(self, value):
        if isinstance(value, dict):
            self.asset_metadata = json.dumps(value)
        else:
            self.asset_metadata = value
    
    def to_dict(self):
        meta = self.get_meta()
        return {
            'id': self.id,
            'brand_profile_id': self.brand_profile_id,
            'asset_type': self.asset_type,
            'name': self.name,
            'file_url': self.file_url,
            'url': self.file_url,
            'file_name': self.file_name,
            'description': self.description or '',
            'tags': self.tags or '',
            'metadata': meta,
            'x': meta.get('x') if meta else None,
            'y': meta.get('y') if meta else None,
            'rotation': meta.get('rotation', 0) if meta else 0,
            'scale': meta.get('scale', 1) if meta else 1,
            'opacity': meta.get('opacity', 1) if meta else 1,
            'zIndex': meta.get('zIndex', 1) if meta else 1,
            'uploaded_at': self.uploaded_at.isoformat() if self.uploaded_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

import uuid
