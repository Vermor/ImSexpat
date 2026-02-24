# ImSexpat

Landing page + admin page protegee par mot de passe, prete pour Railway.

## Installation locale

```bash
npm install
cp .env.example .env
npm run dev
```

Puis ouvre `http://localhost:3000`.

## Variables d'environnement

- `PORT`: port du serveur (Railway le fournit automatiquement).
- `ADMIN_PASSWORD`: mot de passe admin.
- `COOKIE_SECRET`: secret pour signer le cookie de session admin.
- `DATABASE_URL`: URL PostgreSQL (Railway DB).
- `PRIMARY_DOMAIN`: domaine principal public (ex: `imsexpat.site`).

## Securite mot de passe

Le mot de passe ne doit jamais etre commit.

- Local: mets-le dans `.env` (deja ignore par `.gitignore`).
- Railway: service -> Variables -> ajoute `ADMIN_PASSWORD` et `COOKIE_SECRET`.

## DB Railway (PostgreSQL)

1. Dans ton projet Railway, clique `New` -> `Database` -> `Add PostgreSQL`.
2. Dans le service web ImSexpat, configure les refs DB (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`) ou `DATABASE_URL`.
3. Redeploy le service web.

Au demarrage, l'app cree automatiquement les tables `landing_content` et `articles` si elles n'existent pas.

## Stockage images Railway Volume

Pour que les uploads ne disparaissent pas apres redeploy:

1. Crée un volume Railway.
2. Monte le volume sur le service `ImSexpat` au chemin exact: `/app/public/uploads`.
3. Redeploy le service.

L'app ecrit les fichiers d'upload dans ce dossier, donc ils deviennent persistants.

## Admin landing

- Dashboard admin: `/admin`
- Editeur landing: `/admin/landing`
- Editeur articles: `/admin/articles`
- Bibliotheque media: `/admin/media`

Tous les textes de la landing sont modifiables depuis cette page.

## Articles et images

- CRUD articles dans `/admin/articles` (titre, slug, resume, contenu, statut publie).
- Categories + tags.
- SEO article (`seoTitle`, `seoDescription`, `ogImageUrl`).
- Upload image de couverture (max 8MB, compression et redimensionnement auto).
- Bibliotheque d'uploads avec drag-and-drop et insertion rapide dans l'editeur.
- Autosave brouillon local + alerte en quittant une page non sauvegardee.
- Verification de disponibilite du slug.
- Recherche + filtres + pagination sur `/articles`.
- Journal d'activite admin (`/api/admin/activity`).
- Listing public: `/articles`
- Detail public: `/article/:slug`

## Deploiement Railway

1. Connecte le repo GitHub dans Railway.
2. Railway detecte Node automatiquement.
3. Ajoute les variables d'environnement au service web.
4. Deploy.

Note domaine:
- En production, les requetes sur `*.up.railway.app` sont redirigees en 301 vers `https://PRIMARY_DOMAIN`.
