# NeuroSolution ATX Supplement Store – Import Products

**Maintained By:** Lane Melancon — Onn Grid, LLC
**Client:** Dr. Brandon Crawford — NeuroSolution Center of Austin
**Last Updated:** 2026-06-29

---

## Project Direction

Bulk-import 140 supplement products (152 CSV rows including variants) from the master products sheet into the NeuroSolution ATX Shopify supplement store via the **Shopify GraphQL Admin API**. The native Shopify CSV import tool cannot write custom metafield data — this script handles the full import including metaobject definitions, metafield definitions, metaobject entries, and all product/variant data.

**Workflow:**

1. Build and test against dev store (`atx-prod-test-01.myshopify.com`) until the full import is perfect in one implementation.
2. Run the same pipeline against the production store (`neurosolution-shop.myshopify.com`) for the
   final client transfer. **Not yet started** — see "Production Import Prep" under Outstanding
   tasks below for what the next session needs before this can run.

---

## Stores

| Store      | URL                                | Purpose                                | Credentials                          |
| ---------- | ---------------------------------- | -------------------------------------- | ------------------------------------- |
| Dev / Test | `atx-prod-test-01.myshopify.com`   | All testing — use this first           | `.env` (ready)                        |
| Production | `neurosolution-shop.myshopify.com` | Client transfer store — final run only | `.env.production` (**not yet created**) |

---

## API Authentication

**App:** `atx-prod-ingest` (Shopify Dev Dashboard — Onn Grid partner account)
**Auth method:** Client Credentials Grant — no OAuth flow, no redirect needed
**Credentials:** stored in `.env` (dev) / `.env.production` (production) files in project root

### .env file — dev store (project root, exists)

```
SHOPIFY_SHOP=atx-prod-test-01
SHOPIFY_CLIENT_ID=<from atx-prod-ingest app on dev store>
SHOPIFY_CLIENT_SECRET=<from atx-prod-ingest app on dev store>
```

### .env.production file — production store (project root, **NOT YET CREATED**)

```
SHOPIFY_SHOP=neurosolution-shop
SHOPIFY_CLIENT_ID=<from app installed on neurosolution-shop.myshopify.com>
SHOPIFY_CLIENT_SECRET=<from app installed on neurosolution-shop.myshopify.com>
```

The `atx-prod-ingest` app must be installed on `neurosolution-shop.myshopify.com` (via the Shopify
Dev Dashboard, same partner account) with Client Credentials Grant enabled and the same scopes as
the dev store (see below). Each store has its own client ID/secret pair even for the same app —
the dev store's credentials will NOT work against production. Lane needs to install the app on the
production store and provide the resulting client ID/secret before any production script can run.

### api.js — token management (project root)

Handles token fetching and auto-refresh. Import and use the `graphql()` function from this file for all API calls. Tokens expire every 24 hours; `api.js` handles renewal automatically via the `getToken()` function. `api.js` is store-agnostic — it reads `SHOPIFY_SHOP`/`SHOPIFY_CLIENT_ID`/`SHOPIFY_CLIENT_SECRET` from `process.env`, so switching stores is just a matter of which `--env-file` is passed to `node`.

### Running scripts against each store

```
# Dev (atx-prod-test-01) — existing npm scripts, unchanged
npm run setup:metaobjects   # node --env-file=.env scripts/01-setup-metaobjects.js
npm run setup:entries       # node --env-file=.env scripts/02-setup-metaobject-entries.js
npm run import:products     # node --env-file=.env scripts/03-import-products.js
npm run verify              # node --env-file=.env scripts/04-verify.js

# Production (neurosolution-shop) — new :prod npm scripts, require .env.production
npm run setup:metaobjects:prod
npm run setup:entries:prod
npm run import:products:prod
npm run verify:prod
```

### App scopes (dev store — production app must match)

```
write_inventory, read_inventory,
read_metaobject_definitions, write_metaobject_definitions,
read_metaobjects, write_metaobjects,
read_product_feeds, write_product_feeds,
read_product_listings, write_product_listings,
read_products, write_products,
write_theme_code, read_themes, write_themes,
read_publications, write_publications
```

