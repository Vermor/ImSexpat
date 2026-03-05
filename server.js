require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const sharp = require('sharp');
const crypto = require('crypto');
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
  getArticleOpinionPresetOptions,
  getArticleOpinion,
  submitArticleOpinionVote,
  listArticleOpinionOptionsAdmin,
  deleteArticleOpinionOptionAdmin,
  createArticle,
  updateArticle,
  deleteArticle,
  getMediaUsage,
  isSlugAvailable,
  logAdminAction,
  listAdminActivity,
  slugify
} = require('./storage');

const app = express();
const port = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';
const primaryDomain = process.env.PRIMARY_DOMAIN || 'vermor.club';

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

const opinionRateWindowMs = 60 * 1000;
const opinionRateMax = 15;
const opinionRateStore = new Map();

const getOrCreateSessionId = (req, res) => {
  let sid = String(req.signedCookies.vc_sid || '').trim();
  if (sid && /^[a-z0-9]{32,80}$/i.test(sid)) return sid;
  sid = crypto.randomBytes(24).toString('hex');
  res.cookie('vc_sid', sid, {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 1000 * 60 * 60 * 24 * 365
  });
  return sid;
};

const getOpinionVoterKey = (req, res) => {
  const sid = getOrCreateSessionId(req, res);
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const ua = String(req.headers['user-agent'] || '').slice(0, 200);
  const secret = String(process.env.COOKIE_SECRET || 'local-dev-secret');
  return crypto.createHmac('sha256', secret).update(`${sid}|${ip}|${ua}`).digest('hex');
};

const opinionRateLimit = (req, res, next) => {
  const key = getOpinionVoterKey(req, res);
  const now = Date.now();
  const windowStart = now - opinionRateWindowMs;
  const history = (opinionRateStore.get(key) || []).filter((ts) => ts >= windowStart);
  if (history.length >= opinionRateMax) {
    return res.status(429).json({ error: 'Trop de requetes. Reessaie dans une minute.' });
  }
  history.push(now);
  opinionRateStore.set(key, history);
  return next();
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

const normalizeRubricsPayload = (value) => {
  let input = value;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch (_error) {
      input = [];
    }
  }
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => ({
      title: sanitizeText(item && item.title, 80),
      categories: toCommaList(item && item.categories, 400)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((x, i, arr) => arr.indexOf(x) === i)
        .slice(0, 8),
      limit: Math.max(1, Math.min(12, Number(item && item.limit) || 3))
    }))
    .filter((item) => item.title && item.categories.length)
    .slice(0, 8);
};

const normalizeLandingPayload = (payload) => {
  const safe = payload && typeof payload === 'object' ? payload : {};
  const out = {};
  if ('siteName' in safe) out.siteName = sanitizeText(safe.siteName, 100) || DEFAULT_LANDING_CONTENT.siteName;
  if ('pageTitle' in safe) out.pageTitle = sanitizeText(safe.pageTitle, 180) || DEFAULT_LANDING_CONTENT.pageTitle;
  if ('metaDescription' in safe) out.metaDescription = sanitizeText(safe.metaDescription, 300) || DEFAULT_LANDING_CONTENT.metaDescription;
  if ('heroTitle' in safe) out.heroTitle = sanitizeText(safe.heroTitle, 180) || DEFAULT_LANDING_CONTENT.heroTitle;
  if ('heroSubtitle' in safe) out.heroSubtitle = sanitizeText(safe.heroSubtitle, 500) || DEFAULT_LANDING_CONTENT.heroSubtitle;
  if ('ctaText' in safe) out.ctaText = sanitizeText(safe.ctaText, 60) || DEFAULT_LANDING_CONTENT.ctaText;
  if ('ctaHref' in safe) out.ctaHref = sanitizeText(safe.ctaHref, 200) || DEFAULT_LANDING_CONTENT.ctaHref;
  if ('card1Title' in safe) out.card1Title = sanitizeText(safe.card1Title, 120) || DEFAULT_LANDING_CONTENT.card1Title;
  if ('card1Text' in safe) out.card1Text = sanitizeText(safe.card1Text, 500) || DEFAULT_LANDING_CONTENT.card1Text;
  if ('card2Title' in safe) out.card2Title = sanitizeText(safe.card2Title, 120) || DEFAULT_LANDING_CONTENT.card2Title;
  if ('card2Text' in safe) out.card2Text = sanitizeText(safe.card2Text, 500) || DEFAULT_LANDING_CONTENT.card2Text;
  if ('card3Title' in safe) out.card3Title = sanitizeText(safe.card3Title, 120) || DEFAULT_LANDING_CONTENT.card3Title;
  if ('card3Text' in safe) out.card3Text = sanitizeText(safe.card3Text, 500) || DEFAULT_LANDING_CONTENT.card3Text;
  if ('footerText' in safe) out.footerText = sanitizeText(safe.footerText, 120) || DEFAULT_LANDING_CONTENT.footerText;
  if ('rubrics' in safe) out.rubrics = normalizeRubricsPayload(safe.rubrics);
  return out;
};

