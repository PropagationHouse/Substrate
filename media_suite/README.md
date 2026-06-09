# Media Planning Suite

A premium glassmorphic media planning and production management application designed for businesses and agencies to streamline their content creation workflow from concept to completion.

## Features

### 🎯 Business Profile Management
- Create detailed business profiles with industry, target audience, and offerings
- Brand identity management (colors, fonts, logos)
- Multi-business support for agencies

### 📅 Media Planning & Scheduling
- Comprehensive media plan creation with budgets and timelines
- Interactive media calendar with drag-and-drop scheduling
- Content type and channel management
- Status tracking and progress monitoring

### 📸 Shot Lists & Storyboarding
- Professional shot list templates with equipment requirements
- Visual storyboarding with scene management
- Reference image uploads
- Exportable PDFs for production teams

### 🔍 Automated Research System
- Industry trend research and competitor analysis
- Web scraping for content inspiration
- Research data storage and retrieval
- AI-powered insights integration

### 🎨 Brand Asset Management
- Centralized brand asset storage
- Logo, color palette, and font management
- Template library for consistent branding
- Asset organization by business profile

### 📊 Analytics & Dashboard
- Real-time project statistics
- Activity tracking and progress monitoring
- Budget tracking and resource allocation
- Performance metrics and insights

## Technology Stack

- **Backend**: Node.js with Express
- **Database**: SQLite with full-text search
- **Frontend**: Vanilla JavaScript with Glassmorphic UI
- **Styling**: TailwindCSS with custom glassmorphic components
- **File Processing**: Sharp for image optimization
- **Web Scraping**: Puppeteer for automated research
- **File Uploads**: Multer with secure handling

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Modern web browser

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd media-planning-app
```

2. Install dependencies:
```bash
npm install
```

3. Create required directories:
```bash
mkdir -p public/uploads
mkdir -p data
```

4. Build CSS:
```bash
npm run build:css
```

5. Start the application:
```bash
npm start
```

For development:
```bash
npm run dev
```

### Environment Variables

Create a `.env` file:
```env
PORT=3000
NODE_ENV=development
UPLOAD_DIR=./public/uploads
DB_PATH=./media_planning.db
```

## Usage

### Setting Up Your First Business Profile

1. Navigate to the **Business Profile** section
2. Fill in your business information including:
   - Business name and industry
   - Target audience description
   - Products/services offered
   - Brand colors and fonts
   - Upload your logo

### Creating a Media Plan

1. Go to **Media Plans** section
2. Click "Create New Media Plan"
3. Select your business profile
4. Set timeline and budget
5. Add description and objectives

### Building Shot Lists

1. Open a media plan
2. Navigate to the **Shot Lists** tab
3. Add individual shots with:
   - Shot type (wide, medium, close-up, etc.)
   - Location and time requirements
   - Equipment needed
   - Reference images
   - Detailed descriptions

### Creating Storyboards

1. From your media plan, access the **Storyboard** tab
2. Add scenes with:
   - Visual descriptions and camera notes
   - Audio notes and dialogue
   - Scene duration
   - Upload reference images
3. Use preview mode to review flow

### Research & Insights

1. Go to **Research** section
2. Enter topics related to your industry
3. Review automated research results
4. Save relevant findings for future reference

## API Documentation

### Business Profiles
- `GET /api/business-profiles` - List all profiles
- `POST /api/business-profiles` - Create new profile
- `PUT /api/business-profiles/:id` - Update profile
- `DELETE /api/business-profiles/:id` - Delete profile

### Media Plans
- `GET /api/media-plans` - List all plans
- `POST /api/media-plans` - Create new plan
- `GET /api/media-plans/:id` - Get plan details
- `PUT /api/media-plans/:id` - Update plan

### Shot Lists
- `GET /api/shot-lists?plan_id=:id` - Get plan shot lists
- `POST /api/shot-lists` - Add new shot
- `PATCH /api/shot-lists/:id` - Update shot status
- `DELETE /api/shot-lists/:id` - Delete shot

### Storyboards
- `GET /api/storyboards?plan_id=:id` - Get storyboard scenes
- `POST /api/storyboards` - Add new scene
- `PUT /api/storyboards/:id` - Update scene
- `DELETE /api/storyboards/:id` - Delete scene

### Research
- `POST /api/research/search` - Perform web research
- `GET /api/research/saved` - Get saved research
- `DELETE /api/research/:id` - Delete research item

### Brand Assets
- `GET /api/brand-assets?business_id=:id` - Get brand assets
- `POST /api/brand-assets` - Upload new asset
- `DELETE /api/brand-assets/:id` - Delete asset

## Database Schema

The application uses SQLite with the following main tables:

- `business_profiles` - Business information and brand settings
- `media_plans` - Media campaign plans and metadata
- `media_calendar` - Scheduled content and releases
- `shot_lists` - Production shot details and requirements
- `storyboards` - Visual storyboard scenes
- `research_data` - Automated research findings
- `brand_assets` - Brand files and assets

## File Structure

```
media-planning-app/
├── public/
│   ├── css/
│   │   └── styles.css          # Compiled TailwindCSS
│   ├── js/
│   │   └── app.js              # Main frontend application
│   ├── templates/
│   │   ├── shot-list.html      # Shot list template
│   │   └── storyboard.html     # Storyboard template
│   ├── uploads/                # User uploaded files
│   └── index.html              # Main application
├── src/
│   └── input.css              # TailwindCSS source
├── data/                      # Database files
├── server.js                  # Express server
├── package.json              # Dependencies
├── tailwind.config.js        # Tailwind configuration
└── README.md                 # This file
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For support and questions:
- Create an issue in the repository
- Check the documentation
- Review the API endpoints

## Roadmap

### Upcoming Features
- [ ] Team collaboration and user permissions
- [ ] Advanced AI-powered content suggestions
- [ ] Social media integration and auto-posting
- [ ] Advanced analytics and reporting
- [ ] Mobile app development
- [ ] Video editing integration
- [ ] Client portal for project approval
- [ ] Resource management and scheduling
- [ ] Budget tracking and invoicing
- [ ] Template marketplace

### Performance Improvements
- [ ] Database optimization
- [ ] Image CDN integration
- [ ] Caching implementation
- [ ] Real-time updates with WebSockets

## Security Features

- Secure file upload handling
- SQL injection prevention
- XSS protection
- CSRF protection
- Input validation and sanitization
- Rate limiting on API endpoints

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

---

Built with ❤️ for creative professionals and marketing teams.
