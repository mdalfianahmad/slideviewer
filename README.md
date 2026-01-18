# SlideViewer

Real-time presentation sharing app. Present your slides from any device and your audience follows along in sync.

![SlideViewer](https://via.placeholder.com/800x400?text=SlideViewer)

## Features

- 📄 **Upload PDF Slides** - Convert your PDF presentations to shareable slides
- 🔗 **Invite Code** - Share a 6-digit code with your audience
- 📱 **QR Code** - Audience can scan to join instantly
- ⚡ **Real-time Sync** - Slides update on all devices as you navigate
- 👥 **Live Viewer Count** - See how many people are watching
- 🔐 **Google Auth** - Presenter-only authentication (audience doesn't need to log in)
- 📱 **PWA Support** - Works offline and can be installed as an app

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Backend**: Supabase (Database, Auth, Realtime, Storage)
- **PDF Processing**: pdf.js
- **QR Codes**: qrcode library
- **Styling**: CSS Modules

## Prerequisites

- Node.js 18+ 
- npm or yarn
- Supabase account

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/slideviewer.git
cd slideviewer
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Settings > API** and copy your Project URL and anon public key
3. Run the SQL migrations in the Supabase SQL Editor (see `supabase/migrations/`)

### 4. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your values:
```
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_BASE_URL=https://your-domain.com
```

### 5. Set up Google OAuth

1. In Supabase Dashboard: **Authentication > Providers > Google**
2. Enable Google provider
3. Add your Google OAuth credentials from [Google Cloud Console](https://console.cloud.google.com/)
4. In **Authentication > URL Configuration**:
   - Set **Site URL** to your production domain
   - Add **Redirect URLs**: `https://your-domain.com`

### 6. Run locally

```bash
npm run dev
```

## Deployment

### Deploy to Vercel (Recommended)

1. Push your code to GitHub
2. Connect your repo to [Vercel](https://vercel.com)
3. Add environment variables in Vercel:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_BASE_URL` (your Vercel domain)
4. Deploy!

### Deploy to Netlify

1. Push your code to GitHub
2. Connect to [Netlify](https://netlify.com)
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Add environment variables

### After Deployment

**Update Supabase redirect URLs:**
1. Go to Supabase Dashboard > Authentication > URL Configuration
2. Set **Site URL** to your production domain
3. Add your production domain to **Redirect URLs**

## Database Setup

Run these SQL commands in your Supabase SQL Editor:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create presentations table
CREATE TABLE presentations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  title TEXT NOT NULL DEFAULT 'Untitled Presentation',
  file_url TEXT NOT NULL,
  slide_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  invite_code TEXT NOT NULL UNIQUE,
  presenter_token UUID NOT NULL DEFAULT uuid_generate_v4(),
  current_slide_index INTEGER NOT NULL DEFAULT 1,
  is_live BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_presented_at TIMESTAMPTZ
);

-- Create slides table
CREATE TABLE slides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  presentation_id UUID NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  slide_number INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(presentation_id, slide_number)
);

-- Create indexes
CREATE INDEX idx_presentations_invite_code ON presentations(UPPER(invite_code));
CREATE INDEX idx_slides_presentation ON slides(presentation_id);

-- Enable RLS
ALTER TABLE presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE slides ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can read presentations" ON presentations FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert" ON presentations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Users can update own presentations" ON presentations FOR UPDATE USING (auth.uid()::text = user_id::text);
CREATE POLICY "Users can delete own presentations" ON presentations FOR DELETE USING (auth.uid()::text = user_id::text);

CREATE POLICY "Anyone can read slides" ON slides FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert slides" ON slides FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
```

## Storage Setup

1. In Supabase Dashboard: **Storage > Create a new bucket**
2. Create a bucket named `slides`
3. Set to **Public bucket**
4. Add a policy to allow authenticated uploads

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run test` | Run tests in watch mode |
| `npm run test:run` | Run tests once |
| `npm run lint` | Run ESLint |

## Project Structure

```
slideviewer/
├── public/              # Static assets
├── src/
│   ├── components/      # Reusable UI components
│   │   ├── layout/      # Layout components (Container, Navbar)
│   │   └── ui/          # UI components (Button, Input, etc.)
│   ├── context/         # React Context (Auth)
│   ├── hooks/           # Custom hooks
│   ├── lib/             # Utilities (supabase, pdf, invite-code)
│   ├── pages/           # Page components
│   ├── styles/          # Global CSS
│   ├── test/            # Test setup
│   └── types/           # TypeScript types
├── supabase/
│   └── migrations/      # Database migrations
└── package.json
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_SUPABASE_URL` | Supabase project URL | Yes |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key | Yes |
| `VITE_BASE_URL` | Your app's base URL (for QR codes) | Yes for production |

## License

MIT
