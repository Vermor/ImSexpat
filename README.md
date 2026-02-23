# ImSexpat

Landing page + admin page protégée par mot de passe, prête pour Railway.

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

## Sécurité mot de passe

Le mot de passe **ne doit jamais** être commité.

- Local: mets-le dans `.env` (déjà ignoré par `.gitignore`).
- Railway: Project -> Variables -> ajoute `ADMIN_PASSWORD` et `COOKIE_SECRET`.

## Déploiement Railway

1. Connecte le repo GitHub dans Railway.
2. Railway détecte Node automatiquement.
3. Ajoute les variables d'environnement.
4. Deploy.
