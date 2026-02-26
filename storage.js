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
let inMemoryLogs = [];

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
  seoTitle: row.seo_title,
  seoDescription: row.seo_description,
  ogImageUrl: row.og_image_url,
  categories: row.categories || [],
  tags: row.tags || [],
  published: row.published,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapLogRow = (row) => ({
  id: row.id,
  action: row.action,
  entityType: row.entity_type,
  entityId: row.entity_id,
  summary: row.summary,
  actor: row.actor,
  createdAt: row.created_at
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
    seo_title TEXT NOT NULL DEFAULT '',
    seo_description TEXT NOT NULL DEFAULT '',
    og_image_url TEXT NOT NULL DEFAULT '',
    categories TEXT[] NOT NULL DEFAULT '{}',
    tags TEXT[] NOT NULL DEFAULT '{}',
    published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const logsTableSql = `
  CREATE TABLE IF NOT EXISTS admin_activity_logs (
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

const normalizeList = (value) => {
  if (Array.isArray(value)) {
    return [...new Set(value.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 12))];
  }
  return String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x, i, arr) => arr.indexOf(x) === i)
    .slice(0, 12);
};

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
  await pool.query(logsTableSql);
  await pool.query("ALTER TABLE articles ADD COLUMN IF NOT EXISTS seo_title TEXT NOT NULL DEFAULT '';");
  await pool.query("ALTER TABLE articles ADD COLUMN IF NOT EXISTS seo_description TEXT NOT NULL DEFAULT '';");
  await pool.query("ALTER TABLE articles ADD COLUMN IF NOT EXISTS og_image_url TEXT NOT NULL DEFAULT '';");
  await pool.query("ALTER TABLE articles ADD COLUMN IF NOT EXISTS categories TEXT[] NOT NULL DEFAULT '{}';");
  await pool.query("ALTER TABLE articles ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_articles_published_updated ON articles(published, updated_at DESC);');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_articles_categories ON articles USING GIN(categories);');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_articles_tags ON articles USING GIN(tags);');
  await pool.query("CREATE INDEX IF NOT EXISTS idx_articles_search ON articles USING GIN (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(excerpt,'') || ' ' || coalesce(content,'')));");
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

const isSlugAvailable = async (slug, excludeId = null) => {
  const target = slugify(slug);
  if (!target) return false;

  if (!pool) {
    return !inMemoryArticles.some((a) => a.slug === target && a.id !== excludeId);
  }

  const query = excludeId
    ? await pool.query('SELECT id FROM articles WHERE slug = $1 AND id <> $2 LIMIT 1;', [target, excludeId])
    : await pool.query('SELECT id FROM articles WHERE slug = $1 LIMIT 1;', [target]);
  return query.rowCount === 0;
};

const listArticles = async (options = {}) => {
  const page = Math.max(1, Number(options.page || 1));
  const pageSize = Math.min(50, Math.max(1, Number(options.pageSize || 9)));
  const q = String(options.q || '').trim();
  const category = String(options.category || '').trim();
  const tag = String(options.tag || '').trim();
  const publishedOnly = Boolean(options.publishedOnly);

  if (!pool) {
    let items = [...inMemoryArticles];
    if (publishedOnly) items = items.filter((a) => a.published);
    if (category) items = items.filter((a) => (a.categories || []).includes(category));
    if (tag) items = items.filter((a) => (a.tags || []).includes(tag));
    if (q) {
      const needle = q.toLowerCase();
      items = items.filter((a) => `${a.title} ${a.excerpt} ${a.content}`.toLowerCase().includes(needle));
    }

    items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const total = items.length;
    const offset = (page - 1) * pageSize;
    return {
      items: items.slice(offset, offset + pageSize),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
    };
  }

  const where = [];
  const values = [];
  if (publishedOnly) {
    values.push(true);
    where.push(`published = $${values.length}`);
  }
  if (category) {
    values.push(category);
    where.push(`$${values.length} = ANY(categories)`);
  }
  if (tag) {
    values.push(tag);
    where.push(`$${values.length} = ANY(tags)`);
  }
  if (q) {
    values.push(q);
    const idx = values.length;
    where.push(`to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(excerpt,'') || ' ' || coalesce(content,'')) @@ plainto_tsquery('simple', $${idx})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const totalRes = await pool.query(`SELECT COUNT(*)::int AS total FROM articles ${whereSql};`, values);
  const total = totalRes.rows[0].total;

  values.push(pageSize);
  values.push((page - 1) * pageSize);
  const rows = await pool.query(
    `SELECT * FROM articles ${whereSql} ORDER BY updated_at DESC LIMIT $${values.length - 1} OFFSET $${values.length};`,
    values
  );

  return {
    items: rows.rows.map(mapArticleRow),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
  };
};

