const { Pool } = require('pg');

const DEFAULT_LANDING_CONTENT = {
  siteName: 'ImSexpat',
  pageTitle: "ImSexpat | Journal d'un sexpat",
  metaDescription: "recit, informations, news sur la vie d'un sexpat",
  heroTitle: "Journal d'un sexpat",
  heroSubtitle: "recit, informations, news sur la vie d'un sexpat",
  ctaText: 'Voir les themes',
  ctaHref: '#articles',
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

const createPool = () => {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  const isLocal = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');

  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocal ? false : { rejectUnauthorized: false }
  });
};

const mapRow = (row) => ({
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

const createTableSql = `
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

const upsertSql = `
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

const asValues = (content) => ([
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

const initStorage = async () => {
  pool = createPool();

  if (!pool) {
    console.warn('DATABASE_URL missing: using in-memory storage for landing content.');
    return;
  }

  await pool.query(createTableSql);
  await pool.query(upsertSql, asValues(DEFAULT_LANDING_CONTENT));
  console.log('PostgreSQL storage ready for landing content.');
};

const getLandingContent = async () => {
  if (!pool) {
    return { ...inMemoryContent };
  }

  const result = await pool.query('SELECT * FROM landing_content WHERE id = 1 LIMIT 1;');

  if (result.rowCount === 0) {
    await pool.query(upsertSql, asValues(DEFAULT_LANDING_CONTENT));
    return { ...DEFAULT_LANDING_CONTENT };
  }

  return mapRow(result.rows[0]);
};

const updateLandingContent = async (content) => {
  const merged = { ...DEFAULT_LANDING_CONTENT, ...content };

  if (!pool) {
    inMemoryContent = merged;
    return { ...inMemoryContent };
  }

  await pool.query(upsertSql, asValues(merged));
  return getLandingContent();
};

module.exports = {
  DEFAULT_LANDING_CONTENT,
  initStorage,
  getLandingContent,
  updateLandingContent
};
