const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// File upload configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image and document files are allowed'));
    }
  }
});

// Database setup
const db = new sqlite3.Database('./media_planning.db');

// Initialize database tables
db.serialize(() => {
  // Business profiles
  db.run(`CREATE TABLE IF NOT EXISTS business_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    industry TEXT,
    description TEXT,
    website TEXT,
    target_audience TEXT,
    offerings TEXT,
    brand_colors TEXT,
    brand_fonts TEXT,
    logo_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Media plans
  db.run(`CREATE TABLE IF NOT EXISTS media_plans (
    id TEXT PRIMARY KEY,
    business_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    start_date DATE,
    end_date DATE,
    status TEXT DEFAULT 'draft',
    total_budget REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES business_profiles (id)
  )`);

  // Media calendar
  db.run(`CREATE TABLE IF NOT EXISTS media_calendar (
    id TEXT PRIMARY KEY,
    plan_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    content_type TEXT,
    channel TEXT,
    scheduled_date DATETIME,
    status TEXT DEFAULT 'scheduled',
    assets TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES media_plans (id)
  )`);

  // Shot lists
  db.run(`CREATE TABLE IF NOT EXISTS shot_lists (
    id TEXT PRIMARY KEY,
    plan_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    shot_type TEXT,
    location TEXT,
    time_needed TEXT,
    equipment TEXT,
    notes TEXT,
    images TEXT,
    completed BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES media_plans (id)
  )`);

  // Storyboards
  db.run(`CREATE TABLE IF NOT EXISTS storyboards (
    id TEXT PRIMARY KEY,
    plan_id TEXT,
    scene_number INTEGER,
    title TEXT,
    description TEXT,
    visual_notes TEXT,
    audio_notes TEXT,
    duration TEXT,
    image_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (plan_id) REFERENCES media_plans (id)
  )`);

  // Research data
  db.run(`CREATE TABLE IF NOT EXISTS research_data (
    id TEXT PRIMARY KEY,
    business_id TEXT,
    topic TEXT,
    content TEXT,
    source TEXT,
    collected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES business_profiles (id)
  )`);

  // Brand assets
  db.run(`CREATE TABLE IF NOT EXISTS brand_assets (
    id TEXT PRIMARY KEY,
    business_id TEXT,
    asset_type TEXT,
    name TEXT,
    file_path TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (business_id) REFERENCES business_profiles (id)
  )`);
});

// API Routes

// Business Profile Routes
app.get('/api/business-profiles', (req, res) => {
  db.all("SELECT * FROM business_profiles ORDER BY created_at DESC", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/business-profiles', (req, res) => {
  const { name, industry, description, website, target_audience, offerings, brand_colors, brand_fonts } = req.body;
  const id = uuidv4();
  
  db.run(
    `INSERT INTO business_profiles (id, name, industry, description, website, target_audience, offerings, brand_colors, brand_fonts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, industry, description, website, target_audience, offerings, brand_colors, brand_fonts],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id, ...req.body });
    }
  );
});

// Media Plan Routes
app.get('/api/media-plans', (req, res) => {
  const businessId = req.query.business_id;
  let query = "SELECT * FROM media_plans";
  let params = [];
  
  if (businessId) {
    query += " WHERE business_id = ?";
    params.push(businessId);
  }
  
  query += " ORDER BY created_at DESC";
  
  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/media-plans', (req, res) => {
  const { business_id, title, description, start_date, end_date, total_budget } = req.body;
  const id = uuidv4();
  
  db.run(
    `INSERT INTO media_plans (id, business_id, title, description, start_date, end_date, total_budget)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, business_id, title, description, start_date, end_date, total_budget],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id, ...req.body });
    }
  );
});

// Media Calendar Routes
app.get('/api/media-calendar', (req, res) => {
  const planId = req.query.plan_id;
  const month = req.query.month;
  
  let query = "SELECT * FROM media_calendar WHERE plan_id = ?";
  let params = [planId];
  
  if (month) {
    query += " AND strftime('%Y-%m', scheduled_date) = ?";
    params.push(month);
  }
  
  query += " ORDER BY scheduled_date ASC";
  
  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/media-calendar', (req, res) => {
  const { plan_id, title, description, content_type, channel, scheduled_date, assets } = req.body;
  const id = uuidv4();
  
  db.run(
    `INSERT INTO media_calendar (id, plan_id, title, description, content_type, channel, scheduled_date, assets)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, plan_id, title, description, content_type, channel, scheduled_date, JSON.stringify(assets || [])],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id, ...req.body });
    }
  );
});

