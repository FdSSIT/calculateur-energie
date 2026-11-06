# Calculateur de prix de l'énergie

Outil public de consultation des prix moyens de l'électricité, du gaz et du mazout
à Bruxelles (source CREG). Destiné aux services d'aide aux personnes : vérification
du tarif repris sur un décompte, estimation d'un montant à partir d'une consommation.

## Contenu du dépôt

| Fichier | Rôle |
|---|---|
| `index.html` | Le calculateur public (FR / NL). C'est la page vers laquelle le site pointe. |
| `donnees.json` | Les prix mensuels. **Seul fichier à remplacer lors d'une mise à jour.** |
| `encodage/index.html` | Page d'encodage, à adresse séparée. Lit le classeur Excel et produit `donnees.json`. |
| `encodage/vendor/xlsx-lite.js` | Lecteur/écrivain de fichiers Excel écrit pour ce projet (~380 lignes commentées, aucune dépendance). |
| `Modele-donnees-energie.xlsx` | Le modèle de classeur, pré-rempli avec l'historique 2019 → 2026. |

Aucune dépendance en ligne : les pages fonctionnent sans connexion à un service tiers.

## Ce que les pages font — et ne font pas

- Aucun appel réseau sortant. Pas de CDN, pas de police distante, pas de mesure
  d'audience, pas de bibliothèque tierce.
- Aucun cookie. Le seul élément conservé dans le navigateur est la langue choisie
  (FR ou NL), via `localStorage`.
- Aucune donnée à caractère personnel n'est traitée : l'outil ne manipule que des
  prix publics et des nombres saisis à l'écran, qui ne quittent pas le navigateur.
- La page d'encodage lit le classeur **localement** : le fichier n'est envoyé nulle part.

Tout le code est en clair dans les trois fichiers `.html` et `.js` du dépôt,
sans minification, et peut être relu.

## Mise en ligne (une seule fois)

1. Créer un dépôt GitHub, par exemple `calculateur-energie`.
2. Y déposer tous les fichiers de ce dossier, en conservant l'arborescence.
3. Dans le dépôt : **Settings → Pages → Build and deployment**, choisir
   *Deploy from a branch*, branche `main`, dossier `/ (root)`, puis **Save**.
4. Au bout d'une minute, le site est servi à l'adresse indiquée par GitHub
   (`https://<compte>.github.io/calculateur-energie/`).
5. Dans WordPress, ajouter **un simple lien** vers cette adresse.
   Ne rien coller d'autre dans WordPress : pas de script, pas de plugin.

Adresse de la page d'encodage : la même, suivie de `/encodage/`.

> **La page d'encodage n'est pas protégée.** Une adresse distincte n'est pas un accès
> restreint : toute personne qui connaît le lien peut l'ouvrir. Elle ne peut toutefois
> rien modifier en ligne — elle ne fait que produire un fichier à télécharger.
> Ne pas publier ce lien sur le site.

### Adresse personnalisée (facultatif)

Pour servir l'outil sous `energie.votresite.be` plutôt qu'une adresse `github.io` :
ajouter un enregistrement DNS `CNAME` pointant vers `<compte>.github.io`, puis
renseigner ce nom dans **Settings → Pages → Custom domain**. Aucune intervention
sur WordPress.

## Mise à jour mensuelle des prix

1. Ajouter la ligne du mois dans le classeur Excel.
2. Ouvrir la page `/encodage/`, y déposer le classeur.
3. Vérifier les signalements affichés, corriger si nécessaire.
4. Cliquer sur **Télécharger `donnees.json`**.
5. Déposer ce fichier dans le dépôt GitHub, à la racine, en remplaçant l'ancien
   (sur github.com : ouvrir le dépôt, *Add file → Upload files*, déposer, *Commit changes*).

Le calculateur affiche les nouvelles valeurs au rafraîchissement suivant.

## Format du classeur

Une ligne par mois, dans cet ordre de colonnes :

| Colonne | Contenu | Unité |
|---|---|---|
| A | Mois | `AAAA-MM` |
| B | Mazout | € pour 1 545 L |
| C | Électricité, prix moyen commercial | c€/kWh (réf. 3 500 kWh/an) |
| D | Électricité, tarif social mono-horaire | c€/kWh |
| E | Électricité, tarif social bi-horaire jour | c€/kWh |
| F | Électricité, tarif social bi-horaire nuit | c€/kWh |
| G | Gaz, prix moyen commercial | c€/kWh (réf. 23 260 kWh/an) |
| H | Gaz, tarif social | c€/kWh |

Une cellule vide est admise : le mois est alors signalé comme non couvert
dans le calculateur, au lieu d'être compté dans la moyenne.

## Limites assumées de l'outil

- **Moyenne arithmétique** des mois de la période, sans pondération saisonnière :
  une période d'hiver est donc sous-estimée, une période d'été surestimée.
- **Prix hors redevance fixe** (abonnement) : un montant estimé sera inférieur
  à la facture réelle.
- **Granularité mensuelle** : un décompte qui ne commence pas le 1er du mois
  introduit une imprécision de quelques pour cent sur les montants.

Ces trois limites sont rappelées en bas de la page publique.

## Traductions

Tous les textes des deux langues sont regroupés dans l'objet `T` en haut du script
de `index.html` (`T.fr` et `T.nl`). Pour corriger une formulation, modifier la valeur
correspondante dans les deux langues — aucune autre partie du code n'est à toucher.
