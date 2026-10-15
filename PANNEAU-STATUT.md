# 📊 Panneau de Statut - Guide Complet

## 🎯 Vue d'ensemble

Un panneau de statut clair et visible a été ajouté en haut de l'interface pour montrer en temps réel l'état de tous les modes et statistiques du bot.

## 📍 Emplacement

Le panneau est situé **juste en dessous du header**, au-dessus de la navigation par onglets.

## 🎨 Composants du panneau

### 1. État du Desk (DESK RUNNING / DESK STOPPED)

**Indicateur visuel :**
- 🟢 **Vert pulsant** = Desk en cours d'exécution
- ⚫ **Gris** = Desk arrêté

**Signification :**
- Montre si les 6 bots sont actifs et scannent le marché
- Change automatiquement quand tu cliques sur Start/Stop

---

### 2. Mode de Données (DATA)

**Indicateurs visuels :**
- 📡 **LIVE** (badge vert) = Données réelles Binance
- 🎲 **SIM** (badge bleu) = Données simulées

**Signification :**
- **LIVE** : Le bot utilise l'API Binance pour récupérer les prix réels
- **SIM** : Le bot génère des données artificielles pour tester

**Persistance :** Sauvegardé dans localStorage, conservé au refresh

---

### 3. Mode de Détection (DETECTION)

**Indicateurs visuels :**
- 🔓 **RELAXED** (badge orange) = Détection permissive
- 🔒 **STRICT** (badge violet) = Détection stricte

**Signification :**
- **RELAXED** : Critères assouplis pour détecter plus de trades
  - Tolérance FVG : 30% de la range
  - Tolérance zone : ±1%
  - Tolérance confirmation : 0.5%
- **STRICT** : Critères originaux très stricts
  - Gap parfait requis
  - Prix exact sur la zone
  - Rejection parfaite

**Persistance :** Sauvegardé dans localStorage, conservé au refresh

---

### 4. Mode Debug (DEBUG)

**Indicateurs visuels :**
- 🐛 **ACTIVE** (badge rose pulsant) = Mode debug activé
- ⚪ **OFF** (badge gris) = Mode debug désactivé

**Signification :**
- **ACTIVE** : Un trade forcé a été créé pour tester le flux
- **OFF** : Mode debug inactif

**Durée :** Le mode debug s'active pour 5 secondes après avoir cliqué sur le bouton 🐛 Debug

---

### 5. Statistiques Rapides

**Affichées à droite du panneau :**

#### Watchlist
- **Nombre de coins** détectés par le Screener
- Couleur : **Bleu**
- Exemple : `4` coins dans la watchlist

#### Positions
- **Nombre de positions ouvertes** actuellement
- Couleur : **Vert**
- Exemple : `2` positions actives

#### Trades
- **Nombre total de trades** exécutés (hors skipped)
- Couleur : **Violet**
- Exemple : `15` trades réalisés

---

### 6. Statut API et Dernier Update

**Affichés dans le header (en haut à droite) :**

#### API Status
- 🟢 **✓** (vert) = API Binance accessible
- 🔴 **✗** (rouge) = API Binance inaccessible
- ⚫ **?** (gris) = Statut inconnu

#### Last Update
- Horodatage du dernier chargement de données
- Format : `HH:MM:SS`
- Exemple : `14:23:45`

---

## 🎯 Exemples de configurations

### Configuration 1 : Testing en mode permissif
```
DESK RUNNING | DATA: 📡 LIVE | DETECTION: 🔓 RELAXED | DEBUG: ⚪ OFF
Watchlist: 4 | Positions: 2 | Trades: 15
```
**Signification :** Le bot tourne avec des données réelles en mode permissif, a détecté 4 coins, 2 positions sont ouvertes, 15 trades ont été exécutés.

---

### Configuration 2 : Production stricte
```
DESK RUNNING | DATA: 📡 LIVE | DETECTION: 🔒 STRICT | DEBUG: ⚪ OFF
Watchlist: 1 | Positions: 0 | Trades: 2
```
**Signification :** Le bot tourne avec des données réelles en mode strict, a détecté 1 coin, aucune position ouverte, seulement 2 trades (très sélectif).

---

### Configuration 3 : Debug en cours
```
DESK RUNNING | DATA: 🎲 SIM | DETECTION: 🔓 RELAXED | DEBUG: 🐛 ACTIVE
Watchlist: 3 | Positions: 1 | Trades: 8
```
**Signification :** Le bot tourne avec des données simulées en mode permissif, un trade debug vient d'être forcé (badge rose pulsant).

---

### Configuration 4 : Desk arrêté
```
DESK STOPPED | DATA: 📡 LIVE | DETECTION: 🔒 STRICT | DEBUG: ⚪ OFF
Watchlist: 4 | Positions: 0 | Trades: 12
```
**Signification :** Le bot est arrêté mais conserve son état : 4 coins en watchlist, aucune position active, 12 trades historiques.