// Shot List Routes
app.get('/api/shot-lists', (req, res) => {
  const planId = req.query.plan_id;
  
  db.all(
    "SELECT * FROM shot_lists WHERE plan_id = ? ORDER BY created_at ASC",
    [planId],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

app.post('/api/shot-lists', (req, res) => {
  const { plan_id, title, description, shot_type, location, time_needed, equipment, notes } = req.body;
  const id = uuidv4();
  
  db.run(
    `INSERT INTO shot_lists (id, plan_id, title, description, shot_type, location, time_needed, equipment, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, plan_id, title, description, shot_type, location, time_needed, equipment, notes],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id, ...req.body });
    }
  );
});

// Storyboard Routes
app.get('/api/storyboards', (req, res) => {
  const planId = req.query.plan_id;
  
  db.all(
    "SELECT * FROM storyboards WHERE plan_id = ? ORDER BY scene_number ASC",
    [planId],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

app.post('/api/storyboards', (req, res) => {
  const { plan_id, scene_number, title, description, visual_notes, audio_notes, duration } = req.body;
  const id = uuidv4();
  
  db.run(
    `INSERT INTO storyboards (id, plan_id, scene_number, title, description, visual_notes, audio_notes, duration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, plan_id, scene_number, title, description, visual_notes, audio_notes, duration],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id, ...req.body });
    }
  );
});

// Research Routes
app.post('/api/research/search', async (req, res) => {
  const { query, business_id } = req.body;
  
  try {
    // Web scraping logic here
    const results = await performWebSearch(query);
    
    // Store results in database
    const id = uuidv4();
    db.run(
      "INSERT INTO research_data (id, business_id, topic, content, source) VALUES (?, ?, ?, ?, ?)",
      [id, business_id, query, JSON.stringify(results), 'web_search'],
      (err) => {
        if (err) {
          console.error('Error storing research data:', err);
        }
      }
    );
    
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Brand Assets Routes
app.post('/api/brand-assets', upload.single('asset'), (req, res) => {
  const { business_id, asset_type, name, metadata } = req.body;
  const file_path = req.file ? `/uploads/${req.file.filename}` : null;
  const id = uuidv4();
  
  db.run(
    "INSERT INTO brand_assets (id, business_id, asset_type, name, file_path, metadata) VALUES (?, ?, ?, ?, ?, ?)",
    [id, business_id, asset_type, name, file_path, metadata],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id, business_id, asset_type, name, file_path, metadata });
    }
  );
});

app.get('/api/brand-assets', (req, res) => {
  const businessId = req.query.business_id;
  
  db.all(
    "SELECT * FROM brand_assets WHERE business_id = ? ORDER BY created_at DESC",
    [businessId],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// Helper function for web search
async function performWebSearch(query) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  try {
    // Use a search engine (you might want to use a proper API)
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
    
    const results = await page.evaluate(() => {
      const searchResults = [];
      const elements = document.querySelectorAll('div.g');
      
      elements.forEach(element => {
        const title = element.querySelector('h3')?.textContent;
        const link = element.querySelector('a')?.href;
        const snippet = element.querySelector('.VwiC3b')?.textContent;
        
        if (title && link) {
          searchResults.push({ title, link, snippet });
        }
      });
      
      return searchResults.slice(0, 10); // Top 10 results
    });
    
    await browser.close();
    return results;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

// Template routes
app.get('/templates/shot-list', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'templates', 'shot-list.html'));
});

app.get('/templates/storyboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'templates', 'storyboard.html'));
});

app.get('/templates/export', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'templates', 'export.html'));
});

// Serve main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Media Planning App running on port ${PORT}`);
});
