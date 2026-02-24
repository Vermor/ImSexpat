require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const path = require('path');
const fs = require('fs');
const {
  DEFAULT_LANDING_CONTENT,
  initStorage,
  getLandingContent,
  updateLandingContent,
  listArticles,
  getArticleById,
  getArticleBySlug,
  createArticle,
  updateArticle,
  deleteArticle,
  slugify
} = require('./storage');

const app = express();
const port = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
const primaryDomain = process.env.PRIMARY_DOMAIN || 'imsexpat.site';

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if ((file.mimetype || '').startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Only image files are allowed'));
  }
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET || 'local-dev-secret'));

app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  const targetHost = primaryDomain.toLowerCase();

  if (isProd && host.endsWith('up.railway.app') && targetHost) {
    return res.redirect(301, `https://${targetHost}${req.originalUrl}`);
  }

  return next();
});

app.use(express.static(path.join(__dirname, 'public')));

const requireAdminPasswordConfig = (req, res, next) => {
  if (!process.env.ADMIN_PASSWORD) {
    return res
      .status(500)
      .send('ADMIN_PASSWORD is missing. Set it in environment variables.');
  }
  return next();
};

const isAuthenticated = (req) => req.signedCookies.admin_auth === 'ok';

const protectAdmin = [requireAdminPasswordConfig, (req, res, next) => {
  if (isAuthenticated(req)) return next();
  return res.redirect('/admin/login');
}];

const sanitizeText = (value, maxLength) => {
  const text = String(value ?? '').trim();
  return text.slice(0, maxLength);
};

const normalizeLandingPayload = (payload) => ({
  siteName: sanitizeText(payload.siteName, 100) || DEFAULT_LANDING_CONTENT.siteName,
  pageTitle: sanitizeText(payload.pageTitle, 180) || DEFAULT_LANDING_CONTENT.pageTitle,
  metaDescription: sanitizeText(payload.metaDescription, 300) || DEFAULT_LANDING_CONTENT.metaDescription,
  heroTitle: sanitizeText(payload.heroTitle, 180) || DEFAULT_LANDING_CONTENT.heroTitle,
  heroSubtitle: sanitizeText(payload.heroSubtitle, 500) || DEFAULT_LANDING_CONTENT.heroSubtitle,
  ctaText: sanitizeText(payload.ctaText, 60) || DEFAULT_LANDING_CONTENT.ctaText,
  ctaHref: sanitizeText(payload.ctaHref, 200) || DEFAULT_LANDING_CONTENT.ctaHref,
  card1Title: sanitizeText(payload.card1Title, 120) || DEFAULT_LANDING_CONTENT.card1Title,
  card1Text: sanitizeText(payload.card1Text, 500) || DEFAULT_LANDING_CONTENT.card1Text,
  card2Title: sanitizeText(payload.card2Title, 120) || DEFAULT_LANDING_CONTENT.card2Title,
  card2Text: sanitizeText(payload.card2Text, 500) || DEFAULT_LANDING_CONTENT.card2Text,
  card3Title: sanitizeText(payload.card3Title, 120) || DEFAULT_LANDING_CONTENT.card3Title,
  card3Text: sanitizeText(payload.card3Text, 500) || DEFAULT_LANDING_CONTENT.card3Text,
  footerText: sanitizeText(payload.footerText, 120) || DEFAULT_LANDING_CONTENT.footerText
});

const normalizeArticlePayload = (payload, file, currentCover = '') => {
  const publishedRaw = payload.published;
  const published = publishedRaw === true || publishedRaw === 'true' || publishedRaw === 'on' || publishedRaw === '1';

  const nextCover = file
    ? `/uploads/${file.filename}`
    : sanitizeText(payload.coverImageUrl, 300) || currentCover || '';

  const rawContent = String(payload.content ?? '');
  const safeContent = sanitizeHtml(rawContent, {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
      'h1', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li',
      'a', 'img', 'hr', 'span', 'code', 'pre'
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt'],
      p: ['style'],
      h1: ['style'],
      h2: ['style'],
      h3: ['style'],
      h4: ['style'],
      span: ['style']
    },
    allowedStyles: {
      '*': {
        'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/]
      }
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true)
    }
  });

  return {
    title: sanitizeText(payload.title, 180),
    slug: slugify(sanitizeText(payload.slug, 180) || sanitizeText(payload.title, 180)),
    excerpt: sanitizeText(payload.excerpt, 400),
    content: safeContent.slice(0, 30000),
    coverImageUrl: nextCover,
    published
  };
};

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/articles', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'articles.html'));
});

app.get('/article/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'article.html'));
});