**✅ Publishing scopes granted (dev):** `read_publications` / `write_publications` are enabled. `03-import-products.js`
publishes every product to all available sales channels (Online Store, Point of Sale, Shop) via
`publishablePublish`; products remain `status: DRAFT` per the import design. **Confirm the production
app install grants all of the scopes above (including publishing) — if `read_publications`/
`write_publications` are missing on production, `fetchPublicationIds()` will log a warning and skip
publishing (products still get created as DRAFT, just unpublished).**

### GraphQL endpoint

```
https://{SHOPIFY_SHOP}.myshopify.com/admin/api/2025-10/graphql.json
```

(`api.js` is hardcoded to `2025-10`, not the `2025-01` previously noted here.)

---

## File Structure

```
import-products/
├── CLAUDE.md                                         ← This file
├── .env                                              ← Dev (atx-prod-test-01) credentials (never commit to git)
├── .env.production                                   ← Production (neurosolution-shop) credentials — NOT YET CREATED
├── .gitignore                                        ← Ignores .env and .env.* (never commit to git)
├── api.js                                            ← Token management + graphql() helper (store-agnostic)
├── shopify_import.py                                 ← Previous import script (old, unused)
├── scripts/
│   ├── 00-wipe.js                                    ← Wipes store back to empty (products, metaobject/metafield defs)
│   ├── 01-setup-metaobjects.js                       ← Step 1-2: metaobject + metafield definitions
│   ├── 02-setup-metaobject-entries.js                ← Step 3-5: metaobject entries -> scripts/data/metaobject-ids.<SHOPIFY_SHOP>.json
│   ├── 03-import-products.js                         ← Step 6: imports all products/variants via productSet
│   ├── lib/
│   │   ├── csv.js                                    ← CSV parsing
│   │   ├── richtext.js                               ← HTML -> Shopify rich_text_field JSON
│   │   ├── alttext.js                                ← Generates SEO image alt text
│   │   ├── text.js                                   ← normalizeKey/lookupId/lookupEntry helpers
│   │   ├── throttle.js                               ← withRetry() — backs off on THROTTLED errors
│   │   └── log.js                                    ← logUserErrors() helper
│   └── data/
│       └── metaobject-ids.atx-prod-test-01.json      ← Generated by 02 (dev); name -> GID lookup for 03
│           (production run will generate metaobject-ids.neurosolution-shop.json alongside it)
└── sheets/
    ├── atx-prod-test-01_sheet_products               ← Master product data (152 rows, 52 cols) — same data for prod import
    ├── atx-prod-test-01_sheet_flavors                ← All flavor entries
    ├── atx-prod-test-01_sheet_food_supplement_forms  ← All supplement form entries
    └── atx-prod-test-01_sheet_supplement_categories  ← All supplement category entries
```

**Implementation rule:** All solutions must use the Shopify GraphQL Admin API. Keep files well-structured and organized to reflect industry-standard coding practices.

---

## Source Data — Products Sheet

**File:** `sheets/atx-prod-test-01_sheet_products`
**Rows:** 152 (140 unique products + 12 continuation rows for multi-variant products)
**Columns:** 52

### Column reference

