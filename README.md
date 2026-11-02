# 今天吃啥 simulator

A kitchen full of every food I like, plus a shopping cart of what I'm actually going to eat.

## Run it
Open `index.html` in a browser. No server or build step needed.
To publish, push the folder to a GitHub repo and turn on GitHub Pages.

## Add foods
Edit `foods.js`. One food per line. Each food appears in the kitchen as its name:

```js
{ name: "番茄炒蛋", category: "dish", tags: ["Chinese", "homemade"] },
{ name: "Häagen-Dazs抹茶冰淇淋", category: "dessert", tags: ["branded"] },
```

- `name`: Chinese or English, whatever you call it. (Add an `id` only if two foods share a name.)
- `category`: dish, dish-ish, dessert, snack, fruit, ingredient (the coloured dot + filter).
- Tag filters are built automatically from whatever tags you use.

## Where foods start
`layout.js` holds each food's starting position (pixels of `kitchen.jpg`). New foods that aren't in it yet line up on the rug.
To save a new arrangement: drag things where you want, click **⧉ copy layout** (bottom right), and paste the result to Claude (or over `layout.js`).

## Controls
- **Hover**: the word lifts, and a tag shows its category, tags, whether you starred it and when you last ate it.
- **Click, or drag onto the Shopping Cart button**: add it to the cart.
- **Drag**: move food anywhere in the kitchen. "↺ tidy up" puts everything back.
- **Shopping Cart** (button, top right) opens a dropdown: drag rows to reorder, click a row to make the food hop in the kitchen, ☆ = star (starred foods get a ★ in the kitchen), ✓ = ate it, ✕ = remove.
- **Search**: press `/`. Next to it: "match all / match any" (how several tags combine), the result count, and "clear".
- **🎲 今天吃啥?** (button): picks a food at random from whatever the filters show (or everything), spotlighting it in the kitchen; add it to the cart or draw again.
- **Filters** (button): opens categories and tags (A–Z); the badge shows how many are on.

The kitchen is a fixed picture (`kitchen.jpg`) that fills the window. Positions are in that picture's pixels.
Your layout and cart save automatically in your browser. Other people opening the link get their own copy.
