// Entête d'authentification pour les webhooks Make (protégés par une clé d'API).
// La clé vient de la variable d'environnement Vercel MAKE_APIKEY : elle n'est jamais écrite dans le code.
// Tant que la variable n'est pas définie, aucun entête n'est ajouté (comportement inchangé).
export function enteteMake(extra = {}) {
  const cle = process.env.MAKE_APIKEY;
  return cle ? { ...extra, 'x-make-apikey': cle } : extra;
}
