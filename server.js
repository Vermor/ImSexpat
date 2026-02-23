require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const {
  DEFAULT_LANDING_CONTENT,
  initStorage,
  getLandingContent,
  updateLandingContent
} = require('./storage');

const app = express();
const port = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET || 'local-dev-secret'));
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
