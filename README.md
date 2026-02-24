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
2. Ouvre la DB creee, va dans ses variables et recupere `DATABASE_URL`.
3. Partage cette variable avec le service web ImSexpat (`Share with service`).
4. Redeploy le service web.

Au demarrage, l'app cree automatiquement les tables `landing_content` et `articles` si elles n'existent pas.

## Admin landing

- Dashboard admin: `/admin`
- Editeur landing: `/admin/landing`
- Editeur articles: `/admin/articles`
- Bibliotheque media: `/admin/media`

Tous les textes de la landing sont modifiables depuis cette page.

## Articles et images

- CRUD articles dans `/admin/articles` (titre, slug, resume, contenu, statut publie).
- Upload image de couverture (max 5MB, formats image).
- Bibliotheque d'uploads avec drag-and-drop et insertion rapide dans l'editeur.
- Listing public: `/articles`
- Detail public: `/article/:slug`

Important Railway:
- Les fichiers uploades dans `public/uploads` sont sur le disque du service.
- Selon la config Railway, ce stockage peut etre ephemere.
- Pour du long terme, prevois Railway Volume ou stockage objet (S3/Cloudinary).

## Deploiement Railway

1. Connecte le repo GitHub dans Railway.
2. Railway detecte Node automatiquement.
3. Ajoute les variables d'environnement au service web.
4. Deploy.

Note domaine:
- En production, les requetes sur `*.up.railway.app` sont redirigees en 301 vers `https://PRIMARY_DOMAIN`.