| #     | Column                                             | Notes                                                                                  |
| ----- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1     | Handle                                             | URL slug, unique per product                                                           |
| 2     | Product Title                                      | Blank on continuation rows                                                             |
| 3     | Product Description                                | HTML — short intro paragraph                                                           |
| 4     | Vendor                                             | Brand name                                                                             |
| 5     | Product Category                                   | Always: `Health & Beauty > Health Care > Fitness & Nutrition > Vitamins & Supplements` |
| 6     | Product Type                                       | Always: `Supplement`                                                                   |
| 7     | Collection                                         | Always: `Supplements`                                                                  |
| 8     | Tags                                               | Comma-separated                                                                        |
| 9     | Published                                          | TRUE/FALSE                                                                             |
| 10    | Status                                             | `unlisted` for all products                                                            |
| 11    | Option1 Name                                       | e.g. `Formula`                                                                         |
| 12    | Option1 Value                                      | e.g. `softgels`                                                                        |
| 13    | Option1 Linked To                                  | e.g. `product.metafields.shopify.food-supplement-form`                                 |
| 14    | Option2 Name                                       | e.g. `Size`                                                                            |
| 15    | Option2 Value                                      | e.g. `90 Softgels`                                                                     |
| 16    | Option2 Linked To                                  | usually blank                                                                          |
| 17    | Option3 Name                                       | e.g. `Flavor`                                                                          |
| 18    | Option3 Value                                      | e.g. `unflavored`                                                                      |
| 19    | Option3 Linked To                                  | e.g. `product.metafields.shopify.flavor`                                               |
| 20    | SKU                                                | May be blank                                                                           |
| 21    | Weight (grams)                                     | Format: `0.00` — populate from Product Web Link (col 52) if missing                    |
| 22    | Variant Inventory Tracker                          | `shopify`                                                                              |
| 23    | Variant Inventory Qty                              | Integer — `0` or actual count                                                          |
| 24    | Variant Inventory Policy                           | `continue`                                                                             |
| 25    | Variant Fulfillment Service                        | `manual`                                                                               |
| 26    | Variant Price                                      |                                                                                        |
| 27    | Variant Compare At Price                           | Always blank                                                                           |
| 28    | Variant Requires Shipping                          | TRUE/FALSE                                                                             |
| 29    | Variant Taxable                                    | TRUE/FALSE                                                                             |
| 30    | Tax Code                                           |                                                                                        |
| 31–34 | Unit price fields                                  | Always blank                                                                           |
| 35    | Variant Barcode                                    | Always blank                                                                           |
| 36    | Image Src                                          | CDN URL — parent row only; blank on continuation rows                                  |
| 37    | Image Position                                     | Integer                                                                                |
| 38    | Image Alt Text                                     | Not set in CSV — generate from Product Description, optimized for image SEO            |
| 39    | Gift Card                                          | FALSE                                                                                  |
| 40    | SEO Title                                          | Use from CSV for product/parent row                                                    |
| 41    | SEO Description                                    | Use from CSV for product/parent row                                                    |
| 42    | `product.metafields.custom.supplement_category`    | Comma-separated metaobject references                                                  |
| 43    | `product.metafields.custom.supplement_size`        | e.g. `60 Capsules` — see size rules below                                              |
| 44    | `product.metafields.shopify.flavor`                | Comma-separated — links to Flavor metaobject                                           |
| 45    | `product.metafields.shopify.food-supplement-form`  | Comma-separated — links to Medicine/Supplement form metaobject                         |
| 46    | `product.metafields.custom.product_details`        | Rich text HTML                                                                         |
| 47    | `product.metafields.custom.supplement_ingredients` | Rich text HTML                                                                         |
| 48    | `variant.metafields.custom.variant_title`          | e.g. `OptiMag® Neuro (90 Capsules)` — variant rows only                                |
| 49    | Variant Image                                      | CDN URL — continuation/variant rows only; blank on parent row                          |
| 50    | Weight Unit                                        | `lb`                                                                                   |
| 51    | Cost per item                                      | Required for all products and variants                                                 |
| 52    | Product Web Link                                   | URL to product page — use for weight lookup and supplemental data                      |

---

## Product & Variant Structure

### Parent vs continuation rows

- **Parent row:** `Product Title` column is populated — contains all product-level data
- **Continuation row:** `Product Title` is blank — contains only variant-specific fields (Option values, SKU, Price, Variant Image, variant metafields)

### Image assignment rules

- **Parent row:** CDN URL in `Image Src` only — `Variant Image` is blank
- **Continuation rows:** CDN URL in `Variant Image` only — `Image Src` is blank

### Multi-row variant products (8 products, 20 rows total)

| Handle           | Rows | Option Structure                                                                    |
| ---------------- | ---- | ----------------------------------------------------------------------------------- |
| `resvero-active` | 3    | Formula (softgels/liquid) + Size (90 Softgels / 8 fl. oz. / 16 fl. oz.)             |
| `gut-feeling`    | 3    | Formula (powder/packets) + Flavor (mango-strawberry / unflavored)                   |
| `energybits`     | 2    | Size only (360 Tablets / 1000 Tablets)                                              |
| `recoverybits`   | 2    | Size only (360 Tablets / 1000 Tablets)                                              |
| `immunog-prp`    | 3    | Formula (capsules/powder) + Size (120 Capsules / 15 Servings / 30 Servings)         |
| `turmeric-forte` | 2    | Size only (60 Tablets / 180 Tablets)                                                |
| `optimag-125`    | 2    | Size only (120 Capsules / 240 Capsules)                                             |
| `optimag-neuro`  | 3    | Formula (capsules/powder) + Size (90 Capsules / 30 Servings / 60 Servings) + Flavor |

