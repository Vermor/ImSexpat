const { Pool } = require('pg');

const DEFAULT_LANDING_CONTENT = {
  siteName: 'ImSexpat',
  pageTitle: "ImSexpat | Journal d'un sexpat",
  metaDescription: "recit, informations, news sur la vie d'un sexpat",
  heroTitle: "Journal d'un sexpat",
  heroSubtitle: "recit, informations, news sur la vie d'un sexpat",
  ctaText: 'Voir les themes',
  ctaHref: '/articles',
  card1Title: 'Installation expat',
  card1Text: 'Checklist arrivee, visa, assurance, banque et appart a Bangkok ou Chiang Mai.',
  card2Title: 'Vie quotidienne',
  card2Text: 'Transports, sante, courses, quartiers et habitudes culturelles a connaitre.',
  card3Title: 'Week-ends & iles',
  card3Text: 'Itineraires realistes depuis les grandes villes vers les meilleures escapades.',
  footerText: 'ImSexpat'
};

let pool = null;
let inMemoryContent = { ...DEFAULT_LANDING_CONTENT };
let inMemoryArticles = [];
let inMemoryArticleId = 1;

const createPool = () => {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (databaseUrl) {
    const isLocal = databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');
    return new Pool({
      connectionString: databaseUrl,
      ssl: isLocal ? false : { rejectUnauthorized: false }
    });
  }

  const hasPgParts = process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD && process.env.PGDATABASE;
  if (hasPgParts) {
    const isLocal = String(process.env.PGHOST).includes('localhost') || String(process.env.PGHOST).includes('127.0.0.1');
    return new Pool({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: isLocal ? false : { rejectUnauthorized: false }
    });
  }

  return null;
};

const mapLandingRow = (row) => ({
  siteName: row.site_name,
  pageTitle: row.page_title,
  metaDescription: row.meta_description,
  heroTitle: row.hero_title,
  heroSubtitle: row.hero_subtitle,
  ctaText: row.cta_text,
  ctaHref: row.cta_href,
  card1Title: row.card1_title,
  card1Text: row.card1_text,
  card2Title: row.card2_title,
  card2Text: row.card2_text,
  card3Title: row.card3_title,
  card3Text: row.card3_text,
  footerText: row.footer_text
});

const mapArticleRow = (row) => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  excerpt: row.excerpt,
  content: row.content,
  coverImageUrl: row.cover_image_url,
  published: row.published,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const landingTableSql = `
  CREATE TABLE IF NOT EXISTS landing_content (
    id INTEGER PRIMARY KEY,
    site_name TEXT NOT NULL,
    page_title TEXT NOT NULL,
    meta_description TEXT NOT NULL,
    hero_title TEXT NOT NULL,
    hero_subtitle TEXT NOT NULL,
    cta_text TEXT NOT NULL,
    cta_href TEXT NOT NULL,
    card1_title TEXT NOT NULL,
    card1_text TEXT NOT NULL,
    card2_title TEXT NOT NULL,
    card2_text TEXT NOT NULL,
    card3_title TEXT NOT NULL,
    card3_text TEXT NOT NULL,
    footer_text TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const articlesTableSql = `
  CREATE TABLE IF NOT EXISTS articles (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    excerpt TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    cover_image_url TEXT NOT NULL DEFAULT '',
    published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const upsertLandingSql = `
  INSERT INTO landing_content (
    id,
    site_name,
    page_title,
    meta_description,
    hero_title,
    hero_subtitle,
    cta_text,
    cta_href,
    card1_title,
    card1_text,
    card2_title,
    card2_text,
    card3_title,
    card3_text,
    footer_text,
    updated_at
  ) VALUES (
    1,
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8,
    $9,
    $10,
    $11,
    $12,
    $13,
    $14,
    NOW()
  )
  ON CONFLICT (id)
  DO UPDATE SET
    site_name = EXCLUDED.site_name,
    page_title = EXCLUDED.page_title,
    meta_description = EXCLUDED.meta_description,
    hero_title = EXCLUDED.hero_title,
    hero_subtitle = EXCLUDED.hero_subtitle,
    cta_text = EXCLUDED.cta_text,
    cta_href = EXCLUDED.cta_href,
    card1_title = EXCLUDED.card1_title,
    card1_text = EXCLUDED.card1_text,
    card2_title = EXCLUDED.card2_title,
    card2_text = EXCLUDED.card2_text,
    card3_title = EXCLUDED.card3_title,
    card3_text = EXCLUDED.card3_text,
    footer_text = EXCLUDED.footer_text,
    updated_at = NOW();
`;

const landingValues = (content) => ([
  content.siteName,
  content.pageTitle,
  content.metaDescription,
  content.heroTitle,
  content.heroSubtitle,
  content.ctaText,
  content.ctaHref,
  content.card1Title,
  content.card1Text,
  content.card2Title,
  content.card2Text,
  content.card3Title,
  content.card3Text,
  content.footerText
]);

const slugify = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '')
  .slice(0, 80) || 'article';

