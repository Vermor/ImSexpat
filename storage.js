const { Pool } = require('pg');

const DEFAULT_LANDING_CONTENT = {
  siteName: 'Vermor Club',
  pageTitle: 'Vermor Club | Articles et chroniques',
  metaDescription: 'Vermor Club: articles, chroniques et ressources.',
  heroTitle: 'Vermor Club',
  heroSubtitle: 'Articles, chroniques et ressources en cours de construction.',
  ctaText: 'Voir les themes',
  ctaHref: '/articles',
  card1Title: 'Installation expat',
  card1Text: 'Checklist arrivee, visa, assurance, banque et appart a Bangkok ou Chiang Mai.',
  card2Title: 'Vie quotidienne',
  card2Text: 'Transports, sante, courses, quartiers et habitudes culturelles a connaitre.',
  card3Title: 'Week-ends & iles',
  card3Text: 'Itineraires realistes depuis les grandes villes vers les meilleures escapades.',
  footerText: 'Vermor Club',
  rubrics: []
};

let pool = null;
let inMemoryContent = { ...DEFAULT_LANDING_CONTENT };
let inMemoryArticles = [];
let inMemoryArticleId = 1;
let inMemoryLogs = [];
let inMemoryOpinionOptions = [];
let inMemoryOpinionOptionId = 1;
let inMemoryOpinionVotes = [];
let inMemoryOpinionVoteId = 1;
let inMemoryOpinionLikes = [];
let inMemoryOpinionLikeId = 1;

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
  footerText: row.footer_text,
  rubrics: (() => {
    try {
      const parsed = JSON.parse(String(row.rubrics_json || '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  })()
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
  featured: Boolean(row.featured),
  opinionEnabled: Boolean(row.opinion_enabled),
  opinionQuestion: row.opinion_question || '',
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
    rubrics_json TEXT NOT NULL DEFAULT '[]',
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
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    opinion_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    opinion_question TEXT NOT NULL DEFAULT '',
    published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const opinionOptionsTableSql = `
  CREATE TABLE IF NOT EXISTS article_opinion_options (
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_by_user BOOLEAN NOT NULL DEFAULT FALSE,
    creator_key TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const opinionVotesTableSql = `
  CREATE TABLE IF NOT EXISTS article_opinion_votes (
    id SERIAL PRIMARY KEY,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    option_id INTEGER NOT NULL REFERENCES article_opinion_options(id) ON DELETE CASCADE,
    voter_key TEXT NOT NULL,
    explanation TEXT NOT NULL DEFAULT '',
    choice_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (article_id, voter_key)
  );
`;

const opinionLikesTableSql = `
  CREATE TABLE IF NOT EXISTS article_opinion_likes (
    id SERIAL PRIMARY KEY,
    option_id INTEGER NOT NULL REFERENCES article_opinion_options(id) ON DELETE CASCADE,
    voter_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (option_id, voter_key)
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
    rubrics_json,
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
    $15,
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
    rubrics_json = EXCLUDED.rubrics_json,
    updated_at = NOW();
`;

const insertLandingIfMissingSql = `
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
    rubrics_json,
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
    $15,
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
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
  content.footerText,
  JSON.stringify(Array.isArray(content.rubrics) ? content.rubrics : [])
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

const normalizeOpinionOptions = (value) => {
  if (Array.isArray(value)) {
    return [...new Set(value
      .map((x) => String(x || '').trim().slice(0, 60))
      .filter(Boolean))]
      .slice(0, 12);
  }
  return String(value || '')
    .split(/\r?\n/)
    .map((x) => x.trim().slice(0, 60))
    .filter(Boolean)
    .filter((x, i, arr) => arr.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i)
    .slice(0, 12);
};

const OPINION_CHANGE_COOLDOWN_MS = 10 * 60 * 1000;

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
  await pool.query(opinionOptionsTableSql);
  await pool.query(opinionVotesTableSql);
  await pool.query(opinionLikesTableSql);
  await pool.query("ALTER TABLE landing_content ADD COLUMN IF NOT EXISTS rubrics_json TEXT NOT NULL DEFAULT '[]';");
  await pool.query("ALTER TABLE articles ADD COLUMN IF NOT EXISTS seo_title TEXT NOT NULL DEFAULT '';");
  await pool.query("ALTER TABLE articles ADD COLUMN IF NOT EXISTS seo_description TEXT NOT NULL DEFAULT '';");
  await pool.query("ALTER TABLE articles ADD COLUMN IF NOT EXISTS og_image_url TEXT NOT NULL DEFAULT '';");
  await pool.query("ALTER TABLE articles ADD COLUMN IF NOT EXISTS categories TEXT[] NOT NULL DEFAULT '{}';");
  await pool.query("ALTER TABLE articles ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';");
  await pool.query("ALTER TABLE articles ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE;");
  await pool.query("ALTER TABLE articles ADD COLUMN IF NOT EXISTS opinion_enabled BOOLEAN NOT NULL DEFAULT FALSE;");
  await pool.query("ALTER TABLE articles ADD COLUMN IF NOT EXISTS opinion_question TEXT NOT NULL DEFAULT '';");
  await pool.query("ALTER TABLE article_opinion_votes ADD COLUMN IF NOT EXISTS explanation TEXT NOT NULL DEFAULT '';");
  await pool.query("ALTER TABLE article_opinion_votes ADD COLUMN IF NOT EXISTS choice_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_articles_published_updated ON articles(published, updated_at DESC);');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_articles_categories ON articles USING GIN(categories);');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_articles_tags ON articles USING GIN(tags);');
  await pool.query("CREATE INDEX IF NOT EXISTS idx_articles_search ON articles USING GIN (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(excerpt,'') || ' ' || coalesce(content,'')));");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_opinion_options_article ON article_opinion_options(article_id, created_at DESC);');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_opinion_votes_article ON article_opinion_votes(article_id);');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_opinion_likes_option ON article_opinion_likes(option_id);');
  await pool.query(insertLandingIfMissingSql, landingValues(DEFAULT_LANDING_CONTENT));
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
  const base = pool ? await getLandingContent() : inMemoryContent;
  const merged = { ...DEFAULT_LANDING_CONTENT, ...(base || {}), ...(content || {}) };

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
  const categories = normalizeList(options.categories).slice(0, 12);
  const categoryNeedle = category.toLowerCase();
  const categoryNeedles = categories.map((x) => x.toLowerCase());
  const tag = String(options.tag || '').trim();
  const featuredOnly = Boolean(options.featuredOnly);
  const publishedOnly = Boolean(options.publishedOnly);

  if (!pool) {
    let items = [...inMemoryArticles];
    if (publishedOnly) items = items.filter((a) => a.published);
    if (featuredOnly) items = items.filter((a) => a.featured);
    if (categoryNeedles.length) {
      items = items.filter((a) => (a.categories || []).some((c) => categoryNeedles.includes(String(c || '').toLowerCase())));
    } else if (categoryNeedle) {
      items = items.filter((a) => (a.categories || []).some((c) => String(c || '').toLowerCase() === categoryNeedle));
    }
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
  if (featuredOnly) {
    values.push(true);
    where.push(`featured = $${values.length}`);
  }
  if (categoryNeedles.length) {
    values.push(categoryNeedles);
    where.push(`EXISTS (SELECT 1 FROM unnest(categories) AS c WHERE lower(c) = ANY($${values.length}::text[]))`);
  } else if (categoryNeedle) {
    values.push(categoryNeedle);
    where.push(`EXISTS (SELECT 1 FROM unnest(categories) AS c WHERE lower(c) = $${values.length})`);
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
      ARRAY(
        SELECT DISTINCT c
        FROM (
          SELECT unnest(categories) AS c
          FROM articles
        ) AS cats
        WHERE c IS NOT NULL AND c <> ''
        ORDER BY 1
      ) AS categories,
      ARRAY(
        SELECT DISTINCT t
        FROM (
          SELECT unnest(tags) AS t
          FROM articles
        ) AS tags_list
        WHERE t IS NOT NULL AND t <> ''
        ORDER BY 1
      ) AS tags;
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

const syncOpinionPresetOptions = async (articleId, options = []) => {
  const safeOptions = normalizeOpinionOptions(options);

  if (!pool) {
    inMemoryOpinionOptions = inMemoryOpinionOptions.filter((x) => !(x.articleId === articleId && !x.createdByUser));
    safeOptions.forEach((label) => {
      inMemoryOpinionOptions.push({
        id: inMemoryOpinionOptionId,
        articleId,
        label,
        description: '',
        createdByUser: false,
        creatorKey: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      inMemoryOpinionOptionId += 1;
    });
    return safeOptions;
  }

  await pool.query('DELETE FROM article_opinion_options WHERE article_id = $1 AND created_by_user = false;', [articleId]);
  for (const label of safeOptions) {
    await pool.query(
      `INSERT INTO article_opinion_options (article_id, label, description, created_by_user, creator_key, updated_at)
       VALUES ($1, $2, '', false, '', NOW());`,
      [articleId, label]
    );
  }
  return safeOptions;
};

const getArticleOpinionPresetOptions = async (articleId) => {
  if (!pool) {
    return inMemoryOpinionOptions
      .filter((x) => x.articleId === articleId && !x.createdByUser)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((x) => x.label);
  }

  const result = await pool.query(
    `SELECT label FROM article_opinion_options
     WHERE article_id = $1 AND created_by_user = false
     ORDER BY created_at ASC;`,
    [articleId]
  );
  return result.rows.map((x) => String(x.label || ''));
};

const getArticleOpinion = async (articleId, voterKey = '') => {
  if (!pool) {
    const article = inMemoryArticles.find((x) => x.id === articleId) || null;
    if (!article) return null;
    const options = inMemoryOpinionOptions
      .filter((x) => x.articleId === articleId)
      .sort((a, b) => Number(a.createdByUser) - Number(b.createdByUser) || new Date(a.createdAt) - new Date(b.createdAt))
      .map((opt) => {
        const votes = inMemoryOpinionVotes.filter((v) => v.optionId === opt.id).length;
        const likes = inMemoryOpinionLikes.filter((l) => l.optionId === opt.id).length;
        return {
          id: opt.id,
          label: opt.label,
          description: opt.description,
          createdByUser: opt.createdByUser,
          isMine: Boolean(voterKey && opt.creatorKey && opt.creatorKey === voterKey),
          votes,
          likes
        };
      });

    const userVote = voterKey
      ? (inMemoryOpinionVotes.find((v) => v.articleId === articleId && v.voterKey === voterKey) || null)
      : null;
    const likedOptionIds = voterKey
      ? inMemoryOpinionLikes
        .filter((x) => x.voterKey === voterKey && options.some((o) => o.id === x.optionId))
        .map((x) => x.optionId)
      : [];

    const userCustomOption = options.find((x) => x.createdByUser && x.isMine) || null;

    return {
      enabled: Boolean(article.opinionEnabled),
      question: String(article.opinionQuestion || ''),
      totalVotes: options.reduce((acc, x) => acc + x.votes, 0),
      userVoteOptionId: userVote ? userVote.optionId : null,
      userExplanation: userVote ? String(userVote.explanation || '') : '',
      userCustomOptionId: userCustomOption ? userCustomOption.id : null,
      likedOptionIds,
      explanations: inMemoryOpinionVotes
        .filter((x) => x.articleId === articleId && String(x.explanation || '').trim())
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 50)
        .map((v) => {
          const opt = inMemoryOpinionOptions.find((o) => o.id === v.optionId);
          return {
            optionId: v.optionId,
            optionLabel: opt ? opt.label : '',
            explanation: String(v.explanation || ''),
            updatedAt: v.updatedAt
          };
        }),
      options
    };
  }

  const articleRes = await pool.query(
    'SELECT opinion_enabled, opinion_question FROM articles WHERE id = $1 LIMIT 1;',
    [articleId]
  );
  if (articleRes.rowCount === 0) return null;
  const article = articleRes.rows[0];

  const optionsRes = await pool.query(
    `SELECT id, label, description, created_by_user, creator_key, created_at
     FROM article_opinion_options
     WHERE article_id = $1
     ORDER BY created_by_user ASC, created_at ASC;`,
    [articleId]
  );

  const voteCountsRes = await pool.query(
    `SELECT option_id, COUNT(*)::int AS count
     FROM article_opinion_votes
     WHERE article_id = $1
     GROUP BY option_id;`,
    [articleId]
  );
  const likeCountsRes = await pool.query(
    `SELECT l.option_id, COUNT(*)::int AS count
     FROM article_opinion_likes l
     INNER JOIN article_opinion_options o ON o.id = l.option_id
     WHERE o.article_id = $1
     GROUP BY l.option_id;`,
    [articleId]
  );

  const voteCountMap = new Map(voteCountsRes.rows.map((x) => [Number(x.option_id), Number(x.count)]));
  const likeCountMap = new Map(likeCountsRes.rows.map((x) => [Number(x.option_id), Number(x.count)]));
  const options = optionsRes.rows.map((x) => ({
    id: x.id,
    label: x.label,
    description: x.description || '',
    createdByUser: Boolean(x.created_by_user),
    isMine: Boolean(voterKey && x.creator_key && String(x.creator_key) === String(voterKey)),
    votes: voteCountMap.get(Number(x.id)) || 0,
    likes: likeCountMap.get(Number(x.id)) || 0
  }));
  const userCustomOption = options.find((x) => x.createdByUser && x.isMine) || null;

  let userVoteOptionId = null;
  let userExplanation = '';
  let likedOptionIds = [];
  if (voterKey) {
    const voteRes = await pool.query(
      'SELECT option_id, explanation FROM article_opinion_votes WHERE article_id = $1 AND voter_key = $2 LIMIT 1;',
      [articleId, voterKey]
    );
    userVoteOptionId = voteRes.rowCount ? Number(voteRes.rows[0].option_id) : null;
    userExplanation = voteRes.rowCount ? String(voteRes.rows[0].explanation || '') : '';

    const likeRes = await pool.query(
      `SELECT l.option_id
       FROM article_opinion_likes l
       INNER JOIN article_opinion_options o ON o.id = l.option_id
       WHERE o.article_id = $1 AND l.voter_key = $2;`,
      [articleId, voterKey]
    );
    likedOptionIds = likeRes.rows.map((x) => Number(x.option_id));
  }

  const explanationsRes = await pool.query(
    `SELECT v.option_id, v.explanation, v.updated_at, o.label AS option_label
     FROM article_opinion_votes v
     INNER JOIN article_opinion_options o ON o.id = v.option_id
     WHERE v.article_id = $1 AND trim(v.explanation) <> ''
     ORDER BY v.updated_at DESC
     LIMIT 50;`,
    [articleId]
  );

  return {
    enabled: Boolean(article.opinion_enabled),
    question: String(article.opinion_question || ''),
    totalVotes: options.reduce((acc, x) => acc + x.votes, 0),
    userVoteOptionId,
    userExplanation,
    userCustomOptionId: userCustomOption ? userCustomOption.id : null,
    likedOptionIds,
    explanations: explanationsRes.rows.map((x) => ({
      optionId: Number(x.option_id),
      optionLabel: String(x.option_label || ''),
      explanation: String(x.explanation || ''),
      updatedAt: x.updated_at
    })),
    options
  };
};

const submitArticleOpinionVote = async (articleId, voterKey, input = {}) => {
  const safeVoterKey = String(voterKey || '').trim();
  if (!safeVoterKey) throw new Error('Missing voter key');

  const optionId = Number(input.optionId || 0) || null;
  const customLabel = String(input.customLabel || '').trim().slice(0, 60);
  const customDescription = String(input.customDescription || '').trim().slice(0, 500);
  const hasExplanation = Object.prototype.hasOwnProperty.call(input, 'explanation');
  const explanation = String(input.explanation || '').trim().slice(0, 500);
  const hasCustom = Boolean(customLabel);

  if (!hasCustom && !optionId) {
    throw new Error('Option is required');
  }

  if (!pool) {
    const article = inMemoryArticles.find((x) => x.id === articleId) || null;
    if (!article || !article.opinionEnabled) throw new Error('Opinion feature disabled');
    const existingVote = inMemoryOpinionVotes.find((v) => v.articleId === articleId && v.voterKey === safeVoterKey) || null;

    const checkCooldown = (nextOptionId) => {
      if (!existingVote) return;
      const optionChanged = Number(existingVote.optionId) !== Number(nextOptionId);
      if (!optionChanged) return;
      const lastChoiceTs = new Date(existingVote.choiceUpdatedAt || existingVote.updatedAt || existingVote.createdAt || Date.now()).getTime();
      const waitMs = Math.max(0, OPINION_CHANGE_COOLDOWN_MS - (Date.now() - lastChoiceTs));
      if (waitMs > 0) {
        const error = new Error('Vote change cooldown');
        error.code = 'VOTE_CHANGE_COOLDOWN';
        error.waitMs = waitMs;
        throw error;
      }
    };

    let targetOptionId = optionId;
    if (hasCustom) {
      const existingByLabel = inMemoryOpinionOptions.find((x) => x.articleId === articleId && x.label.toLowerCase() === customLabel.toLowerCase());
      if (existingByLabel) {
        checkCooldown(existingByLabel.id);
        targetOptionId = existingByLabel.id;
      } else {
        const existingMine = inMemoryOpinionOptions.find((x) => x.articleId === articleId && x.createdByUser && x.creatorKey === safeVoterKey);
        if (existingMine) {
          throw new Error('Custom option already exists for this voter');
        } else {
          // Creating a new option always implies switching to this option.
          // Enforce cooldown before creating to avoid orphan options.
          if (existingVote) {
            checkCooldown(Number.MAX_SAFE_INTEGER);
          }
          targetOptionId = inMemoryOpinionOptionId;
          inMemoryOpinionOptions.push({
            id: inMemoryOpinionOptionId,
            articleId,
            label: customLabel,
            description: customDescription,
            createdByUser: true,
            creatorKey: safeVoterKey,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          inMemoryOpinionOptionId += 1;
        }
      }
    }

    const found = inMemoryOpinionOptions.find((x) => x.id === targetOptionId && x.articleId === articleId);
    if (!found) throw new Error('Invalid option');
    if (existingVote) {
      const optionChanged = Number(existingVote.optionId) !== Number(found.id);
      checkCooldown(found.id);
      existingVote.optionId = found.id;
      if (hasExplanation) {
        existingVote.explanation = explanation;
      } else if (optionChanged) {
        existingVote.explanation = '';
      }
      if (optionChanged) {
        existingVote.choiceUpdatedAt = new Date().toISOString();
      }
      existingVote.updatedAt = new Date().toISOString();
    } else {
      inMemoryOpinionVotes.push({
        id: inMemoryOpinionVoteId,
        articleId,
        optionId: found.id,
        voterKey: safeVoterKey,
        explanation: hasExplanation ? explanation : '',
        choiceUpdatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      inMemoryOpinionVoteId += 1;
    }

    return getArticleOpinion(articleId, safeVoterKey);
  }

  const articleRes = await pool.query('SELECT id, opinion_enabled FROM articles WHERE id = $1 LIMIT 1;', [articleId]);
  if (articleRes.rowCount === 0) throw new Error('Article not found');
  if (!articleRes.rows[0].opinion_enabled) throw new Error('Opinion feature disabled');

  const existingVoteRes = await pool.query(
    'SELECT option_id, choice_updated_at, updated_at, created_at FROM article_opinion_votes WHERE article_id = $1 AND voter_key = $2 LIMIT 1;',
    [articleId, safeVoterKey]
  );
  const existingVote = existingVoteRes.rowCount ? existingVoteRes.rows[0] : null;
  const checkCooldownDb = (nextOptionId) => {
    if (!existingVote) return;
    const optionChanged = Number(existingVote.option_id) !== Number(nextOptionId);
    if (!optionChanged) return;
    const lastChoiceTs = new Date(existingVote.choice_updated_at || existingVote.updated_at || existingVote.created_at || Date.now()).getTime();
    const waitMs = Math.max(0, OPINION_CHANGE_COOLDOWN_MS - (Date.now() - lastChoiceTs));
    if (waitMs > 0) {
      const error = new Error('Vote change cooldown');
      error.code = 'VOTE_CHANGE_COOLDOWN';
      error.waitMs = waitMs;
      throw error;
    }
  };

  let targetOptionId = optionId;
  if (hasCustom) {
    const byLabelRes = await pool.query(
      'SELECT id FROM article_opinion_options WHERE article_id = $1 AND lower(label) = lower($2) LIMIT 1;',
      [articleId, customLabel]
    );
    if (byLabelRes.rowCount) {
      checkCooldownDb(Number(byLabelRes.rows[0].id));
      targetOptionId = Number(byLabelRes.rows[0].id);
    } else {
      const mineRes = await pool.query(
        `SELECT id FROM article_opinion_options
         WHERE article_id = $1 AND created_by_user = true AND creator_key = $2
         LIMIT 1;`,
        [articleId, safeVoterKey]
      );
      if (mineRes.rowCount) {
        throw new Error('Custom option already exists for this voter');
      } else {
        // Creating a new option always implies switching vote to it.
        // Enforce cooldown before insert to avoid creating orphan options.
        if (existingVote) {
          checkCooldownDb(Number.MAX_SAFE_INTEGER);
        }
        const createdRes = await pool.query(
          `INSERT INTO article_opinion_options (article_id, label, description, created_by_user, creator_key, updated_at)
           VALUES ($1, $2, $3, true, $4, NOW())
           RETURNING id;`,
          [articleId, customLabel, customDescription, safeVoterKey]
        );
        targetOptionId = Number(createdRes.rows[0].id);
      }
    }
  }

  const optionCheck = await pool.query(
    'SELECT id FROM article_opinion_options WHERE id = $1 AND article_id = $2 LIMIT 1;',
    [targetOptionId, articleId]
  );
  if (optionCheck.rowCount === 0) throw new Error('Invalid option');
  checkCooldownDb(targetOptionId);

  if (hasExplanation) {
    await pool.query(
      `INSERT INTO article_opinion_votes (article_id, option_id, voter_key, explanation, choice_updated_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (article_id, voter_key)
       DO UPDATE SET
         option_id = EXCLUDED.option_id,
         explanation = EXCLUDED.explanation,
         choice_updated_at = CASE
           WHEN article_opinion_votes.option_id <> EXCLUDED.option_id THEN NOW()
           ELSE article_opinion_votes.choice_updated_at
         END,
         updated_at = NOW();`,
      [articleId, targetOptionId, safeVoterKey, explanation]
    );
  } else {
    await pool.query(
      `INSERT INTO article_opinion_votes (article_id, option_id, voter_key, choice_updated_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (article_id, voter_key)
       DO UPDATE SET
         option_id = EXCLUDED.option_id,
         explanation = CASE
           WHEN article_opinion_votes.option_id <> EXCLUDED.option_id THEN ''
           ELSE article_opinion_votes.explanation
         END,
         choice_updated_at = CASE
           WHEN article_opinion_votes.option_id <> EXCLUDED.option_id THEN NOW()
           ELSE article_opinion_votes.choice_updated_at
         END,
         updated_at = NOW();`,
      [articleId, targetOptionId, safeVoterKey]
    );
  }

  return getArticleOpinion(articleId, safeVoterKey);
};

const toggleArticleOpinionLike = async (articleId, optionId, voterKey) => {
  const safeVoterKey = String(voterKey || '').trim();
  const safeOptionId = Number(optionId || 0);
  if (!safeVoterKey || !safeOptionId) throw new Error('Invalid like request');

  if (!pool) {
    const option = inMemoryOpinionOptions.find((x) => x.id === safeOptionId && x.articleId === articleId);
    if (!option) throw new Error('Invalid option');
    const idx = inMemoryOpinionLikes.findIndex((x) => x.optionId === safeOptionId && x.voterKey === safeVoterKey);
    let liked = false;
    if (idx >= 0) {
      inMemoryOpinionLikes.splice(idx, 1);
    } else {
      inMemoryOpinionLikes.push({
        id: inMemoryOpinionLikeId,
        optionId: safeOptionId,
        voterKey: safeVoterKey,
        createdAt: new Date().toISOString()
      });
      inMemoryOpinionLikeId += 1;
      liked = true;
    }
    const snapshot = await getArticleOpinion(articleId, safeVoterKey);
    return { liked, snapshot };
  }

  const optionRes = await pool.query(
    'SELECT id FROM article_opinion_options WHERE id = $1 AND article_id = $2 LIMIT 1;',
    [safeOptionId, articleId]
  );
  if (optionRes.rowCount === 0) throw new Error('Invalid option');

  const existing = await pool.query(
    'SELECT id FROM article_opinion_likes WHERE option_id = $1 AND voter_key = $2 LIMIT 1;',
    [safeOptionId, safeVoterKey]
  );
  let liked = false;
  if (existing.rowCount) {
    await pool.query('DELETE FROM article_opinion_likes WHERE id = $1;', [existing.rows[0].id]);
  } else {
    await pool.query(
      'INSERT INTO article_opinion_likes (option_id, voter_key) VALUES ($1, $2);',
      [safeOptionId, safeVoterKey]
    );
    liked = true;
  }

  const snapshot = await getArticleOpinion(articleId, safeVoterKey);
  return { liked, snapshot };
};

const listArticleOpinionOptionsAdmin = async (articleId) => {
  const safeArticleId = Number(articleId || 0);
  if (!safeArticleId) return [];

  if (!pool) {
    return inMemoryOpinionOptions
      .filter((x) => x.articleId === safeArticleId)
      .map((opt) => ({
        id: opt.id,
        label: opt.label,
        description: opt.description || '',
        createdByUser: Boolean(opt.createdByUser),
        votes: inMemoryOpinionVotes.filter((v) => v.optionId === opt.id).length,
        createdAt: opt.createdAt
      }))
      .sort((a, b) => Number(a.createdByUser) - Number(b.createdByUser) || new Date(a.createdAt) - new Date(b.createdAt));
  }

  const result = await pool.query(
    `SELECT
        o.id,
        o.label,
        o.description,
        o.created_by_user,
        o.created_at,
        COUNT(v.id)::int AS votes
      FROM article_opinion_options o
      LEFT JOIN article_opinion_votes v ON v.option_id = o.id
      WHERE o.article_id = $1
      GROUP BY o.id
      ORDER BY o.created_by_user ASC, o.created_at ASC;`,
    [safeArticleId]
  );

  return result.rows.map((x) => ({
    id: Number(x.id),
    label: String(x.label || ''),
    description: String(x.description || ''),
    createdByUser: Boolean(x.created_by_user),
    votes: Number(x.votes || 0),
    createdAt: x.created_at
  }));
};

const deleteArticleOpinionOptionAdmin = async (articleId, optionId) => {
  const safeArticleId = Number(articleId || 0);
  const safeOptionId = Number(optionId || 0);
  if (!safeArticleId || !safeOptionId) return false;

  if (!pool) {
    const option = inMemoryOpinionOptions.find((x) => x.id === safeOptionId && x.articleId === safeArticleId);
    if (!option) return false;
    inMemoryOpinionOptions = inMemoryOpinionOptions.filter((x) => x.id !== safeOptionId);
    inMemoryOpinionVotes = inMemoryOpinionVotes.filter((x) => x.optionId !== safeOptionId);
    inMemoryOpinionLikes = inMemoryOpinionLikes.filter((x) => x.optionId !== safeOptionId);
    return true;
  }

  const check = await pool.query(
    'SELECT id FROM article_opinion_options WHERE id = $1 AND article_id = $2 LIMIT 1;',
    [safeOptionId, safeArticleId]
  );
  if (check.rowCount === 0) return false;

  // Votes/explications/likes tied to this option are removed by FK cascade.
  const deleted = await pool.query('DELETE FROM article_opinion_options WHERE id = $1;', [safeOptionId]);
  return deleted.rowCount > 0;
};

const createArticle = async (input) => {
  const now = new Date().toISOString();
  const slug = await ensureUniqueSlug(input.slug || input.title);
  const categories = normalizeList(input.categories);
  const tags = normalizeList(input.tags);
  const opinionOptions = normalizeOpinionOptions(input.opinionOptions);

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
      featured: input.featured,
      opinionEnabled: Boolean(input.opinionEnabled),
      opinionQuestion: String(input.opinionQuestion || ''),
      published: input.published,
      createdAt: now,
      updatedAt: now
    };

    inMemoryArticleId += 1;
    inMemoryArticles.unshift(article);
    await syncOpinionPresetOptions(article.id, opinionOptions);
    return article;
  }

  const result = await pool.query(
    `INSERT INTO articles (title, slug, excerpt, content, cover_image_url, seo_title, seo_description, og_image_url, categories, tags, featured, opinion_enabled, opinion_question, published, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()) RETURNING *;`,
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
      input.featured,
      Boolean(input.opinionEnabled),
      String(input.opinionQuestion || ''),
      input.published
    ]
  );
  const article = mapArticleRow(result.rows[0]);
  await syncOpinionPresetOptions(article.id, opinionOptions);
  return article;
};

const updateArticle = async (id, input) => {
  const slug = await ensureUniqueSlug(input.slug || input.title, id);
  const categories = normalizeList(input.categories);
  const tags = normalizeList(input.tags);
  const opinionOptions = normalizeOpinionOptions(input.opinionOptions);

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
      featured: input.featured,
      opinionEnabled: Boolean(input.opinionEnabled),
      opinionQuestion: String(input.opinionQuestion || ''),
      published: input.published,
      updatedAt: new Date().toISOString()
    };

    inMemoryArticles[idx] = updated;
    await syncOpinionPresetOptions(id, opinionOptions);
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
         featured = $11,
         opinion_enabled = $12,
         opinion_question = $13,
         published = $14,
         updated_at = NOW()
     WHERE id = $15
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
      input.featured,
      Boolean(input.opinionEnabled),
      String(input.opinionQuestion || ''),
      input.published,
      id
    ]
  );

  if (result.rowCount === 0) return null;
  const article = mapArticleRow(result.rows[0]);
  await syncOpinionPresetOptions(id, opinionOptions);
  return article;
};

const deleteArticle = async (id) => {
  if (!pool) {
    const before = inMemoryArticles.length;
    inMemoryArticles = inMemoryArticles.filter((a) => a.id !== id);
    inMemoryOpinionOptions = inMemoryOpinionOptions.filter((x) => x.articleId !== id);
    inMemoryOpinionVotes = inMemoryOpinionVotes.filter((x) => x.articleId !== id);
    const validOptionIds = new Set(inMemoryOpinionOptions.map((x) => x.id));
    inMemoryOpinionLikes = inMemoryOpinionLikes.filter((x) => validOptionIds.has(x.optionId));
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
  getArticleOpinionPresetOptions,
  getArticleOpinion,
  submitArticleOpinionVote,
  toggleArticleOpinionLike,
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
};