---

## 🔄 Comportements dynamiques

### Quand tu démarres le desk
- Le point passe de ⚫ gris à 🟢 vert pulsant
- Le texte change de "DESK STOPPED" à "DESK RUNNING"

### Quand tu changes de mode de données
- Le badge change de couleur et de texte
- 🎲 SIM (bleu) ↔ 📡 LIVE (vert)

### Quand tu changes de mode de détection
- Le badge change de couleur et de texte
- 🔒 STRICT (violet) ↔ 🔓 RELAXED (orange)

### Quand tu cliques sur Debug
- Le badge DEBUG passe à 🐛 ACTIVE (rose pulsant)
- Après 5 secondes, il revient à ⚪ OFF

### Quand les données se mettent à jour
- L'horodatage "Last Update" change
- En mode LIVE, toutes les 5 minutes automatiquement

### Quand les statistiques changent
- Les nombres se mettent à jour en temps réel
- Watchlist : quand le Screener détecte de nouveaux coins
- Positions : quand des trades sont ouverts/fermés
- Trades : quand l'Auto-take prend des décisions

---

## 🎨 Codes couleurs

| Élément | Couleur | Signification |
|---------|---------|---------------|
| 🟢 Vert | `emerald-500` | Actif, en cours, succès |
| 🔵 Bleu | `blue-500` | Simulation, information |
| 🟠 Orange | `orange-500` | Relaxed, attention |
| 🟣 Violet | `purple-500` | Strict, trades |
| 🌸 Rose | `pink-500` | Debug, temporaire |
| 🔴 Rouge | `red-500` | Erreur, arrêt |
| ⚫ Gris | `gray-500/600/700` | Inactif, neutre |

---

## 💡 Conseils d'utilisation

### Pour le développement
1. Utilise **🎲 SIM + 🔓 RELAXED** pour tester rapidement
2. Clique sur **🐛 Debug** pour vérifier le flux
3. Observe les statistiques qui changent

### Pour la production
1. Utilise **📡 LIVE + 🔒 STRICT** pour la qualité
2. Surveille les statistiques en temps réel
3. Vérifie que le desk est bien RUNNING

### Pour le debugging
1. Si le desk est STOPPED → clique sur Start
2. Si Watchlist = 0 → attends que le Screener détecte
3. Si Positions = 0 → passe en RELAXED ou utilise Debug
4. Si API = ✗ → vérifie ta connexion internet

---

## 🔍 Interprétation des statistiques

### Watchlist élevée (5+)
- ✅ Beaucoup de coins détectés
- ⚠️ Vérifie que c'est normal (marché volatil ?)
- 💡 Mode STRICT pourrait réduire ce nombre

### Watchlist basse (0-1)
- ✅ Mode STRICT très sélectif
- ⚠️ Pas beaucoup d'opportunités
- 💡 Mode RELAXED pourrait augmenter ce nombre

### Positions élevées (3+)
- ✅ Beaucoup de trades ouverts
- ⚠️ Vérifie le risque total
- 💡 Risk Officer pourrait limiter les adds

### Positions basses (0)
- ✅ Aucun trade actif
- ⚠️ Soit pas d'opportunités, soit problème de détection
- 💡 Utilise Debug pour tester le flux

### Trades élevés (20+)
- ✅ Beaucoup d'activité
- ⚠️ Vérifie la qualité dans l'Auditor
- 💡 Mode STRICT pourrait améliorer la qualité

### Trades bas (0-5)
- ✅ Très sélectif
- ⚠️ Pas beaucoup d'opportunités
- 💡 Mode RELAXED pourrait augmenter l'activité

---

## 🐛 Dépannage

### Le panneau ne s'affiche pas
- Rafraîchis la page (F5)
- Vérifie la console pour les erreurs (F12)
- Vérifie que le build est à jour

### Les statistiques ne se mettent pas à jour
- Vérifie que le desk est RUNNING
- Vérifie les logs dans la console
- Utilise Debug pour forcer un update

### Le mode ne change pas
- Clique à nouveau sur le bouton
- Vérifie que localStorage n'est pas bloqué
- Efface localStorage manuellement et rafraîchis

### Le statut API est toujours "?"
- Vérifie ta connexion internet
- Vérifie que Binance API est accessible
- Attends quelques secondes pour le check initial

---

## 📊 Résumé

Le panneau de statut te donne une **vue d'ensemble instantanée** de :
- ✅ L'état du desk (running/stopped)
- ✅ Le mode de données (SIM/LIVE)
- ✅ Le mode de détection (STRICT/RELAXED)
- ✅ Le mode debug (ACTIVE/OFF)
- ✅ Les statistiques clés (watchlist, positions, trades)
- ✅ Le statut de l'API et le dernier update

**Tout est visible en un coup d'œil, sans avoir à naviguer dans les onglets !** 🎉
