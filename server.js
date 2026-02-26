require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const {
  DEFAULT_LANDING_CONTENT,
  initStorage,
  getLandingContent,
  updateLandingContent,
  listArticles,
  getTaxonomies,
  getArticleById,
  getArticleBySlug,
  createArticle,
  updateArticle,
  deleteArticle,
  isSlugAvailable,
  logAdminAction,
  listAdminActivity,
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
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`)
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if ((file.mimetype || '').startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Only image files are allowed'));
  }
});

const isSafeUploadName = (name) => /^[a-zA-Z0-9._-]+$/.test(name || '');

const optimizeUploadedImage = async (fullPath) => {
  const tempPath = `${fullPath}.tmp`;
  await sharp(fullPath)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(tempPath);
  await fs.promises.rename(tempPath, fullPath);
};

const uploadFileToStorage = async (file) => {
  if (!file) return null;
  await optimizeUploadedImage(file.path);

  const stat = await fs.promises.stat(file.path);
  return {
    id: file.filename,
    name: file.filename,
    url: `/uploads/${file.filename}`,
    size: stat.size,
    updatedAt: stat.mtime.toISOString()
  };
};

const listUploadFiles = async () => {
  const entries = await fs.promises.readdir(uploadsDir, { withFileTypes: true });
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name !== '.gitkeep')
    .map(async (entry) => {
      const fullPath = path.join(uploadsDir, entry.name);
      const stat = await fs.promises.stat(fullPath);
      return {
        id: entry.name,
        name: entry.name,
        url: `/uploads/${entry.name}`,
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      };
    }));

  return files.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
};

const deleteUploadFile = async (id) => {
  if (!isSafeUploadName(id)) {
    const error = new Error('Invalid file name');
    error.statusCode = 400;
    throw error;
  }
  await fs.promises.unlink(path.join(uploadsDir, id));
};

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET || 'local-dev-secret'));
app.use((req, res, next) => {
  // Ask crawlers not to index any page of this site.
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.use((req, res, next) => {
  if (req.path === '/health') return next();
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
    return res.status(500).send('ADMIN_PASSWORD is missing. Set it in environment variables.');
  }
  return next();
};

const isAuthenticated = (req) => req.signedCookies.admin_auth === 'ok';

const protectAdmin = [requireAdminPasswordConfig, (req, res, next) => {
  if (isAuthenticated(req)) return next();
  return res.redirect('/admin/login');
}];

const sanitizeText = (value, maxLength) => String(value ?? '').trim().slice(0, maxLength);
const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const getRequestOrigin = (req) => {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || (isProd ? 'https' : 'http');
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host') || primaryDomain;
  return `${proto}://${host}`;
};

const toAbsoluteUrl = (value, req) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const origin = getRequestOrigin(req);
  if (raw.startsWith('//')) return `${origin.startsWith('https://') ? 'https:' : 'http:'}${raw}`;
  if (raw.startsWith('/')) return `${origin}${raw}`;
  return `${origin}/${raw}`;
};

const replaceMeta = (html, pattern, nextTag) => {
  if (pattern.test(html)) {
    return html.replace(pattern, nextTag);
  }
  return html;
};

const toCommaList = (value, maxLength = 400) => {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || '').trim()).filter(Boolean).join(',').slice(0, maxLength);
  }
  return sanitizeText(value, maxLength);
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

const normalizeArticlePayload = (payload, uploadedCoverUrl, currentCover = '') => {
  const publishedRaw = payload.published;
  const published = publishedRaw === true || publishedRaw === 'true' || publishedRaw === 'on' || publishedRaw === '1';

  const nextCover = uploadedCoverUrl || sanitizeText(payload.coverImageUrl, 300) || currentCover || '';

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

  const seoTitle = sanitizeText(payload.seoTitle, 180) || sanitizeText(payload.title, 180);
  const seoDescription = sanitizeText(payload.seoDescription, 320) || sanitizeText(payload.excerpt, 320);

  return {
    title: sanitizeText(payload.title, 180),
    slug: slugify(sanitizeText(payload.slug, 180) || sanitizeText(payload.title, 180)),
    excerpt: sanitizeText(payload.excerpt, 400),
    content: safeContent.slice(0, 50000),
    coverImageUrl: nextCover,
    seoTitle,
    seoDescription,
    ogImageUrl: sanitizeText(payload.ogImageUrl, 300) || nextCover,
    categories: toCommaList(payload.categories, 400),
    tags: toCommaList(payload.tags, 400),
    published
  };
};