app.get('/api/landing', async (req, res) => {
  try {
    const content = await getLandingContent();
    res.json(content);
  } catch (error) {
    console.error('Failed to load landing content:', error);
    res.status(500).json({ error: 'Failed to load landing content' });
  }
});

app.get('/api/articles', async (req, res) => {
  try {
    const rows = await listArticles();
    const published = rows.filter((a) => a.published).map((a) => ({
      id: a.id,
      title: a.title,
      slug: a.slug,
      excerpt: a.excerpt,
      coverImageUrl: a.coverImageUrl,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt
    }));
    res.json(published);
  } catch (error) {
    console.error('Failed to list public articles:', error);
    res.status(500).json({ error: 'Failed to list articles' });
  }
});

app.get('/api/articles/:slug', async (req, res) => {
  try {
    const article = await getArticleBySlug(req.params.slug);
    if (!article) {
      res.status(404).json({ error: 'Article not found' });
      return;
    }
    res.json(article);
  } catch (error) {
    console.error('Failed to load article:', error);
    res.status(500).json({ error: 'Failed to load article' });
  }
});

app.get('/admin/login', requireAdminPasswordConfig, (req, res) => {
  if (isAuthenticated(req)) {
    return res.redirect('/admin');
  }
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/admin/login', requireAdminPasswordConfig, (req, res) => {
  const password = (req.body.password || '').trim();

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.redirect('/admin/login?error=1');
  }

  res.cookie('admin_auth', 'ok', {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 1000 * 60 * 60 * 8
  });

  return res.redirect('/admin');
});

app.post('/admin/logout', (req, res) => {
  res.clearCookie('admin_auth');
  res.redirect('/admin/login');
});

app.get('/admin', protectAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin/landing', protectAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-landing.html'));
});

app.get('/admin/articles', protectAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-articles.html'));
});

app.get('/api/admin/landing', protectAdmin, async (req, res) => {
  try {
    const content = await getLandingContent();
    res.json(content);
  } catch (error) {
    console.error('Failed to load admin landing content:', error);
    res.status(500).json({ error: 'Failed to load admin landing content' });
  }
});

app.post('/api/admin/landing', protectAdmin, async (req, res) => {
  try {
    const payload = normalizeLandingPayload(req.body || {});
    const saved = await updateLandingContent(payload);
    res.json({ ok: true, content: saved });
  } catch (error) {
    console.error('Failed to save landing content:', error);
    res.status(500).json({ error: 'Failed to save landing content' });
  }
});

app.get('/api/admin/articles', protectAdmin, async (req, res) => {
  try {
    const rows = await listArticles();
    res.json(rows);
  } catch (error) {
    console.error('Failed to list admin articles:', error);
    res.status(500).json({ error: 'Failed to list admin articles' });
  }
});

app.get('/api/admin/articles/:id', protectAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid article id' });
      return;
    }

    const article = await getArticleById(id);
    if (!article) {
      res.status(404).json({ error: 'Article not found' });
      return;
    }

    res.json(article);
  } catch (error) {
    console.error('Failed to load admin article:', error);
    res.status(500).json({ error: 'Failed to load admin article' });
  }
});

app.post('/api/admin/articles', protectAdmin, upload.single('coverImage'), async (req, res) => {
  try {
    const idValue = sanitizeText(req.body.id, 24);
    const id = idValue ? Number(idValue) : null;

    if (idValue && (!Number.isInteger(id) || id <= 0)) {
      res.status(400).json({ error: 'Invalid article id' });
      return;
    }

    if (id) {
      const current = await getArticleById(id);
      if (!current) {
        res.status(404).json({ error: 'Article not found' });
        return;
      }

      const payload = normalizeArticlePayload(req.body, req.file, current.coverImageUrl);
      if (!payload.title) {
        res.status(400).json({ error: 'Title is required' });
        return;
      }

      const updated = await updateArticle(id, payload);
      res.json({ ok: true, article: updated });
      return;
    }

    const payload = normalizeArticlePayload(req.body, req.file);
    if (!payload.title) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const created = await createArticle(payload);
    res.json({ ok: true, article: created });
  } catch (error) {
    console.error('Failed to save article:', error);
    res.status(500).json({ error: 'Failed to save article' });
  }
});

app.delete('/api/admin/articles/:id', protectAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid article id' });
      return;
    }

    const removed = await deleteArticle(id);
    if (!removed) {
      res.status(404).json({ error: 'Article not found' });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete article:', error);
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError || error.message === 'Only image files are allowed') {
    res.status(400).json({ error: error.message });
    return;
  }
  next(error);
});

const start = async () => {
  try {
    await initStorage();
    app.listen(port, () => {
      console.log(`ImSexpat app running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Startup failed:', error);
    process.exit(1);
  }
};

start();