const getTaxonomies = async () => {
  if (!pool) {
    const categories = [...new Set(inMemoryArticles.flatMap((a) => a.categories || []))].sort();
    const tags = [...new Set(inMemoryArticles.flatMap((a) => a.tags || []))].sort();
    return { categories, tags };
  }

  const result = await pool.query(`
    SELECT
      ARRAY(SELECT DISTINCT unnest(categories) ORDER BY 1) AS categories,
      ARRAY(SELECT DISTINCT unnest(tags) ORDER BY 1) AS tags
    FROM articles;
  `);

  const row = result.rows[0] || {};
  return { categories: row.categories || [], tags: row.tags || [] };
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
  const categories = normalizeList(input.categories);
  const tags = normalizeList(input.tags);

  if (!pool) {
    const article = {
      id: inMemoryArticleId,
      title: input.title,
      slug,
      excerpt: input.excerpt,
      content: input.content,
      coverImageUrl: input.coverImageUrl,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      ogImageUrl: input.ogImageUrl,
      categories,
      tags,
      published: input.published,
      createdAt: now,
      updatedAt: now
    };

    inMemoryArticleId += 1;
    inMemoryArticles.unshift(article);
    return article;
  }

  const result = await pool.query(
    `INSERT INTO articles (title, slug, excerpt, content, cover_image_url, seo_title, seo_description, og_image_url, categories, tags, published, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()) RETURNING *;`,
    [
      input.title,
      slug,
      input.excerpt,
      input.content,
      input.coverImageUrl,
      input.seoTitle,
      input.seoDescription,
      input.ogImageUrl,
      categories,
      tags,
      input.published
    ]
  );

  return mapArticleRow(result.rows[0]);
};

const updateArticle = async (id, input) => {
  const slug = await ensureUniqueSlug(input.slug || input.title, id);
  const categories = normalizeList(input.categories);
  const tags = normalizeList(input.tags);

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
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      ogImageUrl: input.ogImageUrl,
      categories,
      tags,
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
         seo_title = $6,
         seo_description = $7,
         og_image_url = $8,
         categories = $9,
         tags = $10,
         published = $11,
         updated_at = NOW()
     WHERE id = $12
     RETURNING *;`,
    [
      input.title,
      slug,
      input.excerpt,
      input.content,
      input.coverImageUrl,
      input.seoTitle,
      input.seoDescription,
      input.ogImageUrl,
      categories,
      tags,
      input.published,
      id
    ]
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

const getMediaUsage = async (mediaId) => {
  const safeMediaId = String(mediaId || '').trim();
  if (!safeMediaId) return [];
  const marker = `/uploads/${safeMediaId}`;

  const mapUsage = (article) => {
    const places = [];
    const cover = String(article.coverImageUrl || '');
    const og = String(article.ogImageUrl || '');
    const content = String(article.content || '');
    if (cover.includes(marker)) places.push('cover');
    if (og.includes(marker)) places.push('ogImage');
    if (content.includes(marker)) places.push('content');
    return places.length
      ? { id: article.id, title: article.title, slug: article.slug, places }
      : null;
  };

  if (!pool) {
    return inMemoryArticles.map(mapUsage).filter(Boolean);
  }

  const query = await pool.query(
    `SELECT * FROM articles
     WHERE cover_image_url LIKE $1
        OR og_image_url LIKE $1
        OR content LIKE $1
     ORDER BY updated_at DESC;`,
    [`%${marker}%`]
  );

  return query.rows.map(mapArticleRow).map(mapUsage).filter(Boolean);
};

const logAdminAction = async (input) => {
  const entry = {
    action: String(input.action || ''),
    entityType: String(input.entityType || ''),
    entityId: String(input.entityId || ''),
    summary: String(input.summary || ''),
    actor: String(input.actor || ''),
    createdAt: new Date().toISOString()
  };

  if (!pool) {
    inMemoryLogs.unshift({ id: inMemoryLogs.length + 1, ...entry });
    return;
  }

  await pool.query(
    `INSERT INTO admin_activity_logs (action, entity_type, entity_id, summary, actor)
     VALUES ($1, $2, $3, $4, $5);`,
    [entry.action, entry.entityType, entry.entityId, entry.summary, entry.actor]
  );
};

const listAdminActivity = async (limit = 20) => {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 20)));
  if (!pool) {
    return inMemoryLogs.slice(0, safeLimit);
  }

  const result = await pool.query(
    'SELECT * FROM admin_activity_logs ORDER BY created_at DESC LIMIT $1;',
    [safeLimit]
  );
  return result.rows.map(mapLogRow);
};

module.exports = {
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
  getMediaUsage,
  isSlugAvailable,
  logAdminAction,
  listAdminActivity,
  slugify
};