### Variant option order rule

Always assign option slots in this priority order — skip empty slots:
**Formula → Size → Flavor**

- Formula only → Option1
- Formula + Size → Option1 + Option2
- Formula + Size + Flavor → Option1 + Option2 + Option3
- Size only → Option1
- Size + Flavor → Option1 + Option2

### Supplement size metafield rule

- Product **has Size as a variant option** → `supplement_size` metafield is **blank** (size lives in variant)
- Product **has variants but NOT Size** (e.g. Formula only, or Formula + Flavor) → `supplement_size` metafield is **populated**
- Product **is standalone** (no variants) → `supplement_size` metafield is **populated**

---

## Reference Data

### Supplement categories (20)

```
Appetite, Blood Sugar, Brain, Cardiovascular, Cellular, Endocrine,
Female Vitality, Gastrointestinal, Hepatobiliary, Immune System,
Male Vitality, Metabolism, Mitochondrial Support, Mood, Musculoskeletal,
Occasional Stress, Pets, Protein Support, Sleep, Urinary
```

### Flavors (13)

```
Unflavored, Mango Strawberry, Lemon, Vanilla, Chocolate Banana,
Peppermint, Orange, Peach Mango, Lemon Lime, Citrus, Slightly-Seaweed, Cherry, Mixed Berry
```