const normalizeArticlePayload = (payload, uploadedCoverUrl, currentCover = '') => {
  const publishedRaw = payload.published;
  const published = publishedRaw === true || publishedRaw === 'true' || publishedRaw === 'on' || publishedRaw === '1';
  const featuredRaw = payload.featured;
  const featured = featuredRaw === true || featuredRaw === 'true' || featuredRaw === 'on' || featuredRaw === '1';

  const nextCover = uploadedCoverUrl || sanitizeText(payload.coverImageUrl, 300) || currentCover || '';

  const rawContent = String(payload.content ?? '');
  const safeContent = sanitizeHtml(rawContent, {
    allowedTags: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
      'h1', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li',
      'a', 'img', 'hr', 'span', 'code', 'pre', 'iframe'
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt'],
      iframe: ['src', 'title', 'width', 'height', 'allow', 'allowfullscreen', 'frameborder', 'referrerpolicy'],
      p: ['style'],
      h1: ['style'],
      h2: ['style'],
      h3: ['style'],
      h4: ['style'],
      span: ['style']
    },
    allowedIframeHostnames: ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com'],
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
  const opinionEnabledRaw = payload.opinionEnabled;
  const opinionEnabled = opinionEnabledRaw === true || opinionEnabledRaw === 'true' || opinionEnabledRaw === 'on' || opinionEnabledRaw === '1';
  const opinionQuestion = sanitizeText(payload.opinionQuestion, 180);
  const opinionOptions = String(payload.opinionOptions || '')
    .split(/\r?\n/)
    .map((x) => sanitizeText(x, 60))
    .filter(Boolean)
    .filter((x, i, arr) => arr.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i)
    .slice(0, 12);

  return {
    title: sanitizeText(payload.title, 180),
    slug: slugify(sanitizeText(payload.slug, 180) || sanitizeText(payload.title, 180)),
    excerpt: sanitizeText(payload.excerpt, 400),
    content: safeContent.slice(0, 50000),
    coverImageUrl: nextCover,
    seoTitle,
    seoDescription,
    ogImageUrl: nextCover,
    categories: toCommaList(payload.categories, 400),
    tags: toCommaList(payload.tags, 400),
    opinionEnabled,
    opinionQuestion,
    opinionOptions,
    featured,
    published
  };
};

const actorFromReq = (req) => sanitizeText(req.headers['x-forwarded-for'] || req.ip || 'admin', 160);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/articles', (req, res) => res.sendFile(path.join(__dirname, 'public', 'articles.html')));
app.get('/article/:slug', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    const filePath = path.join(__dirname, 'public', 'article.html');
    const html = await fs.promises.readFile(filePath, 'utf8');
    const article = await getArticleBySlug(req.params.slug);
    if (!article) {
      return res.status(404).type('html').send(html);
    }

    const title = article.seoTitle || article.title || 'Article | Vermor Club';
    const description = article.seoDescription || article.excerpt || '';
    const imageUrl = toAbsoluteUrl(article.ogImageUrl || article.coverImageUrl || '', req);
    const pageUrl = toAbsoluteUrl(req.path || '/', req);

    let output = html;
    output = output.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
    output = replaceMeta(output, /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i, `<meta name="description" content="${escapeHtml(description)}" />`);
    output = replaceMeta(output, /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${escapeHtml(pageUrl)}" />`);
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
    const featuredRaw = String(req.query.featured || '').trim().toLowerCase();
    const featuredOnly = featuredRaw === '1' || featuredRaw === 'true' || featuredRaw === 'yes';
    const result = await listArticles({
      page: req.query.page,
      pageSize: req.query.pageSize,
      q: req.query.q,
      category: req.query.category,
      categories: req.query.categories,
      tag: req.query.tag,
      featuredOnly,
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

app.get('/api/articles/:slug/opinion', async (req, res) => {
  try {
    const article = await getArticleBySlug(req.params.slug);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    const voterKey = getOpinionVoterKey(req, res);
    const snapshot = await getArticleOpinion(article.id, voterKey);
    if (!snapshot) return res.status(404).json({ error: 'Opinion not found' });
    res.json(snapshot);
  } catch (error) {
    console.error('Failed to load article opinion:', error);
    res.status(500).json({ error: 'Failed to load opinion' });
  }
});

app.post('/api/articles/:slug/opinion/vote', opinionRateLimit, async (req, res) => {
  try {
    const article = await getArticleBySlug(req.params.slug);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    const voterKey = getOpinionVoterKey(req, res);
    const optionId = Number(req.body.optionId || 0) || null;
    const customLabel = sanitizeText(req.body.customLabel, 60);
    const customDescription = sanitizeText(req.body.customDescription, 500);
    const hasExplanation = Object.prototype.hasOwnProperty.call(req.body || {}, 'explanation');
    const explanation = sanitizeText(req.body.explanation, 500);
    if (!optionId && !customLabel) {
      return res.status(400).json({ error: 'Choix requis' });
    }
    if (customLabel && !customDescription) {
      return res.status(400).json({ error: 'Description requise pour un nouveau choix' });
    }

    const snapshot = await submitArticleOpinionVote(article.id, voterKey, {
      optionId,
      customLabel,
      customDescription,
      ...(customLabel ? { explanation: customDescription } : {}),
      ...(hasExplanation ? { explanation } : {})
    });
    return res.json({ ok: true, snapshot });
  } catch (error) {
    const message = String(error && error.message || '');
    if (message.includes('disabled')) return res.status(400).json({ error: 'Fonction opinion non active pour cet article' });
    if (message.includes('Invalid option')) return res.status(400).json({ error: 'Choix invalide' });
    if (message.includes('Custom option already exists')) return res.status(409).json({ error: 'Tu as deja propose un choix pour cet article.' });
    console.error('Failed to submit vote:', error);
    return res.status(500).json({ error: 'Erreur lors de lenregistrement du vote' });
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
    const featuredRaw = String(req.query.featured || '').trim().toLowerCase();
    const featuredOnly = featuredRaw === '1' || featuredRaw === 'true' || featuredRaw === 'yes';
    const result = await listArticles({
      page: req.query.page,
      pageSize: req.query.pageSize || 25,
      q: req.query.q,
      category: req.query.category,
      tag: req.query.tag,
      featuredOnly,
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
    const presetOptions = await getArticleOpinionPresetOptions(id);
    res.json({ ...article, opinionOptions: presetOptions });
  } catch (error) {
    console.error('Failed to load admin article:', error);
    res.status(500).json({ error: 'Failed to load admin article' });
  }
});

app.get('/api/admin/articles/:id/opinion-options', protectAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid article id' });
    const article = await getArticleById(id);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    const options = await listArticleOpinionOptionsAdmin(id);
    return res.json({ items: options });
  } catch (error) {
    console.error('Failed to load admin opinion options:', error);
    return res.status(500).json({ error: 'Failed to load opinion options' });
  }
});

app.delete('/api/admin/articles/:id/opinion-options/:optionId', protectAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const optionId = Number(req.params.optionId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid article id' });
    if (!Number.isInteger(optionId) || optionId <= 0) return res.status(400).json({ error: 'Invalid option id' });
    const ok = await deleteArticleOpinionOptionAdmin(id, optionId);
    if (!ok) return res.status(404).json({ error: 'Option not found' });

    await logAdminAction({
      action: 'opinion.option.delete',
      entityType: 'article',
      entityId: String(id),
      summary: `Opinion option ${optionId} deleted for article ${id}`,
      actor: actorFromReq(req)
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete opinion option:', error);
    return res.status(500).json({ error: 'Failed to delete option' });
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
    const usage = await getMediaUsage(id);
    if (usage.length) {
      return res.status(409).json({
        error: 'Image utilisee dans un ou plusieurs articles. Retire-la des articles avant suppression.',
        usage
      });
    }

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
      console.log(`Vermor Club app running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Startup failed:', error);
    process.exit(1);
  }
};

start();