const initStorage = async () => {
  pool = createPool();

  if (!pool) {
    if (process.env.NODE_ENV === 'production') {
      const keys = ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']
        .map((k) => `${k}=${process.env[k] ? 'set' : 'missing'}`)
        .join(', ');
      throw new Error(`No PostgreSQL config found in production. ${keys}`);
    }
    console.warn('DATABASE_URL missing: using in-memory storage for landing and articles.');
    return;
  }

  await pool.query(landingTableSql);
  await pool.query(articlesTableSql);
  await pool.query(upsertLandingSql, landingValues(DEFAULT_LANDING_CONTENT));
  console.log('PostgreSQL storage ready for landing and articles.');
};

const getLandingContent = async () => {
  if (!pool) {
    return { ...inMemoryContent };
  }

  const result = await pool.query('SELECT * FROM landing_content WHERE id = 1 LIMIT 1;');

  if (result.rowCount === 0) {
    await pool.query(upsertLandingSql, landingValues(DEFAULT_LANDING_CONTENT));
    return { ...DEFAULT_LANDING_CONTENT };
  }

  return mapLandingRow(result.rows[0]);
};

const updateLandingContent = async (content) => {
  const merged = { ...DEFAULT_LANDING_CONTENT, ...content };

  if (!pool) {
    inMemoryContent = merged;
    return { ...inMemoryContent };
  }

  await pool.query(upsertLandingSql, landingValues(merged));
  return getLandingContent();
};

const ensureUniqueSlug = async (baseSlug, articleId = null) => {
  const root = slugify(baseSlug);

  if (!pool) {
    let nextSlug = root;
    let suffix = 2;
    const conflict = (slug) => inMemoryArticles.some((a) => a.slug === slug && a.id !== articleId);

    while (conflict(nextSlug)) {
      nextSlug = `${root}-${suffix}`;
      suffix += 1;
    }

    return nextSlug;
  }

  let nextSlug = root;
  let suffix = 2;

  while (true) {
    const check = articleId
      ? await pool.query('SELECT id FROM articles WHERE slug = $1 AND id <> $2 LIMIT 1;', [nextSlug, articleId])
      : await pool.query('SELECT id FROM articles WHERE slug = $1 LIMIT 1;', [nextSlug]);

    if (check.rowCount === 0) {
      return nextSlug;
    }

    nextSlug = `${root}-${suffix}`;
    suffix += 1;
  }
};

const listArticles = async () => {
  if (!pool) {
    return [...inMemoryArticles]
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  const result = await pool.query('SELECT * FROM articles ORDER BY updated_at DESC;');
  return result.rows.map(mapArticleRow);
};

const getArticleById = async (id) => {
  if (!pool) {
    return inMemoryArticles.find((a) => a.id === id) || null;
  }

  const result = await pool.query('SELECT * FROM articles WHERE id = $1 LIMIT 1;', [id]);
  if (result.rowCount === 0) return null;
  return mapArticleRow(result.rows[0]);
};

const getArticleBySlug = async (slug) => {
  if (!pool) {
    return inMemoryArticles.find((a) => a.slug === slug && a.published) || null;
  }

  const result = await pool.query('SELECT * FROM articles WHERE slug = $1 AND published = true LIMIT 1;', [slug]);
  if (result.rowCount === 0) return null;
  return mapArticleRow(result.rows[0]);
};

const createArticle = async (input) => {
  const now = new Date().toISOString();
  const slug = await ensureUniqueSlug(input.slug || input.title);

  if (!pool) {
    const article = {
      id: inMemoryArticleId,
      title: input.title,
      slug,
      excerpt: input.excerpt,
      content: input.content,
      coverImageUrl: input.coverImageUrl,
      published: input.published,
      createdAt: now,
      updatedAt: now
    };

    inMemoryArticleId += 1;
    inMemoryArticles.unshift(article);
    return article;
  }

  const result = await pool.query(
    `INSERT INTO articles (title, slug, excerpt, content, cover_image_url, published, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *;`,
    [input.title, slug, input.excerpt, input.content, input.coverImageUrl, input.published]
  );

  return mapArticleRow(result.rows[0]);
};

const updateArticle = async (id, input) => {
  const slug = await ensureUniqueSlug(input.slug || input.title, id);

  if (!pool) {
    const idx = inMemoryArticles.findIndex((a) => a.id === id);
    if (idx === -1) return null;

    const updated = {
      ...inMemoryArticles[idx],
      title: input.title,
      slug,
      excerpt: input.excerpt,
      content: input.content,
      coverImageUrl: input.coverImageUrl,
      published: input.published,
      updatedAt: new Date().toISOString()
    };

    inMemoryArticles[idx] = updated;
    return updated;
  }

  const result = await pool.query(
    `UPDATE articles
     SET title = $1,
         slug = $2,
         excerpt = $3,
         content = $4,
         cover_image_url = $5,
         published = $6,
         updated_at = NOW()
     WHERE id = $7
     RETURNING *;`,
    [input.title, slug, input.excerpt, input.content, input.coverImageUrl, input.published, id]
  );

  if (result.rowCount === 0) return null;
  return mapArticleRow(result.rows[0]);
};

const deleteArticle = async (id) => {
  if (!pool) {
    const before = inMemoryArticles.length;
    inMemoryArticles = inMemoryArticles.filter((a) => a.id !== id);
    return inMemoryArticles.length !== before;
  }

  const result = await pool.query('DELETE FROM articles WHERE id = $1;', [id]);
  return result.rowCount > 0;
};

module.exports = {
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
};