All 13 are listed directly in `atx-prod-test-01_sheet_flavors` (including "Mixed Berry", referenced by
`optimag-neuro`'s powder variant — mapped to Taxonomy Value "Other" in `FLAVOR_TAXONOMY`).

### Supplement forms (10)

```
Capsules, Food Topper, Liposomal, Liquid, Lozenges,
Packets, Powder, Softgels, Spray, Tablets
```

### Vendors (21)

```
Apex Energetics, Auro Wellness, Biocidin Botanicals, BodyBio,
CellCore Biosciences, Compass Laboratory, Dr. Wong's Essentials,
ENERGYbits, Fatty15, Integrative Peptides, ION Intelligence of Nature,
N1o1 Nitric Oxide, NeoMyalo | New Mind, NuMedica, Nutraneeds,
Qualia Life Sciences, Standard Process, Stemregen, ValAsta, VerVita, Xymogen
```

---

## Metaobject Definitions (must be created before products)

### 1. Native — Flavor

- **Type:** `shopify--flavor`
- Shopify native metaobject — add the definition, do not create a custom one

### 2. Native — Medicine/Supplement form

- **Type:** `shopify--medicine-supplement-form`
- Shopify native metaobject — add the definition, do not create a custom one

### 3. Custom — Supplement category

- **Type:** `supplement_category`
- **Fields:**
  - `name` — Single line text (one)
  - `description` — Multi-line text (one)
  - `icon` — Image/File (one)
  - `image` — Image/File (one)
- **Entries:** One entry per category — all 20 supplement categories from the reference list above

---

## Metafield Definitions (must be created before products)

### Product metafields

| Key                      | Namespace | Type                                                   | Category Assignment    | Notes                                                         |
| ------------------------ | --------- | ------------------------------------------------------ | ---------------------- | ------------------------------------------------------------- |
| `product_details`        | `custom`  | Rich text (one)                                        | All products           | No category filter                                            |
| `supplement_ingredients` | `custom`  | Rich text (one)                                        | Vitamins & Supplements |                                                               |
| `supplement_size`        | `custom`  | Single line text list                                  | Vitamins & Supplements | e.g. `60 Capsules`                                            |
| `supplement_category`    | `custom`  | List, Metaobject (`supplement_category`)               | Vitamins & Supplements | Min: 1 validation; filter + smart collections enabled         |
| `flavor`                 | `shopify` | List, Metaobject (`shopify--flavor`)                   | Vitamins & Supplements | Filter + smart collections enabled; linked to variant options |
| `food-supplement-form`   | `shopify` | List, Metaobject (`shopify--medicine-supplement-form`) | Vitamins & Supplements | Filter + smart collections enabled; linked to variant options |

### Variant metafields

| Key             | Namespace | Type                   | Notes                                                                        |
| --------------- | --------- | ---------------------- | ---------------------------------------------------------------------------- |
| `variant_title` | `custom`  | Single line text (one) | Smart collections + analytics filter enabled; blank for non-variant products |

### Implementation detail — capabilities & validations (set by `01-setup-metaobjects.js`)

- **`FILTER_CAPABILITIES`** = `{ adminFilterable: { enabled: true }, smartCollectionCondition: { enabled: true } }` —
  applied to `custom.supplement_category`, `shopify.flavor`, and `shopify.food-supplement-form` definitions.
- **`custom.supplement_category`** — `type: list.metaobject_reference` with `validations`:
  `metaobject_definition_id` (pinned to the `supplement_category` metaobject definition's ID) and
  `list.min = "1"`.
- **`custom.variant_title`** — `capabilities: { smartCollectionCondition: { enabled: true } }` only (no
  `adminFilterable`).
- **`shopify.flavor` / `shopify.food-supplement-form`** — enabled via `standardMetafieldDefinitionEnable`
  (native definitions), not `metafieldDefinitionCreate`. Re-running with `code: TAKEN` is treated as success
  (idempotent).
- **Category Assignment** (pinning a metafield definition to "Vitamins & Supplements" instead of "All
  products") — set via `constraints: { key: "category", values: ["gid://shopify/TaxonomyCategory/hb-1-9-6"] }`.
  - For metafields created with `metafieldDefinitionCreate` (`supplement_ingredients`, `supplement_size`,
    `supplement_category`), pass `constraints` directly in the create input.
  - For native metafields enabled via `standardMetafieldDefinitionEnable` (`shopify.flavor`,
    `shopify.food-supplement-form`), `constraints` can't be set on enable — instead, look up the definition
    via `metafieldDefinition(identifier: { ownerType, namespace, key })` and call `metafieldDefinitionUpdate`
    with `constraintsUpdates: { key: "category", values: [{ create: "gid://shopify/TaxonomyCategory/hb-1-9-6" }] }`.
  - The `constraints.values` returned by the API store the bare taxonomy node id (`hb-1-9-6`), not the full
    GID — `ensureCategoryConstraint()` in `01-setup-metaobjects.js` strips the GID prefix when checking for
    an existing constraint.
  - `custom.product_details` intentionally has **no** `constraints` — its Category Assignment stays "All
    products" per the table above.

---

## Resolved — `shopify.flavor` / `shopify.food-supplement-form` via linked options

Previously blocked by a Shopify namespace restriction (see Import Status history below). **Fixed** in
`03-import-products.js` using the **linked metafield option** approach:

- For an option whose `Linked To` column points at `product.metafields.shopify.flavor` or
  `product.metafields.shopify.food-supplement-form` (see `OPTION_LINK_MAP` in `03-import-products.js`):
  - The `productOptions` entry uses `linkedMetafield: { namespace, key, values: [<metaobject GIDs>] }`
    instead of plain `values: [{ name }]`.
  - Each linked option **value's `name` must be the metaobject's label** (e.g. "Softgels"), not the raw
    CSV value (e.g. `softgels`) — `lookupEntry()` resolves the CSV value to `[label, gid]` via
    normalized matching, and `buildOptions()` stores a `valueLabels` map for this.
  - Each variant's `optionValues` entry for that option must also set
    **`linkedMetafieldValue: <metaobject GID>`** (via the `valueGids` map built alongside `valueLabels`) —
    this is what actually associates the variant with the `shopify--flavor` /
    `shopify--medicine-supplement-form` metaobject entry.
  - The product's `category` **must** be set to the Vitamins & Supplements taxonomy node
    (`gid://shopify/TaxonomyCategory/hb-1-9-6`, see `VITAMINS_SUPPLEMENTS_CATEGORY`) — linked metafield
    options for `shopify.flavor` / `shopify.food-supplement-form` are rejected if the product category
    doesn't support those standard metafields.
- For products where flavor/form is **not** a linked variant option, `buildProductMetafields()` writes
  `shopify.flavor` / `shopify.food-supplement-form` directly as ordinary product metafields (list of
  metaobject GIDs from `ids.flavors` / `ids.forms`), exactly like `supplement_category`.
- Both the `shopify--flavor` and `shopify--medicine-supplement-form` metaobject entries require a
  `taxonomy_reference` field (see `FLAVOR_TAXONOMY` / `FORM_TAXONOMY` in `02-setup-metaobject-entries.js`) —
  without it, `metaobjectCreate` rejects the entry.

---

## Import Sequence

The import must run in this order to satisfy dependencies. Each script is idempotent (safe to re-run) and
maps directly to a step below. **The commands below show `--env-file=.env` (dev). For a production run,
substitute `--env-file=.env.production` (or use the `:prod` npm scripts) — see "Running scripts against
each store" above. All steps must be run against the target store; GIDs from one store's
`metaobject-ids.<shop>.json` are not valid in another store.**

```
0. (optional) node --env-file=.env scripts/00-wipe.js
   └── Wipes the store back to empty: deletes all products, the supplement_category /
       shopify--flavor / shopify--medicine-supplement-form metaobject definitions (which
       cascade-delete their entries + linked metafield defs), and the remaining custom
       product/variant metafield definitions.
   └── Only run this for a full clean re-import — NOT part of the normal pipeline.

1. node --env-file=.env scripts/01-setup-metaobjects.js
   └── Enables shopify--flavor / shopify--medicine-supplement-form (native metaobjects)
   └── Creates supplement_category (custom metaobject)
   └── Enables shopify.flavor / shopify.food-supplement-form (native metafields, with
       adminFilterable + smartCollectionCondition capabilities)
   └── Creates custom product metafield defs: product_details, supplement_ingredients,
       supplement_size, supplement_category
   └── Creates custom variant metafield def: variant_title

2. node --env-file=.env scripts/02-setup-metaobject-entries.js
   └── Creates all 20 supplement_category entries
   └── Creates all 13 shopify--flavor entries (from atx-prod-test-01_sheet_flavors), each
       with a taxonomy_reference
   └── Creates all 10 shopify--medicine-supplement-form entries, each with a
       taxonomy_reference
   └── Writes scripts/data/metaobject-ids.<SHOPIFY_SHOP>.json (name -> GID lookup used by step 3;
       file is store-scoped so dev and production lookups don't collide)

3. node --env-file=.env scripts/03-import-products.js [--dry-run] [--limit=N] [--handles=a,b,c] [--publish-only]
   └── For each of the 140 products: builds productOptions (Formula -> Size -> Flavor,
       with linked-metafield options where applicable), variants, product metafields,
       images, SEO, and Supplements collection assignment, then calls productSet
       (synchronous: true, identifier: {handle}) to create/upsert the product by handle.
   └── Status: DRAFT for every product, published to every available sales channel via
       publishablePublish (gated — see step 4).
   └── Rate limit: withRetry() backs off on THROTTLED cost errors.
   └── Idempotent re-runs: products whose `productOptions` include a linked metafield
       option (`shopify.flavor` / `shopify.food-supplement-form` — e.g. `resvero-active`,
       `gut-feeling`, `immunog-prp`, `optimag-neuro`) cannot have `productOptions` resent
       on update — productSet rejects it with `CAPABILITY_VIOLATION` ("connected to an
       option, edit the option instead"), and omitting `productOptions` entirely is
       rejected with `PRODUCT_OPTIONS_INPUT_MISSING` once variants are present. On
       `CAPABILITY_VIOLATION`, the script logs `SKIP — <handle>: already has linked
       metafield option(s)...` and leaves that product's existing (already-correct) data
       untouched, counting it as a success. All other products update normally.

4. Publish to sales channels — `read_publications`/`write_publications` scopes (see
   "Missing scopes" above). `fetchPublicationIds()` queries `{ publications }`; if it
   returns `ACCESS_DENIED` (scopes not granted), the run logs one warning and skips
   publishing — products are still created/updated as DRAFT and unpublished. Once the
   scopes are granted, re-run step 3 (or `--publish-only` to just publish existing
   products by handle to all channels without re-running the rest of the import).
```

---

## Import Status (as of 2026-06-14)

### Latest full rebuild — clean, end to end

- Store was found fully empty (0 products, 0 metaobject/metafield definitions) at the start of
  this run — a prior wipe had reset it since the last rebuild.
- ✅ `01-setup-metaobjects.js` → `02-setup-metaobject-entries.js` → `03-import-products.js` →
  `04-verify.js` run in sequence from an empty store.
- ✅ `03-import-products.js` full run — **140/140 succeeded, 0 failed**, published to all 3
  available sales channels (Online Store, Point of Sale, Shop) via `publishablePublish`.
- ✅ `04-verify.js` — product count 140/140, all products `DRAFT`, all 152 image media `READY`
  (0 failed), linked metafield options correct on `resvero-active`, `gut-feeling`,
  `immunog-prp`, `optimag-neuro`.
- ✅ Idempotency confirmed on repeat runs — `identifier: {handle}` upserts cleanly with no
  duplicates; the 4 linked-option products log `SKIP — ... already has linked metafield
  option(s)` and are counted as success.

### Outstanding tasks

- [ ] Populate `Weight (grams)` from Product Web Link (col 52)
- [ ] Once Lane has reviewed the dev store, advise on next steps (e.g. production transfer run)

### Production Import Prep — for next session

Code is ready for a production run (see code changes below). **Blocked on credentials** — do not
run anything against `neurosolution-shop.myshopify.com` until `.env.production` exists and Lane has
confirmed the go-ahead.

**Code changes already made (this session):**

- `scripts/02-setup-metaobject-entries.js` and `scripts/03-import-products.js` now read/write
  `scripts/data/metaobject-ids.<SHOPIFY_SHOP>.json` (derived from the `SHOPIFY_SHOP` env var)
  instead of a single shared `metaobject-ids.json`. The existing dev file was renamed to
  `metaobject-ids.atx-prod-test-01.json`. This means running step 2 against production will write
  a separate `metaobject-ids.neurosolution-shop.json` without touching the dev file.
- Added `:prod` npm scripts (`setup:metaobjects:prod`, `setup:entries:prod`,
  `import:products:prod`, `verify:prod`) that run the same scripts with `--env-file=.env.production`.
- `.gitignore` now ignores `.env.*` in addition to `.env`.

**Checklist for the next session (in order):**

1. [ ] Lane installs the `atx-prod-ingest` app on `neurosolution-shop.myshopify.com` (Shopify Dev
       Dashboard, Onn Grid partner account) with Client Credentials Grant and the same scopes as
       the dev store (see "App scopes" above, including `read_publications`/`write_publications`).
2. [ ] Lane provides the resulting client ID/secret; create `.env.production` in the project root
       with `SHOPIFY_SHOP=neurosolution-shop`, `SHOPIFY_CLIENT_ID=...`, `SHOPIFY_CLIENT_SECRET=...`.
3. [ ] Before running anything, check the current state of `neurosolution-shop` (product count,
       existing metaobject/metafield definitions) — it's a **client transfer store** and may
       already contain data. Use a read-only query (like the one used to inspect
       `atx-prod-test-01` before this session's rebuild) rather than assuming it's empty.
4. [ ] **Do not run `00-wipe.js` against production** unless Lane explicitly confirms the store
       should be wiped first — confirm with Lane regardless of what step 3 finds.
5. [ ] Run `npm run setup:metaobjects:prod` → `npm run setup:entries:prod` →
       `npm run import:products:prod` → `npm run verify:prod`, in that order.
6. [ ] Review `04-verify.js` output against production (140/140 products, all DRAFT, image media
       READY, linked metafield options correct on `resvero-active`, `gut-feeling`, `immunog-prp`,
       `optimag-neuro`).
7. [ ] Confirm with Lane before changing any product `status` from `DRAFT` to `ACTIVE` on
       production — that's a separate decision from the import itself.

---

## Important Rules

- **Always test against dev store first** — never run untested scripts against production
- **All API calls use GraphQL** — no REST, no CSV import tool
- **Never commit `.env` to git**
- **Tokens auto-refresh** via `api.js` — no manual curl needed
- **Check product count before re-running import** — do not duplicate products in dev store
- **Production store** (`neurosolution-shop.myshopify.com`) is a client transfer store — treat with care, confirm with Lane before any production run
- **Shopify Dev MCP is installed** — use it as a Shopify docs reference when planning or implementing solutions

---

## About NeuroSolution ATX

NeuroSolution Center of Austin is a specialized neuroclinical practice offering drug-free regenerative therapies for complex neurological conditions. Dr. Brandon Crawford's clinic combines neurorestoration science with proprietary methods.

**Primary website:** `neurosolutionatx.com`
**Company Context Markdown File** `NEUROSOLUTION_COMPANY.md` ('/Users/lanemelancon/Library/CloudStorage/GoogleDrive-hello@onngrid.com/My Drive/01_Clients/NeuroSolution/NeuroSolution ATX/NeuroSolution Supplement Store/00_Context/NEUROSOLUTION_COMPANY.md')
