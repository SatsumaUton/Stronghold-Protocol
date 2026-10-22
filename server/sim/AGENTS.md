# Battle settlement

Call operations on `battle`; import helpers from [attack.js](attack.js), never internal paths.

```js
battle.dealDamage(source, target, { amount: 100, type: 'arts' });
battle.heal(source, target, 100);
battle.loseHp(target, amount, { source });
battle.reduceElement(target, 100); // recover each gauge
```

`loseHp` takes an already processed amount. Use `battle.forceAttack` for an entire attack.
See [SIM](../../docs/SIM.md) for parameters and hooks.