const actorFromReq = (req) => sanitizeText(req.headers['x-forwarded-for'] || req.ip || 'admin', 160);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/articles', (req, res) => res.sendFile(path.join(__dirname, 'public', 'articles.html')));
app.get('/article/:slug', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'public', 'article.html');
    const html = await fs.promises.readFile(filePath, 'utf8');
    const article = await getArticleBySlug(req.params.slug);
    if (!article) {
      return res.status(404).type('html').send(html);
    }

    const title = article.seoTitle || article.title || 'Article | ImSexpat';
    const description = article.seoDescription || article.excerpt || '';
    const imageUrl = toAbsoluteUrl(article.ogImageUrl || article.coverImageUrl || '', req);
    const pageUrl = toAbsoluteUrl(req.originalUrl || req.path || '/', req);

    let output = html;
    output = output.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
    output = replaceMeta(output, /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, `<meta name="description" content="${escapeHtml(description)}" />`);
    output = replaceMeta(output, /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:title" content="${escapeHtml(title)}" />`);
    output = replaceMeta(output, /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:description" content="${escapeHtml(description)}" />`);
    output = replaceMeta(output, /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`);
    if (/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i.test(output)) {
      output = output.replace(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:url" content="${escapeHtml(pageUrl)}" />`);
    } else {
      output = output.replace(
        /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i,
        `<meta property="og:image" content="${escapeHtml(imageUrl)}" />\n    <meta property="og:url" content="${escapeHtml(pageUrl)}" />`
      );
    }

    return res.type('html').send(output);
  } catch (error) {
    console.error('Failed to render article page:', error);
    return res.sendFile(path.join(__dirname, 'public', 'article.html'));
  }
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
    const result = await listArticles({
      page: req.query.page,
      pageSize: req.query.pageSize,
      q: req.query.q,
      category: req.query.category,
      tag: req.query.tag,
      publishedOnly: true
    });
    const taxonomies = await getTaxonomies();
    res.json({
      items: result.items,
      pagination: result.pagination,
      taxonomies
    });
  } catch (error) {
    console.error('Failed to list public articles:', error);
    res.status(500).json({ error: 'Failed to list articles' });
  }
});

app.get('/api/articles/:slug', async (req, res) => {
  try {
    const article = await getArticleBySlug(req.params.slug);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    res.json(article);
  } catch (error) {
    console.error('Failed to load article:', error);
    res.status(500).json({ error: 'Failed to load article' });
  }
});

app.get('/admin/login', requireAdminPasswordConfig, (req, res) => {
  if (isAuthenticated(req)) return res.redirect('/admin');
  return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/admin/login', requireAdminPasswordConfig, (req, res) => {
  const password = (req.body.password || '').trim();
  if (password !== process.env.ADMIN_PASSWORD) return res.redirect('/admin/login?error=1');

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

app.get('/admin', protectAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin/landing', protectAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-landing.html')));
app.get('/admin/articles', protectAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-articles.html')));
app.get('/admin/media', protectAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-media.html')));

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
    await logAdminAction({
      action: 'landing.update',
      entityType: 'landing',
      entityId: '1',
      summary: `Landing updated: ${payload.pageTitle}`,
      actor: actorFromReq(req)
    });
    res.json({ ok: true, content: saved });
  } catch (error) {
    console.error('Failed to save landing content:', error);
    res.status(500).json({ error: 'Failed to save landing content' });
  }
});

app.get('/api/admin/taxonomies', protectAdmin, async (req, res) => {
  try {
    const tax = await getTaxonomies();
    res.json(tax);
  } catch (error) {
    console.error('Failed to load taxonomies:', error);
    res.status(500).json({ error: 'Failed to load taxonomies' });
  }
});

app.get('/api/admin/activity', protectAdmin, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    const logs = await listAdminActivity(limit);
    res.json(logs);
  } catch (error) {
    console.error('Failed to list activity logs:', error);
    res.status(500).json({ error: 'Failed to list activity logs' });
  }
});

app.get('/api/admin/articles/slug-check', protectAdmin, async (req, res) => {
  try {
    const slug = sanitizeText(req.query.slug, 180);
    const excludeId = Number(req.query.excludeId || 0) || null;
    if (!slug) return res.status(400).json({ error: 'Missing slug' });
    const normalized = slugify(slug);
    const available = await isSlugAvailable(normalized, excludeId);
    res.json({ slug: normalized, available });
  } catch (error) {
    console.error('Failed to check slug:', error);
    res.status(500).json({ error: 'Failed to check slug' });
  }
});

app.get('/api/admin/articles', protectAdmin, async (req, res) => {
  try {
    const result = await listArticles({
      page: req.query.page,
      pageSize: req.query.pageSize || 25,
      q: req.query.q,
      category: req.query.category,
      tag: req.query.tag,
      publishedOnly: false
    });
    const taxonomies = await getTaxonomies();
    res.json({ items: result.items, pagination: result.pagination, taxonomies });
  } catch (error) {
    console.error('Failed to list admin articles:', error);
    res.status(500).json({ error: 'Failed to list admin articles' });
  }
});

