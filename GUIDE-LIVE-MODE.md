# 📊 Guide d'utilisation - Mode LIVE vs SIMULATION

## 🎯 Qu'est-ce qui a été ajouté ?

Le bot de trading supporte maintenant **deux modes de données** :

### 🎲 Mode SIMULATION (par défaut)
- Données générées artificiellement
- Utile pour tester la logique des bots
- **Aucun rapport avec la réalité du marché**
- Démarrage instantané

### 📡 Mode LIVE (Binance API)
- Données réelles du marché crypto
- Prix actuels et historiques OHLC (klines)
- Mise à jour automatique toutes les 2 minutes
- **Reflet fidèle de ce qui se passe sur les exchanges**

---

## 🚀 Comment utiliser

### 1. Basculer entre les modes

En haut à droite de l'interface, tu verras un bouton :
- **🎲 SIM** : Mode simulation actif
- **📡 LIVE** : Mode données réelles actif

**Clique dessus pour basculer** d'un mode à l'autre.

### 2. Indicateurs visuels

- **Point vert pulsant** : Mode LIVE actif
- **Point bleu** : Mode SIMULATION actif
- **Horodatage** : Dernière mise à jour des données
- **Bouton 🔄** : Rafraîchir manuellement les données (mode LIVE uniquement)

### 3. Workflow typique

```
1. Démarre en mode SIM pour tester la logique
2. Observe comment les bots réagissent
3. Bascule en mode LIVE pour voir les vrais signaux
4. Compare les résultats
```

---

## 📡 Mode LIVE - Détails techniques

### Source des données
- **API** : Binance (gratuit, sans clé API)
- **Rate limit** : ~1200 requêtes/minute
- **Cache** : 30 secondes pour éviter le spam
- **CORS** : Supporté nativement (pas de problème de navigateur)

### Données récupérées
Pour chaque coin (BTC, ETH, SOL, etc.) :
- **Daily candles (1d)** : 90 jours d'historique
- **4H candles (4h)** : 180 bougies = 30 jours d'historique
- **1H candles (1h)** : 168 bougies = 7 jours d'historique
- **Volume** : Inclus dans chaque bougie

### Mise à jour automatique
- **Toutes les 2 minutes** en mode LIVE
- **Cache intelligent** : pas de requête redondante
- **Gestion d'erreurs** : fallback automatique sur SIM si l'API échoue

### Coins supportés
```
BTC  → Bitcoin
ETH  → Ethereum
SOL  → Solana
AVAX → Avalanche
DOGE → Dogecoin
LINK → Chainlink
MATIC → Polygon
ARB  → Arbitrum
OP   → Optimism
APT  → Aptos
SUI  → Sui
INJ  → Injective
```

---

## ⚠️ Limitations

### Binance API (gratuit)
- **Rate limit généreux** : 1200 requêtes/minute
- **Volume inclus** dans chaque bougie
- **Latence faible** : données quasi temps réel (quelques secondes)
- **Supporte CORS** : fonctionne directement depuis le navigateur
- **Pas de WebSocket** dans cette version : pas de streaming temps réel

### Ce que tu NE verras PAS
- ❌ Prix en temps réel (tick par tick) - nécessite WebSocket
- ❌ Carnet d'ordres (order book)
- ❌ Données de futures/perpétuels (spot uniquement)

### Ce que tu VERRAS
- ✅ Prix spot réels
- ✅ Historique OHLC fiable
- ✅ Volume par bougie
- ✅ Tendances de marché authentiques
- ✅ Signaux basés sur des données réelles
- ✅ Données quasi temps réel (quelques secondes de latence)

---

## 🔧 Configuration avancée

### Changer le cache duration
Dans `src/engine/realMarketData.ts` :
```typescript
const CACHE_DURATION = 60000; // 1 minute (par défaut)
// Augmente pour moins de requêtes, diminue pour des données plus fraîches
```

### Changer l'intervalle de refresh
Dans `src/App.tsx` :
```typescript
const refreshInterval = setInterval(async () => {
  await loadMarketData('live');
}, 120000); // 2 minutes (par défaut)
// Attention au rate limit de CoinGecko !
```

### Ajouter des coins
Dans `src/engine/realMarketData.ts` :
```typescript
const COIN_MAP: Record<string, string> = {
  // ... coins existants
  NEWCOIN: 'coin-gecko-id', // Ajoute ici
};
```

---

## 🎯 Prochaines étapes possibles

### 1. API payantes (temps réel)
- **Binance API** : WebSocket temps réel, futures, volume
- **CoinMarketCap** : Plus de données, rate limits plus élevés
- **CryptoCompare** : Historique complet, futures

### 2. Améliorations techniques
- WebSocket pour streaming temps réel
- Base de données locale pour l'historique
- Backtesting sur données passées
- Alertes Telegram/Discord

### 3. Fonctionnalités avancées
- Support des futures/perpétuels
- Calcul de funding rates
- Détection de liquidations
- Analyse d'on-chain data

---

## 🐛 Dépannage

### "L'API ne répond pas"
- Vérifie ta connexion internet
- Binance peut être temporairement indisponible
- Le bot fallback automatiquement sur SIM

### "Les données ne se mettent pas à jour"
- Vérifie que tu es en mode LIVE (point vert)
- Le cache dure 30 secondes : attends un peu
- Clique sur le bouton 🔄 pour forcer le refresh

### "Rate limit atteint"
- Tu as fait trop de requêtes (peu probable avec Binance)
- Attends 10 secondes avant de réessayer
- Le bot gère ça automatiquement avec retry

### "Les prix semblent bizarres"
- Binance utilise les prix SPOT, pas futures
- La latence est de quelques secondes seulement
- Vérifie que la paire est correcte (ex: BTCUSDT)

---

## 💡 Conseils d'utilisation

### Pour tester la stratégie
1. **Commence en SIM** : comprends comment les bots fonctionnent
2. **Passe en LIVE** : vois les vrais signaux
3. **Compare** : est-ce que la stratégie aurait fonctionné ?
4. **Note tout** : garde un journal de tes observations

### Pour éviter les problèmes
- **Ne refresh pas trop souvent** en mode LIVE (respecte le rate limit)
- **Utilise le cache** : pas besoin de données à la seconde près
- **Teste d'abord en SIM** : évite de spammer l'API pendant le dev
- **Surveille les logs** : ils t'indiquent ce qui se passe

### Pour aller plus loin
- **Backtesting** : utilise les données historiques pour tester
- **Paper trading** : simule des trades sans argent réel
- **Multi-timeframe** : analyse plusieurs timeframes en parallèle
- **Alertes** : ajoute des notifications pour les signaux importants

---

## 📚 Ressources

- **Binance API Docs** : https://binance-docs.github.io/apidocs/
- **Rate limits** : https://binance-docs.github.io/apidocs/spot/en/#limits
- **Alternative APIs** :
  - CoinGecko : https://www.coingecko.com/api/documentation
  - CoinMarketCap : https://coinmarketcap.com/api/
  - CryptoCompare : https://min-api.cryptocompare.com/

---

## 🎓 Ce que tu apprends

Avec le mode LIVE, tu peux maintenant :
- ✅ Voir comment ta stratégie se comporte sur des données réelles
- ✅ Identifier les faux signaux vs les vrais opportunités
- ✅ Comprendre les limites de l'approche (spot vs futures)
- ✅ Préparer le terrain pour du paper trading puis du trading réel

**Rappel important** : Ce bot est un outil d'apprentissage et d'analyse. Il ne garantit aucun profit. Le trading comporte des risques importants. Teste toujours en paper trading avant d'utiliser de l'argent réel.
