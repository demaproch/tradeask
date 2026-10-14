# 🔍 Guide de diagnostic - Logs de la console

## Objectif

Identifier pourquoi les bots ne scannent pas malgré le démarrage du desk.

## Logs ajoutés pour le diagnostic

### 1. Quand tu cliques sur "Start Desk"

Tu devrais voir dans la console :

```
🔄 runningRef.current mis à jour: true
✅ Démarrage du desk, création de l'interval
✅ Interval créé: [number]
⏰ Premier cycle (setTimeout 100ms)
```

### 2. Quand le cycle de scan démarre

```
🔍 runDeskCycle appelé {running: true, marketDataSize: 12, hasInterval: true}
🔄 Cycle de scan démarré...
```

### 3. Si ça bloque quelque part

Tu verras un de ces messages :

```
❌ runDeskCycle: runningRef.current est false, retour
```
→ Le desk n'est pas considéré comme "running"

```
❌ runDeskCycle: marketData vide, retour
```
→ Les données de marché ne sont pas chargées

```
🔍 runDeskCycle appelé {running: false, marketDataSize: 12, hasInterval: true}
```
→ Le ref n'est pas synchronisé avec l'état

## Procédure de test

### Étape 1 : Rafraîchir la page
```
F5 ou Ctrl+R (Cmd+R sur Mac)
```

### Étape 2 : Ouvrir la console
```
F12 → onglet "Console"
```

### Étape 3 : Effacer les anciens logs
Clique sur le bouton 🚫 (Clear console) en haut de la console

### Étape 4 : Cliquer sur "Start Desk"

### Étape 5 : Observer les logs

Copie-colle **TOUS** les logs que tu vois dans la console, dans l'ordre exact où ils apparaissent.

## Scénarios possibles

### Scénario A : Tout fonctionne ✅

```
🔄 runningRef.current mis à jour: true
✅ Démarrage du desk, création de l'interval
✅ Interval créé: 123
⏰ Premier cycle (setTimeout 100ms)
🔍 runDeskCycle appelé {running: true, marketDataSize: 12, hasInterval: true}
🔄 Cycle de scan démarré...
🔍 Screener: analyse en cours...
✅ Screener: 3 coins détectés
...
```

**Action** : Tout va bien, les bots fonctionnent !

### Scénario B : runningRef est false ❌

```
🔄 runningRef.current mis à jour: true
✅ Démarrage du desk, création de l'interval
✅ Interval créé: 123
⏰ Premier cycle (setTimeout 100ms)
🔍 runDeskCycle appelé {running: false, marketDataSize: 12, hasInterval: true}
❌ runDeskCycle: runningRef.current est false, retour
```

**Diagnostic** : Le ref n'est pas synchronisé
**Solution** : Problème de closure React, il faut utiliser un ref stable

### Scénario C : Market data vide ❌

```
🔄 runningRef.current mis à jour: true
✅ Démarrage du desk, création de l'interval
✅ Interval créé: 123
⏰ Premier cycle (setTimeout 100ms)
🔍 runDeskCycle appelé {running: true, marketDataSize: 0, hasInterval: true}
❌ runDeskCycle: marketData vide, retour
```

**Diagnostic** : Les données ne sont pas chargées
**Solution** : Forcer le chargement avant le démarrage

### Scénario D : Pas de logs du tout ❌

```
🔄 runningRef.current mis à jour: true
✅ Démarrage du desk, création de l'interval
✅ Interval créé: 123
```

Puis **rien d'autre**.

**Diagnostic** : Le setTimeout ne se déclenche pas
**Solution** : Problème avec le timer ou le composant est démonté

### Scénario E : Logs en boucle infinie ❌

```
🔄 runningRef.current mis à jour: true
✅ Démarrage du desk, création de l'interval
✅ Interval créé: 123
🔄 runningRef.current mis à jour: false
⏹ Arrêt du desk, suppression de l'interval
🔄 runningRef.current mis à jour: true
✅ Démarrage du desk, création de l'interval
✅ Interval créé: 124
...
```

**Diagnostic** : Le desk démarre et s'arrête en boucle
**Solution** : Problème avec le state ou les effets React

## Ce qu'il faut m'envoyer

Copie-colle **EXACTEMENT** ce que tu vois dans la console après avoir cliqué sur "Start Desk", en incluant :

1. Les timestamps (si visibles)
2. Les messages complets
3. Les objets JSON (comme `{running: true, marketDataSize: 12}`)
4. Les erreurs en rouge (s'il y en a)

## Exemple de format attendu

```
[12:34:56] 🔄 runningRef.current mis à jour: true
[12:34:56] ✅ Démarrage du desk, création de l'interval
[12:34:56] ✅ Interval créé: 123
[12:34:56] ⏰ Premier cycle (setTimeout 100ms)
[12:34:56] 🔍 runDeskCycle appelé {running: true, marketDataSize: 12, hasInterval: true}
[12:34:56] 🔄 Cycle de scan démarré...
[12:34:56] 🔍 Screener: analyse en cours...
[12:34:57] ✅ Screener: 3 coins détectés
...
```

## Prochaines étapes

Une fois que j'ai les logs complets, je pourrai :
1. Identifier exactement où ça bloque
2. Corriger le problème spécifique
3. T'expliquer pourquoi ça ne marchait pas