app.get('/api/admin/articles/:id', protectAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid article id' });
    const article = await getArticleById(id);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    res.json(article);
  } catch (error) {
    console.error('Failed to load admin article:', error);
    res.status(500).json({ error: 'Failed to load admin article' });
  }
});

app.get('/api/admin/uploads', protectAdmin, async (req, res) => {
  try {
    const files = await listUploadFiles();
    res.json(files);
  } catch (error) {
    console.error('Failed to list uploads:', error);
    res.status(500).json({ error: 'Failed to list uploads' });
  }
});

app.post('/api/admin/uploads', protectAdmin, upload.any(), (req, res) => {
  Promise.all((req.files || []).map((file) => uploadFileToStorage(file)))
    .then(async (files) => {
      const safeFiles = files.filter(Boolean);
      if (safeFiles.length > 0) {
        await logAdminAction({
          action: 'media.upload',
          entityType: 'media',
          entityId: String(safeFiles.length),
          summary: `Uploaded ${safeFiles.length} media file(s)`,
          actor: actorFromReq(req)
        });
      }
      res.json({ ok: true, files: safeFiles });
    })
    .catch((error) => {
      console.error('Failed to upload files:', error);
      res.status(500).json({ error: 'Failed to upload files' });
    });
});

app.post('/api/admin/articles', protectAdmin, upload.single('coverImage'), async (req, res) => {
  try {
    const idValue = sanitizeText(req.body.id, 24);
    const id = idValue ? Number(idValue) : null;
    const uploadedCover = req.file ? await uploadFileToStorage(req.file) : null;
    const uploadedCoverUrl = uploadedCover ? uploadedCover.url : '';

    if (idValue && (!Number.isInteger(id) || id <= 0)) {
      return res.status(400).json({ error: 'Invalid article id' });
    }

    if (id) {
      const current = await getArticleById(id);
      if (!current) return res.status(404).json({ error: 'Article not found' });

      const payload = normalizeArticlePayload(req.body, uploadedCoverUrl, current.coverImageUrl);
      if (!payload.title) return res.status(400).json({ error: 'Title is required' });

      const updated = await updateArticle(id, payload);
      await logAdminAction({
        action: 'article.update',
        entityType: 'article',
        entityId: String(id),
        summary: `Article updated: ${payload.title}`,
        actor: actorFromReq(req)
      });
      return res.json({ ok: true, article: updated });
    }

    const payload = normalizeArticlePayload(req.body, uploadedCoverUrl);
    if (!payload.title) return res.status(400).json({ error: 'Title is required' });

    const created = await createArticle(payload);
    await logAdminAction({
      action: 'article.create',
      entityType: 'article',
      entityId: String(created.id),
      summary: `Article created: ${payload.title}`,
      actor: actorFromReq(req)
    });
    return res.json({ ok: true, article: created });
  } catch (error) {
    console.error('Failed to save article:', error);
    return res.status(500).json({ error: 'Failed to save article' });
  }
});

app.post('/api/admin/uploads/image', protectAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image file is required' });

  uploadFileToStorage(req.file)
    .then((stored) => res.json({ ok: true, url: stored ? stored.url : '' }))
    .catch((error) => {
      console.error('Failed to upload inline image:', error);
      res.status(500).json({ error: 'Failed to upload image' });
    });
});

app.delete('/api/admin/uploads', protectAdmin, async (req, res) => {
  try {
    const id = sanitizeText(req.query.id, 300);
    if (!id) return res.status(400).json({ error: 'Missing file id' });

    await deleteUploadFile(id);
    await logAdminAction({
      action: 'media.delete',
      entityType: 'media',
      entityId: id,
      summary: `Media deleted: ${id}`,
      actor: actorFromReq(req)
    });
    return res.json({ ok: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
    if (error && error.statusCode === 400) return res.status(400).json({ error: error.message });
    console.error('Failed to delete upload:', error);
    return res.status(500).json({ error: 'Failed to delete upload' });
  }
});

app.delete('/api/admin/articles/:id', protectAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid article id' });

    const removed = await deleteArticle(id);
    if (!removed) return res.status(404).json({ error: 'Article not found' });

    await logAdminAction({
      action: 'article.delete',
      entityType: 'article',
      entityId: String(id),
      summary: `Article deleted: ${id}`,
      actor: actorFromReq(req)
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete article:', error);
    return res.status(500).json({ error: 'Failed to delete article' });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError || error.message === 'Only image files are allowed') {
    return res.status(400).json({ error: error.message });
  }
  return next(error);
});

const start = async () => {
  try {
    await initStorage();
    console.log('Media storage: local filesystem');
    app.listen(port, () => {
      console.log(`ImSexpat app running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Startup failed:', error);
    process.exit(1);
  }
};

start();
